/** Readers for untrusted stored model output and client-reported sensor data. */
export type EvidenceRange = { startMs: number; endMs: number; claim: string; modality: string };
export type CriterionEvidence = { criterionId: string; status: string; reason: string; evidence: EvidenceRange[] };
export type JudgeEvidence = { model: string; version: string; failure: string; criteria: CriterionEvidence[] };
export type MotionPoint = { tMs: number; magnitude: number | null };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === "string" ? value.slice(0, 2000) : "";
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function criteria(value: unknown): CriterionEvidence[] {
  return array(value).slice(0, 100).map(item => {
    const row = object(item);
    return { criterionId: text(row.criterionId), status: text(row.status) || "unobservable", reason: text(row.reason),
      evidence: array(row.evidence).slice(0, 100).flatMap(item => {
        const evidence = object(item);
        return finite(evidence.startMs) && finite(evidence.endMs) && evidence.startMs >= 0 && evidence.endMs >= evidence.startMs && evidence.endMs <= 31_000
          ? [{ startMs: evidence.startMs, endMs: evidence.endMs, claim: text(evidence.claim), modality: text(evidence.modality) }] : [];
      }) };
  }).filter(row => row.criterionId);
}

export function readJudges(reportValue: unknown, observationsValue: unknown): JudgeEvidence[] {
  const report = object(reportValue), jury = object(object(observationsValue).jury);
  const rows = array(jury.judges).slice(0, 16);
  if (rows.length) return rows.map(item => {
    const judge = object(item), judgeReport = object(judge.report), pipeline = object(judgeReport.pipeline);
    const unavailable = !!judge.failureCode || pipeline.implementation !== "inference" || !["completed", "needs_review"].includes(text(pipeline.status));
    return { model: text(judge.model) || "Model not recorded", version: text(pipeline.version) || "Version not recorded",
      failure: text(judge.failureCode) || (unavailable ? "Inference unavailable" : ""), criteria: unavailable ? [] : criteria(judgeReport.criteria) };
  });
  const pipeline = object(report.pipeline);
  if (pipeline.implementation !== "inference" || !["completed", "needs_review"].includes(text(pipeline.status))) return [];
  const visual = array(pipeline.modelRuns).map(object).filter(run => run.promptVersion === "timestamped-frames-visible-events-v1");
  return [{ model: visual.map(run => text(run.model)).filter(Boolean).join(", ") || "Visual model not recorded",
    version: text(pipeline.version) || "Version not recorded", failure: "", criteria: criteria(report.criteria) }];
}

/** 100 ms mean vector magnitude, derived in-browser; gaps stay null. Units are unchanged. */
export function motionMagnitudes(value: unknown, sensor: "gyroscope" | "accelerometer", durationMs: number): MotionPoint[] {
  if (!finite(durationMs) || durationMs <= 0 || durationMs > 31_000) return [];
  const samples = array(object(value).samples);
  if (samples.length > 31_000) throw new Error("Sensor trace exceeds its sample limit.");
  const bins = Array.from({ length: Math.ceil(durationMs / 100) + 1 }, () => ({ count: 0, sum: 0 }));
  for (const value of samples) {
    const sample = object(value);
    if (sample.sensor !== sensor || !finite(sample.timestampMs) || sample.timestampMs < 0 || sample.timestampMs > durationMs ||
      !finite(sample.x) || !finite(sample.y) || !finite(sample.z) || Math.max(Math.abs(sample.x), Math.abs(sample.y), Math.abs(sample.z)) > 10_000) continue;
    const bin = bins[Math.min(bins.length - 1, Math.floor(sample.timestampMs / 100))]!;
    bin.sum += Math.hypot(sample.x, sample.y, sample.z); bin.count++;
  }
  return bins.map((bin, index) => ({ tMs: Math.min(durationMs, index * 100), magnitude: bin.count ? bin.sum / bin.count : null }));
}
