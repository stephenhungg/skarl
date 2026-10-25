import type { SpokenLivenessResult } from "./spokenLiveness";

/** A reproducible ranking heuristic over stored witnesses, never acceptance authority. */
export interface SampleQualityInput {
  status: string;
  durationMs: number | null;
  criterionIds: readonly string[];
  report: unknown;
  analysis?: { implementation: string; pipelineStatus: string; recommendation: string } | null;
  jury?: unknown;
  liveness?: SpokenLivenessResult | null;
  sensorSummary?: { source?: string; steadinessRatio?: number | null } | null;
  attested: boolean;
}

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value !== null && typeof value === "object" && !Array.isArray(value)
  ? value as ObjectValue : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const fraction = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const interval = (value: unknown, durationMs: number): value is { startMs: number; endMs: number } => {
  const row = object(value);
  return typeof row.startMs === "number" && typeof row.endMs === "number" &&
    Number.isSafeInteger(row.startMs) && Number.isSafeInteger(row.endMs) &&
    row.startMs >= 0 && row.endMs > row.startMs && row.endMs <= durationMs;
};
type ComponentStatus = "supported" | "partial" | "failed" | "missing" | "not_applicable";
const component = (score: number, maxScore: number, status: ComponentStatus, evidence: string) => ({ score, maxScore, status, evidence });

