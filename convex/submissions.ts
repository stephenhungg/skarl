import { makeFunctionReference } from "convex/server";
import { v, type Infer } from "convex/values";
import { mutation, query, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { isFinanceAgent, requireRole } from "./lib/demoAuth";
import { audit, actorFor, digest, requireTenant } from "./lib/finance";
import { validateFrameHashes, compareFrameHashes } from "./lib/copyDetection";
import { PIPELINE_VERSION, validateEvaluationScope, applyVerificationOnlyGuard, EVALUATION_PROJECTION_VERSION } from "./lib/verificationReport";
import { evaluationVideoModel } from "./validators";
import { checkSpokenLiveness } from "./lib/spokenLiveness";
import { normalizeDiversityTag } from "./lib/diversity";

const frame = v.object({ timestampMs: v.number(), hash: v.string() });
const evidenceFrame = v.object({ storageId: v.id("_storage"), timestampMs: v.number(), contentHash: v.string(), sizeBytes: v.number(),
  kind: v.union(v.literal("visual"), v.literal("dhash")), sampleIndex: v.number(), decodedFrameIndex: v.optional(v.number()) });

/** Internal verifier jobs act on the stored submission, not a demo selector.
 * Scheduling drops user auth; public submission APIs still use requireRole.
 */
async function jobContributor(ctx: Pick<MutationCtx, "db">, job: Doc<"jobs">) {
  const submission = await ctx.db.get(job.submissionId);
  if (!submission || submission.organizationId !== job.organizationId) throw new Error("job_reference_mismatch");
  const principal = await ctx.db.query("memberships").withIndex("by_token_identifier", q =>
    q.eq("tokenIdentifier", submission.contributorTokenIdentifier)).unique();
  if (!principal || principal.status !== "active" || principal.organizationId !== job.organizationId ||
    !principal.roles.includes("contributor") || principal.roles.includes("controller") || isFinanceAgent(principal)) {
    throw new Error("job_reference_mismatch");
  }
  const organization = await ctx.db.get(job.organizationId);
  if (!organization || organization.status !== "active") throw new Error("inactive_organization");
  return { principal, submission };
}
export const generateUploadUrl = mutation({
  args: { demoIdentity: v.string() },
  handler: async (ctx, args) => { await requireRole(ctx, args.demoIdentity, "contributor"); return ctx.storage.generateUploadUrl(); },
});

export const create = mutation({
  args: { demoIdentity: v.string(), orderId: v.id("orders"), storageId: v.id("_storage"), clientRequestId: v.string(),
    consentAcknowledged: v.boolean(), clientFrameDHashes: v.optional(v.array(frame)), verificationOnly: v.optional(v.boolean()), evalRunId: v.optional(v.string()),
    evalVideoModel: v.optional(evaluationVideoModel), livenessChallengeId: v.optional(v.id("livenessChallenges")),
    environment: v.optional(v.string()), variant: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const principal = await requireRole(ctx, args.demoIdentity, "contributor");
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("order_not_found");
    requireTenant(principal, order);
    if (!args.consentAcknowledged) throw new Error("consent_required");
    if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(args.clientRequestId)) throw new Error("invalid_request_id");
    const environment = normalizeDiversityTag(args.environment), variant = normalizeDiversityTag(args.variant);
    validateEvaluationScope(args.verificationOnly, args.evalRunId);
    if (args.evalVideoModel !== undefined && (!args.verificationOnly || args.evalRunId === undefined)) throw new Error("model_override_requires_scoped_evaluation");
    const existing = await ctx.db.query("submissions").withIndex("by_request", q => q.eq("organizationId", principal.organizationId)
      .eq("contributorTokenIdentifier", principal.tokenIdentifier).eq("clientRequestId", args.clientRequestId)).unique();
    if (existing) {
      const asset = existing.originalAssetId ? await ctx.db.get(existing.originalAssetId) : null;
      if (existing.orderId !== args.orderId || asset?.storageId !== args.storageId || existing.livenessChallengeId !== args.livenessChallengeId ||
        existing.environment !== environment || existing.variant !== variant ||
        !!existing.verificationOnly !== !!args.verificationOnly || existing.evalRunId !== args.evalRunId || existing.evalVideoModel !== args.evalVideoModel || digest(existing.clientFrameDHashes ?? []) !== digest(args.clientFrameDHashes ?? [])) throw new Error("submission_request_conflict");
      return { submissionId: existing._id, replayed: true };
    }
    if (["closed", "cancelled", "cancelling", "fulfilled", "refunded"].includes(order.status)) throw new Error("order_closed");
    if (args.evalRunId !== undefined) {
      const scope = await ctx.db.query("submissions").withIndex("by_eval_run", q =>
        q.eq("organizationId", principal.organizationId).eq("evalRunId", args.evalRunId)).take(201);
      if (scope.some(submission => submission.evalVideoModel !== args.evalVideoModel)) throw new Error("evaluation_model_scope_mismatch");
    }
    if (!order.taskVersionId) throw new Error("rubric_required");
    const rubric = await ctx.db.get(order.taskVersionId);
    if (!rubric || rubric.frozenAt === undefined || rubric.orderId !== order._id || rubric.organizationId !== order.organizationId) throw new Error("frozen_rubric_required");
    const metadata = await ctx.db.system.get(args.storageId);
    if (!metadata || metadata.size <= 0 || metadata.size > 25 * 1024 * 1024) throw new Error("upload_size_invalid");
    const uploadMime=(metadata.contentType ?? "").split(";")[0]!.trim().toLowerCase();
    if (!["video/mp4", "video/webm", "video/quicktime"].includes(uploadMime)) throw new Error("unsupported_upload_type");
    const uploadedHash = /^[a-f0-9]{64}$/.test(metadata.sha256) ? metadata.sha256 : [...atob(metadata.sha256)].map(char=>char.charCodeAt(0).toString(16).padStart(2,"0")).join("");
    if (!/^[a-f0-9]{64}$/.test(uploadedHash)) throw new Error("storage_hash_invalid");
    const attached = await ctx.db.query("mediaAssets").withIndex("by_storage_id", q => q.eq("storageId", args.storageId)).first();
    if (attached) throw new Error("upload_already_attached");
    if (args.clientFrameDHashes) validateFrameHashes(args.clientFrameDHashes);
    const now = Date.now();
    const challenge = args.livenessChallengeId ? await ctx.db.get(args.livenessChallengeId) : null;
    if (args.livenessChallengeId) {
      if (!challenge) throw new Error("liveness_challenge_not_found");
      if (challenge.organizationId !== principal.organizationId || challenge.contributorTokenIdentifier !== principal.tokenIdentifier) throw new Error("liveness_challenge_foreign");
      if (challenge.consumedAt !== undefined || challenge.submissionId !== undefined) throw new Error("liveness_challenge_used");
      if (now >= challenge.expiresAt) throw new Error("liveness_challenge_expired");
    }
    const submissionId = await ctx.db.insert("submissions", { organizationId: order.organizationId, orderId: order._id,
      taskVersionId: rubric._id, contributorTokenIdentifier: principal.tokenIdentifier, status: "queued",
      ...(environment !== undefined ? { environment } : {}), ...(variant !== undefined ? { variant } : {}),
      clientRequestId: args.clientRequestId, expectedSourceHash: uploadedHash, ...(args.clientFrameDHashes ? { clientFrameDHashes: args.clientFrameDHashes } : {}),
      verificationOnly: args.verificationOnly ?? false, ...(args.evalRunId !== undefined ? { evalRunId: args.evalRunId } : {}),
      ...(args.evalVideoModel !== undefined ? { evalVideoModel: args.evalVideoModel } : {}),
      ...(challenge ? { livenessChallengeId: challenge._id, liveness: { words: challenge.words, issuedAt: challenge.issuedAt, consumedAt: now } } : {}), updatedAt: now });
    // This write shares the submission transaction: failed creates consume nothing,
    // and racing creates cannot bind one challenge to two different uploads.
    if (challenge) await ctx.db.patch(challenge._id, { consumedAt: now, submissionId });
    const originalAssetId = await ctx.db.insert("mediaAssets", { organizationId: order.organizationId, submissionId,
      storageId: args.storageId, purpose: "original", status: "uploaded", contentHash: uploadedHash,
      mimeType: uploadMime, sizeBytes: metadata.size });
    const licenseVersion = args.verificationOnly ? "verification-only-v1" : "demo-consent-v1";
    const scope = args.verificationOnly ? "Development verification only; no training or dataset distribution" : "Consented demo dataset contribution under the displayed terms";
    const consentRecordId = await ctx.db.insert("consentRecords", { organizationId: order.organizationId, submissionId,
      contributorTokenIdentifier: principal.tokenIdentifier, licenseVersion, licenseHash: digest({ licenseVersion, scope }),
      scope, acknowledgedAt: now, receiptHash: digest({ token: principal.tokenIdentifier, submissionId, licenseVersion, scope, now }) });
    const jobId = await ctx.db.insert("jobs", { organizationId: order.organizationId, submissionId, taskVersionId: rubric._id,
      sourceHash: uploadedHash, pipelineVersion: PIPELINE_VERSION, status: "pending", availableAt: now,
      attempt: 0, maxAttempts: 1, leaseGeneration: 0 });
    await ctx.db.patch(submissionId, { originalAssetId, consentRecordId });
    await audit(ctx, { organizationId: order.organizationId, eventKey: `submitted:${submissionId}`, actor: actorFor(principal),
      action: "submission_queued", entityType: "submissions", entityId: submissionId, reason: "Upload queued for server hashing and independent Gemini observations.", evidenceReferences: [originalAssetId, jobId] });
    await ctx.scheduler.runAfter(0, internal.verify.run, { jobId });
    return { submissionId, replayed: false };
  },
});

