import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const submissionEvidence = makeFunctionReference<"query">("media:submissionEvidence");
const duplicatePair = makeFunctionReference<"query">("media:duplicatePair");
const hashes = ["1234567890abcdef", "234567890abcdef1", "34567890abcdef12"];

async function setup() {
  const t = convexTest(schema, modules);
  const seeded = await t.mutation(internal.seed.demo, {});
  const ids = await t.run(async ctx => {
    const submissionId = await ctx.db.insert("submissions", { organizationId: seeded.organizationId,
      orderId: seeded.orderId, taskVersionId: seeded.taskVersionId, contributorTokenIdentifier: "demo:skarl:contributor",
      status: "needs_review", clientRequestId: "synthetic-media", sourceHash: "a".repeat(64),
      frameDHashes: hashes.map((hash, index) => ({ hash, timestampMs: (index + 1) * 1000 })),
      perceptualHashSource: "serverComputed", updatedAt: Date.now() });
    const storageId = await ctx.storage.store(new Blob(["synthetic media"], { type: "video/mp4" }));
    const originalAssetId = await ctx.db.insert("mediaAssets", { organizationId: seeded.organizationId, submissionId,
      storageId, purpose: "original", status: "verified", contentHash: "a".repeat(64), mimeType: "video/mp4", sizeBytes: 15, durationMs: 4000 });
    const jobId = await ctx.db.insert("jobs", { organizationId: seeded.organizationId, submissionId, taskVersionId: seeded.taskVersionId,
      sourceHash: "a".repeat(64), pipelineVersion: "fixture", status: "completed", availableAt: Date.now(), attempt: 1, maxAttempts: 1, leaseGeneration: 1 });
    const frameStorage = await ctx.storage.store(new Blob(["synthetic frame"], { type: "image/jpeg" }));
    const frameId = await ctx.db.insert("mediaAssets", { organizationId: seeded.organizationId, submissionId, jobId,
      storageId: frameStorage, purpose: "evidence_frame", status: "verified", contentHash: "b".repeat(64), mimeType: "image/jpeg",
      sizeBytes: 15, sourceTimestampMs: 1000 });
    const reportStorageId = await ctx.storage.store(new Blob(["{}"], { type: "application/json" }));
    const analysisId = await ctx.db.insert("analysisResults", { organizationId: seeded.organizationId, jobId, submissionId,
      taskVersionId: seeded.taskVersionId, sourceHash: "a".repeat(64), pipelineVersion: "fixture", leaseGeneration: 1,
      summary: "Synthetic evidence", reportStorageId, reportHash: "c".repeat(64), evidenceAssetIds: [originalAssetId, frameId],
      completedAt: Date.now(), implementation: "inference", pipelineStatus: "completed", recommendation: "needs_review",
      observationsJson: JSON.stringify({ audio: { segments: [{ startMs: 1000, endMs: 2000, text: "Synthetic narration." }] } }) });
    await ctx.db.patch(submissionId, { originalAssetId, currentAnalysisId: analysisId });
    const matchingSubmissionId = await ctx.db.insert("submissions", { organizationId: seeded.organizationId,
      orderId: seeded.orderId, taskVersionId: seeded.taskVersionId, contributorTokenIdentifier: "demo:other-contributor",
      status: "accepted", clientRequestId: "synthetic-copy", sourceHash: "d".repeat(64),
      frameDHashes: hashes.map((hash, index) => ({ hash, timestampMs: (index + 1) * 1000 })), updatedAt: Date.now() });
    return { submissionId, matchingSubmissionId, originalAssetId, frameId, analysisId };
  });
  return { t, ...seeded, ...ids };
}

describe("private evidence queries (synthetic storage only)", () => {
  it("returns bound clip/frame URLs and timestamped transcript to controller and owner", async () => {
    const f = await setup();
    for (const demoIdentity of ["controller", "contributor"]) {
      const result = await f.t.query(submissionEvidence, { demoIdentity, submissionId: f.submissionId });
      expect(result.clip.url).toMatch(/^https?:/);
      expect(result.frames).toHaveLength(1);
      expect(result.frames[0]).toMatchObject({ assetId: f.frameId, timestampMs: 1000 });
      expect(result.frames[0].url).toMatch(/^https?:/);
      expect(result.transcriptSegments).toEqual([{ startMs: 1000, endMs: 2000, text: "Synthetic narration." }]);
    }
    for (const demoIdentity of ["buyer", "finance-agent", "unknown"]) {
      await expect(f.t.query(submissionEvidence, { demoIdentity, submissionId: f.submissionId })).rejects.toThrow();
    }
    await expect(f.t.query(submissionEvidence, { demoIdentity: "contributor", submissionId: f.matchingSubmissionId })).rejects.toThrow("submission_not_owned");
  });

  it("checks both duplicate submissions before returning either side", async () => {
    const f = await setup();
    const args = { submissionId: f.submissionId, matchingSubmissionId: f.matchingSubmissionId };
    await expect(f.t.query(duplicatePair, { ...args, demoIdentity: "contributor" })).rejects.toThrow("submission_not_owned");
    const result = await f.t.query(duplicatePair, { ...args, demoIdentity: "controller" });
    expect(result.score).toBe(1);
    expect(result.matchedFrames.map((row: { distance: number }) => row.distance)).toEqual([0, 0, 0]);
    expect(result.matchedFrames[0].leftFrame.assetId).toBe(f.frameId);
    expect(result.matchedFrames[0].rightFrame).toBeNull();
    expect(result.right.framesAvailable).toBe(false);
    await f.t.run(async ctx => {
      const other = await ctx.db.insert("organizations", { name: "Other", createdByTokenIdentifier: "other", status: "active" });
      await ctx.db.patch(f.matchingSubmissionId, { organizationId: other });
    });
    await expect(f.t.query(duplicatePair, { ...args, demoIdentity: "controller" })).rejects.toThrow("cross_organization_access");
  });

  it("rejects swapped analysis/original references and excludes quarantined or unlinked frames", async () => {
    const f = await setup();
    const args = { demoIdentity: "controller", submissionId: f.submissionId };
    await f.t.run(ctx => ctx.db.patch(f.originalAssetId, { submissionId: f.matchingSubmissionId }));
    await expect(f.t.query(submissionEvidence, args)).rejects.toThrow("media_source_mismatch");
    await f.t.run(ctx => ctx.db.patch(f.originalAssetId, { submissionId: f.submissionId, status: "quarantined" }));
    await f.t.run(ctx => ctx.db.patch(f.frameId, { status: "quarantined" }));
    expect(await f.t.query(submissionEvidence, args)).toMatchObject({ clip: null, frames: [], framesAvailable: false });
    await f.t.run(ctx => ctx.db.patch(f.frameId, { status: "verified" }));
    await f.t.run(ctx => ctx.db.patch(f.analysisId, { evidenceAssetIds: [] }));
    expect((await f.t.query(submissionEvidence, args)).frames).toEqual([]);
    await f.t.run(ctx => ctx.db.patch(f.analysisId, { submissionId: f.matchingSubmissionId }));
    await expect(f.t.query(submissionEvidence, args)).rejects.toThrow("analysis_source_mismatch");
  });
});
