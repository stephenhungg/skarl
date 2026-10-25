import { v } from "convex/values";
import { action, internalQuery, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { MAX_SENSOR_TRACE_BYTES, validateSensorTrace } from "./lib/sensorTrace";
import { MAX_ANNOTATION_BYTES, validateAnnotationFile } from "./lib/derivedAnnotations";
import type { TrainingInputs } from "./lib/trainingFormats";
import type { Doc, Id } from "./_generated/dataModel";
import { hasOrderAuthority, requireRole } from "./lib/demoAuth";
import { requireBuyerOrder, digest, requireTenant } from "./lib/finance";
import { attestationLinks } from "./lib/eas";
import { checkSpokenLiveness } from "./lib/spokenLiveness";
import type { AudioObservation, VerificationReport } from "./lib/verificationReport";
import { PAYMENT_NETWORK, PAYMENT_RAILS, USDC_ADDRESS } from "../packages/contracts/src/chain";
import { validateTransfer } from "../packages/payments/src/reconciliation";
import { createDatasetMediaToken } from "../packages/payments/src/dataset-media-token";
import { service } from "./payments";
import { deriveSampleQuality } from "./lib/sampleQuality";
import { buildProvenance } from "./lib/provenance";

/** A confirmed commitment must match the evidence being scored, not just exist. */
function attestationMatches(attestation: Doc<"attestations"> | null, submission: Doc<"submissions">,
  analysis: Doc<"analysisResults"> | null, rubric: Doc<"rubricVersions">) {
  const hash = (value: string | undefined) => !!value && /^0x[a-fA-F0-9]{64}$/.test(value);
  return !!analysis && attestation?.analysisId === analysis._id && attestation.submissionId === submission._id &&
    attestation.status === "confirmed" && hash(attestation.attestationUid) && hash(attestation.txHash) &&
    attestation.fields?.reportHash.replace(/^0x/, "") === analysis.reportHash &&
    attestation.fields.sourceSha256.replace(/^0x/, "") === submission.sourceHash &&
    attestation.fields.rubricHash.replace(/^0x/, "") === rubric.contentHash &&
    attestation.fields.pipelineVersion === analysis.pipelineVersion &&
    attestation.fields.recommendation === analysis.recommendation && attestation.fields.licensed === true;
}

/** JSON is stored evidence, not authority: discard corrupt or rebound reports. */
function boundReport(analysis: Doc<"analysisResults"> | null, submission: Doc<"submissions">,
  rubric: Doc<"rubricVersions">): VerificationReport | null {
  try {
    if (!analysis?.reportJson || analysis.organizationId !== submission.organizationId ||
      analysis.submissionId !== submission._id || analysis.taskVersionId !== rubric._id ||
      analysis.sourceHash !== submission.sourceHash) return null;
    const report = JSON.parse(analysis.reportJson) as VerificationReport;
    if (digest(report) !== analysis.reportHash || report.submissionId !== submission._id || report.taskVersionId !== rubric._id ||
      report.source.sha256 !== submission.sourceHash || report.pipeline.version !== analysis.pipelineVersion ||
      report.pipeline.implementation !== analysis.implementation || report.pipeline.status !== analysis.pipelineStatus ||
      report.recommendation !== analysis.recommendation || !Array.isArray(report.criteria) ||
      !report.duplicate || !Array.isArray(report.duplicate.matches) || report.criteria.some(row => !row ||
        typeof row.criterionId !== "string" || !Array.isArray(row.evidence) || row.evidence.some(item => !item))) return null;
    return report;
  } catch { return null; }
}

/** A broadcast hash or approval is not proof of payment. */
async function payout(ctx: QueryCtx, payable: Doc<"payables"> | undefined) {
  const pending = { status: "pending" as const, amountAtomic: payable?.amountAtomic.toString() ?? null,
    txHash: null, explorerUrl: null };
  if (!payable || payable.status !== "paid" || payable.network !== PAYMENT_NETWORK || payable.tokenAddress !== USDC_ADDRESS) return pending;
  const commands = await ctx.db.query("paymentCommands").withIndex("by_payable", q => q.eq("payableId", payable._id)).collect();
  for (const command of commands) {
    if (command.organizationId !== payable.organizationId || command.orderId !== payable.orderId ||
      command.kind !== "contributor_payout" || command.network !== PAYMENT_NETWORK || command.tokenAddress !== USDC_ADDRESS ||
      command.amountAtomic !== payable.amountAtomic || command.recipientAddress !== payable.recipientAddress ||
      !["confirmed", "finalized"].includes(command.status)) continue;
    const attempts = await ctx.db.query("paymentAttempts").withIndex("by_command", q => q.eq("paymentCommandId", command._id)).collect();
    for (const attempt of attempts) {
      if (attempt.organizationId !== payable.organizationId || !attempt.txHash || !attempt.payerAddress ||
        attempt.network !== PAYMENT_NETWORK || attempt.tokenAddress !== USDC_ADDRESS || attempt.amountAtomic !== payable.amountAtomic ||
        !["confirmed", "finalized"].includes(attempt.status)) continue;
      const observations = await ctx.db.query("chainObservations").withIndex("by_attempt", q => q.eq("paymentAttemptId", attempt._id)).collect();
      for (const observation of observations) {
        if (observation.organizationId !== payable.organizationId || observation.txHash.toLowerCase() !== attempt.txHash.toLowerCase()) continue;
        try { validateTransfer(observation, { network: PAYMENT_NETWORK, fromAddress: attempt.payerAddress,
          toAddress: payable.recipientAddress, amountAtomic: payable.amountAtomic }); } catch { continue; }
        return { status: "paid" as const, amountAtomic: payable.amountAtomic.toString(), txHash: observation.txHash,
          explorerUrl: PAYMENT_RAILS[PAYMENT_NETWORK].explorerTx(observation.txHash) };
      }
    }
  }
  return pending;
}

/** Validate the licensed delivery snapshot before issuing any original-media URL.
 * These checks mirror the paid evidence media path, with human acceptance also
 * supported: a buyer may accept evidence that the machine sent to review.
 */
async function deliveredSample(ctx: QueryCtx, order: Doc<"orders">, delivery: Doc<"deliveries">,
  rubric: Doc<"rubricVersions">, payables: Doc<"payables">[], demoIdentity: string, nativeMedia = false) {
  const submission = await ctx.db.get(delivery.submissionId);
  const manifest = delivery.manifest;
  if (!submission || !manifest || submission.status !== "accepted" || submission.verificationOnly ||
    submission.evalRunId !== undefined || submission.evalVideoModel !== undefined || !submission.sourceHash ||
    delivery.organizationId !== order.organizationId || submission.organizationId !== order.organizationId ||
    submission.orderId !== order._id || submission.taskVersionId !== rubric._id ||
    delivery.termsHash !== order.termsHash || digest(manifest) !== delivery.manifestHash ||
    manifest.sourceHash !== submission.sourceHash || manifest.taskVersionId !== rubric._id ||
    manifest.originalAssetId !== submission.originalAssetId || manifest.consentRecordId !== submission.consentRecordId ||
    manifest.decisionId !== delivery.decisionId) return null;
  const [original, consent, decision, analysis] = await Promise.all([
    ctx.db.get(manifest.originalAssetId), ctx.db.get(manifest.consentRecordId), ctx.db.get(delivery.decisionId),
    manifest.analysisResultId ? ctx.db.get(manifest.analysisResultId) : null,
  ]);
  if (!original || !consent || !decision || [original, consent, decision].some(row => row.organizationId !== order.organizationId) ||
    original.submissionId !== submission._id || original.purpose !== "original" || original.status !== "verified" ||
    original.contentHash !== submission.sourceHash || !original.mimeType.startsWith("video/") ||
    consent.submissionId !== submission._id || consent.contributorTokenIdentifier !== submission.contributorTokenIdentifier ||
    consent.licenseVersion !== "demo-consent-v1" || manifest.licenseVersion !== consent.licenseVersion || !consent.scope.trim() ||
    consent.revocationStatus !== undefined ||
    consent.licenseHash !== digest({ licenseVersion: consent.licenseVersion, scope: consent.scope }) ||
    decision.submissionId !== submission._id || decision.taskVersionId !== rubric._id || decision.decision !== "accepted" ||
    decision.analysisResultId !== manifest.analysisResultId || decision.evidenceHash !== (analysis?.reportHash ?? submission.sourceHash)) return null;
  if (manifest.analysisResultId && (!analysis || analysis.organizationId !== order.organizationId ||
    analysis.submissionId !== submission._id || analysis.taskVersionId !== rubric._id || analysis.sourceHash !== submission.sourceHash)) return null;
  const machine = decision.decisionKey === `accept:${submission._id}`;
  if (machine ? !analysis || analysis.implementation !== "inference" || analysis.pipelineStatus !== "completed" ||
    analysis.recommendation !== "accept" : !decision.decisionKey.startsWith("human:")) return null;
  const report = boundReport(analysis, submission, rubric);
  if (analysis?.reportJson && !report) return null;
  let audio: AudioObservation | undefined;
  let jury: unknown;
  try {
    if (analysis?.observationsJson) {
      const observations = JSON.parse(analysis.observationsJson);
      audio = observations?.audio;
      jury = observations?.jury;
    }
  } catch { return null; }
  // Select only rubric findings and timestamps, never model text or arbitrary fields.
  const criteria = rubric.criteria.map(({ criterionId }) => {
    const finding = report?.criteria.find(row => row.criterionId === criterionId);
    return { criterionId, status: finding?.status ?? "unobservable", evidence: (finding?.evidence ?? [])
      .map(({ modality, startMs, endMs }) => ({ modality, startMs, endMs })) };
  });
  const transcriptSegments = (audio?.segments ?? []).map(({ startMs, endMs, text }) => ({ startMs, endMs, text }));
  const attestation = analysis ? await ctx.db.query("attestations").withIndex("by_analysis", q => q.eq("analysisId", analysis._id)).unique() : null;
  const attested = attestationMatches(attestation, submission, analysis, rubric);
  const trace = submission.sensorTrace;
  const rawTraceExists = trace ? !!await ctx.db.system.get(trace.storageId) : false;
  const durationMs = original.durationMs ?? report?.source.durationMs ?? null;
  const liveness = submission.liveness ? checkSpokenLiveness(submission.liveness, audio, durationMs ?? 0) : null;
  const quality = deriveSampleQuality({ status: submission.status, durationMs,
    criterionIds: rubric.criteria.map(row => row.criterionId), report, analysis, jury, liveness,
    sensorSummary: rawTraceExists ? trace?.motionSummary : null, attested });
  const samplePayables = payables.filter(row => row.submissionId === submission._id && row.organizationId === order.organizationId &&
    row.decisionId === decision._id && row.contributorTokenIdentifier === submission.contributorTokenIdentifier);
  if (samplePayables.length > 1) throw new Error("duplicate_payable_reference");
  const url = await ctx.storage.getUrl(original.storageId);
  if (!url) return null;
  const binding = digest({ submissionId: submission._id, manifestHash: delivery.manifestHash,
    consentReceiptHash: consent.receiptHash, licenseHash: consent.licenseHash });
  let mediaUrl = url, expiresAt: number | null = null;
  if (!nativeMedia) {
    const secret = process.env.SKARL_PAYMENTS_SERVICE_SECRET ?? "";
    const grant = createDatasetMediaToken({ demoIdentity, orderId: order._id, submissionId: submission._id, binding }, secret);
    expiresAt = grant.expiresAt;
    mediaUrl = `https://skarl.vercel.app/api/orders/${order._id}/dataset/media?token=${encodeURIComponent(grant.token)}`;
  }
  // Client-derived labels are separate from the published acceptance snapshot.
  // Only authorized, licensed samples reach this point; no model output affects
  // eligibility, payable amounts, quality scores or original-media bindings.
  const annotationRuns = await ctx.db.query("derivedAnnotations")
    .withIndex("by_submission", q => q.eq("submissionId", submission._id)).order("desc").collect();
  const annotations = await Promise.all(annotationRuns
    .filter(run => run.organizationId === order.organizationId && run.advisory === true)
    .map(async run => ({ kind: run.kind, model: run.model, summary: run.summary,
      url: await ctx.storage.getUrl(run.storageId), derived: true as const, advisory: true as const })));
  return { submissionId: submission._id, sourceSha256: submission.sourceHash, durationMs,
    task: { id: rubric._id, version: rubric.version, languageInstruction: rubric.taskPrompt, criterionIds: rubric.criteria.map(row => row.criterionId) },
    acceptedAt: decision.decidedAt, acceptance: { basis: machine ? "machine" as const : "human_controller" as const, decisionId: decision._id },
    license: { version: consent.licenseVersion, scope: consent.scope },
    annotations,
    provenance: await buildProvenance(ctx, { ...submission, currentAnalysisId: analysis?._id }),
    diversity: { environment: submission.environment ?? null, variant: submission.variant ?? null,
      source: "contributor_self_reported" as const },
    criteria, transcriptSegments, ...quality,
    sensorTrace: trace ? { rawTraceExists, rawTraceDownload: null, source: "clientReported" as const, sampleRateHz: trace.sampleRateHz,
      sampleCount: trace.sampleCount, durationMs: trace.durationMs, sensors: trace.sensors, motionSummary: trace.motionSummary,
      device: trace.device, version: trace.version ?? 1, context: trace.context ?? null, segments: trace.segments ?? [],
      videoStartOffsetMs: trace.videoStartOffsetMs ?? null, videoStopOffsetMs: trace.videoStopOffsetMs ?? null,
      syncSource: trace.syncSource ?? null, syncAccuracy: trace.syncAccuracy ?? null, unavailableSensors: trace.unavailableSensors ?? [] } : null,
    liveness,
    duplicate: { status: report?.duplicate.status ?? "not_checked" },
    attestation: attested ? { uid: attestation!.attestationUid!, ...attestationLinks(attestation!.attestationUid!, attestation!.txHash!) } : null,
    payout: await payout(ctx, samplePayables[0]), media: { url: mediaUrl, mimeType: original.mimeType, binding, expiresAt,
      fps: null, clientReportedFps: trace?.device.fps ?? null } };
}

async function orderScope(ctx: QueryCtx, args: { demoIdentity: string; orderId: Id<"orders"> }) {
    const principal = await requireRole(ctx, args.demoIdentity, ["buyer", "controller"]);
    if (principal.roles.includes("finance-agent")) throw new Error("forbidden");
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("order_not_found");
    requireBuyerOrder(principal, order);
    const rubric = order.taskVersionId ? await ctx.db.get(order.taskVersionId) : null;
    if (rubric && (rubric.organizationId !== order.organizationId || rubric.orderId !== order._id || rubric.frozenAt === undefined)) {
      throw new Error("task_version_mismatch");
    }
    return { order, rubric };
}

/** Buyer delivery is an explicit licensed publication, never an analysis queue export. */
export const forOrder = query({
  // A changing cache key refreshes expiring grants without mutating dataset data.
  // It never supplies the authoritative signing clock or changes access rights.
  args: { demoIdentity: v.string(), orderId: v.id("orders"), refreshKey: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { order, rubric } = await orderScope(ctx, args);
    const [deliveries, payables] = await Promise.all([
      ctx.db.query("deliveries").withIndex("by_order", q => q.eq("orderId", order._id)).collect(),
      ctx.db.query("payables").withIndex("by_order", q => q.eq("orderId", order._id)).collect(),
    ]);
    const samples = [];
    const seen = new Set<string>();
    if (rubric) for (const delivery of deliveries) {
      if (seen.has(delivery.submissionId)) continue;
      const sample = await deliveredSample(ctx, order, delivery, rubric, payables, args.demoIdentity);
      if (sample) { samples.push(sample); seen.add(sample.submissionId); }
    }
    return { schema: "skarl.dataset.v1" as const, orderId: order._id,
      task: rubric ? { id: rubric._id, version: rubric.version, languageInstruction: rubric.taskPrompt, criterionIds: rubric.criteria.map(row => row.criterionId) } : null,
      generatedAt: Date.now(), samples };
  },
});

const trainingArgs = { demoIdentity: v.string(), orderId: v.id("orders"), submissionId: v.id("submissions"), binding: v.string() };
/** Internal storage handles never cross the public dataset boundary. Reuses every publication/license check. */
export const authorizeTrainingInputs = internalQuery({
  args: trainingArgs,
  handler: async (ctx, args) => {
    const { order, rubric } = await orderScope(ctx, args);
    if (!rubric) throw new Error("sample_not_available");
    const deliveries = await ctx.db.query("deliveries").withIndex("by_submission", q => q.eq("submissionId", args.submissionId)).collect();
    for (const delivery of deliveries) {
      if (delivery.orderId !== order._id) continue;
      const sample = await deliveredSample(ctx, order, delivery, rubric, [], args.demoIdentity, true);
      if (!sample || sample.media.binding !== args.binding) continue;
      const submission = (await ctx.db.get(args.submissionId))!;
      const runs = await ctx.db.query("derivedAnnotations").withIndex("by_submission", q => q.eq("submissionId", submission._id)).order("desc").collect();
      const hands = runs.find(run => run.organizationId === order.organizationId && run.advisory && run.kind === "hands");
      return { sourceSha256: sample.sourceSha256!, durationMs: sample.durationMs,
        traceStorageId: sample.sensorTrace?.rawTraceExists ? submission.sensorTrace!.storageId : null,
        handsStorageId: hands?.storageId ?? null };
    }
    throw new Error("sample_not_available");
  },
});

/** One bounded episode per call. Recheck consent/binding after storage I/O before returning private evidence. */
export const trainingInputs = action({
  args: trainingArgs,
  handler: async (ctx, args): Promise<TrainingInputs> => {
    const authorized = await ctx.runQuery(internal.datasets.authorizeTrainingInputs, args);
    async function json(storageId: Id<"_storage"> | null, maxBytes: number): Promise<unknown> {
      if (!storageId) return null;
      const blob = await ctx.storage.get(storageId);
      if (!blob || blob.size <= 0 || blob.size > maxBytes || blob.type.split(";")[0] !== "application/json") return null;
      try { return JSON.parse(await blob.text()); } catch { return null; }
    }
    let trace: TrainingInputs["trace"] = null, hands: TrainingInputs["hands"] = null;
    const traceJson = await json(authorized.traceStorageId, MAX_SENSOR_TRACE_BYTES);
    if (traceJson) try { trace = validateSensorTrace(traceJson); } catch { /* Invalid evidence contributes no state. */ }
    const handsJson = await json(authorized.handsStorageId, MAX_ANNOTATION_BYTES);
    if (handsJson) try {
      const file = validateAnnotationFile(handsJson);
      if (file.kind === "hands" && file.submissionId === args.submissionId && file.sourceSha256 === authorized.sourceSha256 &&
        file.frames.every(frame => authorized.durationMs === null || frame.tMs <= authorized.durationMs)) hands = file;
    } catch { /* Invalid or rebound annotations contribute no action proxy. */ }
    const current = await ctx.runQuery(internal.datasets.authorizeTrainingInputs, args);
    if (digest(current) !== digest(authorized)) throw new Error("sample_not_available");
    return { trace, hands, status: trace || hands ? "validated_storage" : "unavailable" };
  },
});

/** Companion to witnessReceipt: advisory evidence only, with no media grants. */
export const sampleQuality = query({
  args: { demoIdentity: v.string(), submissionId: v.id("submissions") },
  handler: async (ctx, args) => {
    const principal = await requireRole(ctx, args.demoIdentity, ["buyer", "controller", "contributor"]);
    if (principal.roles.includes("finance-agent")) throw new Error("forbidden");
    const submission = await ctx.db.get(args.submissionId);
    if (!submission) throw new Error("submission_not_found");
    requireTenant(principal, submission);
    const order = await ctx.db.get(submission.orderId);
    if (!order) throw new Error("order_not_found");
    requireTenant(principal, order);
    if (!hasOrderAuthority(principal, order) &&
      !(principal.roles.includes("contributor") && submission.contributorTokenIdentifier === principal.tokenIdentifier)) throw new Error("submission_not_owned");
    const rubric = await ctx.db.get(submission.taskVersionId);
    if (!rubric || rubric.organizationId !== order.organizationId || rubric.orderId !== order._id) throw new Error("task_version_mismatch");
    // Accepted samples use their published analysis snapshot, just like the export.
    const deliveries = submission.status === "accepted" ? await ctx.db.query("deliveries")
      .withIndex("by_submission", q => q.eq("submissionId", submission._id)).collect() : [];
    const delivery = deliveries.find(row => row.organizationId === order.organizationId && row.orderId === order._id &&
      row.manifest && digest(row.manifest) === row.manifestHash && row.termsHash === order.termsHash &&
      row.manifest.sourceHash === submission.sourceHash && row.manifest.taskVersionId === rubric._id &&
      row.manifest.originalAssetId === submission.originalAssetId && row.manifest.decisionId === row.decisionId);
    const analysisId = delivery ? delivery.manifest?.analysisResultId : submission.currentAnalysisId;
    const selectedAnalysis = analysisId ? await ctx.db.get(analysisId) : null;
    const analysis = selectedAnalysis && selectedAnalysis.organizationId === submission.organizationId &&
      selectedAnalysis.submissionId === submission._id && selectedAnalysis.taskVersionId === rubric._id &&
      selectedAnalysis.sourceHash === submission.sourceHash ? selectedAnalysis : null;
    const report = boundReport(analysis, submission, rubric);
    const original = submission.originalAssetId ? await ctx.db.get(submission.originalAssetId) : null;
    const durationMs = original?.organizationId === order.organizationId && original.submissionId === submission._id &&
      original.contentHash === submission.sourceHash && original.status === "verified" && original.purpose === "original"
      ? original.durationMs ?? report?.source.durationMs ?? null : report?.source.durationMs ?? null;
    let audio: AudioObservation | undefined, jury: unknown;
    try {
      const observations = JSON.parse(analysis?.observationsJson ?? "{}");
      audio = observations?.audio; jury = observations?.jury;
    } catch { /* Corrupt observations cannot earn witness credit. */ }
    const attestation = analysis ? await ctx.db.query("attestations")
      .withIndex("by_analysis", q => q.eq("analysisId", analysis._id)).unique() : null;
    const trace = submission.sensorTrace;
    const rawTraceExists = trace ? !!await ctx.db.system.get(trace.storageId) : false;
    return { submissionId: submission._id, submissionStatus: submission.status, analysisId: analysis?._id ?? null,
      evidenceBasis: delivery ? "published_delivery" as const : "current_analysis" as const,
      ...deriveSampleQuality({ status: submission.status, durationMs, criterionIds: rubric.criteria.map(row => row.criterionId),
        report, analysis, jury, liveness: submission.liveness ? checkSpokenLiveness(submission.liveness, audio, durationMs ?? 0) : null,
        sensorSummary: rawTraceExists ? trace?.motionSummary : null,
        attested: attestationMatches(attestation, submission, analysis, rubric) }) };
  },
});

/** Only the trusted streaming proxy receives the native non-expiring storage URL. */
export const originalMedia = query({
  args: { serviceSecret: v.string(), demoIdentity: v.string(), orderId: v.id("orders"),
    submissionId: v.id("submissions"), binding: v.string() },
  handler: async (ctx, args) => {
    service(args.serviceSecret);
    const { order, rubric } = await orderScope(ctx, args);
    if (!rubric) throw new Error("sample_not_available");
    const deliveries = await ctx.db.query("deliveries").withIndex("by_submission", q => q.eq("submissionId", args.submissionId)).collect();
    for (const delivery of deliveries) {
      if (delivery.orderId !== order._id) continue;
      const sample = await deliveredSample(ctx, order, delivery, rubric, [], args.demoIdentity, true);
      if (sample?.media.binding === args.binding) return { storageUrl: sample.media.url, mimeType: sample.media.mimeType, binding: args.binding };
    }
    throw new Error("sample_not_available");
  },
});

/** Only recorded obligations count as earnings; the order's rate is not a promise. */
export const contributorEarnings = query({
  args: { demoIdentity: v.string() },
  handler: async (ctx, args) => {
    const principal = await requireRole(ctx, args.demoIdentity, "contributor");
    if (principal.roles.includes("finance-agent")) throw new Error("forbidden");
    const submissions = await ctx.db.query("submissions").withIndex("by_contributor", q =>
      q.eq("organizationId", principal.organizationId).eq("contributorTokenIdentifier", principal.tokenIdentifier)).collect();
    const orderIds = [...new Set(submissions.map(row => row.orderId))];
    const payables = (await Promise.all(orderIds.map(async orderId => {
      const order = await ctx.db.get(orderId);
      if (!order) throw new Error("order_not_found");
      requireTenant(principal, order);
      return ctx.db.query("payables").withIndex("by_order", q => q.eq("orderId", orderId)).collect();
    }))).flat().filter(row => row.organizationId === principal.organizationId && row.contributorTokenIdentifier === principal.tokenIdentifier);
    return Promise.all(submissions.map(async submission => {
      const obligations = payables.filter(row => row.submissionId === submission._id && row.orderId === submission.orderId);
      if (obligations.length > 1) throw new Error("duplicate_payable_reference");
      const payable = obligations[0];
      return { submissionId: submission._id, orderId: submission.orderId, status: submission.status,
        amountAtomic: payable?.amountAtomic.toString() ?? "0", payableStatus: payable?.status ?? null,
        payout: payable ? await payout(ctx, payable) : { status: "not_payable" as const, amountAtomic: null, txHash: null, explorerUrl: null } };
    }));
  },
});