export const claim = internalMutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "pending") return null;
    const { principal, submission } = await jobContributor(ctx, job);
    const rubric = await ctx.db.get(job.taskVersionId);
    const asset = submission?.originalAssetId ? await ctx.db.get(submission.originalAssetId) : null;
    if (!submission || !rubric || !asset || submission.contributorTokenIdentifier !== principal.tokenIdentifier ||
      submission.organizationId !== job.organizationId || asset.submissionId !== submission._id || asset.organizationId !== job.organizationId ||
      rubric.organizationId !== job.organizationId || rubric._id !== submission.taskVersionId) throw new Error("job_reference_mismatch");
    if (submission.status === "accepted" || submission.currentAnalysisId) return null;
    const generation = job.leaseGeneration + 1;
    await ctx.db.patch(job._id, { status: "leased", pipelineVersion: PIPELINE_VERSION, attempt: job.attempt + 1, leaseGeneration: generation, leaseExpiresAt: Date.now() + 5 * 60_000 });
    await ctx.db.patch(submission._id, { status: "analysing", updatedAt: Date.now() });
    // Watchdog ensures interrupted actions eventually expose review, not a permanent spinner.
    await ctx.scheduler.runAfter(5 * 60_000, internal.submissions.expire, { jobId: job._id, generation });
    return { job: { ...job, pipelineVersion: PIPELINE_VERSION }, submission, rubric, asset, generation };
  },
});

