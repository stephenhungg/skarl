import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { hasOrderAuthority, requireRole, type DemoPrincipal } from "./lib/demoAuth";
import { requireTenant } from "./lib/finance";
import { alignFrameHashes } from "./lib/copyDetection";
import { resolveTaskSpec } from "./lib/taskSpec";

async function principal(ctx: QueryCtx, identity: string) {
  const member = await requireRole(ctx, identity, ["buyer", "controller", "contributor"]);
  if (member.roles.includes("finance-agent")) throw new Error("forbidden");
  return member;
}

async function accessible(ctx: QueryCtx, member: DemoPrincipal, id: Id<"submissions">) {
  const submission = await ctx.db.get(id);
  if (!submission) throw new Error("submission_not_found");
  requireTenant(member, submission);
  const order = await ctx.db.get(submission.orderId);
  if (!order) throw new Error("order_not_found");
  requireTenant(member, order);
  if (!hasOrderAuthority(member, order) && submission.contributorTokenIdentifier !== member.tokenIdentifier) {
    throw new Error("submission_not_owned");
  }
  return submission;
}

function transcript(observationsJson: string | undefined) {
  if (!observationsJson) return [];
  const observations: unknown = JSON.parse(observationsJson);
  if (!observations || typeof observations !== "object" || !("audio" in observations) || !observations.audio) return [];
  const audio = observations.audio;
  if (typeof audio !== "object" || !("segments" in audio) || !Array.isArray(audio.segments)) throw new Error("invalid_transcript_evidence");
  return audio.segments.map((segment: unknown) => {
    if (!segment || typeof segment !== "object" || !("startMs" in segment) || !("endMs" in segment) || !("text" in segment) ||
      typeof segment.startMs !== "number" || typeof segment.endMs !== "number" || !Number.isSafeInteger(segment.startMs) ||
      !Number.isSafeInteger(segment.endMs) || segment.startMs < 0 || segment.endMs < segment.startMs || segment.endMs > 30_000 ||
      typeof segment.text !== "string") throw new Error("invalid_transcript_evidence");
    return { startMs: segment.startMs, endMs: segment.endMs, text: segment.text };
  });
}

async function evidence(ctx: QueryCtx, submission: Doc<"submissions">) {
  const rubric = await ctx.db.get(submission.taskVersionId);
  if (!rubric || rubric.organizationId !== submission.organizationId || rubric.orderId !== submission.orderId) throw new Error("task_rubric_mismatch");
  const taskSpec = resolveTaskSpec(rubric);
  const analysis = submission.currentAnalysisId ? await ctx.db.get(submission.currentAnalysisId) : null;
  if (analysis && (analysis.organizationId !== submission.organizationId || analysis.submissionId !== submission._id ||
    analysis.taskVersionId !== submission.taskVersionId || analysis.sourceHash !== submission.sourceHash)) throw new Error("analysis_source_mismatch");
  const original = submission.originalAssetId ? await ctx.db.get(submission.originalAssetId) : null;
  if (original && (original.organizationId !== submission.organizationId || original.submissionId !== submission._id || original.purpose !== "original" ||
    original.contentHash !== (submission.sourceHash ?? submission.expectedSourceHash))) throw new Error("media_source_mismatch");
  const assets = await ctx.db.query("mediaAssets").withIndex("by_submission_purpose", q =>
    q.eq("submissionId", submission._id).eq("purpose", "evidence_frame")).collect();
  const frames = [];
  for (const asset of assets) {
    if (asset.organizationId !== submission.organizationId) throw new Error("media_source_mismatch");
    if (asset.status !== "verified" || asset.sourceTimestampMs === undefined || !analysis ||
      asset.jobId !== analysis.jobId || !analysis.evidenceAssetIds.includes(asset._id)) continue;
    frames.push({ assetId: asset._id, timestampMs: asset.sourceTimestampMs, mimeType: asset.mimeType,
      kind: asset.frameKind ?? "legacy", sampleIndex: asset.sampleIndex ?? null, decodedFrameIndex: asset.decodedFrameIndex ?? null,
      url: await ctx.storage.getUrl(asset.storageId) });
  }
  frames.sort((a, b) => a.timestampMs - b.timestampMs || a.assetId.localeCompare(b.assetId));
  return { submissionId: submission._id, taskSpec, analysisId: analysis?._id ?? null,
    clip: original && original.status !== "quarantined" ? { assetId: original._id, mimeType: original.mimeType,
      status: original.status, durationMs: original.durationMs ?? null, url: await ctx.storage.getUrl(original.storageId) } : null,
    frames: frames.filter(frame => frame.kind !== "dhash"),
    dHashFrames: frames.filter(frame => frame.kind === "dhash"),
    dHashFrameIndices: analysis?.dHashFrameIndices ?? [],
    framesAvailable: frames.some(frame => frame.url !== null),
    transcriptSegments: transcript(analysis?.observationsJson),
    perceptualHashSource: submission.perceptualHashSource ?? null,
    sensorTrace: submission.sensorTrace ? { ...submission.sensorTrace, url: await ctx.storage.getUrl(submission.sensorTrace.storageId) } : null,
  };
}

