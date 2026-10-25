import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { audioFromTranscriptSegments, buildVerificationReport, PIPELINE_VERSION } from "./lib/verificationReport";
import { canonical, digest, recordJournal } from "./lib/finance";
import { createFundingJournal } from "../packages/ledger/src/index";
import { PAYMENT_CHAIN_ID, PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/chain";
import { proposeAgentPaymentFor } from "./finance";

// In-memory synthetic fixtures only; no model, signature, funding or transfer is live.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const CONTRIBUTOR = "demo:skarl:contributor", BUYER = "demo:skarl:buyer", POLICY = "service:skarl:policy-engine";
const RECIPIENT = `0x${"11".repeat(20)}`;
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });
async function setup() {
  const t = convexTest(schema, modules); workflowTest.register(t);
  const seeded = await t.mutation(internal.seed.demo, {});
  return { t, organizationId: seeded.organizationId, orderId: seeded.defaultOrderId, taskVersionId: seeded.defaultTaskVersionId };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
/** Synthetic stored evidence for tests only, never used by hosted scenario preparation. */
async function licensedInference(f: Fixture, accept = false) {
  const submissionId = await f.t.run(async ctx => {
    const now = Date.now(), sourceHash = digest(`synthetic-test-ready:${accept}`);
    const contributor = (await ctx.db.query("memberships").withIndex("by_token_identifier", q => q.eq("tokenIdentifier", CONTRIBUTOR)).unique())!;
    await ctx.db.patch(contributor._id, { walletAddress: RECIPIENT, walletVerification: {
      siweMessageHash: "e".repeat(64), nonce: "synthetic-test-only", signature: `0x${"1".repeat(130)}`, chainId: PAYMENT_CHAIN_ID, verifiedAt: now,
    } });
    const liveness = { words: ["apple", "river", "cloud"], issuedAt: now, consumedAt: now };
    const submissionId = await ctx.db.insert("submissions", { organizationId: f.organizationId, orderId: f.orderId,
      taskVersionId: f.taskVersionId, contributorTokenIdentifier: CONTRIBUTOR, sourceHash, status: "needs_review",
      clientRequestId: `synthetic-licensed-policy-test:${accept}`, liveness, updatedAt: now });
    const storageId = await ctx.storage.store(new Blob(["synthetic test media, no recording"], { type: "video/mp4" }));
    const originalAssetId = await ctx.db.insert("mediaAssets", { organizationId: f.organizationId, submissionId, storageId,
      purpose: "original", status: "verified", contentHash: sourceHash, mimeType: "video/mp4", sizeBytes: 40, durationMs: 12_000 });
    const consentRecordId = await ctx.db.insert("consentRecords", { organizationId: f.organizationId, submissionId,
      contributorTokenIdentifier: CONTRIBUTOR, licenseVersion: "synthetic-test-license", licenseHash: "f".repeat(64),
      scope: "Synthetic isolated policy fixture only", acknowledgedAt: now, receiptHash: "d".repeat(64) });
    const jobId = await ctx.db.insert("jobs", { organizationId: f.organizationId, submissionId, taskVersionId: f.taskVersionId,
      sourceHash, pipelineVersion: PIPELINE_VERSION, status: "completed", availableAt: now, attempt: 1, maxAttempts: 1,
      leaseGeneration: 1, completedAt: now });
    const audio = audioFromTranscriptSegments([
      { startMs: 0, endMs: 800, text: "Apple river cloud." },
      { startMs: 1_000, endMs: 3_000, text: "I pick up the red cup." },
      { startMs: 5_000, endMs: 7_000, text: "I place it on the coaster." },
    ], 12_000);
    const rubric = (await ctx.db.get(f.taskVersionId))!;
    const report = buildVerificationReport({ submissionId, taskVersionId: f.taskVersionId, sourceHash, durationMs: 12_000,
      criteria: rubric.criteria, liveness, audio, video: { visibility: "clear", observations: [
        { action: "pickup", object: "red_cup", target: "unknown", startMs: 1_000, endMs: 3_000, description: "A hand picks up the red cup." },
        { action: "place", object: "red_cup", target: "coaster", startMs: 5_000, endMs: 7_000, description: "The hand places the red cup on the coaster." },
      ] }, duplicate: { status: "clear", matches: [] }, modelRuns: [{ provider: "simulated", model: "synthetic-test-only", promptVersion: "fixture" }] });
    expect(report.recommendation).toBe("accept");
    const reportStorageId = await ctx.storage.store(new Blob([canonical(report)], { type: "application/json" }));
    const analysisId = await ctx.db.insert("analysisResults", { organizationId: f.organizationId, jobId, submissionId,
      taskVersionId: f.taskVersionId, sourceHash, pipelineVersion: PIPELINE_VERSION, leaseGeneration: 1,
      implementation: "inference", pipelineStatus: "completed", recommendation: "accept", summary: "Synthetic stored inference fixture; no model run",
      reportStorageId, reportHash: digest(report), reportJson: canonical(report), observationsJson: canonical({ audio,
        jury: { advisoryOnly: true, agreementFraction: 1, disagreedCriteria: [], judges: [
          { model: "synthetic-judge-a", report }, { model: "synthetic-judge-b", report },
        ] } }), evidenceAssetIds: [originalAssetId], completedAt: now });
    await ctx.db.patch(submissionId, { originalAssetId, consentRecordId, currentAnalysisId: analysisId });
    if (accept) {
      await ctx.db.patch(f.orderId, { status: "funded" });
      const order = (await ctx.db.get(f.orderId))!;
      await recordJournal(ctx, f.organizationId, createFundingJournal({ eventId: `fixture:funding:${f.orderId}`,
        orderId: f.orderId, amountMicroUsdc: order.budgetAtomic }));
    }
    return submissionId;
  });
  if (accept) expect((await f.t.mutation(api.finance.acceptAndPublish, { demoIdentity: "controller", submissionId })).ok).toBe(true);
  return submissionId;
}

async function ready() {
  const f = await setup(), submissionId = await licensedInference(f);
  await f.t.run(async ctx => {
    const now = Date.now(), order = (await ctx.db.get(f.orderId))!;
    await ctx.db.patch(f.orderId, { status: "funded", autoPay: { enabled: true, maxPerClipAtomic: order.pricePerSampleAtomic,
      requireAllChecks: true, setBy: BUYER, setAt: now } });
    await recordJournal(ctx, f.organizationId, createFundingJournal({ eventId: `fixture:funding:${f.orderId}`,
      orderId: f.orderId, amountMicroUsdc: order.budgetAtomic }));
  });
  const submission = (await f.t.run(ctx => ctx.db.get(submissionId)))!;
  return { ...f, submissionId, analysisId: submission.currentAnalysisId!, consentId: submission.consentRecordId! };
}
type Ready = Awaited<ReturnType<typeof ready>>;
async function editReport(f: Ready, edit: (report: any, observations: any) => void) {
  await f.t.run(async ctx => {
    const analysis = (await ctx.db.get(f.analysisId))!;
    const report = JSON.parse(analysis.reportJson!), observations = JSON.parse(analysis.observationsJson!);
    edit(report, observations);
    await ctx.db.patch(f.analysisId, { reportJson: canonical(report), reportHash: digest(report), observationsJson: canonical(observations) });
  });
}
async function proposed(f: Ready) {
  const accepted = await f.t.mutation(internal.policy.evaluateSubmission, { submissionId: f.submissionId });
  expect(accepted.ok).toBe(true);
  const payable = await f.t.run(ctx => ctx.db.query("payables").withIndex("by_order", q => q.eq("orderId", f.orderId)).unique());
  expect(payable).not.toBeNull();
  const result = await f.t.run(ctx => proposeAgentPaymentFor(ctx, { payableId: payable!._id }));
  if (!result.ok) throw new Error(result.code);
  return { ...result, payableId: payable!._id };
}
async function expectReview(f: Ready, code: string) {
  const result = await f.t.mutation(internal.policy.evaluateSubmission, { submissionId: f.submissionId });
  expect(result.ok).toBe(false);
  if (!result.ok && "failures" in result) expect(result.failures).toContain(code);
  expect((await f.t.run(ctx => ctx.db.get(f.submissionId)))?.status).toBe("needs_review");
  expect(await f.t.run(ctx => ctx.db.query("payables").collect())).toEqual([]);
  const queue = await f.t.query(api.exceptions.list, { demoIdentity: "buyer", orderId: f.orderId });
  expect(queue.some(row => row.exception.code === "policy_review" && row.exception.failures.includes(code))).toBe(true);
}

describe("deterministic acceptance fails closed with precise buyer-review reasons", () => {
  const cases: [string, string, (f: Ready) => Promise<unknown>][] = [
    ["missing analysis", "completed_accept_inference_required", f => f.t.run(ctx => ctx.db.patch(f.submissionId, { currentAnalysisId: undefined }))],
    ["incomplete inference", "completed_accept_inference_required", f => f.t.run(ctx => ctx.db.patch(f.analysisId, { pipelineStatus: "needs_review", recommendation: "needs_review" }))],
    ["scaffold", "completed_accept_inference_required", f => f.t.run(ctx => ctx.db.patch(f.analysisId, { implementation: "scaffold", pipelineStatus: "ml_unavailable", recommendation: "needs_review" }))],
    ["jury disagreement", "jury_not_accept", f => editReport(f, (_r, o) => { o.jury.agreementFraction = 0; o.jury.disagreedCriteria = ["red-cup-pickup"]; })],
    ["missing jury", "jury_not_accept", f => editReport(f, (_r, o) => { delete o.jury; })],
    ["duplicate", "duplicate_not_clear", f => editReport(f, r => { r.duplicate.status = "suspected"; })],
    ["missing liveness transcript", "liveness:missing_transcript", f => editReport(f, (_r, o) => { delete o.audio; })],
    ["prompt injection", "prompt_injection_flag", f => editReport(f, r => { r.warnings.push("Instruction-like media content requires human review"); })],
    ["missing consent", "consent_license_required", f => f.t.run(ctx => ctx.db.patch(f.submissionId, { consentRecordId: undefined }))],
    ["revoked consent", "consent_license_required", f => f.t.run(ctx => ctx.db.patch(f.consentId, { revocationStatus: "revoked" }))],
    ["missing rubric check", "rubric_checks_incomplete", f => editReport(f, r => { r.criteria.pop(); })],
    ["policy attributed to another actor", "buyer_policy_invalid", f => f.t.run(async ctx => { const order = (await ctx.db.get(f.orderId))!; await ctx.db.patch(f.orderId, { autoPay: { ...order.autoPay!, setBy: "untrusted-narration" } }); })],
    ["disabled buyer rule", "auto_pay_disabled", f => f.t.mutation(api.orders.setAutoPay, { demoIdentity: "buyer", orderId: f.orderId, enabled: false, maxPerClipAtomic: "2500000" })],
  ];
  for (const [label, code, mutate] of cases) it(`routes ${label} to review without creating a payable`, async () => {
    const f = await ready(); await mutate(f); await expectReview(f, code);
  });
  it("cannot accept without remaining prepaid funds even if inference passes", async () => {
    const f = await ready();
    await f.t.run(async ctx => { for (const line of await ctx.db.query("journalLines").collect()) await ctx.db.patch(line._id, { amountAtomic: 1n }); });
    await expectReview(f, "insufficient_funded_remaining");
  });
});

describe("policy approval preserves buyer caps, bindings and independent authority", () => {
  it("accepts and approves exact-cap payment under an internal service while retaining unpaid status", async () => {
    const f = await ready(), p = await proposed(f);
    await f.t.mutation(api.orders.setAutoPay, { demoIdentity: "buyer", orderId: f.orderId, enabled: true, maxPerClipAtomic: "1875000" });
    expect((await f.t.mutation(internal.policy.policyApproval, { intentId: p.intentId })).ok).toBe(true);
    const approval = await f.t.run(ctx => ctx.db.query("approvals").unique());
    expect(approval).toMatchObject({ approverTokenIdentifier: POLICY, requestedBy: { kind: "service", identity: "demo:skarl:finance-agent" } });
    expect((await f.t.run(ctx => ctx.db.get(p.payableId)))?.status).toBe("payout_in_progress");
    expect(await f.t.run(ctx => ctx.db.query("chainObservations").collect())).toEqual([]);
  });
  const cases: [string, string, (f: Ready, p: Awaited<ReturnType<typeof proposed>>) => Promise<unknown>][] = [
    ["one micro above buyer cap", "over_cap_payout", f => f.t.mutation(api.orders.setAutoPay, { demoIdentity: "buyer", orderId: f.orderId, enabled: true, maxPerClipAtomic: "1874999" })],
    ["changed accepted payable", "accepted_payable_binding_required", (f, p) => f.t.run(ctx => ctx.db.patch(p.payableId, { amountAtomic: 2n }))],
    ["unverified wallet", "verified_contributor_wallet_required", f => f.t.run(async ctx => { const m = (await ctx.db.query("memberships").withIndex("by_token_identifier", q => q.eq("tokenIdentifier", CONTRIBUTOR)).unique())!; await ctx.db.patch(m._id, { walletVerification: undefined }); })],
    ["unfunded order", "insufficient_funded_remaining", f => f.t.run(ctx => ctx.db.patch(f.orderId, { status: "awaiting_funding" }))],
    ["exhausted cash", "insufficient_funded_remaining", f => f.t.run(async ctx => { for (const line of await ctx.db.query("journalLines").collect()) if (line.account === "asset:usdc") await ctx.db.patch(line._id, { amountAtomic: 1n }); })],
    ["changed command binding", "proposal_binding_changed", (f, p) => f.t.run(ctx => ctx.db.patch(p.paymentCommandId, { bindingHash: "changed" }))],
    ["withdrawn consent", "consent_license_required", f => f.t.run(ctx => ctx.db.patch(f.consentId, { revocationStatus: "revoked" }))],
  ];
  for (const [label, code, mutate] of cases) it(`refuses ${label} and records the reason without approval`, async () => {
    const f = await ready(), p = await proposed(f); await mutate(f, p);
    const result = await f.t.mutation(internal.policy.policyApproval, { intentId: p.intentId });
    expect(result).toMatchObject({ ok: false, code });
    expect(await f.t.run(ctx => ctx.db.query("approvals").collect())).toEqual([]);
    const queue = await f.t.query(api.exceptions.list, { demoIdentity: "buyer", orderId: f.orderId });
    expect(queue.some(row => row.exception.code === "policy_review" && row.exception.failures.includes(code))).toBe(true);
  });
  it("reserves already approved intents before authorizing another payout from the same funded order", async () => {
    const f = await ready(), p = await proposed(f);
    await f.t.run(async ctx => {
      const original = (await ctx.db.get(p.intentId))!;
      const { _id, _creationTime, ...terms } = original;
      await ctx.db.insert("paymentIntents", { ...terms, intentId: "synthetic-reserved-other-payout", amountAtomic: 9_000_000n, status: "approved" });
    });
    expect(await f.t.mutation(internal.policy.policyApproval, { intentId: p.intentId })).toMatchObject({ ok: false, code: "insufficient_funded_remaining" });
    expect(await f.t.run(ctx => ctx.db.query("approvals").collect())).toEqual([]);
  });
  it("keeps the internal policy service working with public demo selectors disabled", async () => {
    const f = await ready(), p = await proposed(f);
    vi.stubEnv("SKARL_DEMO_IDENTITIES", "off");
    expect((await f.t.mutation(internal.policy.policyApproval, { intentId: p.intentId })).ok).toBe(true);
    expect((await f.t.run(ctx => ctx.db.query("approvals").unique()))?.approverTokenIdentifier).toBe(POLICY);
  });
  it("allows the owning buyer to approve an exception proposed by the agent", async () => {
    const f = await ready(), p = await proposed(f);
    expect((await f.t.mutation(api.finance.approve, { demoIdentity: "buyer", intentId: p.intentId })).ok).toBe(true);
    expect((await f.t.run(ctx => ctx.db.query("approvals").unique()))?.approverTokenIdentifier).toBe(BUYER);
  });
  it("refuses a different buyer in the same tenant on policy edits, acceptance and approval", async () => {
    const f = await ready(), p = await proposed(f);
    await f.t.run(ctx => ctx.db.patch(f.orderId, { buyerTokenIdentifier: "another-buyer" }));
    await expect(f.t.mutation(api.orders.setAutoPay, { demoIdentity: "buyer", orderId: f.orderId, enabled: false, maxPerClipAtomic: "1" })).rejects.toThrow("order_not_found");
    await expect(f.t.mutation(api.finance.acceptAndPublish, { demoIdentity: "buyer", submissionId: f.submissionId })).rejects.toThrow("order_not_owned");
    await expect(f.t.mutation(api.finance.approve, { demoIdentity: "buyer", intentId: p.intentId })).rejects.toThrow("order_not_owned");
    expect(await f.t.run(ctx => ctx.db.query("approvals").collect())).toEqual([]);
  });
  it("refuses every public policy-engine selector even after provisioning the real service", async () => {
    const f = await ready(), p = await proposed(f);
    for (const demoIdentity of ["policy-engine", POLICY]) {
      expect(await f.t.mutation(api.finance.approve, { demoIdentity, intentId: p.intentId })).toMatchObject({ ok: false, code: "unknown_demo_identity" });
      await expect(f.t.mutation(api.orders.setAutoPay, { demoIdentity, orderId: f.orderId, enabled: false, maxPerClipAtomic: "1" })).rejects.toThrow("unknown_demo_identity");
    }
  });
  it("refuses a buyer from another tenant without granting policy or approval access", async () => {
    const f = await ready(), p = await proposed(f);
    const userId = await f.t.run(async ctx => {
      const userId = await ctx.db.insert("users", { email: "foreign-buyer@example.test" });
      const organizationId = await ctx.db.insert("organizations", { name: "Foreign test tenant", status: "active", createdByTokenIdentifier: `auth:${userId}` });
      await ctx.db.insert("memberships", { organizationId, issuer: "auth", subject: userId,
        tokenIdentifier: `auth:${userId}`, roles: ["buyer"], grantedByTokenIdentifier: `auth:${userId}`, status: "active" });
      return userId;
    });
    const signed = f.t.withIdentity({ subject: `${userId}|test`, issuer: "https://auth.example.test" });
    expect(await signed.mutation(api.finance.approve, { demoIdentity: "policy-engine", intentId: p.intentId })).toMatchObject({ ok: false, code: "not_found" });
    await expect(signed.mutation(api.orders.setAutoPay, { demoIdentity: "buyer", orderId: f.orderId, enabled: true, maxPerClipAtomic: "1" })).rejects.toThrow("order_not_found");
    expect(await f.t.run(ctx => ctx.db.query("approvals").collect())).toEqual([]);
  });
  it("signed humans cannot become policy-engine through a selector or service role", async () => {
    const f = await ready(), p = await proposed(f);
    const userId = await f.t.run(ctx => ctx.db.insert("users", { email: "synthetic@example.test" }));
    const signed = f.t.withIdentity({ subject: `${userId}|test`, issuer: "https://auth.example.test" });
    const memberId = await f.t.run(ctx => ctx.db.insert("memberships", { organizationId: f.organizationId,
      issuer: "auth", subject: userId, tokenIdentifier: `auth:${userId}`, roles: ["buyer"], grantedByTokenIdentifier: BUYER, status: "active" }));
    // The selector cannot replace the authenticated buyer's persisted principal.
    await expect(signed.mutation(api.finance.approve, { demoIdentity: "policy-engine", intentId: p.intentId })).rejects.toThrow("order_not_owned");
    await f.t.run(ctx => ctx.db.patch(memberId, { roles: ["policy-engine", "buyer"] }));
    expect(await signed.mutation(api.finance.approve, { demoIdentity: "buyer", intentId: p.intentId })).toMatchObject({ ok: false, code: "internal_service_only" });
    expect(await f.t.run(ctx => ctx.db.query("approvals").collect())).toEqual([]);
  });
});

describe("buyer rule creation and changes", () => {
  const input = () => ({ demoIdentity: "buyer", requestId: "policy-order", title: "Policy fixture", buyerWalletAddress: RECIPIENT,
    quantityRequested: "3", pricePerSampleAtomic: "9007199254740993", contributorRateAtomic: "1000000", deadlineAt: Date.now() + 3_600_000,
    taskPrompt: "Cup upright", criteria: [{ criterionId: "cup", description: "Cup upright", modality: "visual" as const }] });
  it("defaults ON with an exact bigint per-clip cap and records the buyer signature audit", async () => {
    const f = await setup(), created = await f.t.mutation(api.orders.createOrder, input());
    const order = (await f.t.run(ctx => ctx.db.get(created.orderId)))!;
    expect(order.autoPay).toMatchObject({ enabled: true, maxPerClipAtomic: 9007199254740993n, requireAllChecks: true, setBy: BUYER });
    expect((await f.t.run(ctx => ctx.db.query("auditEvents").collect())).filter(row => row.entityId === order._id && row.action === "auto_pay_policy_set")).toHaveLength(1);
    expect((await f.t.mutation(api.orders.createOrder, input())).replayed).toBe(true);
  });
  for (const cap of ["0", "1.5", "-1", "9223372036854775808"]) it(`rejects invalid or inexact buyer cap ${cap}`, async () => {
    const f = await setup();
    await expect(f.t.mutation(api.orders.createOrder, { ...input(), autoPay: { enabled: true, maxPerClipAtomic: cap, requireAllChecks: true } })).rejects.toThrow();
  });
  it("allows explicit opt-out at creation and audits later cap changes and disabling idempotently", async () => {
    const f = await setup(), created = await f.t.mutation(api.orders.createOrder, { ...input(), autoPay: { enabled: false, maxPerClipAtomic: "2000000", requireAllChecks: true } });
    expect((await f.t.run(ctx => ctx.db.get(created.orderId)))?.autoPay?.enabled).toBe(false);
    const change = { demoIdentity: "buyer", orderId: created.orderId, enabled: true, maxPerClipAtomic: "1234567" };
    expect(await f.t.mutation(api.orders.setAutoPay, change)).toMatchObject({ replayed: false });
    expect(await f.t.mutation(api.orders.setAutoPay, change)).toMatchObject({ replayed: true });
    await f.t.mutation(api.orders.setAutoPay, { ...change, enabled: false });
    const order = (await f.t.run(ctx => ctx.db.get(created.orderId)))!;
    expect(order.autoPay).toMatchObject({ enabled: false, maxPerClipAtomic: 1234567n, setBy: BUYER });
    expect((await f.t.run(ctx => ctx.db.query("auditEvents").collect())).filter(row => row.entityId === order._id && row.action === "auto_pay_policy_changed")).toHaveLength(2);
  });
});