export const facts = internalMutation({
  args: { jobId: v.id("jobs"), generation: v.number(), sourceHash: v.string(), durationMs: v.number(),
    frameDHashes: v.optional(v.array(frame)), perceptualHash: v.optional(v.string()),
    perceptualHashSource: v.optional(v.union(v.literal("serverComputed"), v.literal("clientReported"))), mediaVerified: v.boolean() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "leased" || job.leaseGeneration !== args.generation || (job.leaseExpiresAt ?? 0) <= Date.now()) throw new Error("stale_analysis_attempt");
    const { submission } = await jobContributor(ctx, job);
    if (!/^[a-f0-9]{64}$/.test(args.sourceHash) || !Number.isSafeInteger(args.durationMs) || args.durationMs < 0 || args.durationMs > 30_000) throw new Error("invalid_source_facts");
    if (args.frameDHashes) validateFrameHashes(args.frameDHashes, args.durationMs || undefined);
    if (!submission?.originalAssetId) throw new Error("original_missing");
    const hashFacts = { ...(args.frameDHashes ? { frameDHashes: args.frameDHashes } : {}),
      ...(args.perceptualHash ? { perceptualHash: args.perceptualHash } : {}),
      ...(args.perceptualHashSource ? { perceptualHashSource: args.perceptualHashSource } : {}) };
    await ctx.db.patch(job._id, { sourceHash: args.sourceHash });
    await ctx.db.patch(submission._id, { sourceHash: args.sourceHash, ...hashFacts });
    await ctx.db.patch(submission.originalAssetId, { contentHash: args.sourceHash, durationMs: args.durationMs, status: args.mediaVerified ? "verified" : "quarantined" });
  },
});

