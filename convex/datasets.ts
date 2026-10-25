import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireRole } from "./lib/demoAuth";
import { digest, requireTenant } from "./lib/finance";
import { attestationLinks } from "./lib/eas";
import { checkSpokenLiveness } from "./lib/spokenLiveness";
import type { AudioObservation, VerificationReport } from "./lib/verificationReport";
import { PAYMENT_NETWORK, PAYMENT_RAILS, USDC_ADDRESS } from "../packages/contracts/src/chain";
import { validateTransfer } from "../packages/payments/src/reconciliation";
import { createDatasetMediaToken } from "../packages/payments/src/dataset-media-token";
import { service } from "./payments";

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
 * supported: a controller may accept evidence that the machine sent to review.
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
    consent.licenseHash !== digest({ licenseVersion: consent.licenseVersion, scope: consent.scope }) ||
    decision.submissionId !== submission._id || decision.taskVersionId !== rubric._id || decision.decision !== "accepted" ||
    decision.analysisResultId !== manifest.analysisResultId || decision.evidenceHash !== (analysis?.reportHash ?? submission.sourceHash)) return null;
  if (manifest.analysisResultId && (!analysis || analysis.organizationId !== order.organizationId ||
    analysis.submissionId !== submission._id || analysis.taskVersionId !== rubric._id || analysis.sourceHash !== submission.sourceHash)) return null;
  const machine = decision.decisionKey === `accept:${submission._id}`;
  if (machine ? !analysis || analysis.implementation !== "inference" || analysis.pipelineStatus !== "completed" ||
    analysis.recommendation !== "accept" : !decision.decisionKey.startsWith("human:")) return null;
  let report: VerificationReport | null = null;
  let audio: AudioObservation | undefined;
  try {
    if (analysis?.reportJson) {
      report = JSON.parse(analysis.reportJson) as VerificationReport;
      if (digest(report) !== analysis.reportHash || report.submissionId !== submission._id || report.taskVersionId !== rubric._id ||
        report.source.sha256 !== submission.sourceHash || report.pipeline.implementation !== analysis.implementation ||
        report.pipeline.status !== analysis.pipelineStatus || report.recommendation !== analysis.recommendation ||
        !Array.isArray(report.criteria)) return null;
    }
    if (analysis?.observationsJson) audio = JSON.parse(analysis.observationsJson).audio;
  } catch { return null; }
  // Select only rubric findings and timestamps, never model text or arbitrary fields.
  const criteria = rubric.criteria.map(({ criterionId }) => {
    const finding = report?.criteria.find(row => row.criterionId === criterionId);
    return { criterionId, status: finding?.status ?? "unobservable", evidence: (finding?.evidence ?? [])
      .map(({ modality, startMs, endMs }) => ({ modality, startMs, endMs })) };
  });
  const transcriptSegments = (audio?.segments ?? []).map(({ startMs, endMs, text }) => ({ startMs, endMs, text }));
  const attestation = analysis ? await ctx.db.query("attestations").withIndex("by_analysis", q => q.eq("analysisId", analysis._id)).unique() : null;
  const attested = attestation?.submissionId === submission._id && attestation.status === "confirmed" &&
    !!attestation.attestationUid && !!attestation.txHash && attestation.fields?.reportHash.replace(/^0x/, "") === analysis?.reportHash &&
    attestation.fields?.sourceSha256.replace(/^0x/, "") === submission.sourceHash;
  const trace = submission.sensorTrace;
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
  return { submissionId: submission._id, sourceSha256: submission.sourceHash, durationMs: original.durationMs ?? report?.source.durationMs ?? null,
    task: { id: rubric._id, version: rubric.version, criterionIds: rubric.criteria.map(row => row.criterionId) },
    acceptedAt: decision.decidedAt, acceptance: { basis: machine ? "machine" as const : "human_controller" as const, decisionId: decision._id },
    license: { version: consent.licenseVersion, scope: consent.scope },
    criteria, transcriptSegments,
    sensorTrace: trace ? { rawTraceExists: !!await ctx.db.system.get(trace.storageId), sampleRateHz: trace.sampleRateHz,
      sampleCount: trace.sampleCount, durationMs: trace.durationMs, sensors: trace.sensors, motionSummary: trace.motionSummary } : null,
    liveness: submission.liveness ? checkSpokenLiveness(submission.liveness, audio, original.durationMs ?? report?.source.durationMs ?? 0) : null,
    duplicate: { status: report?.duplicate.status ?? "not_checked" },
    attestation: attested ? { uid: attestation.attestationUid!, ...attestationLinks(attestation.attestationUid!, attestation.txHash!) } : null,
    payout: await payout(ctx, samplePayables[0]), media: { url: mediaUrl, mimeType: original.mimeType, binding, expiresAt } };
}

async function orderScope(ctx: QueryCtx, args: { demoIdentity: string; orderId: Id<"orders"> }) {
    const principal = await requireRole(ctx, args.demoIdentity, ["buyer", "controller"]);
    if (args.demoIdentity === "finance-agent" || principal.roles.includes("finance-agent")) throw new Error("forbidden");
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("order_not_found");
    requireTenant(principal, order);
    if (!principal.roles.includes("controller") && order.buyerTokenIdentifier !== principal.tokenIdentifier) throw new Error("order_not_owned");
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
      task: rubric ? { id: rubric._id, version: rubric.version, criterionIds: rubric.criteria.map(row => row.criterionId) } : null,
      generatedAt: Date.now(), samples };
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
