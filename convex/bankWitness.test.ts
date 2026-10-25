import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import { makeFunctionReference, type ApiFromModules } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type * as bankWitness from "./bankWitness";
import type * as refunds from "./refunds";
import { BANK_FRESH_MS, BANK_LABEL } from "./bankWitness";
import type { BankActivity } from "./lib/nessie";
import schema from "./schema";
import { runScheduledUntil } from "../test/workflow";
import { createFulfillmentJournal } from "../packages/ledger/src/index";
import { recordJournal } from "./lib/finance";
import { PAYMENT_CHAIN_ID, PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/chain";

// Synthetic provider/RPC fixtures only. These tests perform no live bank or chain calls.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
type BankApi = ApiFromModules<{ bankWitness: typeof bankWitness }>["bankWitness"];
const ref = <K extends keyof BankApi>(name: K) => makeFunctionReference(`bankWitness:${name}`) as BankApi[K];
type RefundApi = ApiFromModules<{refunds: typeof refunds}>["refunds"];
const refundRef = <K extends keyof RefundApi>(name: K) => makeFunctionReference(`refunds:${name}`) as RefundApi[K];
const SECRET = "synthetic-service-secret-for-bank-witness-tests";
const PAYER = `0x${"11".repeat(20)}`;
const TREASURY = `0x${"22".repeat(20)}`;
const TX = `0x${"bb".repeat(32)}`;
const NONCE = `0x${"aa".repeat(32)}`;
const BANK_ACCOUNT = "synthetic-treasury";
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("SKARL_PAYMENTS_SERVICE_SECRET", SECRET);
  vi.stubEnv("NESSIE_ENABLED", "true");
  vi.stubEnv("NESSIE_API_KEY", "synthetic-key-never-a-real-credential");
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function setup() {
  const t = convexTest(schema, modules);
  workflowTest.register(t);
  const seeded = await t.mutation(internal.seed.demo, {});
  const funding = await t.mutation(api.payments.recordFundingAttempt, {serviceSecret: SECRET,
    orderId: seeded.orderId, demoIdentity: "buyer", payerAddress: PAYER, recipientAddress: TREASURY,
    authorizationNonce: NONCE, amountAtomic: 100_000_000n, validBefore: Date.now() + 60_000});
  const attempt = await t.run(ctx => ctx.db.get(funding.attemptId));
  if (!attempt?.paymentIntentId) throw new Error("missing_synthetic_funding_intent");
  const intentId = attempt.paymentIntentId;
  const intent = await t.run(ctx => ctx.db.get(intentId));
  if (!intent) throw new Error("missing_synthetic_funding_intent");
  return {t, ...seeded, funding, intentId, intent, scope: {demoIdentity: "controller", orderId: seeded.orderId}};
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function confirm(f: Fixture) {
  await f.t.mutation(api.payments.confirmFunding, {serviceSecret: SECRET, attemptId: f.funding.attemptId,
    authorizationNonce: NONCE, observation: {network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS,
      txHash: TX, logIndex: 3, blockNumber: 123n, blockHash: `0x${"dd".repeat(32)}`,
      fromAddress: PAYER, toAddress: TREASURY, amountAtomic: 100_000_000n,
      confirmations: 2, succeeded: true, observedAt: Date.now()}});
}
async function treasury(f: Fixture) {
  const [id] = await f.t.mutation(ref("prepareAccounts"), {});
  if (!id) throw new Error("missing_synthetic_treasury");
  await f.t.mutation(ref("claimAccountStep"), {id});
  await f.t.mutation(ref("finishAccountStep"), {id, step: "customer", externalId: "synthetic-customer"});
  await f.t.mutation(ref("claimAccountStep"), {id});
  await f.t.mutation(ref("finishAccountStep"), {id, step: "account", externalId: BANK_ACCOUNT});
  return id;
}
function activity(f: Fixture, changes: Partial<BankActivity> = {}): BankActivity {
  return {id: "synthetic-deposit", kind: "deposit", accountId: BANK_ACCOUNT, amountAtomic: "100000000",
    description: f.intent.intentId, status: "completed", ...changes};
}
async function snapshot(f: Fixture, rows: BankActivity[]) {
  await f.t.mutation(ref("storeSnapshot"), {organizationId: f.organizationId, accountId: BANK_ACCOUNT,
    status: "available", activitiesJson: JSON.stringify(rows)});
}
async function prepared(f: Fixture) {
  await confirm(f); await treasury(f); await snapshot(f, []);
  const operation = await f.t.mutation(ref("claimOperation"), {intentId: f.intentId});
  if (!operation) throw new Error("missing_synthetic_bank_operation");
  return operation;
}

describe("Nessie durable simulated bank intent", () => {
  it("seeds only treasury and verified active contributors, with stable account identities", async () => {
    const f = await setup();
    const initial = await f.t.mutation(ref("prepareAccounts"), {});
    expect(initial).toHaveLength(1);
    expect(await f.t.mutation(ref("prepareAccounts"), {})).toEqual(initial);
    await f.t.run(async ctx => {
      const contributor = await ctx.db.query("memberships").withIndex("by_token_identifier", q => q.eq("tokenIdentifier", "demo:skarl:contributor")).unique();
      if (!contributor) throw new Error("missing_synthetic_contributor");
      await ctx.db.patch(contributor._id, {walletAddress: PAYER, walletVerification: {
        siweMessageHash: "synthetic-message-hash", nonce: "synthetic-nonce", signature: "synthetic-signature",
        chainId: PAYMENT_CHAIN_ID, verifiedAt: Date.now()}});
    });
    const verifiedAccounts = await f.t.mutation(ref("prepareAccounts"), {});
    expect(verifiedAccounts).toHaveLength(2);
    expect(verifiedAccounts[0]).toBe(initial[0]);
    expect(await f.t.mutation(ref("prepareAccounts"), {})).toEqual(verifiedAccounts);
  });

  it("claims each account POST once and retains ambiguity after a lost response", async () => {
    const f = await setup();
    const [id] = await f.t.mutation(ref("prepareAccounts"), {});
    expect(id).toBeDefined();
    expect(await f.t.mutation(ref("claimAccountStep"), {id: id!})).toMatchObject({status: "creating_customer"});
    expect(await f.t.mutation(ref("claimAccountStep"), {id: id!})).toBeNull();
    await f.t.mutation(ref("finishAccountStep"), {id: id!, step: "customer", errorCode: "nessie_timeout"});
    expect(await f.t.mutation(ref("claimAccountStep"), {id: id!})).toBeNull();
    expect(await f.t.run(ctx => ctx.db.get(id!))).toMatchObject({status: "creating_customer", errorCode: "nessie_timeout"});
  });

  it("runs idempotent mocked seeding without sending contributor personal data", async () => {
    const f = await setup();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      expect(JSON.stringify(body)).not.toContain("demo:skarl");
      return response({objectCreated: {_id: body.first_name ? "synthetic-customer" : BANK_ACCOUNT}}, 201);
    });
    vi.stubGlobal("fetch", fetchMock);
    await f.t.action(ref("seed"), {});
    await f.t.action(ref("seed"), {});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await f.t.run(ctx => ctx.db.query("bankAccounts").collect())).toMatchObject([{status: "ready", accountId: BANK_ACCOUNT}]);
  });

  it("does not prepare bank money from an unconfirmed funding intent or stale bank read", async () => {
    const f = await setup();
    await treasury(f); await snapshot(f, []);
    expect(await f.t.mutation(ref("claimOperation"), {intentId: f.intentId})).toBeNull();
    await confirm(f);
    await f.t.run(async ctx => {
      const stored = await ctx.db.query("bankSnapshots").first();
      if (!stored) throw new Error("missing_synthetic_snapshot");
      await ctx.db.patch(stored._id, {fetchedAt: Date.now() - BANK_FRESH_MS - 1});
    });
    expect(await f.t.mutation(ref("claimOperation"), {intentId: f.intentId})).toBeNull();
    expect(await f.t.run(ctx => ctx.db.query("bankOperations").collect())).toEqual([]);
  });

  it("reserves confirmed funding once and refuses replay after ambiguous submission", async () => {
    const f = await setup();
    const operation = await prepared(f);
    expect(operation).toMatchObject({status: "sending", kind: "deposit", amountAtomic: 100_000_000n});
    expect(await f.t.mutation(ref("claimOperation"), {intentId: f.intentId})).toBeNull();
    await f.t.mutation(ref("finishOperation"), {id: operation._id, errorCode: "nessie_timeout"});
    expect(await f.t.mutation(ref("claimOperation"), {intentId: f.intentId})).toBeNull();
    expect(await f.t.run(ctx => ctx.db.get(operation._id))).toMatchObject({status: "uncertain"});
    expect(await f.t.run(ctx => ctx.db.query("bankOperations").collect())).toHaveLength(1);
    expect(await f.t.run(ctx => ctx.db.query("journalEntries").collect())).toHaveLength(1);
  });

  it("off-ramps only a confirmed payout to its verified contributor account with exact transfer evidence", async () => {
    const f = await setup(); await confirm(f); await treasury(f);
    const recipient = `0x${"33".repeat(20)}`;
    const walletVerification = {siweMessageHash: "synthetic-message-hash", nonce: "synthetic-nonce",
      signature: "synthetic-signature", chainId: PAYMENT_CHAIN_ID, verifiedAt: Date.now()};
    const {payableId, contributorId} = await f.t.run(async ctx => {
      const contributor = await ctx.db.query("memberships").withIndex("by_token_identifier", q => q.eq("tokenIdentifier", "demo:skarl:contributor")).unique();
      if (!contributor) throw new Error("missing_synthetic_contributor");
      await ctx.db.patch(contributor._id, {walletAddress: recipient, walletVerification});
      const now = Date.now();
      // Only acceptance/media evidence is synthetic pre-existing state. Proposal,
      // independent approval, dispatch and chain observation use policy mutations.
      const submissionId = await ctx.db.insert("submissions", {organizationId: f.organizationId,
        orderId: f.orderId, taskVersionId: f.taskVersionId, contributorTokenIdentifier: contributor.tokenIdentifier,
        status: "accepted", clientRequestId: "synthetic-bank-payout", updatedAt: now});
      const decisionId = await ctx.db.insert("reviewDecisions", {organizationId: f.organizationId,
        submissionId, taskVersionId: f.taskVersionId, decisionKey: "synthetic-bank-decision", decision: "accepted",
        reviewerTokenIdentifier: "demo:skarl:controller", reason: "Synthetic accepted work fixture", evidenceHash: "f".repeat(64), decidedAt: now});
      await recordJournal(ctx, f.organizationId, createFulfillmentJournal({eventId: `fulfillment:${submissionId}`,
        orderId: f.orderId, sampleId: submissionId, contributorId: contributor.tokenIdentifier,
        priceMicroUsdc: 10_000_000n, contributorMicroUsdc: 7_500_000n}));
      const payableId = await ctx.db.insert("payables", {organizationId: f.organizationId, orderId: f.orderId,
        submissionId, decisionId, network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS,
        contributorTokenIdentifier: contributor.tokenIdentifier, recipientAddress: recipient, amountAtomic: 7_500_000n,
        sourceEventKey: `fulfillment:${submissionId}`, status: "accrued", createdAt: now});
      return {payableId, contributorId: contributor._id};
    });
    const accounts = await f.t.mutation(ref("prepareAccounts"), {});
    const contributorAccount = accounts[1]!;
    await f.t.mutation(ref("claimAccountStep"), {id: contributorAccount});
    await f.t.mutation(ref("finishAccountStep"), {id: contributorAccount, step: "customer", externalId: "synthetic-contributor-customer"});
    await f.t.mutation(ref("claimAccountStep"), {id: contributorAccount});
    await f.t.mutation(ref("finishAccountStep"), {id: contributorAccount, step: "account", externalId: "synthetic-contributor-account"});
    await snapshot(f, []);
    const proposal = await f.t.mutation(api.finance.proposePayment, {demoIdentity: "finance-agent", payableId});
    if (!proposal.ok) throw new Error(proposal.code);
    expect(await f.t.mutation(ref("claimOperation"), {intentId: proposal.intentId})).toBeNull();
    const approved = await f.t.mutation(api.finance.approve, {demoIdentity: "controller", intentId: proposal.intentId});
    if (!approved.ok) throw new Error(approved.code);
    await runScheduledUntil(async () => {
      const dispatch = await f.t.run(ctx => ctx.db.query("outboxEvents").withIndex("by_event_key", q =>
        q.eq("organizationId", f.organizationId).eq("eventKey", `dispatch:${proposal.paymentCommandId}`)).unique());
      return dispatch?.status === "pending";
    });
    const claim = await f.t.mutation(api.payments.claimPayout, {serviceSecret: SECRET, intentId: proposal.intentId,
      demoIdentity: "controller", senderAddress: TREASURY, treasuryAddress: TREASURY, claimId: "synthetic-bank-payout-claim-0001"});
    await f.t.mutation(api.payments.recordPayoutObservation, {serviceSecret: SECRET, attemptId: claim.attemptId,
      observation: {network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, txHash: `0x${"cc".repeat(32)}`,
        logIndex: 4, blockNumber: 124n, blockHash: `0x${"ee".repeat(32)}`, fromAddress: TREASURY, toAddress: recipient,
        amountAtomic: 7_500_000n, confirmations: 2, succeeded: true, observedAt: Date.now()}});
    await f.t.run(ctx => ctx.db.patch(contributorId, {walletVerification: undefined}));
    expect(await f.t.mutation(ref("claimOperation"), {intentId: proposal.intentId})).toBeNull();
    await f.t.run(ctx => ctx.db.patch(contributorId, {walletVerification}));
    const operation = await f.t.mutation(ref("claimOperation"), {intentId: proposal.intentId});
    expect(operation).toMatchObject({kind: "transfer", accountId: BANK_ACCOUNT, payeeId: "synthetic-contributor-account", amountAtomic: 7_500_000n});
    if (!operation) throw new Error("missing_synthetic_payout_operation");
    await snapshot(f, [{id: "synthetic-offramp", kind: "transfer", accountId: BANK_ACCOUNT,
      payeeId: "synthetic-contributor-account", amountAtomic: "7500000", description: operation.intentId, status: "completed"}]);
    const payout = (await f.t.query(ref("reconciliation4Way"), f.scope)).rows.find(row => row.kind === "contributor_payout");
    expect(payout).toMatchObject({order: {status: "match"}, ledger: {status: "match"}, chain: {status: "match"}, bank: {status: "match"}});
    expect(await f.t.mutation(ref("claimOperation"), {intentId: proposal.intentId})).toBeNull();
    const journals = await f.t.run(ctx => ctx.db.query("journalEntries").collect());
    expect(journals.filter(row => row.kind === "payout")).toHaveLength(1);
  });

  it("observes a preexisting matching intent description without issuing another POST", async () => {
    const f = await setup();
    await confirm(f); await treasury(f); await snapshot(f, [activity(f)]);
    expect(await f.t.mutation(ref("claimOperation"), {intentId: f.intentId})).toBeNull();
    expect(await f.t.run(ctx => ctx.db.query("bankOperations").collect())).toMatchObject([{status: "observed"}]);
    expect((await f.t.query(ref("reconciliation4Way"), f.scope)).rows[0]?.bank.status).toBe("match");
  });
});