export const copies = internalQuery({
  args: { submissionId: v.id("submissions") },
  handler: async (ctx, args) => {
    const submission = await ctx.db.get(args.submissionId);
    if (!submission?.sourceHash) return { status: "not_checked" as const, matches: [] };
    validateEvaluationScope(submission.verificationOnly, submission.evalRunId);
    // An explicit undefined index value excludes every scoped evaluation row from the ordinary pool.
    const candidates = await ctx.db.query("submissions").withIndex("by_eval_run", q =>
      q.eq("organizationId", submission.organizationId).eq("evalRunId", submission.evalRunId))
      .filter(q => q.neq(q.field("simulationOnly"), true)).take(201);
    if (submission.evalRunId !== undefined && candidates.some(candidate => !candidate.verificationOnly ||
      candidate.orderId !== submission.orderId || candidate.contributorTokenIdentifier !== submission.contributorTokenIdentifier ||
      candidate.evalVideoModel !== submission.evalVideoModel)) throw new Error("evaluation_scope_contaminated");
    if (candidates.length > 200) return { status: "not_checked" as const, matches: [] };
    const matches = [];
    for (const candidate of candidates) {
      if (candidate._id === submission._id || !candidate.currentAnalysisId) continue;
      const candidateOrder = await ctx.db.get(candidate.orderId);
      if (candidateOrder?.publicId.startsWith("scenario:") && candidate.orderId !== submission.orderId) continue;
      const analysis = await ctx.db.get(candidate.currentAnalysisId);
      if (!analysis || analysis.organizationId !== submission.organizationId || analysis.submissionId !== candidate._id) continue;
      if (candidate.status !== "accepted" && ["failed", "ml_unavailable"].includes(analysis.pipelineStatus)) continue;
      const exact = candidate.sourceHash === submission.sourceHash;
      const score = exact ? 1 : compareFrameHashes(submission.frameDHashes ?? [], candidate.frameDHashes ?? []);
      if (score !== null) matches.push({ submissionId: candidate._id, score, overlapMs: 0 });
    }
    return { status: matches.length ? "suspected" as const : "clear" as const, matches };
  },
});

/** Trusted Node action owns full canonical schema/rubric validation before storing either report.
 * This internal mutation fences scope, frozen criterion IDs, digests and licensing without runtime code generation.
 * It is not a public model-output API.
 */
const completeArgs = v.object({ jobId: v.id("jobs"), generation: v.number(), reportJson: v.string(), observationsJson: v.string(),
    reportStorageId: v.id("_storage"), reportHash: v.string(), processingElapsedMs: v.number(), evidenceFrames: v.optional(v.array(evidenceFrame)), failureCode: v.optional(v.string()) });
