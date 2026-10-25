// @vitest-environment node
import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import crons from "./crons";
import { FINANCE_INTERVAL_MS, RECONCILIATION_INTERVAL_MS } from "./scheduledData";
import { PAYMENT_NETWORK, SOLANA_PAYMENT_NETWORK, SOLANA_USDC_MINT, USDC_ADDRESS } from "../packages/contracts/src/chain";
import { recordJournal } from "./lib/finance";
import { createFundingJournal, createFulfillmentJournal } from "../packages/ledger/src/index";

const observers = vi.hoisted(() => ({ base: vi.fn(), solana: vi.fn() }));
vi.mock("../apps/web/lib/payments/chain", () => ({ observeTransfer: observers.base }));
vi.mock("../packages/payments/src/solana", () => ({ observeSolanaTransfer: observers.solana }));
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const reconcile = makeFunctionReference<"action">("scheduledJobs:reconcile"), finance = makeFunctionReference<"action">("scheduledJobs:finance");
const reserveJob = makeFunctionReference<"mutation">("scheduledData:reserveJob");
const finishJob = makeFunctionReference<"mutation">("scheduledData:finishJob");
const reserveFinance = makeFunctionReference<"mutation">("scheduledData:reserveFinance");
const finishFinance = makeFunctionReference<"mutation">("scheduledData:finishFinance");
const snapshots = makeFunctionReference<"query">("scheduledData:snapshots");
const SECRET = "scheduled-unit-test-service-secret-not-live";
const BUYER = `0x${"1".repeat(40)}`, TREASURY = `0x${"2".repeat(40)}`, RECIPIENT = `0x${"3".repeat(40)}`;
const HASH = `0x${"a".repeat(64)}`, NONCE = `0x${"b".repeat(64)}`;
const solanaBuyer = "1".repeat(32), solanaTreasury = "2".repeat(32), signature = "3".repeat(88);
const turn = (calls: unknown[] = [], output_text = "Reviewed changed obligations. Independent controller approval is required. No money moved.") => ({ status: "completed", steps: calls, output_text });
const call = (id: string, name: string, args: object = {}) => ({ type: "function_call", id, name, arguments: args });
const json = (value: unknown) => JSON.stringify(value, (_key, x) => typeof x === "bigint" ? x.toString() : x);
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-25T12:00:00Z"));
  vi.stubEnv("SKARL_PAYMENTS_SERVICE_SECRET", SECRET);
  vi.stubEnv("SKARL_SOLANA_TREASURY_ADDRESS", solanaTreasury);
  vi.stubEnv("GEMINI_API_KEY", "unit-test-placeholder");
  vi.stubEnv("SKARL_SCHEDULED_JOBS_DISABLED", "false");
  vi.stubEnv("FINANCE_AGENT_BACKGROUND_ENABLED", "true");
  observers.base.mockReset(); observers.solana.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(turn()), { status: 200 })));
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function setup() {
  const t = convexTest(schema, modules); workflowTest.register(t);
  return { t, ...await t.mutation(internal.seed.demo, {}) };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function funding(f: Fixture, solana = false, txHash: string | null = solana ? signature : HASH) {
  const order = await f.t.run(ctx => ctx.db.get(f.orderId));
  const amountAtomic = order!.budgetAtomic;
  const result = await f.t.mutation(api.payments.recordFundingAttempt, { serviceSecret: SECRET, demoIdentity: "buyer", orderId: f.orderId,
    payerAddress: solana ? solanaBuyer : BUYER, recipientAddress: solana ? solanaTreasury : TREASURY,
    authorizationNonce: NONCE, amountAtomic, validBefore: Date.now() + 60_000,
    ...(solana ? { network: SOLANA_PAYMENT_NETWORK } : {}) });
  if (txHash) await f.t.mutation(api.payments.recordTransaction, { serviceSecret: SECRET, attemptId: result.attemptId, txHash });
  const observation = { network: solana ? SOLANA_PAYMENT_NETWORK : PAYMENT_NETWORK,
    tokenAddress: solana ? SOLANA_USDC_MINT : USDC_ADDRESS, txHash: txHash ?? HASH, logIndex: 0,
    blockNumber: 100n, blockHash: solana ? "4".repeat(44) : `0x${"c".repeat(64)}`,
    fromAddress: solana ? solanaBuyer : BUYER, toAddress: solana ? solanaTreasury : TREASURY,
    amountAtomic, confirmations: 2, succeeded: true, observedAt: Date.now() };
  return { ...result, observation };
}
async function payable(f: Fixture, amountAtomic = 2_500_000n) {
  return f.t.run(async ctx => {
    const n = (await ctx.db.query("payables").collect()).length;
    const submissionId = await ctx.db.insert("submissions", { organizationId: f.organizationId, orderId: f.orderId, taskVersionId: f.taskVersionId,
      contributorTokenIdentifier: "demo:skarl:contributor", status: "accepted", clientRequestId: `synthetic-scheduled-${n}`, updatedAt: Date.now() });
    const decisionId = await ctx.db.insert("reviewDecisions", { organizationId: f.organizationId, submissionId, taskVersionId: f.taskVersionId,
      decisionKey: `synthetic-scheduled-decision-${n}`, decision: "accepted", reviewerTokenIdentifier: "demo:skarl:controller",
      reason: "Synthetic scheduled-agent fixture", evidenceHash: "f".repeat(64), decidedAt: Date.now() });
    return ctx.db.insert("payables", { organizationId: f.organizationId, orderId: f.orderId, submissionId, decisionId,
      network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, contributorTokenIdentifier: "demo:skarl:contributor",
      recipientAddress: RECIPIENT, amountAtomic, sourceEventKey: `fulfillment:${submissionId}`, status: "accrued", createdAt: Date.now() });
  });
}
async function dispatchedPayout(f: Fixture, index = 0) {
  const payableId = await payable(f), proposal = await f.t.mutation(api.finance.proposePayment, { demoIdentity: "finance-agent", payableId });
  if (!proposal.ok) throw new Error(proposal.code);
  const txHash = `0x${(index + 1).toString(16).padStart(64, "0")}`;
  const attemptId = await f.t.run(async ctx => {
    const intent = await ctx.db.get(proposal.intentId);
    if (!intent || intent.kind !== "contributor_payout") throw new Error("missing synthetic payout");
    const approvalId = await ctx.db.insert("approvals", { organizationId: f.organizationId, paymentCommandId: proposal.paymentCommandId,
      requestedBy: { kind: "service", identity: "demo:skarl:finance-agent" }, approverTokenIdentifier: "demo:skarl:controller",
      bindingHash: intent.bindingHash, status: "approved", reason: "Synthetic pre-existing dispatch; cron grants no approval",
      decidedAt: Date.now(), expiresAt: intent.expiresAt });
    await ctx.db.patch(proposal.paymentCommandId, { approvalId, attemptCount: 1, status: "reconciling" });
    await ctx.db.patch(proposal.intentId, { status: "reconciling" });
    await ctx.db.patch(payableId, { status: "payout_in_progress" });
    const payable = await ctx.db.get(payableId);
    await recordJournal(ctx, f.organizationId, createFundingJournal({ eventId: `synthetic-scheduled-funding-${index}`,
      orderId: f.orderId, amountMicroUsdc: intent.amountAtomic }));
    await recordJournal(ctx, f.organizationId, createFulfillmentJournal({ eventId: `synthetic-scheduled-accrual-${index}`,
      orderId: f.orderId, sampleId: payable!.submissionId, contributorId: payable!.contributorTokenIdentifier,
      priceMicroUsdc: intent.amountAtomic, contributorMicroUsdc: intent.amountAtomic }));
    return ctx.db.insert("paymentAttempts", { organizationId: f.organizationId, paymentIntentId: proposal.intentId,
      paymentCommandId: proposal.paymentCommandId, network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, attemptId: `synthetic-payout-${index}`,
      attempt: 1, amountAtomic: intent.amountAtomic, payerAddress: TREASURY, txHash, status: "reconciling", createdAt: Date.now(), updatedAt: Date.now() });
  });
  const observation = { network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, txHash, logIndex: 0, blockNumber: 100n,
    blockHash: `0x${"c".repeat(64)}`, fromAddress: TREASURY, toAddress: RECIPIENT, amountAtomic: 2_500_000n,
    confirmations: 2, succeeded: true, observedAt: Date.now() };
  return { attemptId, payableId, observation };
}
async function counts(f: Fixture) {
  return f.t.run(async ctx => ({ attempts: (await ctx.db.query("paymentAttempts").collect()).length,
    observations: (await ctx.db.query("chainObservations").collect()).length, journals: (await ctx.db.query("journalEntries").collect()).length,
    approvals: (await ctx.db.query("approvals").collect()).length, runs: await ctx.db.query("financeAgentRuns").collect(),
    checkpoints: await ctx.db.query("scheduledCheckpoints").collect() }));
}

describe("observation-only scheduled reconciliation", () => {
  it("registers real two-minute and ten-minute cron intervals", () => {
    const config = JSON.parse(crons.export());
    expect(config["observe pending settlements"].schedule).toMatchObject({ type: "interval", minutes: 2 });
    expect(config["finance changed accruals and exceptions"].schedule).toMatchObject({ type: "interval", minutes: 10 });
  });
  it.each([false, true])("confirms an existing %s funding transfer exactly once with the existing observer", async solana => {
    const f = await setup(), item = await funding(f, solana);
    (solana ? observers.solana : observers.base).mockResolvedValue(item.observation);
    const result = await f.t.action(reconcile, {});
    expect(result.confirmed).toBe(1);
    const state = await counts(f);
    expect(state.attempts).toBe(1); expect(state.observations).toBe(1); expect(state.journals).toBe(1); expect(state.approvals).toBe(0);
    expect((await f.t.run(ctx => ctx.db.get(item.attemptId)))?.status).toBe("confirmed");
    expect((await f.t.run(ctx => ctx.db.get(f.orderId)))?.status).toBe("funded");
    vi.setSystemTime(Date.now() + RECONCILIATION_INTERVAL_MS + 1000);
    await f.t.action(reconcile, {});
    expect(solana ? observers.solana : observers.base).toHaveBeenCalledTimes(1);
    expect((await counts(f)).journals).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["failed", "finalized"] as const)("does not reobserve a definitively %s attempt", async status => {
    const f = await setup(), item = await funding(f);
    await f.t.run(ctx => ctx.db.patch(item.attemptId, { status }));
    expect(await f.t.action(reconcile, {})).toMatchObject({ confirmed: 0, pending: 0 });
    expect(observers.base).not.toHaveBeenCalled();
    expect((await counts(f)).attempts).toBe(1);
  });
  it("posts an already dispatched payout observation without new approval, attempt or signing", async () => {
    const f = await setup(), item = await dispatchedPayout(f);
    observers.base.mockResolvedValue(item.observation);
    const before = await counts(f), result = await f.t.action(reconcile, {}), after = await counts(f);
    expect(result.confirmed).toBe(1);
    expect(after.approvals).toBe(before.approvals); expect(after.attempts).toBe(before.attempts);
    expect(after.observations).toBe(1); expect(after.journals).toBe(before.journals + 1);
    expect((await f.t.run(ctx => ctx.db.get(item.payableId)))?.status).toBe("paid");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("caps each order at four observation attempts and gives unchecked attempts the next turn", async () => {
    const f = await setup();
    for (let index = 0; index < 5; index++) await dispatchedPayout(f, index);
    observers.base.mockRejectedValue(new Error("pending receipt"));
    expect(await f.t.action(reconcile, {})).toMatchObject({ pending: 4 });
    expect(observers.base).toHaveBeenCalledTimes(4);
    vi.setSystemTime(Date.now() + RECONCILIATION_INTERVAL_MS + 1000);
    await f.t.action(reconcile, {});
    expect(observers.base.mock.calls[4][0]).toBe(`0x${"5".padStart(64, "0")}`);
    expect((await counts(f)).attempts).toBe(5);
  });
  it("paginates discovery fairly over three orders per tick", async () => {
    const f = await setup();
    await f.t.run(async ctx => {
      const original = await ctx.db.get(f.orderId);
      const { _id, _creationTime, ...order } = original!;
      for (let index = 0; index < 5; index++) await ctx.db.insert("orders", { ...order, publicId: `synthetic-cron-order-${index}` });
    });
    const sizes = [];
    for (let index = 0; index < 3; index++) {
      sizes.push((await f.t.action(reconcile, {})).orders);
      vi.setSystemTime(Date.now() + RECONCILIATION_INTERVAL_MS + 1000);
    }
    expect(sizes).toEqual([3, 3, 1]);
    expect(observers.base).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("never pays or creates a replacement attempt for hashless, pending or invalid transfers", async () => {
    const f = await setup(); await funding(f, false, null);
    let result = await f.t.action(reconcile, {});
    expect(result.pending).toBe(1); expect(observers.base).not.toHaveBeenCalled();
    await f.t.run(async ctx => { const row = (await ctx.db.query("paymentAttempts").collect())[0]; await ctx.db.patch(row._id, { txHash: HASH }); });
    vi.setSystemTime(Date.now() + RECONCILIATION_INTERVAL_MS + 1000);
    observers.base.mockRejectedValue(new Error("sensitive RPC details and key"));
    result = await f.t.action(reconcile, {});
    expect(result.pending).toBe(1);
    const state = await counts(f);
    expect(state.attempts).toBe(1); expect(state.observations).toBe(0); expect(state.journals).toBe(0); expect(state.approvals).toBe(0);
    expect(json(state)).not.toContain("sensitive RPC details");
    const snapshot = await f.t.query(snapshots, { demoIdentity: "controller", orderId: f.orderId });
    expect(snapshot.some((row: any) => row.snapshot?.some?.((x: any) => x.exception.code === "late_settlement"))).toBe(true);
  });
  it("atomic leases coalesce overlapping ticks and reject stale completion", async () => {
    const f = await setup();
    const [a, b] = await Promise.all([f.t.mutation(reserveJob, { job: "reconciliation" }), f.t.mutation(reserveJob, { job: "reconciliation" })]);
    const reserved = a ?? b;
    expect([a, b].filter(Boolean)).toHaveLength(1);
    await f.t.mutation(finishJob, { stateId: reserved.stateId, generation: reserved.generation - 1, cursor: "bad-cursor" });
    expect((await f.t.run(ctx => ctx.db.get(reserved.stateId)))?.status).toBe("running");
    expect(await f.t.action(reconcile, {})).toMatchObject({ status: "noop" });
    expect(observers.base).not.toHaveBeenCalled();
  });
  it("recovers stale webhook classification without inventing chain cash", async () => {
    const f = await setup(); await funding(f);
    const webhook = await f.t.mutation(api.chainWitness.receiveWebhook, { serviceSecret: SECRET, treasury: TREASURY,
      eventId: "synthetic-unknown", network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, txHash: `0x${"d".repeat(64)}`,
      logIndex: 0, fromAddress: BUYER, toAddress: TREASURY, amountAtomic: "1" });
    observers.base.mockRejectedValue(new Error("pending"));
    vi.setSystemTime(Date.now() + RECONCILIATION_INTERVAL_MS + 1000);
    await f.t.action(reconcile, {});
    expect((await f.t.run(ctx => ctx.db.get(webhook.receiptId)))?.status).toBe("unknown_transfer");
    expect((await counts(f)).observations).toBe(0);
    const exceptions = await f.t.query(api.exceptions.list, { demoIdentity: "controller", orderId: f.orderId });
    expect(exceptions.some(row => row.exception.code === "unknown_transfer")).toBe(true);
  });
  it("does not invoke RPC without configuration and supports explicit kill switch", async () => {
    const f = await setup(); await funding(f);
    vi.stubEnv("SKARL_PAYMENTS_SERVICE_SECRET", "");
    expect(await f.t.action(reconcile, {})).toMatchObject({ pending: 1 });
    expect(observers.base).not.toHaveBeenCalled();
    vi.stubEnv("SKARL_SCHEDULED_JOBS_DISABLED", "true");
    expect(await f.t.action(reconcile, {})).toMatchObject({ status: "disabled" });
    expect(await f.t.action(finance, {})).toMatchObject({ status: "disabled" });
  });
});

describe("changed-state scheduled finance agent", () => {
  it("persists a real tool-loop transcript, refuses forced approval, and noops unchanged books", async () => {
    const f = await setup(), payableId = await payable(f);
    let round = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string);
      let response;
      if (round++ === 0) response = turn([call("read", "listOutstandingPayables"), call("propose", "proposePaymentBatch", { payableIds: [payableId] })]);
      else if (round === 2) {
        const proposal = body.input.find((x: any) => x.type === "function_result" && x.name === "proposePaymentBatch");
        const intentId = JSON.parse(proposal.result[0].text).results[0].intentId;
        response = turn([call("malicious-approve", "approve", { intentId })]);
      } else response = turn();
      return new Response(JSON.stringify(response), { status: 200 });
    }));
    expect(await f.t.action(finance, {})).toMatchObject({ agentRuns: 1 });
    const first = await counts(f);
    expect(first.runs).toHaveLength(1); expect(first.runs[0].status).toBe("completed");
    expect(first.runs[0].requesterTokenIdentifier).toBe("demo:skarl:finance-agent");
    expect(JSON.parse(first.runs[0].transcriptJson).map((x: any) => x.call.name)).toEqual(["listOutstandingPayables", "proposePaymentBatch", "approve"]);
    expect(JSON.parse(first.runs[0].transcriptJson).at(-1).result).toMatchObject({ ok: false, code: "self_approval_refused" });
    expect(first.approvals).toBe(0); expect(first.attempts).toBe(0);
    expect(await f.t.action(finance, {})).toMatchObject({ status: "noop" });
    vi.setSystemTime(Date.now() + FINANCE_INTERVAL_MS + 1000);
    // The newly proposed obligation adds a real missing-transfer exception once.
    expect(await f.t.action(finance, {})).toMatchObject({ agentRuns: 1 });
    vi.setSystemTime(Date.now() + FINANCE_INTERVAL_MS + 1000);
    expect(await f.t.action(finance, {})).toMatchObject({ agentRuns: 0 });
    expect((await counts(f)).runs).toHaveLength(2); expect(fetch).toHaveBeenCalledTimes(4);
  });
  it("does nothing for empty books, runs on a new accrual, and caps each run through existing policy", async () => {
    const f = await setup();
    expect(await f.t.action(finance, {})).toMatchObject({ agentRuns: 0 }); expect(fetch).not.toHaveBeenCalled();
    const payableId = await payable(f, 10_000_001n);
    vi.setSystemTime(Date.now() + FINANCE_INTERVAL_MS + 1000);
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(n++ === 0
      ? turn([call("too-large", "proposePaymentBatch", { payableIds: [payableId] })]) : turn()), { status: 200 })));
    expect(await f.t.action(finance, {})).toMatchObject({ agentRuns: 1 });
    const state = await counts(f);
    expect(state.runs[0].proposedAtomic).toBe(0n);
    expect(JSON.parse(state.runs[0].transcriptJson)[0].result.code).toBe("batch_amount_limit");
    expect(state.approvals).toBe(0); expect(state.attempts).toBe(0);
  });
  it("uses a durable request ID after an interrupted pre-action reservation", async () => {
    const f = await setup(); await payable(f);
    const first = await f.t.mutation(reserveFinance, { orderId: f.orderId });
    expect(first).not.toBeNull();
    expect(await f.t.mutation(reserveFinance, { orderId: f.orderId })).toBeNull();
    vi.setSystemTime(Date.now() + FINANCE_INTERVAL_MS + 1000);
    const resumed = await f.t.mutation(reserveFinance, { orderId: f.orderId });
    expect(resumed.requestId).toBe(first.requestId); expect(resumed.generation).toBe(first.generation);
    const run = await f.t.action(api.financeAgent.run, { demoIdentity: "finance-agent", orderId: f.orderId, requestId: resumed.requestId, prompt: resumed.prompt });
    await f.t.mutation(finishFinance, { stateId: resumed.stateId, generation: resumed.generation, runId: run.runId });
    vi.setSystemTime(Date.now() + FINANCE_INTERVAL_MS + 1000);
    expect(await f.t.mutation(reserveFinance, { orderId: f.orderId })).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("flags late/unknown exceptions even without accrued payables and never retries a failed model unchanged", async () => {
    const f = await setup(); await funding(f, false, null);
    vi.setSystemTime(Date.now() + RECONCILIATION_INTERVAL_MS + 1000);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("provider body must not persist", { status: 403 })));
    expect(await f.t.action(finance, {})).toMatchObject({ agentRuns: 1 });
    const state = await counts(f);
    expect(state.runs[0].status).toBe("failed"); expect(state.runs[0].failureCode).toBe("gemini_http_403");
    vi.setSystemTime(Date.now() + FINANCE_INTERVAL_MS + 1000);
    expect(await f.t.action(finance, {})).toMatchObject({ agentRuns: 0 });
    expect(fetch).toHaveBeenCalledTimes(1); expect((await counts(f)).attempts).toBe(1);
    expect(json(await counts(f))).not.toContain("provider body must not persist");
  });
  it("checks current role and tenant before reserving or exposing snapshots", async () => {
    const f = await setup(); await payable(f);
    await expect(f.t.query(snapshots, { demoIdentity: "contributor", orderId: f.orderId })).rejects.toThrow("forbidden");
    await f.t.run(async ctx => { const member = await ctx.db.query("memberships").withIndex("by_token_identifier", q => q.eq("tokenIdentifier", "demo:skarl:finance-agent")).unique(); await ctx.db.patch(member!._id, { status: "revoked" }); });
    await expect(f.t.action(finance, {})).rejects.toThrow("inactive_demo_identity");
    await expect(f.t.action(reconcile, {})).rejects.toThrow("inactive_demo_identity");
    expect(fetch).not.toHaveBeenCalled();
  });
});
