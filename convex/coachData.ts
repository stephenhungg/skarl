import { v } from "convex/values";
import { internalMutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireRole } from "./lib/demoAuth";
import { digest, requireTenant } from "./lib/finance";
import { COACH_PROMPT_VERSION, coachSnapshot, validateCoachOutput, type CoachOutput, type CoachSnapshot } from "./lib/contributorCoach";

async function ownedSubmission(ctx: QueryCtx | MutationCtx, demoIdentity: string, submissionId: Id<"submissions">) {
  const principal = await requireRole(ctx, demoIdentity, "contributor");
  const submission = await ctx.db.get(submissionId);
  if (!submission) throw new Error("submission_not_found");
  requireTenant(principal, submission);
  if (submission.contributorTokenIdentifier !== principal.tokenIdentifier) throw new Error("submission_not_owned");
  return submission;
}

async function source(ctx: QueryCtx | MutationCtx, submissionId: Id<"submissions">, demoIdentity: string) {
  const submission = await ownedSubmission(ctx, demoIdentity, submissionId);
  const analysis = submission.currentAnalysisId ? await ctx.db.get(submission.currentAnalysisId) : null;
  if (!analysis?.reportJson) throw new Error("coach_report_unavailable");
  if (analysis.submissionId !== submission._id || analysis.organizationId !== submission.organizationId ||
    analysis.taskVersionId !== submission.taskVersionId || analysis.sourceHash !== submission.sourceHash) throw new Error("analysis_reference_mismatch");
  const report = JSON.parse(analysis.reportJson);
  if (digest(report) !== analysis.reportHash || report.submissionId !== submission._id || report.taskVersionId !== submission.taskVersionId ||
    report.source?.sha256 !== submission.sourceHash || report.recommendation !== analysis.recommendation ||
    report.pipeline?.status !== analysis.pipelineStatus || report.pipeline?.implementation !== analysis.implementation) throw new Error("analysis_reference_mismatch");
  const snapshot = coachSnapshot(analysis.reportJson, submission.status);
  const sourceKey = digest({ analysisId: analysis._id, reportHash: analysis.reportHash, submissionStatus: submission.status,
    decisionId: submission.currentDecisionId ?? null, promptVersion: COACH_PROMPT_VERSION });
  return { submission, analysis, snapshot, sourceKey };
}

export const begin = internalMutation({
  args: { demoIdentity: v.string(), submissionId: v.id("submissions"), model: v.string() },
  handler: async (ctx, args) => {
    const current = await source(ctx, args.submissionId, args.demoIdentity);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,100}$/.test(args.model)) throw new Error("coach_invalid_model");
    const prior = await ctx.db.query("coachExplanations").withIndex("by_source", q => q.eq("submissionId", args.submissionId).eq("sourceKey", current.sourceKey)).unique();
    if (prior && (prior.status !== "unavailable" || Date.now() - (prior.completedAt ?? prior.startedAt) < 60_000)) {
      return { explanationId: prior._id, generation: prior.generation, replayed: true, snapshot: null };
    }
    const generation = (prior?.generation ?? 0) + 1;
    const fields = { organizationId: current.submission.organizationId, submissionId: current.submission._id,
      contributorTokenIdentifier: current.submission.contributorTokenIdentifier, analysisId: current.analysis._id,
      sourceKey: current.sourceKey, reportHash: current.analysis.reportHash, model: args.model, promptVersion: COACH_PROMPT_VERSION,
      inputJson: JSON.stringify(current.snapshot), status: "running" as const, generation, startedAt: Date.now() };
    const explanationId = prior ? prior._id : await ctx.db.insert("coachExplanations", fields);
    if (prior) await ctx.db.patch(prior._id, { ...fields, outputJson: undefined, failureCode: undefined, completedAt: undefined });
    await ctx.scheduler.runAfter(90_000, internal.coachData.expire, { explanationId, generation });
    return { explanationId, generation, replayed: false, snapshot: current.snapshot };
  },
});

export const complete = internalMutation({
  args: { demoIdentity: v.string(), explanationId: v.id("coachExplanations"), generation: v.number(),
    rawOutput: v.optional(v.string()), failureCode: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.explanationId);
    if (!row) throw new Error("coach_not_found");
    await ownedSubmission(ctx, args.demoIdentity, row.submissionId);
    if (row.generation !== args.generation || row.status !== "running") return { stored: false };
    let failureCode = args.failureCode;
    try {
      const current = await source(ctx, row.submissionId, args.demoIdentity);
      if (current.sourceKey !== row.sourceKey) failureCode = "coach_source_changed";
    } catch { failureCode = "coach_source_changed"; }
    if (failureCode && !/^(?:coach_[a-z_]+|claude_[a-z_]+|claude_http_\d{3}|anthropic_key_missing|agent_deadline)$/.test(failureCode)) failureCode = "coach_unavailable";
    let output: CoachOutput | undefined;
    if (!failureCode) {
      try { output = validateCoachOutput(args.rawOutput ?? "", JSON.parse(row.inputJson) as CoachSnapshot); }
      catch { failureCode = "coach_invalid_output"; }
    }
    await ctx.db.patch(row._id, { status: output ? "completed" : "unavailable", completedAt: Date.now(),
      ...(output ? { outputJson: JSON.stringify(output) } : { failureCode: failureCode ?? "coach_unavailable" }) });
    return { stored: true };
  },
});

/** Contributor-only, current evidence only. Demo selectors remain impersonable demo credentials. */
export const forSubmission = query({
  args: { demoIdentity: v.string(), submissionId: v.id("submissions") },
  handler: async (ctx, args) => {
    const submission = await ownedSubmission(ctx, args.demoIdentity, args.submissionId);
    if (!submission.currentAnalysisId) return null;
    const current = await source(ctx, args.submissionId, args.demoIdentity);
    const row = await ctx.db.query("coachExplanations").withIndex("by_source", q => q.eq("submissionId", args.submissionId).eq("sourceKey", current.sourceKey)).unique();
    if (!row) return null;
    return { explanationId: row._id, submissionId: row.submissionId, analysisId: row.analysisId, reportHash: row.reportHash,
      provider: "claude" as const, model: row.model, promptVersion: row.promptVersion, status: row.status,
      startedAt: row.startedAt, completedAt: row.completedAt, failureCode: row.failureCode,
      explanation: row.outputJson ? JSON.parse(row.outputJson) as CoachOutput : null,
      advisory: true, demoOnly: true };
  },
});

/** Interrupted generation is visible and retryable; a stale watchdog cannot expire a newer attempt. */
export const expire = internalMutation({
  args: { explanationId: v.id("coachExplanations"), generation: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.explanationId);
    if (!row || row.status !== "running" || row.generation !== args.generation || Date.now() - row.startedAt < 90_000) return;
    await ctx.db.patch(row._id, { status: "unavailable", failureCode: "coach_interrupted", completedAt: Date.now() });
  },
});
