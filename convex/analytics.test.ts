import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { audit, recordJournal } from "./lib/finance";
import { createFundingJournal, createFulfillmentJournal, createPayoutJournal } from "../packages/ledger/src/index";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/chain";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const overview = makeFunctionReference<"query">("analytics:overview"), timeSeries = makeFunctionReference<"query">("analytics:timeSeries");
const CONTRIBUTOR = "demo:skarl:contributor";
async function setup() { const t = convexTest(schema, modules); return { t, ...await t.mutation(internal.seed.demo, {}) }; }
type Fixture = Awaited<ReturnType<typeof setup>>;
const input = (f: Fixture) => ({ demoIdentity: "controller", orderId: f.orderId });
// These are synthetic persisted facts. They do not demonstrate inference, wallet verification or settlement.
async function sample(f: Fixture, latency?: number[]) {
  return f.t.run(async ctx => {
    const submissionId = await ctx.db.insert("submissions", { organizationId: f.organizationId, orderId: f.orderId, taskVersionId: f.taskVersionId,
      contributorTokenIdentifier: CONTRIBUTOR, clientRequestId: "synthetic", sourceHash: "a".repeat(64), status: "accepted", updatedAt: Date.now() });
    const decisionId = await ctx.db.insert("reviewDecisions", { organizationId: f.organizationId, submissionId, taskVersionId: f.taskVersionId,
      decisionKey: `synthetic:${submissionId}`, decision: "accepted", reviewerTokenIdentifier: "demo:skarl:controller", reason: "Synthetic fixture", evidenceHash: "a".repeat(64), decidedAt: Date.now() });
    await ctx.db.insert("deliveries", { organizationId: f.organizationId, orderId: f.orderId, submissionId, decisionId, manifestHash: "b".repeat(64), termsHash: "c".repeat(64), eventKey: `fulfillment:${submissionId}`, publishedAt: Date.now() });
    const payableId = await ctx.db.insert("payables", { organizationId: f.organizationId, network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, orderId: f.orderId,
      submissionId, decisionId, contributorTokenIdentifier: CONTRIBUTOR, recipientAddress: `0x${"1".repeat(40)}`, amountAtomic: 75n, sourceEventKey: `fulfillment:${submissionId}`, status: "paid", createdAt: Date.now() - 1000 });
    if (latency) {
      const jobId = await ctx.db.insert("jobs", { organizationId: f.organizationId, submissionId, taskVersionId: f.taskVersionId, sourceHash: "a".repeat(64), pipelineVersion: "fixture", status: "completed", availableAt: Date.now(), attempt: 1, maxAttempts: 1, leaseGeneration: 1 });
      const reportStorageId = await ctx.storage.store(new Blob(["synthetic report"]));
      await ctx.db.insert("analysisResults", { organizationId: f.organizationId, jobId, submissionId, taskVersionId: f.taskVersionId, sourceHash: "a".repeat(64), pipelineVersion: "fixture", leaseGeneration: 1,
        summary: "Synthetic model metadata", reportStorageId, reportHash: "c".repeat(64), evidenceAssetIds: [], completedAt: Date.now(), implementation: "inference", pipelineStatus: "completed", recommendation: "accept",
        processingElapsedMs: 999999, reportJson: JSON.stringify({ pipeline: { modelRuns: latency.map(elapsedMs => ({ elapsedMs })) } }) });
    }
    return { submissionId, decisionId, payableId };
  });
}
async function paidIntent(f: Fixture, payableId: Awaited<ReturnType<typeof sample>>["payableId"]) {
  return f.t.run(async ctx => {
    const binding = { organizationId: f.organizationId, network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, orderId: f.orderId, payableId,
      requesterTokenIdentifier: "demo:skarl:finance-agent", recipientAddress: `0x${"1".repeat(40)}`, amountAtomic: 75n, bindingHash: "fixture", sourceVersion: "fixture", status: "confirmed" as const, updatedAt: Date.now() };
    const paymentCommandId = await ctx.db.insert("paymentCommands", { ...binding, commandId: "synthetic-payout", kind: "contributor_payout", requestedBy: { kind: "service", identity: "demo:skarl:finance-agent" }, attemptCount: 1, leaseGeneration: 0 });
    const intentId = await ctx.db.insert("paymentIntents", { ...binding, kind: "contributor_payout", intentId: "synthetic-payout", paymentCommandId, expiresAt: Date.now() + 60000 });
    const attemptId = await ctx.db.insert("paymentAttempts", { organizationId: f.organizationId, network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, paymentIntentId: intentId, paymentCommandId,
      attemptId: "fixture-attempt", attempt: 1, amountAtomic: 75n, status: "confirmed", createdAt: Date.now(), updatedAt: Date.now() });
    await ctx.db.insert("chainObservations", { organizationId: f.organizationId, network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, paymentAttemptId: attemptId, txHash: `0x${"d".repeat(64)}`,
      logIndex: 2, blockNumber: 9007199254740993n, blockHash: `0x${"e".repeat(64)}`, fromAddress: `0x${"2".repeat(40)}`, toAddress: `0x${"1".repeat(40)}`, amountAtomic: 75n, confirmations: 2, succeeded: true, observedAt: Date.now() });
    return { intentId, attemptId };
  });
}