export async function completeFor(ctx: MutationCtx, args: Infer<typeof completeArgs>, simulatedScenarioId?: string) {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("job_not_found");
    const { submission } = await jobContributor(ctx, job);
    const existing = await ctx.db.query("analysisResults").withIndex("by_job_generation", q => q.eq("jobId", job._id).eq("leaseGeneration", args.generation)).unique();
    if (existing) {
      if (existing.reportHash !== args.reportHash) throw new Error("analysis_replay_conflict");
      return existing._id;
    }
    const interruptedFailure = job.status === "failed" && job.lastErrorCode === "verification_interrupted" && args.failureCode === "verification_interrupted";
    if ((!interruptedFailure && (job.status !== "leased" || (job.leaseExpiresAt ?? 0) <= Date.now())) || job.leaseGeneration !== args.generation) throw new Error("stale_analysis_attempt");
    if (args.reportJson.length > 200_000 || args.observationsJson.length > 200_000) throw new Error("report_too_large");
    if (args.failureCode && !/^[a-z0-9_]{1,80}$/.test(args.failureCode)) throw new Error("invalid_failure_code");
    const report = JSON.parse(args.reportJson);
    if (report.submissionId !== job.submissionId || report.taskVersionId !== job.taskVersionId || report.source.sha256 !== job.sourceHash ||
      digest(report) !== args.reportHash || report.pipeline.version !== job.pipelineVersion || report.pipeline.implementation !== (simulatedScenarioId ? "scaffold" : "inference")) throw new Error("report_source_mismatch");
    if (interruptedFailure && (report.pipeline.status !== "failed" || report.recommendation !== "needs_review")) throw new Error("timeout_report_must_fail_closed");
    if (!submission || submission.status === "accepted" || submission.taskVersionId !== job.taskVersionId || submission.sourceHash !== job.sourceHash) throw new Error("submission_changed");
    validateEvaluationScope(submission.verificationOnly, submission.evalRunId);
    if (simulatedScenarioId) {
      const order = await ctx.db.get(submission.orderId);
      if (order?.publicId !== `scenario:${simulatedScenarioId}` || !submission.verificationOnly) throw new Error("invalid_simulated_analysis_scope");
    }
    const observations = JSON.parse(args.observationsJson);
    // Recompute from persisted challenge facts and transcript, never a model's
    // claimed pass flag. Legacy reports retain their original validation contract.
    const livenessNeedsReview = job.pipelineVersion === PIPELINE_VERSION &&
      checkSpokenLiveness(submission.liveness, observations?.audio, report.source.durationMs).status !== "passed";
    if (livenessNeedsReview &&
      report.recommendation !== "needs_review") throw new Error("liveness_must_review");
    const evaluation = observations?.evaluation;
    if (submission.evalRunId !== undefined) {
      const quality = evaluation?.qualityReport;
      const rubric = await ctx.db.get(submission.taskVersionId);
      const expectedCriteria = new Set(rubric?.criteria.map(c => c.criterionId) ?? []);
      const criterionIds = Array.isArray(quality?.criteria)
        ? quality.criteria.map((criterion: {criterionId?: unknown}) => criterion?.criterionId) : [];
      const frozenCriteriaMatch = criterionIds.length === expectedCriteria.size && new Set(criterionIds).size === criterionIds.length &&
        criterionIds.every((criterionId: unknown) => typeof criterionId === "string" && expectedCriteria.has(criterionId));
      if (!evaluation || evaluation.evaluationOnly !== true || evaluation.projectionVersion !== EVALUATION_PROJECTION_VERSION ||
        !quality || !rubric || !frozenCriteriaMatch ||
        quality.submissionId !== report.submissionId || quality.taskVersionId !== report.taskVersionId ||
        digest(quality.source) !== digest(report.source) || quality.pipeline.version !== job.pipelineVersion ||
        digest(quality) !== evaluation.qualityReportHash || digest(applyVerificationOnlyGuard(quality)) !== args.reportHash) throw new Error("evaluation_report_mismatch");
      if (livenessNeedsReview && quality.recommendation !== "needs_review") throw new Error("liveness_must_review");
    } else if (evaluation !== undefined) throw new Error("unexpected_evaluation_projection");
    if (submission.verificationOnly && report.recommendation !== "needs_review") throw new Error("verification_only_must_review");
    const frameAssetIds: Id<"mediaAssets">[] = [], dHashFrameIndices: number[] = [];
    const suppliedFrames = args.evidenceFrames ?? [];
    if (suppliedFrames.length > 18 || new Set(suppliedFrames.map(frame => frame.storageId)).size !== suppliedFrames.length ||
      new Set(suppliedFrames.map(frame => `${frame.kind}:${frame.sampleIndex}`)).size !== suppliedFrames.length) throw new Error("invalid_evidence_frames");
    for (const frame of [...suppliedFrames].sort((a, b) => a.sampleIndex - b.sampleIndex)) {
      if (!Number.isSafeInteger(frame.timestampMs) || frame.timestampMs < 0 || frame.timestampMs > report.source.durationMs ||
        !Number.isSafeInteger(frame.sampleIndex) || frame.sampleIndex < 0 || frame.sampleIndex >= (frame.kind === "visual" ? 12 : 6) ||
        !/^[a-f0-9]{64}$/.test(frame.contentHash) || !Number.isSafeInteger(frame.sizeBytes) || frame.sizeBytes < 4 || frame.sizeBytes > 100 * 1024 ||
        (frame.kind === "dhash" && (!Number.isSafeInteger(frame.decodedFrameIndex) || frame.decodedFrameIndex! < 0 || frame.decodedFrameIndex! > 181 ||
          submission.frameDHashes?.[frame.sampleIndex]?.timestampMs !== frame.timestampMs))) throw new Error("invalid_evidence_frames");
      const metadata = await ctx.db.system.get(frame.storageId);
      if (!metadata || metadata.contentType !== "image/jpeg" || metadata.size !== frame.sizeBytes) throw new Error("evidence_frame_storage_mismatch");
      const storedHash = /^[a-f0-9]{64}$/.test(metadata.sha256) ? metadata.sha256 : [...atob(metadata.sha256)].map(char => char.charCodeAt(0).toString(16).padStart(2, "0")).join("");
      if (storedHash !== frame.contentHash || await ctx.db.query("mediaAssets").withIndex("by_storage_id", q => q.eq("storageId", frame.storageId)).first()) throw new Error("evidence_frame_storage_mismatch");
      frameAssetIds.push(await ctx.db.insert("mediaAssets", { organizationId: job.organizationId, submissionId: submission._id, jobId: job._id,
        storageId: frame.storageId, purpose: "evidence_frame", status: "verified", contentHash: frame.contentHash, mimeType: "image/jpeg", sizeBytes: frame.sizeBytes,
        sourceTimestampMs: frame.timestampMs, frameKind: frame.kind, sampleIndex: frame.sampleIndex,
        ...(frame.decodedFrameIndex !== undefined ? { decodedFrameIndex: frame.decodedFrameIndex } : {}) }));
      if (frame.kind === "dhash") dHashFrameIndices.push(frame.decodedFrameIndex!);
    }
    const context = { organizationId: job.organizationId, jobId: job._id, submissionId: job.submissionId, taskVersionId: job.taskVersionId,
      sourceHash: job.sourceHash, pipelineVersion: job.pipelineVersion, leaseGeneration: args.generation,
      summary: `${simulatedScenarioId ? `SIMULATED ${simulatedScenarioId}: ` : ""}${report.recommendation}: ${report.criteria.map((c: {criterionId:string;status:string}) => `${c.criterionId}=${c.status}`).join(", ")}`,
      reportStorageId: args.reportStorageId, reportHash: args.reportHash, evidenceAssetIds: [...(submission.originalAssetId ? [submission.originalAssetId] : []), ...frameAssetIds],
      ...(dHashFrameIndices.length ? { dHashFrameIndices } : {}),
      completedAt: Date.now(), reportJson: args.reportJson, observationsJson: args.observationsJson, processingElapsedMs: args.processingElapsedMs,
      ...(submission.perceptualHashSource ? { perceptualHashSource: submission.perceptualHashSource } : {}) };
    const outcome = simulatedScenarioId ? {implementation: "scaffold" as const, pipelineStatus: "needs_review" as const, recommendation: "needs_review" as const} : report.pipeline.status === "completed"
      ? { implementation: "inference" as const, pipelineStatus: "completed" as const, recommendation: report.recommendation as "accept"|"needs_review"|"request_correction" }
      : { implementation: "inference" as const, pipelineStatus: report.pipeline.status as "needs_review"|"failed"|"ml_unavailable", recommendation: "needs_review" as const };
    const analysisId = await ctx.db.insert("analysisResults", { ...context, ...outcome });
    await ctx.db.patch(submission._id, { currentAnalysisId: analysisId, status: report.recommendation === "request_correction" ? "needs_correction" : "needs_review", updatedAt: Date.now() });
    await ctx.db.patch(job._id, { status: report.pipeline.status === "failed" ? "failed" : "completed", completedAt: Date.now(), ...(args.failureCode ? {lastErrorCode: args.failureCode} : {}) });
    await audit(ctx, { organizationId: job.organizationId, eventKey: `analysed:${job._id}:${args.generation}`, actor: {kind:"service",identity:"gemini-verifier"},
      action: "analysis_stored", entityType: "submissions", entityId: submission._id, reason: context.summary, evidenceReferences: [analysisId] });
    if (!simulatedScenarioId && !submission.verificationOnly) await ctx.scheduler.runAfter(0, makeFunctionReference<"mutation", { submissionId: Id<"submissions"> }>("policy:evaluateSubmission"), { submissionId: submission._id });
    return analysisId;
}
export const complete = internalMutation({args: completeArgs.fields, handler: (ctx, args) => completeFor(ctx, args)});