export function deriveSampleQuality(input: SampleQualityInput) {
  const report = object(input.report), pipeline = object(report.pipeline), duplicate = object(report.duplicate);
  const durationMs = typeof input.durationMs === "number" && Number.isSafeInteger(input.durationMs) && input.durationMs > 0 ? input.durationMs : null;
  const criterionIds = [...new Set(input.criterionIds)];
  const findings = list(report.criteria).map(object);
  const expectedFindings = criterionIds.map(criterionId => findings.filter(row => row.criterionId === criterionId));
  // A status without a valid interval is not a timestamped witness. Ignore unknown rubric IDs.
  const supported = expectedFindings.flatMap(rows => rows.length === 1 && rows[0]!.status === "supported"
    ? list(rows[0]!.evidence).filter(value => durationMs !== null && interval(value, durationMs))
      .filter(value => ["video", "audio", "text"].includes(String(object(value).modality))) : []);
  const allSupported = criterionIds.length > 0 && expectedFindings.every(rows => rows.length === 1 && rows[0]!.status === "supported" &&
    list(rows[0]!.evidence).some(value => durationMs !== null && interval(value, durationMs) &&
      ["video", "audio", "text"].includes(String(object(value).modality))));
  const jury = object(input.jury), judges = list(jury.judges).map(object);
  const models = judges.map(judge => judge.model);
  const juryAvailable = criterionIds.length > 0 && judges.length >= 2 && models.every(model => typeof model === "string" && !!model.trim()) &&
    new Set(models).size === models.length && judges.every(judge => {
      const judgeReport = object(judge.report), judgePipeline = object(judgeReport.pipeline);
      return !judge.failureCode && judgePipeline.implementation === "inference" && judgePipeline.status === "completed" &&
        typeof report.submissionId === "string" && !!report.submissionId && judgeReport.submissionId === report.submissionId &&
        typeof report.taskVersionId === "string" && !!report.taskVersionId && judgeReport.taskVersionId === report.taskVersionId &&
        typeof object(report.source).sha256 === "string" && !!object(report.source).sha256 &&
        object(judgeReport.source).sha256 === object(report.source).sha256 &&
        object(judgeReport.source).durationMs === object(report.source).durationMs && judgePipeline.version === pipeline.version &&
        criterionIds.every(id => {
          const rows = list(judgeReport.criteria).map(object).filter(row => row.criterionId === id);
          return rows.length === 1 && ["supported", "contradicted", "unobservable"].includes(String(rows[0]!.status));
        });
    }) && fraction(jury.agreementFraction);
  const agreedCriteria = juryAvailable ? criterionIds.filter(id => {
    const statuses = judges.map(judge => list(object(judge.report).criteria).map(object).find(row => row.criterionId === id)!.status);
    return statuses.every(status => status === statuses[0]);
  }).length : 0;
  // Stored summary and underlying reports must agree; unavailable fallback reports never vote.
  const juryFraction = juryAvailable ? Math.min(agreedCriteria / criterionIds.length, jury.agreementFraction as number) : null;
  const duplicateClear = duplicate.status === "clear" && Array.isArray(duplicate.matches) && duplicate.matches.length === 0;
  const live = input.liveness?.status === "passed" && durationMs !== null && interval(input.liveness.evidence, durationMs);
  const steadiness = input.sensorSummary?.source === "clientReported" && fraction(input.sensorSummary.steadinessRatio)
    ? input.sensorSummary.steadinessRatio : null;
  const components = {
    juryAgreement: component(juryFraction === null ? 0 : Math.round(25 * juryFraction), 25,
      juryFraction === null ? "missing" : juryFraction === 1 ? "supported" : juryFraction === 0 ? "failed" : "partial",
      juryFraction === null ? "No complete, distinct-model jury with a valid agreement result."
        : `${agreedCriteria}/${criterionIds.length} rubric criteria agree across ${judges.length} stored model reports; conservative agreement fraction ${juryFraction}.`),
    allCriteriaSupported: component(allSupported ? 25 : 0, 25, allSupported ? "supported" : "failed",
      allSupported ? `All ${criterionIds.length} rubric criteria have supported findings and valid timestamped evidence.`
        : "At least one rubric criterion lacks a unique supported finding with valid timestamped evidence."),
    duplicateClear: component(duplicateClear ? 20 : 0, 20, duplicateClear ? "supported" : duplicate.status === "suspected" ? "failed" : "missing",
      duplicateClear ? "Stored heuristic duplicate check is clear with no matches; this is not proof of uniqueness."
        : `Duplicate check is ${typeof duplicate.status === "string" ? duplicate.status : "unavailable"}; no clear-check credit.`),
    livenessPassed: component(live ? 15 : 0, 15, live ? "supported" : input.liveness ? "failed" : "missing",
      live ? "Issued spoken challenge matched timestamped transcript segments; this is not identity verification."
        : `Spoken liveness has no valid pass (${input.liveness?.status ?? "unavailable"}).`),
    sensorSteadiness: component(steadiness === null ? 0 : Math.round(5 * steadiness), 5,
      !input.sensorSummary ? "not_applicable" : steadiness === null ? "missing" : steadiness === 1 ? "supported" : "partial",
      !input.sensorSummary ? "No sensor trace; no steadiness credit and no weight redistribution."
        : steadiness === null ? "Attached sensor summary has no valid client-reported steadiness ratio."
          : `Client-reported steady gyroscope sample ratio ${steadiness}; heuristic camera stability, not task success.`),
    attestationPresent: component(input.attested ? 10 : 0, 10, input.attested ? "supported" : "missing",
      input.attested ? "Confirmed, source/report-bound attestation is present; it commits to the report, not its truth."
        : "No confirmed, source/report-bound attestation."),
  };
  const capReasons: string[] = [];
  if (input.status !== "accepted") capReasons.push("submission_not_accepted");
  if (pipeline.implementation !== "inference" || pipeline.status !== "completed" || report.recommendation !== "accept" ||
    !input.analysis || input.analysis.implementation !== "inference" || input.analysis.pipelineStatus !== "completed" || input.analysis.recommendation !== "accept") {
    capReasons.push("completed_accept_inference_required");
  }
  if (!duplicateClear) capReasons.push("duplicate_clear_required");
  if (!allSupported) capReasons.push("all_criteria_evidence_required");
  if (juryFraction !== null && juryFraction < 1) capReasons.push("jury_disagreement");
  const rawQualityScore = Object.values(components).reduce((sum, row) => sum + row.score, 0);
  const scoreCap = capReasons.length ? 49 : null;
  const intervals = supported.map(value => object(value) as { startMs: number; endMs: number });
  const paddingMs = 500;
  const usableStartMs = intervals.length ? Math.max(0, Math.min(...intervals.map(row => row.startMs)) - paddingMs) : null;
  const usableEndMs = intervals.length ? Math.min(durationMs!, Math.max(...intervals.map(row => row.endMs)) + paddingMs) : null;
  return { method: "skarl.quality.heuristic.v1" as const,
    qualityScore: scoreCap === null ? rawQualityScore : Math.min(rawQualityScore, scoreCap), rawQualityScore, scoreCap, capReasons, components,
    usableStartMs, usableEndMs,
    segment: { method: "supported_criterion_bounds" as const, paddingMs, evidenceCount: intervals.length,
      durationSource: "supplied_stored_duration" as const, contiguousActionGuarantee: false as const } };
}
