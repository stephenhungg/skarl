import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { attestationLinks } from "./eas";
import { digest } from "./finance";
import { checkSpokenLiveness } from "./spokenLiveness";
import type { AudioObservation } from "./verificationReport";

/** Stored visual mentions are a conservative heuristic, never a face detector or privacy clearance.
 * In particular, missing mentions (including hands-only observations) do not establish absence.
 */
export function privacyFromObservations(video: unknown, durationMs: number) {
  const evidence: { startMs: number; endMs: number; signal: "face_or_person_mention" }[] = [];
  if (video && typeof video === "object" && "observations" in video && Array.isArray(video.observations)) {
    for (const row of video.observations) {
      if (!row || typeof row.description !== "string" || !/\b(?:faces?|bystanders?|persons?|people)\b/i.test(row.description) ||
        !Number.isSafeInteger(row.startMs) || !Number.isSafeInteger(row.endMs) || row.startMs < 0 ||
        row.endMs <= row.startMs || row.endMs > durationMs) continue;
      evidence.push({ startMs: row.startMs, endMs: row.endMs, signal: "face_or_person_mention" });
    }
  }
  return { privacyReview: evidence.length ? "needs_review" as const : "not_checked" as const,
    privacyEvidence: { basis: "stored_visual_description_heuristic" as const, evidence } };
}

/** Export-safe current provenance: no identity token, wallet, narration, private URL or revocation reason.
 * Call after authorizing access to this submission; this helper is also usable from dataset queries.
 */
export async function buildProvenance(ctx: Pick<QueryCtx, "db">, submission: Doc<"submissions">) {
  const [consent, original, analysis] = await Promise.all([
    submission.consentRecordId ? ctx.db.get(submission.consentRecordId) : null,
    submission.originalAssetId ? ctx.db.get(submission.originalAssetId) : null,
    submission.currentAnalysisId ? ctx.db.get(submission.currentAnalysisId) : null,
  ]);
  if (consent && (consent.organizationId !== submission.organizationId || consent.submissionId !== submission._id ||
    consent.contributorTokenIdentifier !== submission.contributorTokenIdentifier)) throw new Error("consent_reference_mismatch");
  const verifiedSource = !!original && original.organizationId === submission.organizationId && original.submissionId === submission._id &&
    original.purpose === "original" && original.status === "verified" && original.contentHash === submission.sourceHash &&
    /^[a-f0-9]{64}$/.test(original.contentHash);
  let durationMs = 0;
  let audio: AudioObservation | undefined;
  let video: unknown;
  let boundAnalysis = false;
  try {
    if (analysis?.reportJson && analysis.organizationId === submission.organizationId && analysis.submissionId === submission._id &&
      analysis.taskVersionId === submission.taskVersionId && analysis.sourceHash === submission.sourceHash) {
      const report = JSON.parse(analysis.reportJson);
      boundAnalysis = digest(report) === analysis.reportHash && report.submissionId === submission._id &&
        report.taskVersionId === submission.taskVersionId && report.source?.sha256 === submission.sourceHash &&
        report.pipeline?.implementation === analysis.implementation && report.pipeline?.status === analysis.pipelineStatus &&
        report.recommendation === analysis.recommendation;
      if (boundAnalysis) {
        durationMs = Number.isSafeInteger(report.source.durationMs) ? report.source.durationMs : 0;
        const observations = analysis.observationsJson ? JSON.parse(analysis.observationsJson) : null;
        audio = observations?.audio;
        video = observations?.video;
      }
    }
  } catch { boundAnalysis = false; audio = undefined; video = undefined; }
  const row = boundAnalysis && analysis ? await ctx.db.query("attestations").withIndex("by_analysis", q => q.eq("analysisId", analysis._id)).unique() : null;
  const attested = row?.submissionId === submission._id && row.status === "confirmed" && !!row.attestationUid && !!row.txHash &&
    row.fields?.reportHash.replace(/^0x/, "") === analysis?.reportHash && row.fields?.sourceSha256.replace(/^0x/, "") === submission.sourceHash;
  const liveness = boundAnalysis ? checkSpokenLiveness(submission.liveness, audio, durationMs) : null;
  return {
    schemaVersion: "skarl.provenance.v1" as const,
    consentRecordId: consent?._id ?? null,
    licenseVersion: consent?.licenseVersion ?? null,
    licenseScope: consent?.scope ?? null,
    consentTimestamp: consent?.acknowledgedAt ?? null,
    consentEvidence: consent ? "stored_acknowledgement" as const : "missing" as const,
    contributorPseudonymousId: digest({ domain: "skarl.provenance.contributor.v1", organizationId: submission.organizationId,
      contributorTokenIdentifier: submission.contributorTokenIdentifier }),
    sourceSha256: verifiedSource ? original!.contentHash : null,
    sourceHashBasis: verifiedSource ? "verified_original" as const : "unavailable" as const,
    eas: attested ? { status: "confirmed" as const, uid: row.attestationUid!, ...attestationLinks(row.attestationUid!, row.txHash!) } :
      { status: "unavailable" as const, uid: null, easscanUrl: null, basescanUrl: null },
    liveness: { status: liveness?.status ?? "not_checked", basis: "derived_spoken_word_match" as const,
      evidence: liveness?.status === "passed" ? { startMs: liveness.evidence.startMs, endMs: liveness.evidence.endMs } : null },
    revocation: { status: consent ? consent.revocationStatus ?? "not_requested" as const : "consent_missing" as const,
      requestedAt: consent?.revocationRequestedAt ?? null, revokedAt: consent?.revokedAt ?? null },
    ...privacyFromObservations(video, durationMs),
  };
}
