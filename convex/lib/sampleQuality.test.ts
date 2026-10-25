import { describe, expect, it } from "vitest";
import { deriveSampleQuality, type SampleQualityInput } from "./sampleQuality";
import type { VerificationReport } from "./verificationReport";

// Synthetic stored evidence only; these tests do not run inference or attestations.
const criterionIds = ["pickup", "place"];
function report(): VerificationReport {
  return { schemaVersion: "1.0", reportId: "synthetic", submissionId: "sample", taskVersionId: "rubric",
    source: { sha256: "a".repeat(64), durationMs: 10000 },
    pipeline: { version: "synthetic-v1", status: "completed", implementation: "inference", modelRuns: [] },
    criteria: criterionIds.map((criterionId, index) => ({ criterionId, status: "supported", reason: "Synthetic finding",
      evidence: [{ modality: "video", startMs: 1000 + index * 4000, endMs: 2000 + index * 4000, claim: "Synthetic evidence" }] })),
    duplicate: { status: "clear", matches: [] }, recommendation: "accept", warnings: [] };
}
function fixture(): SampleQualityInput {
  return { status: "accepted", durationMs: 10000, criterionIds, report: report(),
    analysis: { implementation: "inference", pipelineStatus: "completed", recommendation: "accept" },
    jury: { advisoryOnly: true, agreementFraction: 1, disagreedCriteria: [], judges: [
      { model: "synthetic-model-a", report: report() }, { model: "synthetic-model-b", report: report() },
    ] },
    liveness: { status: "passed", evidence: { modality: "audio", startMs: 50, endMs: 500, claim: "Synthetic challenge match" } },
    sensorSummary: { source: "clientReported", steadinessRatio: 1 }, attested: true };
}

