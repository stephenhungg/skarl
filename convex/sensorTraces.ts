import { v } from "convex/values";
import { action, internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireRole } from "./lib/demoAuth";
import { actorFor, audit, requireTenant } from "./lib/finance";
import { MAX_SENSOR_TRACE_BYTES, summarizeMotion, validateSensorTrace } from "./lib/sensorTrace";
import { sensorTrace } from "./sensorTraceValidators";

const uploadArgs = { demoIdentity: v.string(), submissionId: v.id("submissions"), storageId: v.id("_storage") };
async function owned(ctx: Pick<QueryCtx, "db" | "auth">, demoIdentity: string, submissionId: Id<"submissions">) {
  const principal = await requireRole(ctx, demoIdentity, "contributor"), submission = await ctx.db.get(submissionId);
  if (!submission) throw new Error("submission_not_found");
  requireTenant(principal, submission);
  if (submission.contributorTokenIdentifier !== principal.tokenIdentifier) throw new Error("submission_not_owned");
  if (!submission.consentRecordId) throw new Error("consent_required");
  return { principal, submission };
}
async function upload(ctx: Pick<QueryCtx, "db">, storageId: Id<"_storage">) {
  const metadata = await ctx.db.system.get(storageId);
  if (!metadata || metadata.size <= 0 || metadata.size > MAX_SENSOR_TRACE_BYTES) throw new Error("sensor_trace_size_invalid");
  if ((metadata.contentType ?? "").split(";")[0]!.trim().toLowerCase() !== "application/json") throw new Error("sensor_trace_type_invalid");
  return metadata;
}
export const authorize = internalQuery({
  args: uploadArgs,
  handler: async (ctx, args) => {
    const { submission } = await owned(ctx, args.demoIdentity, args.submissionId);
    if (submission.sensorTrace && submission.sensorTrace.storageId !== args.storageId) throw new Error("sensor_trace_already_attached");
    if (!submission.sensorTrace && ["accepted", "rejected"].includes(submission.status)) throw new Error("submission_evidence_closed");
    const metadata = await upload(ctx, args.storageId);
    return { sizeBytes: metadata.size };
  },
});

/** Reads the uploaded bytes, never trusts client-computed metadata or motion statistics. */
export const attachSensorTrace = action({
  args: uploadArgs,
  handler: async (ctx, args): Promise<{ submissionId: Id<"submissions">; replayed: boolean }> => {
    const metadata = await ctx.runQuery(internal.sensorTraces.authorize, args);
    const blob = await ctx.storage.get(args.storageId);
    if (!blob || blob.size !== metadata.sizeBytes || blob.size > MAX_SENSOR_TRACE_BYTES) throw new Error("sensor_trace_size_invalid");
    let json: unknown;
    try { json = JSON.parse(await blob.text()); } catch { throw new Error("invalid_sensor_trace"); }
    const trace = validateSensorTrace(json);
    return ctx.runMutation(internal.sensorTraces.attachValidated, { ...args, trace: {
      version: trace.version,
      ...(trace.version === 2 ? { videoStartOffsetMs: trace.videoStartOffsetMs, videoStopOffsetMs: trace.videoStopOffsetMs,
        syncSource: trace.syncSource, syncAccuracy: trace.syncAccuracy, segments: trace.segments, context: trace.context,
        unavailableSensors: trace.unavailableSensors } : {}),
      storageId: args.storageId, sampleRateHz: trace.sampleRateHz, sampleCount: trace.samples.length, durationMs: trace.durationMs,
      sensors: trace.sensors, device: trace.device, recordedAt: trace.recordedAt, clock: trace.clock,
      sizeBytes: blob.size, attachedAt: Date.now(), motionSummary: summarizeMotion(trace),
    } });
  },
});

export const attachValidated = internalMutation({
  args: { ...uploadArgs, trace: sensorTrace },
  handler: async (ctx, args) => {
    // Recheck mutable authorization and attachment state after action I/O.
    const { principal, submission } = await owned(ctx, args.demoIdentity, args.submissionId);
    if (submission.sensorTrace) {
      if (submission.sensorTrace.storageId !== args.storageId) throw new Error("sensor_trace_already_attached");
      return { submissionId: submission._id, replayed: true };
    }
    if (["accepted", "rejected"].includes(submission.status)) throw new Error("submission_evidence_closed");
    const metadata = await upload(ctx, args.storageId);
    if (args.trace.storageId !== args.storageId || args.trace.sizeBytes !== metadata.size) throw new Error("sensor_trace_storage_mismatch");
    const attached = await ctx.db.query("submissions").withIndex("by_sensor_storage", q => q.eq("sensorTrace.storageId", args.storageId)).first();
    if (attached) throw new Error("sensor_trace_upload_already_attached");
    await ctx.db.patch(submission._id, { sensorTrace: args.trace, updatedAt: Date.now() });
    await audit(ctx, { organizationId: submission.organizationId, eventKey: `sensor-trace:${submission._id}`, actor: actorFor(principal),
      action: "sensor_trace_attached", entityType: "submissions", entityId: submission._id,
      reason: "Validated client-reported IMU evidence attached; not hardware attested and not acceptance authority.", evidenceReferences: [args.storageId] });
    return { submissionId: submission._id, replayed: false };
  },
});