/** Role-checked issuance of Convex storage bearer URLs; do not publish or cache these URLs. */
export const submissionEvidence = query({
  args: { demoIdentity: v.string(), submissionId: v.id("submissions") },
  handler: async (ctx, args) => evidence(ctx, await accessible(ctx, await principal(ctx, args.demoIdentity), args.submissionId)),
});

/** Both sides require access, including for a contributor who owns only one clip. */
export const duplicatePair = query({
  args: { demoIdentity: v.string(), submissionId: v.id("submissions"), matchingSubmissionId: v.id("submissions") },
  handler: async (ctx, args) => {
    const member = await principal(ctx, args.demoIdentity);
    const left = await accessible(ctx, member, args.submissionId);
    const right = await accessible(ctx, member, args.matchingSubmissionId);
    if (left._id === right._id) throw new Error("distinct_submissions_required");
    const [leftEvidence, rightEvidence] = await Promise.all([evidence(ctx, left), evidence(ctx, right)]);
    const leftHashes = left.frameDHashes ?? [], rightHashes = right.frameDHashes ?? [];
    const alignment = alignFrameHashes(leftHashes, rightHashes), score = alignment?.score ?? null;
    // dHashes and persisted visual samples may use different timestamps. Return
    // both explicitly; the UI must not label a nearest frame as the hash's frame.
    const matchedFrames = (alignment?.matches ?? []).map(({leftIndex, rightIndex, distance}) => ({
      sampleIndex: leftIndex, leftSampleIndex: leftIndex, rightSampleIndex: rightIndex,
      leftTimestampMs: leftHashes[leftIndex]!.timestampMs, rightTimestampMs: rightHashes[rightIndex]!.timestampMs, distance,
      leftFrame: leftEvidence.dHashFrames.find(asset => asset.sampleIndex === leftIndex && asset.timestampMs === leftHashes[leftIndex]!.timestampMs)
        ?? leftEvidence.frames.find(asset => asset.kind === "legacy" && asset.timestampMs === leftHashes[leftIndex]!.timestampMs) ?? null,
      rightFrame: rightEvidence.dHashFrames.find(asset => asset.sampleIndex === rightIndex && asset.timestampMs === rightHashes[rightIndex]!.timestampMs)
        ?? rightEvidence.frames.find(asset => asset.kind === "legacy" && asset.timestampMs === rightHashes[rightIndex]!.timestampMs) ?? null,
    }));
    return { left: leftEvidence, right: rightEvidence, matchedFrames, score,
      exactSourceMatch: !!left.sourceHash && left.sourceHash === right.sourceHash,
      perceptualMatch: score !== null, heuristicOnly: true };
  },
});