export const expire = internalMutation({
  args: { jobId: v.id("jobs"), generation: v.number() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "leased" || job.leaseGeneration !== args.generation || (job.leaseExpiresAt ?? 0) > Date.now()) return;
    await jobContributor(ctx, job);
    await ctx.db.patch(job._id, { status:"failed", lastErrorCode:"verification_interrupted" });
    await ctx.db.patch(job.submissionId, { status:"needs_review", updatedAt:Date.now() });
    await ctx.scheduler.runAfter(0, internal.verify.interrupted, {jobId:job._id,generation:args.generation});
  },
});

export const getReport = query({
  args: { demoIdentity: v.string(), submissionId: v.id("submissions") },
  handler: async (ctx, args) => {
    const principal = await requireRole(ctx, args.demoIdentity, ["buyer", "controller", "finance-agent", "contributor"]);
    const submission = await ctx.db.get(args.submissionId);
    if (!submission) throw new Error("submission_not_found");
    requireTenant(principal, submission);
    if (principal.roles.includes("contributor") && submission.contributorTokenIdentifier !== principal.tokenIdentifier) throw new Error("submission_not_owned");
    if (principal.roles.includes("buyer")) {
      const order = await ctx.db.get(submission.orderId);
      if (!order || order.buyerTokenIdentifier !== principal.tokenIdentifier) throw new Error("order_not_owned");
    }
    const analysis = submission.currentAnalysisId ? await ctx.db.get(submission.currentAnalysisId) : null;
    if (analysis && (analysis.organizationId !== submission.organizationId || analysis.submissionId !== submission._id)) throw new Error("analysis_reference_mismatch");
    const decision = submission.currentDecisionId ? await ctx.db.get(submission.currentDecisionId) : null;
    if (decision && (decision.organizationId !== submission.organizationId || decision.submissionId !== submission._id)) throw new Error("decision_reference_mismatch");
    return { status: submission.status, sourceHash: submission.sourceHash, perceptualHashSource: submission.perceptualHashSource,
      capture: submission.sensorTrace ? { version: submission.sensorTrace.version ?? 1, device: submission.sensorTrace.device,
        context: submission.sensorTrace.context ?? null, segments: submission.sensorTrace.segments ?? [],
        unavailableSensors: submission.sensorTrace.unavailableSensors ?? [],
        videoStartOffsetMs: submission.sensorTrace.videoStartOffsetMs ?? null, videoStopOffsetMs: submission.sensorTrace.videoStopOffsetMs ?? null,
        clock: submission.sensorTrace.clock, syncSource: submission.sensorTrace.syncSource ?? null,
        syncAccuracy: submission.sensorTrace.syncAccuracy ?? null } : null,
      submittedAt: submission._creationTime, analysisCompletedAt: analysis?.completedAt ?? null,
      decision: decision ? { _id: decision._id, decision: decision.decision, reason: decision.reason, reasonCode: decision.reasonCode,
        note: decision.note, decidedAt: decision.decidedAt } : null,
      verificationOnly: submission.verificationOnly ?? false, evalRunId: submission.evalRunId, evalVideoModel: submission.evalVideoModel,
      ...(submission.liveness ? { liveness: submission.liveness } : {}),
      report: analysis?.reportJson ? JSON.parse(analysis.reportJson) : null,
      observations: analysis?.observationsJson ? JSON.parse(analysis.observationsJson) : null,
      processingElapsedMs: analysis?.processingElapsedMs };
  },
});

