// @vitest-environment node
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { canonical, digest } from "./lib/finance";
import { audioFromTranscriptSegments, buildVerificationReports, EVALUATION_PROJECTION_VERSION,
  VERIFICATION_ONLY_WARNING, type BuildVerificationReportInput, type VideoObservation } from "./lib/verificationReport";
import { validateVerificationReportForRubric } from "../packages/contracts/src/verification";

// Synthetic bytes and mocked provider observations only. No decoding, credentials or inference.
const mocked = vi.hoisted(() => ({ prepare: vi.fn(), video: vi.fn(), audio: vi.fn() }));
vi.mock("./lib/media", () => ({ prepareMedia: mocked.prepare,
  MediaPreparationError: class extends Error { constructor(public code: string) { super(code); } } }));
vi.mock("./lib/gemini", () => ({ observeVideo: mocked.video, observeAudio: mocked.audio,
  videoModel: () => "mock-vision", audioModel: () => "mock-audio",
  GeminiFailure: class extends Error { constructor(public code: string) { super(code); } } }));
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const frames = [
  { timestampMs: 1_000, hash: "1234567890abcdef" },
  { timestampMs: 5_000, hash: "234567890abcdef1" },
  { timestampMs: 9_000, hash: "34567890abcdef12" },
];
const video: VideoObservation = { visibility: "clear", observations: [
  { action: "pickup", object: "red_cup", target: "unknown", startMs: 1_000, endMs: 3_000, description: "A hand picks up the red cup." },
  { action: "place", object: "red_cup", target: "coaster", startMs: 5_000, endMs: 7_000, description: "The hand places the red cup on the coaster." },
] };
const audio = audioFromTranscriptSegments([
  { startMs: 1_000, endMs: 3_000, text: "I pick up the red cup." },
  { startMs: 5_000, endMs: 7_000, text: "I place it on the coaster." },
], 12_000);
const run = { provider: "mock", model: "synthetic", promptVersion: "test-v1", elapsedMs: 10 };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-25T08:00:00Z"));
  mocked.prepare.mockReset().mockResolvedValue({ silentVideo: new Uint8Array([1]), audio: new Uint8Array([2]),
    durationMs: 12_000, videoFrames: [], frameDHashes: frames, perceptualHash: frames.map(f => f.hash).join(""), warnings: [] });
  mocked.video.mockReset().mockResolvedValue({ observation: video, run });
  mocked.audio.mockReset().mockResolvedValue({ observation: audio, run });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
async function setup() { const t = convexTest(schema, modules); return { t, ...await t.mutation(internal.seed.demo, {}) }; }
type Fixture = Awaited<ReturnType<typeof setup>>;
async function create(f: Fixture, request: string, evalRunId?: string) {
  const storageId = await f.t.run(ctx => ctx.storage.store(new Blob([`synthetic:${request}`], { type: "video/mp4" })));
  const args = { demoIdentity: "contributor", orderId: f.orderId, storageId, clientRequestId: request,
    consentAcknowledged: true, ...(evalRunId !== undefined ? { verificationOnly: true, evalRunId } : {}) };
  const { submissionId } = await f.t.mutation(api.submissions.create, args);
  const job = await f.t.run(async ctx => (await ctx.db.query("jobs").withIndex("by_logical_job", q => q.eq("submissionId", submissionId)).unique())!);
  return { submissionId, args, job };
}
async function inputFor(f: Fixture, item: Awaited<ReturnType<typeof create>>): Promise<BuildVerificationReportInput> {
  const rubric = await f.t.run(ctx => ctx.db.get(f.taskVersionId));
  return { submissionId: item.submissionId, taskVersionId: f.taskVersionId, sourceHash: item.job.sourceHash,
    durationMs: 12_000, criteria: rubric!.criteria, video, audio, modelRuns: [run], duplicate: { status: "clear", matches: [] } };
}
async function finish(f: Fixture, item: Awaited<ReturnType<typeof create>>) {
  await f.t.action(internal.verify.run, { jobId: item.job._id });
  return f.t.query(api.submissions.getReport, { demoIdentity: "contributor", submissionId: item.submissionId });
}
async function setFacts(f: Fixture, item: Awaited<ReturnType<typeof create>>) {
  const claim = await f.t.mutation(internal.submissions.claim, { jobId: item.job._id });
  await f.t.mutation(internal.submissions.facts, { jobId: item.job._id, generation: claim!.generation,
    sourceHash: item.job.sourceHash, durationMs: 12_000, mediaVerified: true, frameDHashes: frames });
  return claim!;
}