describe("dashboard analytics", () => {
  it("returns empty observed financial totals and no invented latency", async () => {
    const f = await setup();
    expect(await f.t.query(overview, input(f))).toMatchObject({ funded: "0", fundedAtomic: "0", cashAtomic: "0", obligationsAtomic: "0", accepted: "0",
      verificationLatencyMs: { sampleCount: "0", p50: null, p95: null }, payoutCycleTimeMs: { sampleCount: "0", p50: null, p95: null }, acceptanceRate: { basisPoints: null } });
  });
  it("preserves amounts above Number.MAX_SAFE_INTEGER", async () => {
    const f = await setup(), amount = 9007199254740993n;
    await f.t.run(async ctx => {
      await recordJournal(ctx, f.organizationId, createFundingJournal({ eventId: "fund", orderId: f.orderId, amountMicroUsdc: amount }));
      await recordJournal(ctx, f.organizationId, createFulfillmentJournal({ eventId: "fulfill", orderId: f.orderId, sampleId: "sample", contributorId: CONTRIBUTOR, priceMicroUsdc: amount, contributorMicroUsdc: amount - 1n }));
      await recordJournal(ctx, f.organizationId, createPayoutJournal({ eventId: "payout", orderId: f.orderId, payableId: "sample", contributorId: CONTRIBUTOR, amountMicroUsdc: amount - 1n }));
    });
    const result = await f.t.query(overview, input(f));
    expect(result).toMatchObject({ fundedAtomic: amount.toString(), cashAtomic: "1", obligationsAtomic: "0", cashLessObligationsAtomic: "1" });
    expect(() => JSON.stringify(result)).not.toThrow();
  });
  it("uses summed actual model-run durations and posted payout timing, with unique duplicate counts", async () => {
    const f = await setup(), one = await sample(f, [100, 200]); await sample(f, [200, 400]);
    await paidIntent(f, one.payableId);
    await f.t.run(async ctx => {
      await recordJournal(ctx, f.organizationId, createFundingJournal({ eventId: "fund", orderId: f.orderId, amountMicroUsdc: 100n }));
      await recordJournal(ctx, f.organizationId, createFulfillmentJournal({ eventId: "fulfill", orderId: f.orderId, sampleId: one.submissionId, contributorId: CONTRIBUTOR, priceMicroUsdc: 100n, contributorMicroUsdc: 75n }));
      await recordJournal(ctx, f.organizationId, createPayoutJournal({ eventId: "synthetic-payout", orderId: f.orderId, payableId: one.submissionId, contributorId: CONTRIBUTOR, amountMicroUsdc: 75n }));
      for (const key of ["duplicate-one", "duplicate-two"]) await audit(ctx, { organizationId: f.organizationId, eventKey: key, actor: { kind: "human", identity: "controller" }, action: "acceptance_refused", entityType: "submissions", entityId: one.submissionId, reason: "duplicate_submission" });
    });
    expect(await f.t.query(overview, input(f))).toMatchObject({ accepted: "2", delivered: "2", duplicatesBlocked: "1", refusals: "2", verificationLatencyMs: { sampleCount: "2", p50: 300, p95: 600 }, payoutCycleTimeMs: { sampleCount: "1" } });
  });
  it("buckets exact funding and payouts into half-open five-minute intervals, retaining empty buckets", async () => {
    const f = await setup();
    await f.t.run(async ctx => {
      const id = await recordJournal(ctx, f.organizationId, createFundingJournal({ eventId: "fund", orderId: f.orderId, amountMicroUsdc: 100n }));
      await ctx.db.patch(id, { effectiveAt: 300000 });
    });
    const result = await f.t.query(timeSeries, { ...input(f), from: 0, to: 900000 });
    expect(result.buckets).toHaveLength(3);
    expect(result.buckets.map((row: { fundedAtomic: string }) => row.fundedAtomic)).toEqual(["0", "100", "0"]);
    expect((await f.t.query(timeSeries, { ...input(f), from: 0, to: 300000 })).buckets[0].fundedAtomic).toBe("0");
    await expect(f.t.query(timeSeries, { ...input(f), from: 0, to: 8 * 86400000 })).rejects.toThrow("invalid_time_range");
  });
  it("rejects nonfinance identities and foreign tenants across every endpoint", async () => {
    const f = await setup();
    for (const endpoint of [overview]) for (const demoIdentity of ["contributor", "buyer"])
      await expect(f.t.query(endpoint, { ...input(f), demoIdentity })).rejects.toThrow("forbidden");
    const foreign = await f.t.run(ctx => ctx.db.insert("organizations", { name: "foreign", status: "active", createdByTokenIdentifier: "foreign" }));
    await f.t.run(ctx => ctx.db.patch(f.orderId, { organizationId: foreign }));
    for (const endpoint of [overview]) await expect(f.t.query(endpoint, input(f))).rejects.toThrow("cross_organization_access");
    await expect(f.t.query(timeSeries, { ...input(f), from: 0, to: 300000 })).rejects.toThrow("cross_organization_access");
  });
  it("fails closed on cross-tenant nested lines and unbalanced posted journals", async () => {
    const f = await setup();
    const journalId = await f.t.run(ctx => recordJournal(ctx, f.organizationId, createFundingJournal({ eventId: "fund", orderId: f.orderId, amountMicroUsdc: 100n })));
    const line = await f.t.run(ctx => ctx.db.query("journalLines").withIndex("by_entry", q => q.eq("journalEntryId", journalId)).first());
    await f.t.run(ctx => ctx.db.patch(line!._id, { amountAtomic: 99n }));
    await expect(f.t.query(overview, input(f))).rejects.toThrow("unbalanced_journal");
    const foreign = await f.t.run(ctx => ctx.db.insert("organizations", { name: "foreign", status: "active", createdByTokenIdentifier: "foreign" }));
    await f.t.run(ctx => ctx.db.patch(line!._id, { amountAtomic: 100n, organizationId: foreign }));
    await expect(f.t.query(overview, input(f))).rejects.toThrow("statement_line_binding_mismatch");
  });
});