describe("deterministic sample quality over stored witnesses", () => {
  it("makes each heuristic point accountable and derives a padded segment without inventing action labels", () => {
    const input = fixture(), quality = deriveSampleQuality(input);
    expect(quality).toMatchObject({ method: "skarl.quality.heuristic.v1", qualityScore: 100, rawQualityScore: 100,
      scoreCap: null, capReasons: [], usableStartMs: 500, usableEndMs: 6500,
      segment: { paddingMs: 500, evidenceCount: 2, contiguousActionGuarantee: false } });
    expect(Object.values(quality.components).map(row => row.score)).toEqual([25, 25, 20, 15, 5, 10]);
    expect(deriveSampleQuality(input)).toEqual(quality);
  });

  it("clamps padding to recorded duration and ignores contradicted, invalid, duplicate and off-rubric findings", () => {
    const input = fixture(), stored = report();
    stored.criteria[0]!.evidence = [{ modality: "video", startMs: 100, endMs: 200, claim: "Synthetic start" }];
    stored.criteria[1]!.evidence = [{ modality: "video", startMs: 9000, endMs: 9900, claim: "Synthetic end" },
      { modality: "video", startMs: -1000, endMs: 50000, claim: "Invalid interval must not expand segment" }];
    stored.criteria.push({ criterionId: "unknown", status: "supported", reason: "Not ordered",
      evidence: [{ modality: "video", startMs: 0, endMs: 10000, claim: "Outside frozen rubric" }] });
    input.report = stored;
    expect(deriveSampleQuality(input)).toMatchObject({ usableStartMs: 0, usableEndMs: 10000, segment: { evidenceCount: 2 } });
    stored.criteria[0]!.status = "contradicted";
    expect(deriveSampleQuality(input)).toMatchObject({ usableStartMs: 8500, usableEndMs: 10000, segment: { evidenceCount: 1 } });
    stored.criteria.push({ ...stored.criteria[1]! });
    expect(deriveSampleQuality(input)).toMatchObject({ usableStartMs: null, usableEndMs: null, qualityScore: 49,
      capReasons: ["all_criteria_evidence_required"] });
  });

  it.each(["needs_review", "rejected", "queued"])("caps %s even when other witnesses are positive because quality cannot promote an unaccepted sample", status => {
    const quality = deriveSampleQuality({ ...fixture(), status });
    expect(quality.qualityScore).toBe(49);
    expect(quality.capReasons).toContain("submission_not_accepted");
  });

  it.each(["suspected", "not_checked"] as const)("caps a %s duplicate check because auxiliary witnesses cannot erase copy uncertainty", status => {
    const stored = report(); stored.duplicate.status = status;
    const quality = deriveSampleQuality({ ...fixture(), report: stored });
    expect(quality.qualityScore).toBe(49);
    expect(quality.components.duplicateClear.score).toBe(0);
    expect(quality.capReasons).toContain("duplicate_clear_required");
  });

  it("does not call a clear flag with candidate matches clear, because the evidence contradicts the summary", () => {
    const stored = report(); stored.duplicate.matches.push({ submissionId: "other", score: 1, overlapMs: 2000 });
    expect(deriveSampleQuality({ ...fixture(), report: stored })).toMatchObject({ qualityScore: 49,
      components: { duplicateClear: { score: 0 } }, capReasons: ["duplicate_clear_required"] });
  });

  it.each([
    { implementation: "scaffold", pipelineStatus: "completed", recommendation: "accept" },
    { implementation: "inference", pipelineStatus: "needs_review", recommendation: "needs_review" },
    { implementation: "inference", pipelineStatus: "failed", recommendation: "accept" },
    { implementation: "inference", pipelineStatus: "completed", recommendation: "request_correction" },
  ])("caps unavailable or review-required analysis instead of treating acceptance as proof of inference: %j", analysis => {
    expect(deriveSampleQuality({ ...fixture(), analysis })).toMatchObject({ qualityScore: 49,
      capReasons: ["completed_accept_inference_required"] });
  });

  it("also caps human-accepted review-required reports, because a human decision does not rewrite model uncertainty", () => {
    const stored = report(); stored.recommendation = "needs_review"; stored.pipeline.status = "needs_review";
    expect(deriveSampleQuality({ ...fixture(), report: stored })).toMatchObject({ qualityScore: 49,
      capReasons: ["completed_accept_inference_required"] });
  });

  it("recomputes jury agreement from distinct available reports rather than trusting a summary fraction", () => {
    const first = report(), second = report(); second.criteria[0]!.status = "contradicted";
    const input = fixture(); input.jury = { agreementFraction: 1, judges: [
      { model: "synthetic-a", report: first }, { model: "synthetic-b", report: second },
    ] };
    expect(deriveSampleQuality(input)).toMatchObject({ qualityScore: 49, rawQualityScore: 88,
      components: { juryAgreement: { score: 13, status: "partial" } }, capReasons: ["jury_disagreement"] });
    input.jury = { agreementFraction: 1, judges: [
      { model: "same-model", report: first }, { model: "same-model", report: first },
    ] };
    expect(deriveSampleQuality(input).components.juryAgreement).toMatchObject({ score: 0, status: "missing" });
    input.jury = { agreementFraction: 1, judges: [
      { model: "synthetic-a", report: first }, { model: "synthetic-b", failureCode: "timeout", report: first },
    ] };
    expect(deriveSampleQuality(input).components.juryAgreement).toMatchObject({ score: 0, status: "missing" });
  });

  it.each(["submissionId", "taskVersionId", "sha256", "pipelineVersion"])("does not borrow a jury from another %s binding", binding => {
    const foreign = report();
    if (binding === "submissionId") foreign.submissionId = "another-sample";
    if (binding === "taskVersionId") foreign.taskVersionId = "another-rubric";
    if (binding === "sha256") foreign.source.sha256 = "b".repeat(64);
    if (binding === "pipelineVersion") foreign.pipeline.version = "another-pipeline";
    const quality = deriveSampleQuality({ ...fixture(), jury: { agreementFraction: 1, judges: [
      { model: "synthetic-a", report: report() }, { model: "synthetic-b", report: foreign },
    ] } });
    expect(quality.components.juryAgreement).toMatchObject({ score: 0, status: "missing" });
  });

  it("keeps absent optional sensor evidence explicit without inflating the remaining component weights", () => {
    const input = fixture(); delete input.sensorSummary;
    expect(deriveSampleQuality(input)).toMatchObject({ qualityScore: 95,
      components: { sensorSteadiness: { score: 0, maxScore: 5, status: "not_applicable" } } });
    for (const ratio of [NaN, Infinity, -0.1, 1.1, null]) {
      expect(deriveSampleQuality({ ...input, sensorSummary: { source: "clientReported", steadinessRatio: ratio } })
        .components.sensorSteadiness).toMatchObject({ score: 0, status: "missing" });
    }
  });

  it("returns no segment and no fabricated credits when stored evidence is absent or malformed", () => {
    const quality = deriveSampleQuality({ status: "needs_review", durationMs: null, criterionIds, report: null, attested: false });
    expect(quality).toMatchObject({ qualityScore: 0, rawQualityScore: 0, usableStartMs: null, usableEndMs: null });
    expect(Object.values(quality.components).every(row => row.score === 0)).toBe(true);
    expect(deriveSampleQuality({ ...fixture(), durationMs: 0 }).usableStartMs).toBeNull();
    expect(deriveSampleQuality({ ...fixture(), report: { criteria: "garbage", duplicate: null, pipeline: [] } }))
      .toMatchObject({ qualityScore: 30, usableStartMs: null, usableEndMs: null,
        components: { juryAgreement: { score: 0 }, allCriteriaSupported: { score: 0 }, duplicateClear: { score: 0 } } });
  });
});
