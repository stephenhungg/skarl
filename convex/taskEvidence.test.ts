// @vitest-environment node
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { CAN_TO_HAT_TASK_SPEC, RED_CUP_TASK_SPEC } from "./lib/taskSpec";
import { audioFromTranscriptSegments, type VideoObservation } from "./lib/verificationReport";
import { validateVerificationReportForRubric } from "../packages/contracts/src/verification";

// Synthetic bytes and mocked independent providers; this does not establish live inference accuracy.
const mocked = vi.hoisted(() => ({ prepare: vi.fn(), video: vi.fn(), audio: vi.fn() }));
vi.mock("./lib/media", () => ({ prepareMedia: mocked.prepare,
  MediaPreparationError: class extends Error { constructor(public code: string) { super(code); } } }));
vi.mock("./lib/gemini", () => ({ observeVideo: mocked.video, observeAudio: mocked.audio,
  videoModel: () => "mock-vision", audioModel: () => "mock-audio",
  GeminiFailure: class extends Error { constructor(public code: string) { super(code); } } }));
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const criteria = [
  { criterionId: "can-pickup", description: "Pick up the can", modality: "visual" as const },
  { criterionId: "hat-placement", description: "Place the can closer to the hat that is next to the lamp", modality: "temporal" as const },
  { criterionId: "narration-alignment", description: "Narration agrees with visible actions and object", modality: "cross_modal" as const },
];
const video: VideoObservation = { visibility: "clear", observations: [
  { action: "pickup", object: "can", target: "unknown", startMs: 1_000, endMs: 3_000, description: "A hand picks up the can." },
  { action: "place", object: "can", target: "hat", startMs: 5_000, endMs: 7_000, description: "The can moves closer to the hat that is next to the lamp." },
] };
const audio = audioFromTranscriptSegments([
  { startMs: 0, endMs: 800, text: "Apple river cloud." },
  { startMs: 1_000, endMs: 3_000, text: "I pick up the can." },
  { startMs: 5_000, endMs: 7_000, text: "I place it closer to the hat that is next to the lamp." },
], 12_000, CAN_TO_HAT_TASK_SPEC);
const liveness = { words: ["apple", "river", "cloud"], issuedAt: 1_000, consumedAt: 20_000 };
const run = { provider: "mock", model: "synthetic", promptVersion: "task-test-v2", elapsedMs: 10 };
beforeEach(() => {
  vi.stubEnv("VERIFIER_JURY", "on");
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-25T08:00:00Z"));
  const frameDHashes = [{ timestampMs: 1_000, hash: "1234567890abcdef" },
    { timestampMs: 5_000, hash: "234567890abcdef1" }, { timestampMs: 9_000, hash: "34567890abcdef12" }];
  mocked.prepare.mockReset().mockResolvedValue({ silentVideo: new Uint8Array([1]), audio: new Uint8Array([2]),
    durationMs: 12_000, videoFrames: [], hashFrames: [], frameDHashes,
    perceptualHash: frameDHashes.map(frame => frame.hash).join(""), warnings: [] });
  mocked.video.mockReset().mockImplementation(async (_frames, _duration, model) => ({ observation: video, run: { ...run, model: model ?? run.model } }));
  mocked.audio.mockReset().mockResolvedValue({ observation: audio, run });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });
async function fixture(withSpec = true) {
  const t = convexTest(schema, modules); await t.mutation(internal.seed.demo, {});
  const order = await t.mutation(api.orders.createOrder, { demoIdentity: "buyer", requestId: "can-task-evidence",
    title: "Can-to-hat narrated demonstrations", buyerWalletAddress: `0x${"1".repeat(40)}`,
    quantityRequested: "1", pricePerSampleAtomic: "1000000", contributorRateAtomic: "750000", deadlineAt: Date.now() + 3_600_000,
    taskPrompt: "Pick up the can and place it closer to the hat that is next to the lamp. Narrate each action. Fixed camera; can, hat and lamp in frame; 10 to 30 seconds.",
    criteria, ...(withSpec ? { taskSpec: CAN_TO_HAT_TASK_SPEC } : {}) });
  const storageId = await t.run(ctx => ctx.storage.store(new Blob(["synthetic can task video"], { type: "video/mp4" })));
  const { submissionId } = await t.mutation(api.submissions.create, { demoIdentity: "contributor", orderId: order.orderId,
    storageId, clientRequestId: "can-evidence", consentAcknowledged: true, verificationOnly: true, evalRunId: "can-task-synthetic" });
  await t.run(ctx => ctx.db.patch(submissionId, { liveness }));
  const job = await t.run(async ctx => (await ctx.db.query("jobs").withIndex("by_logical_job", q => q.eq("submissionId", submissionId)).unique())!);
  await t.action(internal.verify.run, { jobId: job._id });
  const stored = await t.query(api.submissions.getReport, { demoIdentity: "contributor", submissionId });
  return { t, stored };
}

describe("task-scoped verifier persistence (synthetic providers)", () => {
  it("passes the frozen can task to both visual judges and audio, preserving can/hat evidence without granting payment authority", async () => {
    const { t, stored } = await fixture();
    expect(mocked.video).toHaveBeenCalledTimes(2);
    for (const call of mocked.video.mock.calls) expect(call[3]).toEqual({ taskSpec: CAN_TO_HAT_TASK_SPEC, criteria });
    expect(mocked.audio).toHaveBeenCalledWith(new Uint8Array([2]), 12_000, { taskSpec: CAN_TO_HAT_TASK_SPEC, criteria });
    expect(stored.report).toMatchObject({ recommendation: "needs_review", pipeline: { version: "task-evidence-2.0" },
      observations: { video, audio } });
    const quality = stored.observations.evaluation.qualityReport;
    expect(quality.recommendation).toBe("accept");
    expect(quality.criteria.every((criterion: { status: string }) => criterion.status === "supported")).toBe(true);
    expect(validateVerificationReportForRubric(quality, criteria.map(criterion => criterion.criterionId), CAN_TO_HAT_TASK_SPEC).valid).toBe(true);
    expect(validateVerificationReportForRubric(quality, criteria.map(criterion => criterion.criterionId), RED_CUP_TASK_SPEC).valid).toBe(false);
    expect(stored.observations.jury).toMatchObject({ advisoryOnly: true, agreementFraction: 1, disagreedCriteria: [] });
    for (const judge of stored.observations.jury.judges) expect(judge.report.observations.video.observations).toEqual(video.observations);
    await t.run(async ctx => {
      expect(await ctx.db.query("payables").collect()).toHaveLength(0);
      expect(await ctx.db.query("paymentIntents").collect()).toHaveLength(0);
    });
  });

  it("stores review-only unavailable evidence for an unrelated order without a structured spec", async () => {
    const { stored } = await fixture(false);
    expect(mocked.prepare).not.toHaveBeenCalled();
    expect(mocked.video).not.toHaveBeenCalled();
    expect(mocked.audio).not.toHaveBeenCalled();
    expect(stored.observations.failureCode).toBe("task_spec_unavailable");
    expect(stored.report).toMatchObject({ recommendation: "needs_review", pipeline: { status: "failed" } });
    expect(stored.report.criteria.every((criterion: { status: string }) => criterion.status === "unobservable")).toBe(true);
  });
});
