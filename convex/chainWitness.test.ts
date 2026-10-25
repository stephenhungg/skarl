import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import { makeFunctionReference, type ApiFromModules } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type * as chainWitness from "./chainWitness";
import schema from "./schema";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/chain";
import type { CdpWitnessResult } from "./lib/cdpSql";

// Simulated CDP/RPC evidence only. These tests perform no chain or provider calls.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
type WitnessApi = ApiFromModules<{ chainWitness: typeof chainWitness }>["chainWitness"];
const ref = <K extends keyof WitnessApi>(name: K) => makeFunctionReference(`chainWitness:${name}`) as WitnessApi[K];
const SECRET = "synthetic-service-secret-for-chain-witness-tests";
const PAYER = `0x${"11".repeat(20)}`;
const TREASURY = `0x${"22".repeat(20)}`;
const TX = `0x${"bb".repeat(32)}`;
const NONCE = `0x${"aa".repeat(32)}`;
const OTHER = `0x${"cc".repeat(32)}`;

beforeEach(() => { vi.useFakeTimers(); vi.stubEnv("SKARL_PAYMENTS_SERVICE_SECRET", SECRET); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });
async function setup() {
  const t = convexTest(schema, modules);
  workflowTest.register(t);
  const seeded = await t.mutation(internal.seed.demo, {});
  const funding = await t.mutation(api.payments.recordFundingAttempt, { serviceSecret: SECRET,
    orderId: seeded.orderId, demoIdentity: "buyer", payerAddress: PAYER, recipientAddress: TREASURY,
    authorizationNonce: NONCE, amountAtomic: 100_000_000n, validBefore: Date.now() + 60_000 });
  const event = { serviceSecret: SECRET, treasury: TREASURY, eventId: "synthetic-event-1", network: PAYMENT_NETWORK,
    tokenAddress: USDC_ADDRESS, txHash: TX, logIndex: 3, fromAddress: PAYER, toAddress: TREASURY, amountAtomic: "100000000" };
  const observation = { network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, txHash: TX, logIndex: 3,
    blockNumber: 123n, blockHash: `0x${"dd".repeat(32)}`, fromAddress: PAYER, toAddress: TREASURY,
    amountAtomic: 100_000_000n, confirmations: 2, succeeded: true, observedAt: Date.now() };
  return { t, ...seeded, funding, event, observation, scope: { demoIdentity: "controller", orderId: seeded.orderId } };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function confirm(f: Fixture) {
  await f.t.mutation(api.payments.confirmFunding, { serviceSecret: SECRET, attemptId: f.funding.attemptId,
    authorizationNonce: NONCE, observation: f.observation });
}
function indexed(f: Fixture): CdpWitnessResult {
  const o = f.observation;
  return { status: "available", fetchedAt: Date.now(), transfers: [{ network: PAYMENT_NETWORK,
    tokenAddress: USDC_ADDRESS.toLowerCase(), txHash: TX, logIndex: o.logIndex, fromAddress: PAYER, toAddress: TREASURY,
    amountAtomic: o.amountAtomic.toString(), blockHash: o.blockHash, blockNumber: o.blockNumber.toString() }] };
}
async function store(f: Fixture, result: CdpWitnessResult) {
  await f.t.mutation(ref("storeSnapshot"), { ...f.scope, treasury: TREASURY, resultJson: JSON.stringify(result) });
}

describe("CDP webhook trust and idempotency", () => {
  it("refuses unauthorized service ingress without persisting a receipt", async () => {
    const f = await setup();
    for (const secret of ["", "bad", "x".repeat(SECRET.length)]) {
      await expect(f.t.mutation(ref("receiveWebhook"), { ...f.event, serviceSecret: secret })).rejects.toThrow("payment_service_unauthorized");
    }
    expect(await f.t.run(ctx => ctx.db.query("cdpWebhookReceipts").collect())).toEqual([]);
  });

  it("deduplicates both delivery identity and transaction/log identity, refusing changed evidence", async () => {
    const f = await setup();
    const first = await f.t.mutation(ref("receiveWebhook"), f.event);
    expect(first.candidates).toEqual([{ attemptId: f.funding.attemptId, kind: "funding", authorizationNonce: NONCE }]);
    expect(await f.t.mutation(ref("receiveWebhook"), f.event)).toMatchObject({ receiptId: first.receiptId, replayed: true });
    expect(await f.t.mutation(ref("receiveWebhook"), { ...f.event, eventId: "redelivery-from-second-subscription" }))
      .toMatchObject({ receiptId: first.receiptId, replayed: true });
    for (const change of [{ amountAtomic: "100000001" }, { txHash: OTHER }, { logIndex: 4 }]) {
      await expect(f.t.mutation(ref("receiveWebhook"), { ...f.event, ...change })).rejects.toThrow("webhook_event_conflict");
    }
    expect(await f.t.run(ctx => ctx.db.query("cdpWebhookReceipts").collect())).toHaveLength(1);
    expect(await f.t.run(ctx => ctx.db.query("journalEntries").collect())).toHaveLength(0);
    expect((await f.t.run(ctx => ctx.db.get(f.orderId)))?.status).toBe("awaiting_funding");
  });

  it("requires canonical reconciliation before marking processed and preserves it on retries", async () => {
    const f = await setup();
    const received = await f.t.mutation(ref("receiveWebhook"), f.event);
    const finish = { serviceSecret: SECRET, receiptId: received.receiptId, status: "processed" as const };
    await expect(f.t.mutation(ref("finishWebhook"), finish)).rejects.toThrow("webhook_not_reconciled");
    await confirm(f);
    await f.t.mutation(ref("finishWebhook"), finish);
    await f.t.mutation(ref("finishWebhook"), { ...finish, status: "unknown_transfer" });
    expect(await f.t.mutation(ref("receiveWebhook"), f.event)).toMatchObject({ processed: true, replayed: true, candidates: [] });
    expect((await f.t.run(ctx => ctx.db.get(received.receiptId)))?.status).toBe("processed");
    expect(await f.t.run(ctx => ctx.db.query("journalEntries").collect())).toHaveLength(1);
  });

  it("adds unknown transfers to the existing exception disposition queue without posting cash", async () => {
    const f = await setup();
    const received = await f.t.mutation(ref("receiveWebhook"), { ...f.event, amountAtomic: "7" });
    expect(received.candidates).toHaveLength(0);
    await f.t.mutation(ref("finishWebhook"), { serviceSecret: SECRET, receiptId: received.receiptId, status: "unknown_transfer" });
    const queue = await f.t.query(api.exceptions.list, f.scope);
    const unknown = queue.find(row => row.exception.code === "unknown_transfer")!;
    expect(unknown).toMatchObject({ stillDetected: true, disposition: null });
    const args = { ...f.scope, exceptionKey: unknown.exceptionKey, reason: "Investigating synthetic unmatched deposit" };
    const acknowledged = await f.t.mutation(api.exceptions.acknowledge, args);
    expect(await f.t.mutation(api.exceptions.acknowledge, args)).toEqual({ ...acknowledged, replayed: true });
    await f.t.mutation(api.exceptions.resolve, args);
    const resolved = (await f.t.query(api.exceptions.list, f.scope)).find(row => row.exceptionKey === unknown.exceptionKey);
    expect(resolved).toMatchObject({ stillDetected: true, disposition: { status: "resolved" } });
    expect(await f.t.run(ctx => ctx.db.query("journalEntries").collect())).toHaveLength(0);
  });

  it("refuses ambiguous treasury ownership across tenants", async () => {
    const f = await setup();
    await f.t.run(async ctx => {
      const org = await ctx.db.get(f.organizationId);
      const intent = await ctx.db.query("paymentIntents").first();
      if (!org || !intent) throw new Error("fixture_missing");
      const { _id: orgId, _creationTime: orgTime, ...orgFields } = org;
      const foreignId = await ctx.db.insert("organizations", { ...orgFields, name: "Synthetic foreign treasury owner" });
      const { _id, _creationTime, ...fields } = intent;
      await ctx.db.insert("paymentIntents", { ...fields, organizationId: foreignId, intentId: "synthetic-foreign-intent" });
    });
    await expect(f.t.mutation(ref("receiveWebhook"), f.event)).rejects.toThrow("treasury_scope_unavailable");
    expect(await f.t.run(ctx => ctx.db.query("cdpWebhookReceipts").collect())).toHaveLength(0);
  });

  it("rejects wrong network, token, scope and noncanonical money", async () => {
    const f = await setup();
    for (const change of [{ network: "eip155:8453" }, { tokenAddress: PAYER }, { treasury: PAYER, fromAddress: TREASURY },
      { amountAtomic: "1.5" }, { amountAtomic: "01" }, { amountAtomic: (2n ** 256n).toString() }]) {
      await expect(f.t.mutation(ref("receiveWebhook"), { ...f.event, ...change })).rejects.toThrow();
    }
    expect(await f.t.run(ctx => ctx.db.query("cdpWebhookReceipts").collect())).toHaveLength(0);
  });
});

describe("CDP witness projections", () => {
  it("preserves reconciled matches when CDP is missing/unavailable/stale or disagrees", async () => {
    const f = await setup();
    await confirm(f);
    let result = await f.t.query(ref("reconciliationWithWitness"), f.scope);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.witness.status).toBe("witness_unavailable");
    await store(f, indexed(f));
    result = await f.t.query(ref("reconciliationWithWitness"), f.scope);
    expect(result.matches[0]?.witness.status).toBe("match");
    await store(f, { status: "available", transfers: [], fetchedAt: Date.now() });
    expect((await f.t.query(ref("reconciliationWithWitness"), f.scope)).matches[0]?.witness.status).toBe("missing");
    const mismatch = indexed(f);
    if (mismatch.status === "available") mismatch.transfers[0]!.amountAtomic = "100000001";
    await store(f, mismatch);
    expect((await f.t.query(ref("reconciliationWithWitness"), f.scope)).matches[0]?.witness.status).toBe("mismatch");
    await store(f, { status: "witness_unavailable", reason: "rate_limited", fetchedAt: Date.now() });
    result = await f.t.query(ref("reconciliationWithWitness"), f.scope);
    expect(result.witness).toMatchObject({ status: "witness_unavailable", reason: "rate_limited" });
    expect(result.matches).toHaveLength(1);
    await store(f, indexed(f));
    vi.advanceTimersByTime(120_001);
    expect((await f.t.query(ref("reconciliationWithWitness"), f.scope)).matches[0]?.witness.status).toBe("witness_unavailable");
    expect(await f.t.run(ctx => ctx.db.query("journalEntries").collect())).toHaveLength(1);
  });

  it("lets the owning buyer inspect chain witnesses for organization peers while refusing contributors and foreign tenants", async () => {
    const f = await setup();
    expect(await f.t.query(ref("reconciliationWithWitness"), {...f.scope, demoIdentity: "buyer"})).toEqual(await f.t.query(ref("reconciliationWithWitness"), f.scope));
    expect(await f.t.query(ref("webhookExceptions"), {...f.scope, demoIdentity: "buyer"})).toEqual(await f.t.query(ref("webhookExceptions"), f.scope));
    await f.t.run(ctx => ctx.db.patch(f.orderId, {buyerTokenIdentifier: "fixture:other-buyer"}));
    expect(await f.t.query(ref("reconciliationWithWitness"), {...f.scope, demoIdentity: "buyer"})).toEqual(await f.t.query(ref("reconciliationWithWitness"), f.scope));
    expect(await f.t.query(ref("webhookExceptions"), {...f.scope, demoIdentity: "buyer"})).toEqual(await f.t.query(ref("webhookExceptions"), f.scope));
    for (const demoIdentity of ["contributor"]) {
      await expect(f.t.query(ref("reconciliationWithWitness"), { ...f.scope, demoIdentity })).rejects.toThrow("forbidden");
      await expect(f.t.query(ref("webhookExceptions"), { ...f.scope, demoIdentity })).rejects.toThrow("forbidden");
    }
    const foreignOrder = await f.t.run(async ctx => {
      const org = await ctx.db.get(f.organizationId), order = await ctx.db.get(f.orderId);
      if (!org || !order) throw new Error("fixture_missing");
      const { _id: orgId, _creationTime: orgTime, ...orgFields } = org;
      const foreignId = await ctx.db.insert("organizations", { ...orgFields, name: "Synthetic foreign organization" });
      const { _id, _creationTime, ...orderFields } = order;
      return ctx.db.insert("orders", { ...orderFields, organizationId: foreignId, publicId: "synthetic-foreign-order" });
    });
    for (const demoIdentity of ["buyer", "controller", "finance-agent"]) await expect(f.t.query(ref("reconciliationWithWitness"), {...f.scope, demoIdentity, orderId: foreignOrder})).rejects.toThrow("cross_organization_access");
    for (const demoIdentity of ["buyer", "controller", "finance-agent"]) await expect(f.t.query(ref("webhookExceptions"), {...f.scope, demoIdentity, orderId: foreignOrder})).rejects.toThrow("cross_organization_access");
    expect(await f.t.query(ref("witnessInputs"), { ...f.scope, demoIdentity: "finance-agent" })).toEqual({ treasury: TREASURY, txHashes: [] });
  });

  it("durably gates parallel refreshes and honors the snapshot cache", async () => {
    const f = await setup();
    const first = await f.t.mutation(ref("reserveRefresh"), f.scope);
    expect(first).toBe(true);
    expect(await f.t.mutation(ref("reserveRefresh"), f.scope)).toBe(false);
    vi.advanceTimersByTime(15_001);
    expect(await f.t.mutation(ref("reserveRefresh"), f.scope)).toBe(true);
    await store(f, indexed(f));
    vi.advanceTimersByTime(15_001);
    expect(await f.t.mutation(ref("reserveRefresh"), f.scope)).toBe(false);
    vi.advanceTimersByTime(15_000);
    expect(await f.t.mutation(ref("reserveRefresh"), f.scope)).toBe(true);
    expect(await f.t.run(ctx => ctx.db.query("cdpQueryGate").collect())).toHaveLength(1);
  });

  it("stores an honest unavailable snapshot when the client key is absent", async () => {
    const f = await setup();
    vi.stubEnv("CDP_CLIENT_API_KEY", undefined);
    expect(await f.t.action(ref("refresh"), f.scope)).toEqual({ status: "witness_unavailable" });
    expect((await f.t.query(ref("reconciliationWithWitness"), f.scope)).witness).toMatchObject({
      status: "witness_unavailable", reason: "client_key_not_configured" });
    expect(await f.t.action(ref("refresh"), f.scope)).toEqual({ status: "cached_or_rate_limited" });
  });
});