describe("evaluation corpus isolation and advisory projection", () => {
  it("binds scope on replay and rejects invalid or non-verification scopes", async () => {
    const f = await setup(), item = await create(f, "immutable", "run-a");
    expect(await f.t.mutation(api.submissions.create, item.args)).toEqual({ submissionId: item.submissionId, replayed: true });
    for (const patch of [{ evalRunId: "run-b" }, { evalRunId: undefined }]) {
      await expect(f.t.mutation(api.submissions.create, { ...item.args, ...patch })).rejects.toThrow("submission_request_conflict");
    }
    await expect(f.t.mutation(api.submissions.create, { ...item.args, verificationOnly: false })).rejects.toThrow("evaluation_requires_verification_only");
    for (const evalRunId of ["", " ", "x".repeat(65), "run/escape", "run\nother", "évaluation"]) {
      await expect(f.t.mutation(api.submissions.create, { ...item.args, evalRunId })).rejects.toThrow("invalid_eval_run_id");
    }
    expect(await f.t.query(api.submissions.evaluationRun, { demoIdentity: "contributor", orderId: f.orderId, evalRunId: "run-a" }))
      .toEqual({ submissions: [{ _id: item.submissionId, clientRequestId: "immutable" }], truncated: false });
  });

  it("detects copies inside one run while excluding other runs and ordinary submissions", async () => {
    const f = await setup();
    const original = await create(f, "original", "run-a");
    const originalReport = await finish(f, original);
    expect(originalReport.observations.evaluation.qualityReport.recommendation).toBe("accept");
    const sameRun = await create(f, "same-run", "run-a"); await setFacts(f, sameRun);
    expect(await f.t.query(internal.submissions.copies, { submissionId: sameRun.submissionId })).toMatchObject({
      status: "suspected", matches: [{ submissionId: original.submissionId, score: 1 }] });
    const otherRun = await create(f, "other-run", "run-b"); await setFacts(f, otherRun);
    expect(await f.t.query(internal.submissions.copies, { submissionId: otherRun.submissionId })).toEqual({ status: "clear", matches: [] });
    const normal = await create(f, "normal");
    const normalReport = await finish(f, normal);
    expect(normalReport.report.recommendation).toBe("accept");
    expect(normalReport.observations.evaluation).toBeUndefined();
    const ordinaryCopy = await create(f, "ordinary-copy"); await setFacts(f, ordinaryCopy);
    expect(await f.t.query(internal.submissions.copies, { submissionId: ordinaryCopy.submissionId })).toMatchObject({
      status: "suspected", matches: [{ submissionId: normal.submissionId, score: 1 }] });
    const inventory = await f.t.query(api.submissions.evaluationRun, { demoIdentity: "contributor", orderId: f.orderId, evalRunId: "run-a" });
    expect(inventory.submissions.map(s => s._id)).toEqual([original.submissionId, sameRun.submissionId]);
    expect(inventory.submissions[0]?.sourceHash).toBe(original.job.sourceHash);
  });

  it("stores a canonical advisory acceptance but keeps operational review and refuses all licensing/payables", async () => {
    const f = await setup(), item = await create(f, "quality", "quality-run"), stored = await finish(f, item);
    expect(stored).toMatchObject({ verificationOnly: true, evalRunId: "quality-run", report: { recommendation: "needs_review" } });
    const evaluation = stored.observations.evaluation;
    expect(evaluation).toMatchObject({ evaluationOnly: true, projectionVersion: EVALUATION_PROJECTION_VERSION,
      qualityReport: { recommendation: "accept", pipeline: { status: "completed" } } });
    expect(evaluation.qualityReportHash).toBe(digest(evaluation.qualityReport));
    const rubric = await f.t.run(ctx => ctx.db.get(f.taskVersionId));
    for (const report of [stored.report, evaluation.qualityReport]) {
      expect(validateVerificationReportForRubric(report, rubric!.criteria.map(c => c.criterionId)).valid).toBe(true);
      expect(report.source.sha256).toBe(item.job.sourceHash);
    }
    expect(evaluation.qualityReport.warnings).toEqual([]);
    expect(stored.report.warnings).toEqual([VERIFICATION_ONLY_WARNING]);
    expect(await f.t.mutation(api.finance.acceptAndPublish, { demoIdentity: "controller", submissionId: item.submissionId }))
      .toMatchObject({ ok: false, code: "verification_only_not_licensed" });
    expect(await f.t.run(ctx => ctx.db.query("payables").collect())).toHaveLength(0);
    expect(await f.t.run(ctx => ctx.db.query("deliveries").collect())).toHaveLength(0);
    expect(await f.t.run(ctx => ctx.db.query("journalEntries").collect())).toHaveLength(0);
  });

  it("preserves media warnings, failed providers and unscoped behavior instead of inventing a quality acceptance", async () => {
    const f = await setup(), item = await create(f, "warnings", "warning-run"), input = await inputFor(f, item);
    for (const extra of [{ warnings: ["Frame coverage is sparse."] }, { warnings: [VERIFICATION_ONLY_WARNING] }, { failure: "gemini_timeout" },
      { duplicate: { status: "not_checked" as const, matches: [] } }]) {
      const reports = buildVerificationReports({ ...input, ...extra }, { verificationOnly: true, evalRunId: "warning-run" });
      expect(reports.qualityReport?.recommendation).toBe("needs_review");
      expect(reports.report.warnings).toEqual([...new Set([...reports.qualityReport!.warnings, VERIFICATION_ONLY_WARNING])]);
    }
    expect(buildVerificationReports(input, { verificationOnly: true }).qualityReport).toBeUndefined();
    expect(buildVerificationReports(input, {}).report.recommendation).toBe("accept");
    mocked.audio.mockRejectedValueOnce(new Error("synthetic provider failure"));
    const stored = await finish(f, item);
    expect(stored.observations.evaluation.qualityReport).toMatchObject({ recommendation: "needs_review", pipeline: { status: "failed" } });
    expect(stored.observations.failureCode).toBe("audio_unavailable");
  });

  it("refuses mixed owner/order scopes, enforces role and tenant, and flags truncated inventories", async () => {
    const f = await setup(), item = await create(f, "scope", "owned-run");
    const args = { demoIdentity: "contributor", orderId: f.orderId, evalRunId: "owned-run" };
    await expect(f.t.query(api.submissions.evaluationRun, { ...args, demoIdentity: "controller" })).rejects.toThrow("forbidden");
    await expect(f.t.query(api.submissions.evaluationRun, { ...args, evalRunId: "bad run" })).rejects.toThrow("invalid_eval_run_id");
    await f.t.run(ctx => ctx.db.patch(item.submissionId, { contributorTokenIdentifier: "foreign" }));
    await expect(f.t.query(api.submissions.evaluationRun, args)).rejects.toThrow("evaluation_scope_contaminated");
    await expect(f.t.mutation(internal.submissions.claim, { jobId: item.job._id })).rejects.toThrow("job_reference_mismatch");
    await create(f, "second-owned", "owned-run");
    await f.t.run(ctx => ctx.db.patch(item.submissionId, { contributorTokenIdentifier: "demo:skarl:contributor", sourceHash: item.job.sourceHash, orderId: f.defaultOrderId }));
    await expect(f.t.query(api.submissions.evaluationRun, args)).rejects.toThrow("evaluation_scope_contaminated");
    await expect(f.t.query(internal.submissions.copies, { submissionId: item.submissionId })).rejects.toThrow("evaluation_scope_contaminated");
    await f.t.run(async ctx => {
      await ctx.db.patch(item.submissionId, { orderId: f.orderId });
      for (let index = 0; index < 199; index++) await ctx.db.insert("submissions", {
        organizationId: f.organizationId, orderId: f.orderId, taskVersionId: f.taskVersionId,
        contributorTokenIdentifier: "demo:skarl:contributor", status: "queued", clientRequestId: `extra-${index}`,
        verificationOnly: true, evalRunId: "owned-run", updatedAt: Date.now(),
      });
    });
    const inventory = await f.t.query(api.submissions.evaluationRun, args);
    expect(inventory.truncated).toBe(true); expect(inventory.submissions).toHaveLength(200);
    const foreignOrganization = await f.t.run(ctx => ctx.db.insert("organizations", { name: "Foreign", status: "active", createdByTokenIdentifier: "foreign" }));
    await f.t.run(ctx => ctx.db.patch(f.orderId, { organizationId: foreignOrganization }));
    await expect(f.t.query(api.submissions.evaluationRun, args)).rejects.toThrow("cross_organization_access");
  });

  it("rejects altered projection hashes and licensing bypasses at persistence", async () => {
    const f = await setup(), item = await create(f, "bound", "bound-run"), claim = await setFacts(f, item);
    const reports = buildVerificationReports(await inputFor(f, item), { verificationOnly: true, evalRunId: "bound-run" });
    const quality = reports.qualityReport!;
    const evaluation = { evaluationOnly: true, projectionVersion: EVALUATION_PROJECTION_VERSION, qualityReport: quality, qualityReportHash: digest(quality) };
    const reportJson = canonical(reports.report), reportStorageId = await f.t.run(ctx => ctx.storage.store(new Blob([reportJson], { type: "application/json" })));
    const args = { jobId: item.job._id, generation: claim.generation, reportJson, reportStorageId,
      reportHash: digest(reports.report), observationsJson: canonical({ evaluation }), processingElapsedMs: 1 };
    for (const patch of [{ qualityReportHash: "0".repeat(64) }, { projectionVersion: "different" }, { evaluationOnly: false },
      { qualityReport: { ...quality, submissionId: "foreign" } }, { qualityReport: { ...quality, criteria: quality.criteria.slice(1) } }]) {
      await expect(f.t.mutation(internal.submissions.complete, { ...args, observationsJson: canonical({ evaluation: { ...evaluation, ...patch } }) }))
        .rejects.toThrow("evaluation_report_mismatch");
    }
    await expect(f.t.mutation(internal.submissions.complete, { ...args, reportJson: canonical(quality), reportHash: digest(quality) }))
      .rejects.toThrow("evaluation_report_mismatch");
    await expect(f.t.mutation(internal.submissions.complete, { ...args, observationsJson: "{}" })).rejects.toThrow("evaluation_report_mismatch");
    expect(await f.t.mutation(internal.submissions.complete, args)).toBeTruthy();
  });

  it("keeps the finance copy guard global and counts accepted rows rather than evaluation uploads", async () => {
    const f = await setup(), item = await create(f, "normal-finance"); await setFacts(f, item);
    await f.t.run(async ctx => {
      for (let index = 0; index < 201; index++) await ctx.db.insert("submissions", {
        organizationId: f.organizationId, orderId: f.orderId, taskVersionId: f.taskVersionId,
        contributorTokenIdentifier: "demo:skarl:contributor", status: "needs_review", clientRequestId: `capacity-${index}`,
        verificationOnly: true, evalRunId: "capacity-run", updatedAt: Date.now(),
      });
    });
    // The next genuine guard is unfunded order, not capacity exhausted by 201 eval rows.
    expect(await f.t.mutation(api.finance.acceptAndPublish, { demoIdentity: "controller", submissionId: item.submissionId }))
      .toMatchObject({ ok: false, code: "order_not_funded_or_open" });
    const accepted = await f.t.run(ctx => ctx.db.insert("submissions", {
      organizationId: f.organizationId, orderId: f.defaultOrderId, taskVersionId: f.defaultTaskVersionId,
      contributorTokenIdentifier: "another-contributor", status: "accepted", clientRequestId: "accepted-security-fixture",
      // Defensive impossible-state fixture: even a scoped accepted row cannot hide from finance.
      verificationOnly: true, evalRunId: "other-run", sourceHash: "f".repeat(64), updatedAt: Date.now(),
      frameDHashes: frames.map(frame => ({ ...frame, hash: (BigInt(`0x${frame.hash}`) ^ 1n).toString(16).padStart(16, "0") })),
    }));
    expect(await f.t.mutation(api.finance.acceptAndPublish, { demoIdentity: "controller", submissionId: item.submissionId }))
      .toMatchObject({ ok: false, code: "duplicate_submission", matchingSubmissionId: accepted });
  });

  it("persists an evaluation-only failure projection when the worker lease expires", async () => {
    const f = await setup(), item = await create(f, "watchdog", "watchdog-run"), claim = await setFacts(f, item);
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1);
    await f.t.mutation(internal.submissions.expire, { jobId: item.job._id, generation: claim.generation });
    expect(await f.t.action(internal.verify.interrupted, { jobId: item.job._id, generation: claim.generation })).toHaveProperty("analysisId");
    const stored = await f.t.query(api.submissions.getReport, { demoIdentity: "contributor", submissionId: item.submissionId });
    expect(stored.observations.evaluation.qualityReport).toMatchObject({ recommendation: "needs_review", pipeline: { status: "failed" } });
    expect(stored.observations.evaluation.qualityReportHash).toBe(digest(stored.observations.evaluation.qualityReport));
    expect(stored.report.warnings).toContain(VERIFICATION_ONLY_WARNING);
  });

});
