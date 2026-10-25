import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { annotationSummary } from "./annotationValidators";
import { hasOrderAuthority, isFinanceAgent, requireRole } from "./lib/demoAuth";
import { requireTenant } from "./lib/finance";
import { resolveTaskSpec, detectorClassForObject } from "./lib/taskSpec";
import { frameHasObjectInHand, MAX_ANNOTATION_BYTES, summarizeAnnotations, validateAnnotationFile } from "./lib/derivedAnnotations";

async function accessible(ctx: Pick<QueryCtx, "db" | "auth">, identity: string, submissionId: Id<"submissions">) {
  const principal = await requireRole(ctx, identity, ["buyer", "controller", "contributor"]);
  if (isFinanceAgent(principal)) throw new Error("forbidden");
  const submission = await ctx.db.get(submissionId);
  if (!submission) throw new Error("submission_not_found");
  requireTenant(principal, submission);
  const order = await ctx.db.get(submission.orderId);
  if (!order) throw new Error("order_not_found");
  requireTenant(principal, order);
  const ownContribution = principal.roles.includes("contributor") && submission.contributorTokenIdentifier === principal.tokenIdentifier;
  if (!hasOrderAuthority(principal, order) && !ownContribution) throw new Error("submission_not_owned");
  return { principal, submission };
}

export const generateUploadUrl = mutation({
  args: { demoIdentity: v.string(), submissionId: v.id("submissions") },
  handler: async (ctx, args) => {
    await accessible(ctx, args.demoIdentity, args.submissionId);
    return ctx.storage.generateUploadUrl();
  },
});

/** Reads and validates stored JSON atomically. Caller summary is compatibility input only. */
export const saveDerived = mutation({
  args: { demoIdentity: v.string(), submissionId: v.id("submissions"), storageId: v.id("_storage"), summary: annotationSummary },
  handler: async (ctx, args) => {
    const { principal, submission } = await accessible(ctx, args.demoIdentity, args.submissionId);
    const existing = await ctx.db.query("derivedAnnotations").withIndex("by_storage", q => q.eq("storageId", args.storageId)).unique();
    if (existing) {
      if (existing.submissionId !== submission._id || existing.organizationId !== submission.organizationId) throw new Error("annotation_upload_already_attached");
      return existing._id;
    }
    const metadata = await ctx.db.system.get(args.storageId);
    if (!metadata || metadata.size <= 0 || metadata.size > MAX_ANNOTATION_BYTES) throw new Error("annotation_size_invalid");
    if ((metadata.contentType ?? "").split(";")[0]!.trim().toLowerCase() !== "application/json") throw new Error("annotation_type_invalid");
    const blob = await ctx.storage.get(args.storageId);
    if (!blob || blob.size !== metadata.size || blob.size > MAX_ANNOTATION_BYTES) throw new Error("annotation_size_invalid");
    let json: unknown;
    try { json = JSON.parse(await blob.text()); } catch { throw new Error("invalid_annotations"); }
    const file = validateAnnotationFile(json);
    if (file.submissionId !== submission._id || file.sourceSha256 !== (submission.sourceHash ?? submission.expectedSourceHash)) throw new Error("annotation_source_mismatch");
    const original = submission.originalAssetId ? await ctx.db.get(submission.originalAssetId) : null;
    if (!original || original.organizationId !== submission.organizationId || original.submissionId !== submission._id ||
      original.purpose !== "original" || original.contentHash !== file.sourceSha256) throw new Error("annotation_source_mismatch");
    if (original.durationMs !== undefined && file.frames.some(frame => frame.tMs > original.durationMs!)) throw new Error("annotation_timestamp_out_of_bounds");
    const rubric = await ctx.db.get(submission.taskVersionId);
    if (!rubric || rubric.organizationId !== submission.organizationId || rubric.orderId !== submission.orderId) throw new Error("task_rubric_mismatch");
    const spec = resolveTaskSpec(rubric);
    const detectorClass = spec ? detectorClassForObject(spec.object) : null;
    return ctx.db.insert("derivedAnnotations", {
      submissionId: submission._id, organizationId: submission.organizationId, kind: file.kind, model: file.model,
      storageId: args.storageId, summary: summarizeAnnotations(file, detectorClass), createdBy: principal.tokenIdentifier,
      createdAt: Date.now(), advisory: true,
      ...(file.kind === "objects" ? {
        ...(spec ? { taskObject: spec.object } : {}),
        ...(detectorClass ? { detectorClass } : {}),
        objectInHandTimestampsMs: detectorClass ? file.frames.filter(frame => frameHasObjectInHand(frame, detectorClass)).map(frame => frame.tMs) : [],
      } : {}),
    });
  },
});

/** Issues private storage bearer URLs only after checking the submission's role and tenant. */
export const forSubmission = query({
  args: { demoIdentity: v.string(), submissionId: v.id("submissions") },
  handler: async (ctx, args) => {
    const { submission } = await accessible(ctx, args.demoIdentity, args.submissionId);
    const rows = await ctx.db.query("derivedAnnotations").withIndex("by_submission", q => q.eq("submissionId", submission._id)).order("desc").collect();
    return Promise.all(rows.filter(row => row.organizationId === submission.organizationId && row.advisory === true)
      .sort((a, b) => b.createdAt - a.createdAt || b._creationTime - a._creationTime)
      .map(async row => ({ _id: row._id, kind: row.kind, model: row.model, createdAt: row.createdAt,
        createdBy: row.createdBy, url: await ctx.storage.getUrl(row.storageId), summary: row.summary })));
  },
});
