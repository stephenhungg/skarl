import Ajv2020 from "ajv/dist/2020.js";
import schema from "../schemas/verification-report.schema.json" with { type: "json" };
// Cross-field conditions intentionally refine nested schemas. Base objects require fields.
const validateShape = new Ajv2020({ allErrors: true, strict: false }).compile<ReportShape>(schema);
const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export interface VerificationResult { valid: boolean; errors: string[] }
export interface VerificationTaskSpec { object: string; distractors: readonly string[]; target: string; steps: readonly string[]; narration?: readonly string[] }
interface ActionObservation { action: string; object: string; target: string; startMs: number; endMs: number; description: string }
interface ReportShape { submissionId: string; recommendation: string; pipeline: { version: string }; source: { durationMs: number }; duplicate: { matches: { submissionId: string; overlapMs: number }[] }; criteria: { criterionId: string; evidence: { modality: string; startMs: number; endMs: number }[] }[]; observations?: { video?: { observations: ActionObservation[] }; audio?: { claims: ActionObservation[]; segments: { startMs: number; endMs: number; text: string }[] } } }

// Python rejects strings that are not valid Unicode; keep both sides in agreement.
function hasLoneSurrogate(value: unknown): boolean {
  if (typeof value === "string") return loneSurrogate.test(value);
  if (Array.isArray(value)) return value.some(hasLoneSurrogate);
  if (value !== null && typeof value === "object") return Object.entries(value).some(([key, item]) => loneSurrogate.test(key) || hasLoneSurrogate(item));
  return false;
}

export function validateVerificationReport(value: unknown, taskSpec?: VerificationTaskSpec): VerificationResult {
  if (hasLoneSurrogate(value)) return { valid: false, errors: ["strings must be well-formed Unicode"] };
  if (!validateShape(value)) return { valid: false, errors: (validateShape.errors ?? []).map(e => `${e.instancePath}: ${e.message}`) };
  const report = value as ReportShape;
  const errors: string[] = [];
  const ids = new Set<string>();
  const accept = report.recommendation === "accept";
  for (const criterion of report.criteria) {
    if (ids.has(criterion.criterionId)) errors.push(`duplicate criterionId: ${criterion.criterionId}`);
    ids.add(criterion.criterionId);
    for (const evidence of criterion.evidence) {
      if (evidence.endMs < evidence.startMs) errors.push("evidence endMs precedes startMs");
      if (accept && evidence.endMs === evidence.startMs) errors.push("accept requires nonzero-length evidence");
      if (evidence.endMs > report.source.durationMs) errors.push("evidence exceeds source duration");
    }
  }
  for (const match of report.duplicate.matches) {
    if (match.submissionId.toLowerCase() === report.submissionId.toLowerCase()) errors.push("duplicate candidate references the source submission");
    if (match.overlapMs > report.source.durationMs) errors.push("duplicate overlap exceeds source duration");
  }
  const observations = [...(report.observations?.video?.observations ?? []), ...(report.observations?.audio?.claims ?? [])];
  const segments = report.observations?.audio?.segments ?? [];
  for (const item of [...observations, ...segments]) {
    if (item.endMs <= item.startMs) errors.push("observations require nonzero, ordered intervals");
    if (item.endMs > report.source.durationMs) errors.push("observation exceeds source duration");
  }
  if (observations.length) {
    // The order supplies this spec. Report text and narration never define allowed labels.
    const legacy = report.pipeline.version === "red-cup-evidence-1.2";
    const spec = legacy ? { object: "red_cup", distractors: ["blue_cup"], target: "coaster", steps: [] } : taskSpec;
    if (spec) {
      const objects = new Set([spec.object, ...spec.distractors, ...(legacy ? [] : ["other"]), "unknown"]);
      const targets = new Set([spec.target, "other", "unknown"]);
      for (const observation of observations) {
        if (!objects.has(observation.object)) errors.push(`object is not in the task spec: ${observation.object}`);
        if (!targets.has(observation.target)) errors.push(`target is not in the task spec: ${observation.target}`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

// Model output may invent criteria; call this with the task's rubric before persisting any report.
export function validateVerificationReportForRubric(value: unknown, rubricCriterionIds: readonly string[], taskSpec?: VerificationTaskSpec): VerificationResult {
  const result = validateVerificationReport(value, taskSpec);
  if (!result.valid) return result;
  const report = value as ReportShape;
  const rubric = new Set(rubricCriterionIds);
  const errors: string[] = [];
  if (!taskSpec && report.pipeline.version === "task-evidence-2.0" && ((report.observations?.video?.observations.length ?? 0) + (report.observations?.audio?.claims.length ?? 0) > 0)) errors.push("task-scoped observations require the order task spec");
  if (rubric.size === 0 || rubric.size !== rubricCriterionIds.length) errors.push("rubric criterion IDs must be nonempty and unique");
  const reported = new Set(report.criteria.map(criterion => criterion.criterionId));
  for (const id of reported) if (!rubric.has(id)) errors.push(`criterion is not in the task rubric: ${id}`);
  if (report.recommendation === "accept") for (const id of rubric) if (!reported.has(id)) errors.push(`accept requires every rubric criterion: ${id}`);
  return { valid: errors.length === 0, errors };
}
