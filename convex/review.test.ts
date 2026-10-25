import { convexTest, type TestConvex } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { PAYMENT_CHAIN_ID, PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/chain";

// These are isolated in-memory policy tests. The stored media, completed-analysis
// projection, verified-wallet record, and funding entry below are synthetic
// fixtures, not evidence of inference, SIWE verification, or a chain transfer.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
type Test = TestConvex<typeof schema>;
type Fixture = {
  t: Test;
  organizationId: Id<"organizations">;
  orderId: Id<"orders">;
  taskVersionId: Id<"rubricVersions">;
  sequence: number;
};

const CONTRIBUTOR = "demo:skarl:contributor";
const RECIPIENT = "0x1111111111111111111111111111111111111111";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

async function setup(funded = true): Promise<Fixture> {
  const t = convexTest(schema, modules);
  workflowTest.register(t);
  const seeded = await t.mutation(internal.seed.demo, {});
  await t.run(async (ctx) => {
    const contributor = await ctx.db.query("memberships")
      .withIndex("by_token_identifier", (q) => q.eq("tokenIdentifier", CONTRIBUTOR)).unique();
    if (!contributor) throw new Error("missing fixture contributor");
    await ctx.db.patch(contributor._id, {
      walletAddress: RECIPIENT,
      walletVerification: {
        siweMessageHash: "e".repeat(64), nonce: "fixture-only-not-a-live-siwe-proof",
        signature: `0x${"1".repeat(130)}`, chainId: PAYMENT_CHAIN_ID, verifiedAt: Date.now(),
      },
    });
    if (!funded) return;
    // Deliberately bypass the real funding integration: this simulates its
    // trusted database preconditions without fabricating a transaction hash.
    const now = Date.now();
    const entry = await ctx.db.insert("journalEntries", {
      organizationId: seeded.organizationId, orderId: seeded.orderId,
      network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS,
      eventKey: `fixture:funding:${seeded.orderId}`, kind: "funding", status: "posted",
      memo: "Synthetic test prepayment; no onchain transfer performed",
      sourceReference: "fixture-only:no-chain-receipt", effectiveAt: now, recordedAt: now,
    });
    await ctx.db.insert("journalLines", {
      organizationId: seeded.organizationId, journalEntryId: entry,
      account: "asset:usdc", side: "debit", amountAtomic: 100_000_000n, lineNumber: 0,
    });
    await ctx.db.insert("journalLines", {
      organizationId: seeded.organizationId, journalEntryId: entry,
      account: "liability:customer_prepayments", side: "credit", amountAtomic: 100_000_000n, lineNumber: 1,
    });
    await ctx.db.patch(seeded.orderId, { status: "funded", updatedAt: now });
  });
  return { t, organizationId: seeded.organizationId, orderId: seeded.orderId, taskVersionId: seeded.taskVersionId, sequence: 0 };
}

async function submission(fixture: Fixture, options: {
  sourceHash?: string;
  perceptualHash?: string;
  unavailableAnalysis?: boolean;
} = {}) {
  const sequence = ++fixture.sequence;
  const sourceHash = options.sourceHash ?? sequence.toString(16).padStart(64, "0");
  return fixture.t.run(async (ctx) => {
    const now = Date.now();
    const submissionId = await ctx.db.insert("submissions", {
      organizationId: fixture.organizationId, orderId: fixture.orderId, taskVersionId: fixture.taskVersionId,
      contributorTokenIdentifier: CONTRIBUTOR, status: "needs_review", clientRequestId: `fixture-submission-${sequence}`,
      expectedSourceHash: sourceHash, sourceHash,
      ...(options.perceptualHash ? { perceptualHash: options.perceptualHash } : {}), updatedAt: now,
    });
    const storageId = await ctx.storage.store(new Blob([`synthetic-media-fixture-${sequence}`], { type: "video/mp4" }));
    const originalAssetId = await ctx.db.insert("mediaAssets", {
      organizationId: fixture.organizationId, submissionId, storageId, purpose: "original", status: "verified",
      contentHash: sourceHash, mimeType: "video/mp4", sizeBytes: 128, durationMs: 12_000, width: 720, height: 480,
    });
    const consentRecordId = await ctx.db.insert("consentRecords", {
      organizationId: fixture.organizationId, submissionId, contributorTokenIdentifier: CONTRIBUTOR,
      licenseVersion: "demo-consent-v1", licenseHash: "f".repeat(64), scope: "Synthetic test demonstration license",
      acknowledgedAt: now, receiptHash: "d".repeat(64),
    });
    const jobId = await ctx.db.insert("jobs", {
      organizationId: fixture.organizationId, submissionId, taskVersionId: fixture.taskVersionId,
      sourceHash, pipelineVersion: "fixture-inference-v1", status: "completed", availableAt: now,
      attempt: 1, maxAttempts: 1, leaseGeneration: 1, completedAt: now,
    });
    const reportStorageId = await ctx.storage.store(new Blob([
      JSON.stringify({ fixtureOnly: true, submissionId, sourceHash, note: "No model was run" }),
    ], { type: "application/json" }));
    const outcome = options.unavailableAnalysis
      ? { implementation: "scaffold" as const, pipelineStatus: "ml_unavailable" as const, recommendation: "needs_review" as const }
      : { implementation: "inference" as const, pipelineStatus: "completed" as const, recommendation: "accept" as const };
    const analysisId = await ctx.db.insert("analysisResults", {
      organizationId: fixture.organizationId, jobId, submissionId, taskVersionId: fixture.taskVersionId,
      sourceHash, pipelineVersion: "fixture-inference-v1", leaseGeneration: 1,
      ...outcome, summary: "Synthetic stored analysis projection; not a live model result",
      reportStorageId, reportHash: "c".repeat(64), evidenceAssetIds: [originalAssetId], completedAt: now,
    });
    await ctx.db.patch(submissionId, { originalAssetId, consentRecordId, currentAnalysisId: analysisId });
    return submissionId;
  });
}

const review = (submissionId: Id<"submissions">, decision: "accept" | "reject" | "request_correction" = "accept") => ({
  demoIdentity: "controller", submissionId, decision, reasonCode: "human_evidence_review", note: "Reviewed the source clip and licensed task criteria.",
});
describe("human review", () => {
  it("accepts unavailable-model evidence through the shared gate exactly once", async () => {
    const f = await setup(), id = await submission(f, { unavailableAnalysis: true });
    const first = await f.t.mutation(api.review.reviewSubmission, review(id));
    expect(first.ok).toBe(true);
    expect(await f.t.mutation(api.review.reviewSubmission, review(id))).toMatchObject({ ...first, replayed: true });
    await f.t.run(async ctx => {
      expect(await ctx.db.query("payables").collect()).toHaveLength(1);
      expect(await ctx.db.query("deliveries").collect()).toHaveLength(1);
      expect(await ctx.db.query("reviewDecisions").collect()).toHaveLength(1);
      const decision = (await ctx.db.query("reviewDecisions").collect())[0]!;
      expect(decision.reasonCode).toBe("human_evidence_review");
      expect(decision.evidenceHash).toBe("c".repeat(64));
      expect((await ctx.db.get(f.orderId))!.acceptedCount).toBe(1n);
    });
  });
  it.each(["contributor", "finance-agent"])("refuses %s and audits without writing a decision", async demoIdentity => {
    const f = await setup(), id = await submission(f);
    expect(await f.t.mutation(api.review.reviewSubmission, { ...review(id), demoIdentity })).toMatchObject({ ok: false });
    expect(await f.t.mutation(api.review.reviewSubmission, { ...review(id), demoIdentity })).toMatchObject({ ok: false });
    await f.t.run(async ctx => {
      expect(await ctx.db.query("reviewDecisions").collect()).toHaveLength(0);
      expect(await ctx.db.query("payables").collect()).toHaveLength(0);
      expect((await ctx.db.query("auditEvents").collect()).filter(e => e.action === "review_refused")).toHaveLength(1);
    });
  });
  it("rejects cross-tenant access and conflicting contributor/controller roles", async () => {
    const f = await setup(), id = await submission(f);
    await f.t.run(async ctx => {
      const controller = await ctx.db.query("memberships").withIndex("by_token_identifier", q => q.eq("tokenIdentifier", "demo:skarl:controller")).unique();
      await ctx.db.patch(controller!._id, { roles: ["controller", "contributor"] });
    });
    expect(await f.t.mutation(api.review.reviewSubmission, review(id))).toMatchObject({ ok: false, code: "conflicting_roles" });
    await f.t.run(async ctx => {
      const org = await ctx.db.insert("organizations", { name: "other", createdByTokenIdentifier: "other", status: "active" });
      await ctx.db.patch(id, { organizationId: org });
    });
    expect(await f.t.mutation(api.review.reviewSubmission, review(id))).toMatchObject({ ok: false, code: "not_found" });
  });
  it.each(["reject", "request_correction"] as const)("records %s idempotently without a payable", async decision => {
    const f = await setup(), id = await submission(f);
    const first = await f.t.mutation(api.review.reviewSubmission, review(id, decision));
    expect(first).toMatchObject({ ok: true, replayed: false });
    expect(await f.t.mutation(api.review.reviewSubmission, review(id, decision))).toMatchObject({ ok: true, replayed: true });
    await f.t.run(async ctx => {
      expect((await ctx.db.get(id))!.status).toBe(decision === "reject" ? "rejected" : "needs_correction");
      expect(await ctx.db.query("payables").collect()).toHaveLength(0);
    });
  });
  it("does not let a stale acceptance retry override a later correction", async () => {
    const f = await setup(false), id = await submission(f);
    expect(await f.t.mutation(api.review.reviewSubmission, review(id))).toMatchObject({ ok: false, code: "order_not_funded_or_open" });
    expect(await f.t.mutation(api.review.reviewSubmission, review(id, "request_correction"))).toMatchObject({ ok: true });
    expect(await f.t.mutation(api.review.reviewSubmission, review(id))).toMatchObject({ ok: false, code: "review_superseded" });
  });
  it("cannot override duplicate, exhausted quota, or unfunded-order blocks", async () => {
    const f = await setup(), first = await submission(f, { sourceHash: "a".repeat(64) });
    expect(await f.t.mutation(api.review.reviewSubmission, review(first))).toMatchObject({ ok: true });
    const copy = await submission(f, { sourceHash: "a".repeat(64) });
    expect(await f.t.mutation(api.review.reviewSubmission, review(copy))).toMatchObject({ ok: false, code: "duplicate_submission", matchingSubmissionId: first });
    const next = await submission(f);
    await f.t.run(async ctx => { const order = await ctx.db.get(f.orderId); await ctx.db.patch(f.orderId, { acceptedCount: order!.quantityRequested }); });
    expect(await f.t.mutation(api.review.reviewSubmission, review(next))).toMatchObject({ ok: false, code: "quota_exhausted" });
    const unfunded = await setup(false), waiting = await submission(unfunded);
    expect(await unfunded.t.mutation(api.review.reviewSubmission, review(waiting))).toMatchObject({ ok: false, code: "order_not_funded_or_open" });
  });
});