export const interruptedContext = internalQuery({
  args:{jobId:v.id("jobs"),generation:v.number()},
  handler:async(ctx,args)=>{
    const job=await ctx.db.get(args.jobId);
    if(!job || job.status !== "failed" || job.lastErrorCode !== "verification_interrupted" || job.leaseGeneration !== args.generation) return null;
    const submission=await ctx.db.get(job.submissionId),rubric=await ctx.db.get(job.taskVersionId);
    const asset=submission?.originalAssetId ? await ctx.db.get(submission.originalAssetId) : null;
    if(!submission || !rubric || submission.currentAnalysisId || submission.organizationId !== job.organizationId || rubric.organizationId !== job.organizationId) return null;
    return {job,submission,rubric,asset};
  },
});

/** Bounded inventory lets an eval runner reject unknown or cross-owner run members. */
export const evaluationRun = query({
  args: { demoIdentity: v.string(), orderId: v.id("orders"), evalRunId: v.string() },
  handler: async (ctx, args) => {
    const principal = await requireRole(ctx, args.demoIdentity, "contributor");
    validateEvaluationScope(true, args.evalRunId);
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("order_not_found");
    requireTenant(principal, order);
    const submissions = await ctx.db.query("submissions").withIndex("by_eval_run", q =>
      q.eq("organizationId", principal.organizationId).eq("evalRunId", args.evalRunId)).take(201);
    if (submissions.some(submission => !submission.verificationOnly || submission.orderId !== args.orderId ||
      submission.contributorTokenIdentifier !== principal.tokenIdentifier ||
      submission.evalVideoModel !== submissions[0]?.evalVideoModel)) throw new Error("evaluation_scope_contaminated");
    return { submissions: submissions.slice(0, 200).map(submission => ({ _id: submission._id,
      clientRequestId: submission.clientRequestId, ...(submission.sourceHash ? { sourceHash: submission.sourceHash } : {}),
      ...(submission.evalVideoModel ? { evalVideoModel: submission.evalVideoModel } : {}) })),
      truncated: submissions.length > 200 };
  },
});
