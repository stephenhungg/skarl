import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { acceptAndPublishFor, authorize, refuse } from "./finance";
import { actorFor, audit, digest } from "./lib/finance";

/** Human review is evidence-bound. Acceptance uses the same transactional gate as finance. */
export const reviewSubmission = mutation({
  args: { demoIdentity: v.string(), submissionId: v.id("submissions"),
    decision: v.union(v.literal("accept"), v.literal("reject"), v.literal("request_correction")),
    reasonCode: v.string(), note: v.string() },
  handler: async (ctx, args) => {
    const auth = await authorize(ctx, args.demoIdentity, "controller");
    if (!auth.principal) return { ok: false as const, code: auth.denied! };
    const principal = auth.principal, submission = await ctx.db.get(args.submissionId);
    if (!submission || submission.organizationId !== principal.organizationId) return { ok: false as const, code: "not_found" };
    if (auth.denied) return refuse(ctx, principal, submission, "review", auth.denied);
    if (principal.roles.includes("contributor") || submission.contributorTokenIdentifier === principal.tokenIdentifier) {
      return refuse(ctx, principal, submission, "review", "self_review_refused");
    }
    const reasonCode = args.reasonCode.trim(), note = args.note.trim();
    if (!/^[a-z][a-z0-9_]{0,79}$/.test(reasonCode) || !note || note.length > 4000) return refuse(ctx, principal, submission, "review", "invalid_review_reason");
    const analysis = submission.currentAnalysisId ? await ctx.db.get(submission.currentAnalysisId) : null;
    if (submission.currentAnalysisId && (!analysis || analysis.organizationId !== submission.organizationId ||
      analysis.submissionId !== submission._id || analysis.taskVersionId !== submission.taskVersionId || analysis.sourceHash !== submission.sourceHash)) {
      return refuse(ctx, principal, submission, "review", "analysis_source_mismatch");
    }
    if (!submission.sourceHash) return refuse(ctx, principal, submission, "review", "verified_source_required");
    const evidenceHash = analysis?.reportHash ?? submission.sourceHash;
    const decision = args.decision === "accept" ? "accepted" as const : args.decision === "reject" ? "rejected" as const : "request_correction" as const;
    const decisionKey = `human:${digest({ submissionId: submission._id, analysisId: analysis?._id,
      evidenceHash, taskVersionId: submission.taskVersionId, reviewer: principal.tokenIdentifier, decision, reasonCode, note })}`;
    const existing = await ctx.db.query("reviewDecisions").withIndex("by_decision_key", q =>
      q.eq("organizationId", submission.organizationId).eq("decisionKey", decisionKey)).unique();
    if (existing) {
      // A stale retry must never reactivate a decision superseded by another review.
      if (submission.currentDecisionId !== existing._id) return { ok: false as const, code: "review_superseded", decisionId: existing._id };
      if (decision === "accepted") return { ...await acceptAndPublishFor(ctx, args), decisionId: existing._id };
      return { ok: true as const, decisionId: existing._id, replayed: true };
    }
    if (!["needs_review", "needs_correction"].includes(submission.status)) return refuse(ctx, principal, submission, "review", "submission_not_reviewable");
    const decisionId = await ctx.db.insert("reviewDecisions", { organizationId: submission.organizationId,
      submissionId: submission._id, analysisResultId: analysis?._id, taskVersionId: submission.taskVersionId,
      decisionKey, decision, reviewerTokenIdentifier: principal.tokenIdentifier,
      reason: `${reasonCode}: ${note}`, reasonCode, note, evidenceHash, decidedAt: Date.now() });
    await ctx.db.patch(submission._id, { currentDecisionId: decisionId, updatedAt: Date.now(),
      ...(decision === "rejected" ? { status: "rejected" as const } : decision === "request_correction" ? { status: "needs_correction" as const } : {}) });
    await audit(ctx, { organizationId: submission.organizationId, eventKey: decisionKey, actor: actorFor(principal),
      action: "submission_human_reviewed", entityType: "submissions", entityId: submission._id,
      reason: `${decision}: ${reasonCode}: ${note}`, evidenceReferences: [decisionId, evidenceHash, ...(analysis ? [analysis._id] : [])] });
    if (decision === "accepted") return { ...await acceptAndPublishFor(ctx, args), decisionId };
    return { ok: true as const, decisionId, replayed: false };
  },
});
