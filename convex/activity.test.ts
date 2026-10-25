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
const contributors = makeFunctionReference<"query">("activity:contributors"), payouts = makeFunctionReference<"query">("activity:payoutHistory"), feed = makeFunctionReference<"query">("activity:feed");
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

describe("dashboard financial lists", () => {
  it("preserves amounts above Number.MAX_SAFE_INTEGER and derives contributor earnings from journals", async () => {
    const f = await setup(), amount = 9007199254740993n;
    await f.t.run(async ctx => {
      await recordJournal(ctx, f.organizationId, createFundingJournal({ eventId: "fund", orderId: f.orderId, amountMicroUsdc: amount }));
      await recordJournal(ctx, f.organizationId, createFulfillmentJournal({ eventId: "fulfill", orderId: f.orderId, sampleId: "sample", contributorId: CONTRIBUTOR, priceMicroUsdc: amount, contributorMicroUsdc: amount - 1n }));
      await recordJournal(ctx, f.organizationId, createPayoutJournal({ eventId: "payout", orderId: f.orderId, payableId: "sample", contributorId: CONTRIBUTOR, amountMicroUsdc: amount - 1n }));
    });
    const result = await f.t.query(overview, input(f));
    expect(result).toMatchObject({ fundedAtomic: amount.toString(), cashAtomic: "1", obligationsAtomic: "0", cashLessObligationsAtomic: "1" });
    const list = await f.t.query(contributors, input(f));
    expect(list.page).toContainEqual(expect.objectContaining({ tokenIdentifier: CONTRIBUTOR, earningsAccruedAtomic: (amount - 1n).toString(), earningsPaidAtomic: (amount - 1n).toString(), outstandingAtomic: "0" }));
    expect(() => JSON.stringify([result, list])).not.toThrow();
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
    const history = await f.t.query(payouts, input(f));
    expect(history.page[0]).toMatchObject({ status: "confirmed", amountAtomic: "75", observations: [expect.objectContaining({ blockNumber: "9007199254740993", amountAtomic: "75", logIndex: 2 })] });
    expect(() => JSON.stringify(history)).not.toThrow();
  });
  it("paginates tied audit, chain and agent events without duplicates and rejects mismatched cursors", async () => {
    const f = await setup(), one = await sample(f); await paidIntent(f, one.payableId);
    await f.t.run(async ctx => {
      for (const eventKey of ["one", "two", "three"]) await audit(ctx, { organizationId: f.organizationId, eventKey, actor: { kind: "human", identity: "controller" }, action: "fixture", entityType: "orders", entityId: f.orderId, reason: "Synthetic" });
      await ctx.db.insert("financeAgentRuns", { organizationId: f.organizationId, orderId: f.orderId, requestId: "fixture", prompt: "Synthetic question", requesterTokenIdentifier: "demo:skarl:controller", model: "fixture", maxToolCalls: 1, maxBatchAtomic: 1n, proposedAtomic: 0n, reservedPayableIds: [], status: "completed", transcriptJson: "[]", startedAt: Date.now() });
    });
    const first = await f.t.query(feed, { ...input(f), limit: 2 });
    const all = [...first.page]; let cursor = first.continueCursor;
    while (cursor) { const next = await f.t.query(feed, { ...input(f), cursor, limit: 2 }); all.push(...next.page); cursor = next.continueCursor; }
    expect(all).toHaveLength(6); expect(new Set(all.map(row => row.id)).size).toBe(6); // Includes the seed audit.
    expect(new Set(all.map(row => row.source))).toEqual(new Set(["audit", "chain", "agent"]));
    await expect(f.t.query(payouts, { ...input(f), cursor: first.continueCursor })).rejects.toThrow("invalid_cursor");
    await expect(f.t.query(feed, { ...input(f), limit: 101 })).rejects.toThrow("invalid_page_size");
  });
  it("keeps unscoped buyer aggregates limited to owned non-scenario orders", async () => {
    const f = await setup(), own = await sample(f);
    await paidIntent(f, own.payableId);
    const buyer = {demoIdentity: "buyer"};
    const before = await Promise.all([overview, contributors, payouts, feed].map(endpoint => f.t.query(endpoint, buyer)));
    const extraOrders = await f.t.run(async ctx => {
      const order = await ctx.db.get(f.orderId);
      if (!order) throw new Error("fixture_order_missing");
      const {_id, _creationTime, ...fields} = order;
      const foreignBuyer = await ctx.db.insert("orders", {...fields, publicId: "fixture:another-buyers-order", buyerTokenIdentifier: "fixture:other-buyer"});
      const scenario = await ctx.db.insert("orders", {...fields, publicId: "scenario:simulated-order"});
      await ctx.db.insert("memberships", {organizationId: f.organizationId, issuer: "fixture", subject: "unrelated-contributor",
        tokenIdentifier: "fixture:unrelated-contributor", roles: ["contributor"], grantedByTokenIdentifier: "fixture", status: "active"});
      for (const orderId of [foreignBuyer, scenario]) {
        await recordJournal(ctx, f.organizationId, createFundingJournal({eventId: `extra:${orderId}`, orderId, amountMicroUsdc: 111n}));
        await audit(ctx, {organizationId: f.organizationId, eventKey: `extra-refused:${orderId}`, actor: {kind: "service", identity: "fixture"},
          action: "acceptance_refused", entityType: "orders", entityId: orderId, reason: "duplicate_submission"});
      }
      return [foreignBuyer, scenario];
    });
    for (const orderId of extraOrders) {
      const extra = {...f, orderId}, accepted = await sample(extra);
      await paidIntent(extra, accepted.payableId);
    }
    const after = await Promise.all([overview, contributors, payouts, feed].map(endpoint => f.t.query(endpoint, buyer)));
    expect(after).toEqual(before);
    expect(after[1].page.map((row: {tokenIdentifier: string}) => row.tokenIdentifier)).toEqual([CONTRIBUTOR]);
  });
  it("permits the owning buyer and refuses contributors, other buyers and foreign tenants", async () => {
    const f = await setup();
    await sample(f);
    for (const endpoint of [overview, contributors, payouts, feed]) for (const demoIdentity of ["contributor"])
      await expect(f.t.query(endpoint, { ...input(f), demoIdentity })).rejects.toThrow("forbidden");
    for (const endpoint of [overview, contributors, payouts, feed]) expect(await f.t.query(endpoint, {...input(f), demoIdentity: "buyer"})).toEqual(await f.t.query(endpoint, input(f)));
    await f.t.run(ctx => ctx.db.patch(f.orderId, {buyerTokenIdentifier: "fixture:other-buyer"}));
    for (const endpoint of [overview, contributors, payouts, feed]) await expect(f.t.query(endpoint, {...input(f), demoIdentity: "buyer"})).rejects.toThrow("order_not_owned");
    await expect(f.t.query(timeSeries, {...input(f), demoIdentity: "buyer", from: 0, to: 300000})).rejects.toThrow("order_not_owned");
    const foreign = await f.t.run(ctx => ctx.db.insert("organizations", { name: "foreign", status: "active", createdByTokenIdentifier: "foreign" }));
    await f.t.run(ctx => ctx.db.patch(f.orderId, { organizationId: foreign }));
    for (const endpoint of [overview, contributors, payouts, feed]) await expect(f.t.query(endpoint, input(f))).rejects.toThrow("cross_organization_access");
    await expect(f.t.query(timeSeries, { ...input(f), from: 0, to: 300000 })).rejects.toThrow("cross_organization_access");
  });
});