describe("Nessie fourth witness projection", () => {
  it("compares a labeled scenario snapshot through the real bank detector without replacing treasury evidence", async () => {
    const f = await setup(); await prepared(f); await snapshot(f, [activity(f)]);
    const beforeSnapshot = await f.t.run(ctx => ctx.db.query("bankSnapshots").collect());
    const scenarioId = "bank-isolation-test";
    const accountId = `SIMULATED:${scenarioId}:treasury`;
    const lab = await f.t.run(async ctx => {
      const source = await ctx.db.get(f.orderId);
      if (!source) throw new Error("missing_source_order");
      const {_id, _creationTime, ...fields} = source;
      const orderId = await ctx.db.insert("orders", {...fields, publicId: `scenario:${scenarioId}`,
        title: `SIMULATED ${scenarioId}`, status: "awaiting_funding", acceptedCount: 0n});
      const {_id: sourceIntentId, _creationTime: intentTime, ...terms} = f.intent;
      const intentId = `SIMULATED:${scenarioId}:funding`;
      const paymentIntentId = await ctx.db.insert("paymentIntents", {...terms, orderId, intentId, status: "settlement_pending"});
      await ctx.db.insert("bankOperations", {organizationId: f.organizationId, orderId, paymentIntentId, intentId,
        kind: "deposit", amountAtomic: terms.amountAtomic, accountId, status: "submitted", createdAt: Date.now(), updatedAt: Date.now()});
      return {orderId, intentId};
    });
    // A lab order never borrows an existing treasury snapshot, even before its own snapshot is stored.
    const labScope = {...f.scope, orderId: lab.orderId};
    expect((await f.t.query(ref("reconciliation4Way"), labScope)).bankAvailable).toBe(false);
    await f.t.mutation(ref("storeSnapshot"), {organizationId: f.organizationId, accountId, status: "available",
      scenarioOrderId: lab.orderId, scenarioId,
      activitiesJson: JSON.stringify([activity(f, {id: `SIMULATED:${scenarioId}:row`, accountId,
        description: lab.intentId, amountAtomic: "100000001"})])});
    const read = await f.t.query(ref("reconciliation4Way"), labScope);
    expect(read.rows[0]?.bank).toMatchObject({status: "mismatch", reason: "bank_binding_or_amount_mismatch", amountAtomic: "100000001"});
    expect(read.exceptions).toContainEqual(expect.objectContaining({code: "bank_mismatch", eventKey: lab.intentId}));
    expect(await f.t.run(ctx => ctx.db.query("bankSnapshots").collect())).toEqual(beforeSnapshot);
    expect((await f.t.query(ref("reconciliation4Way"), f.scope)).rows[0]?.bank.status).toBe("match");
    expect(await f.t.run(ctx => ctx.db.query("journalEntries").withIndex("by_order", q => q.eq("orderId", lab.orderId)).collect())).toEqual([]);
    const event = await f.t.run(ctx => ctx.db.query("auditEvents").withIndex("by_event_key", q =>
      q.eq("organizationId", f.organizationId).eq("eventKey", `scenario-bank:${scenarioId}`)).unique());
    expect(JSON.parse(event!.reason)).toMatchObject({simulated: true, scenarioId, accountId});
    await expect(f.t.mutation(ref("storeSnapshot"), {organizationId: f.organizationId, accountId, status: "available",
      scenarioOrderId: f.orderId, scenarioId, activitiesJson: "[]"})).rejects.toThrow("scenario_bank_scope_invalid");
  });

  it("reports match, missing, amount mismatch, pending, duplicate and stale bank evidence honestly", async () => {
    const f = await setup(); await prepared(f);
    const read = () => f.t.query(ref("reconciliation4Way"), f.scope);
    expect((await read()).rows[0]).toMatchObject({order: {status: "match"}, ledger: {status: "match"}, chain: {status: "match"}, bank: {status: "missing"}});
    await snapshot(f, [activity(f)]);
    const matched = await read();
    expect(matched).toMatchObject({label: BANK_LABEL, simulated: true, bankAvailable: true});
    expect(matched.rows[0]?.bank.status).toBe("match");
    expect(matched.reconciliation.matches[0]?.amountAtomic).toBe("100000000");
    await snapshot(f, [activity(f, {amountAtomic: "100000001"})]);
    expect((await read()).rows[0]?.bank.status).toBe("mismatch");
    expect((await read()).exceptions).toContainEqual(expect.objectContaining({code: "bank_mismatch", eventKey: f.intent.intentId}));
    await snapshot(f, [activity(f, {status: "pending"})]);
    expect((await read()).rows[0]?.bank).toMatchObject({status: "missing", reason: "bank_record_pending"});
    await snapshot(f, [activity(f), activity(f, {id: "synthetic-duplicate"})]);
    expect((await read()).rows[0]?.bank).toMatchObject({status: "mismatch", reason: "duplicate_bank_records"});
    await snapshot(f, [activity(f)]);
    vi.advanceTimersByTime(BANK_FRESH_MS + 1);
    expect((await read()).rows[0]?.bank.status).toBe("missing");
    expect((await read()).bankAvailable).toBe(false);
    expect(await f.t.run(ctx => ctx.db.query("journalEntries").collect())).toHaveLength(1);
  });

  it("rejects a tampered operation kind/payee even when the provider agrees with the tampering", async () => {
    const f = await setup(); const operation = await prepared(f);
    await f.t.run(ctx => ctx.db.patch(operation._id, {kind: "transfer", payeeId: "synthetic-wrong-payee"}));
    await snapshot(f, [activity(f, {kind: "transfer", payeeId: "synthetic-wrong-payee"})]);
    const projected = await f.t.query(ref("reconciliation4Way"), f.scope);
    expect(projected.rows[0]?.bank).toMatchObject({status: "mismatch", reason: "bank_intent_binding_changed"});
    expect(projected.exceptions).toContainEqual(expect.objectContaining({code: "bank_mismatch"}));
  });

  it("surfaces unknown treasury activity without allocating it to this order", async () => {
    const f = await setup(); await prepared(f);
    await snapshot(f, [activity(f), activity(f, {id: "synthetic-unallocated", description: "unknown-intent"})]);
    const exceptions = await f.t.query(ref("bankExceptions"), f.scope);
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0]).toMatchObject({code: "bank_mismatch"});
    expect(exceptions[0]?.detail).toContain("unmatched treasury activity synthetic-unallocated");
    expect(exceptions[0]?.eventKey).toBeUndefined();
    expect(exceptions[0]?.orderId).toBeUndefined();
    expect((await f.t.query(ref("reconciliation4Way"), f.scope)).rows[0]?.bank.status).toBe("match");
  });

  it("lets controllers acknowledge bank mismatches while retaining detected evidence", async () => {
    const f = await setup(); await prepared(f);
    await snapshot(f, [activity(f, {amountAtomic: "100000001"})]);
    const queue = await f.t.query(api.exceptions.list, f.scope);
    const mismatch = queue.find(row => row.exception.code === "bank_mismatch");
    expect(mismatch).toMatchObject({stillDetected: true, disposition: null});
    if (!mismatch) throw new Error("missing_synthetic_bank_exception");
    const args = {...f.scope, exceptionKey: mismatch.exceptionKey, reason: "Investigating synthetic bank amount mismatch"};
    const first = await f.t.mutation(api.exceptions.acknowledge, args);
    expect(await f.t.mutation(api.exceptions.acknowledge, args)).toEqual({...first, replayed: true});
    expect((await f.t.query(api.exceptions.list, f.scope)).find(row => row.exceptionKey === mismatch.exceptionKey))
      .toMatchObject({stillDetected: true, disposition: {status: "acknowledged"}});
    expect((await f.t.query(ref("reconciliation4Way"), f.scope)).rows[0]?.bank.status).toBe("mismatch");
    expect(await f.t.run(ctx => ctx.db.query("journalEntries").collect())).toHaveLength(1);
  });

  it("flags bank activity for a known unconfirmed intent without a durable bank business claim", async () => {
    const f = await setup(); await treasury(f); await snapshot(f, [activity(f)]);
    expect(await f.t.run(ctx => ctx.db.query("bankOperations").collect())).toEqual([]);
    const projected = await f.t.query(ref("reconciliation4Way"), f.scope);
    expect(projected.rows[0]?.bank).toMatchObject({status: "mismatch", reason: "unexpected_bank_activity_without_business_claim"});
    expect(projected.exceptions).toContainEqual(expect.objectContaining({code: "bank_mismatch", eventKey: f.intent.intentId}));
    expect(await f.t.mutation(ref("claimOperation"), {intentId: f.intentId})).toBeNull();
  });

  it("does not infer an order obligation from an orphan journal refund prefix", async () => {
    const f = await setup(); await confirm(f);
    await f.t.run(async ctx => {
      const entry = await ctx.db.query("journalEntries").first();
      if (!entry) throw new Error("missing_synthetic_journal");
      await ctx.db.patch(entry._id, {eventKey: "refund_paid:fake"});
    });
    const projected = await f.t.query(ref("reconciliation4Way"), f.scope);
    expect(projected.rows.find(row => row.intentId === "refund_paid:fake")).toMatchObject({
      kind: "refund_paid", order: {status: "missing"}, ledger: {status: "mismatch"}, chain: {status: "missing"},
      bank: {status: "missing", reason: "outside_bank_simulation_scope"},
    });
  });

  it("preserves a real refund obligation and its ledger/chain match while showing bank coverage missing", async () => {
    const f = await setup(); await confirm(f);
    const proposal = await f.t.mutation(api.orders.cancelRemainder, {demoIdentity: "buyer", orderId: f.orderId, reason: "Synthetic unused quota refund"});
    const commandId = proposal.paymentCommandId;
    const approved = await f.t.mutation(refundRef("approve"), {demoIdentity: "controller", commandId, reason: "Refund unused quota"});
    expect(approved.ok).toBe(true);
    const claim = await f.t.mutation(refundRef("claim"), {serviceSecret: SECRET, commandId, demoIdentity: "controller",
      senderAddress: TREASURY, treasuryAddress: TREASURY, claimId: "synthetic-bank-refund-claim-0001"});
    await f.t.mutation(refundRef("recordObservation"), {serviceSecret: SECRET, attemptId: claim.attemptId,
      observation: {network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, txHash: `0x${"cc".repeat(32)}`,
        logIndex: 4, blockNumber: 124n, blockHash: `0x${"ee".repeat(32)}`, fromAddress: TREASURY, toAddress: PAYER,
        amountAtomic: 100_000_000n, confirmations: 2, succeeded: true, observedAt: Date.now()}});
    const projected = await f.t.query(ref("reconciliation4Way"), f.scope);
    expect(projected.rows.find(row => row.intentId === `refund_paid:${commandId}`)).toMatchObject({
      kind: "refund_paid", order: {status: "match", amountAtomic: "100000000"}, ledger: {status: "match"}, chain: {status: "match"},
      bank: {status: "missing", reason: "outside_bank_simulation_scope"},
    });
  });

  it("refuses buyer/contributor access and cross-tenant order reads", async () => {
    const f = await setup();
    for (const demoIdentity of ["buyer", "contributor"]) {
      await expect(f.t.query(ref("reconciliation4Way"), {...f.scope, demoIdentity})).rejects.toThrow("forbidden");
      await expect(f.t.query(ref("bankExceptions"), {...f.scope, demoIdentity})).rejects.toThrow("forbidden");
    }
    const orderId = await f.t.run(async ctx => {
      const org = await ctx.db.get(f.organizationId), order = await ctx.db.get(f.orderId);
      if (!org || !order) throw new Error("missing_synthetic_order");
      const {_id: orgId, _creationTime: orgTime, ...orgFields} = org;
      const foreignId = await ctx.db.insert("organizations", {...orgFields, name: "Synthetic foreign tenant"});
      const {_id, _creationTime, ...fields} = order;
      return ctx.db.insert("orders", {...fields, organizationId: foreignId, publicId: "synthetic-foreign-bank-order"});
    });
    await expect(f.t.query(ref("reconciliation4Way"), {...f.scope, orderId})).rejects.toThrow();
    await expect(f.t.query(ref("bankExceptions"), {...f.scope, orderId})).rejects.toThrow();
  });
});

describe("Nessie action guards and timeout recovery", () => {
  it("does not call a provider when the key is absent", async () => {
    const f = await setup();
    vi.stubEnv("NESSIE_API_KEY", undefined);
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    expect(await f.t.action(ref("seed"), {})).toEqual({status: "nessie_not_configured"});
    expect(await f.t.action(ref("syncOrder"), {orderId: f.orderId})).toEqual({status: "nessie_not_configured"});
    expect(await f.t.action(ref("sweep"), {})).toEqual({status: "nessie_not_configured"});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // A 400 validation refusal proves Nessie created nothing, so it may be retried; a lost response may have committed, so it may not.
  it("releases only provider-refused operations, never uncertain timeouts", async () => {
    const f = await setup();
    const org = await f.t.run(async ctx => (await ctx.db.query("organizations").first())!._id);
    const base = await f.t.run(async ctx => (await ctx.db.query("paymentIntents").first())!);
    const insert = (errorCode: string) => f.t.run(ctx => ctx.db.insert("bankOperations", {organizationId: org, orderId: base.orderId,
      paymentIntentId: base._id, intentId: `${base.intentId}-${errorCode}`, kind: "deposit", amountAtomic: 10_000n, accountId: BANK_ACCOUNT,
      status: "uncertain", errorCode, createdAt: Date.now(), updatedAt: Date.now()}));
    await insert("nessie_http_400"); await insert("nessie_timeout"); await insert("nessie_request_or_response_failed");
    expect(await f.t.mutation(ref("releaseRejectedOperations"), {organizationId: org})).toEqual({released: 1});
    expect((await f.t.run(ctx => ctx.db.query("bankOperations").collect())).map(row => row.errorCode).sort())
      .toEqual(["nessie_request_or_response_failed", "nessie_timeout"]);
  });

  it("rejects a silent empty GET credential response before reading activity or sending money", async () => {
    const f = await setup(); await confirm(f); await treasury(f);
    const fetchMock = vi.fn(async () => response([])); vi.stubGlobal("fetch", fetchMock);
    expect(await f.t.action(ref("syncOrder"), {orderId: f.orderId})).toEqual({status: "bank_unavailable"});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await f.t.run(ctx => ctx.db.query("bankOperations").collect())).toEqual([]);
    const projected = await f.t.query(ref("reconciliation4Way"), f.scope);
    expect(projected.bankAvailable).toBe(false);
    expect(projected.rows[0]?.bank).toMatchObject({status: "missing", reason: "nessie_credentials_unverified"});
  });

  it("recovers observed evidence after a lost POST response without resending the deposit", async () => {
    const f = await setup(); await confirm(f); await treasury(f);
    let deposited = false, posts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (init?.method === "POST") {
        posts++;
        expect(path).toBe(`/accounts/${BANK_ACCOUNT}/deposits`);
        expect(String(init.body)).toContain('"amount":10000'); // 100 USDC as integer cents
        expect(String(init.body)).toContain(f.intent.intentId);
        // The server committed, but the response was lost. This is not a failed payment.
        deposited = true;
        throw new Error("synthetic network timeout with no proven remote failure");
      }
      if (path === `/accounts/${BANK_ACCOUNT}`) return response({_id: BANK_ACCOUNT});
      if (path.endsWith("/transfers")) return response([]);
      if (path.endsWith("/deposits")) return response(deposited ? [{_id: "synthetic-deposit", medium: "balance",
        amount: 10000, description: f.intent.intentId, status: "completed"}] : []);
      throw new Error("unexpected_synthetic_request");
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await f.t.action(ref("syncOrder"), {orderId: f.orderId})).toEqual({status: "refreshed"});
    expect(await f.t.action(ref("syncOrder"), {orderId: f.orderId})).toEqual({status: "refreshed"});
    expect(posts).toBe(1);
    expect(await f.t.run(ctx => ctx.db.query("bankOperations").collect())).toMatchObject([{status: "observed"}]);
    expect((await f.t.query(ref("reconciliation4Way"), f.scope)).rows[0]?.bank.status).toBe("match");
    expect(await f.t.run(ctx => ctx.db.query("journalEntries").collect())).toHaveLength(1);
  });
});
