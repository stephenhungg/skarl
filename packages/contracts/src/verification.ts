import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
const schema = JSON.parse(readFileSync(new URL("../schemas/verification-report.schema.json", import.meta.url), "utf8"));
// Cross-field conditions intentionally refine nested schemas. Base objects require fields.
const validateShape = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export interface VerificationResult { valid: boolean; errors: string[] }
interface ReportShape { submissionId: string; recommendation: string; source: { durationMs: number }; duplicate: { matches: { submissionId: string; overlapMs: number }[] }; criteria: { criterionId: string; evidence: { modality: string; startMs: number; endMs: number }[] }[] }

// Python rejects strings that are not valid Unicode; keep both sides in agreement.
function hasLoneSurrogate(value: unknown): boolean {
  if (typeof value === "string") return loneSurrogate.test(value);
  if (Array.isArray(value)) return value.some(hasLoneSurrogate);
  if (value !== null && typeof value === "object") return Object.entries(value).some(([key, item]) => loneSurrogate.test(key) || hasLoneSurrogate(item));
  return false;
}

export function validateVerificationReport(value: unknown): VerificationResult {
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
  return { valid: errors.length === 0, errors };
}

// Model output may invent criteria; call this with the task's rubric before persisting any report.
export function validateVerificationReportForRubric(value: unknown, rubricCriterionIds: readonly string[]): VerificationResult {
  const result = validateVerificationReport(value);
  if (!result.valid) return result;
  const report = value as ReportShape;
  const rubric = new Set(rubricCriterionIds);
  const errors: string[] = [];
  if (rubric.size === 0 || rubric.size !== rubricCriterionIds.length) errors.push("rubric criterion IDs must be nonempty and unique");
  const reported = new Set(report.criteria.map(criterion => criterion.criterionId));
  for (const id of reported) if (!rubric.has(id)) errors.push(`criterion is not in the task rubric: ${id}`);
  if (report.recommendation === "accept") for (const id of rubric) if (!reported.has(id)) errors.push(`accept requires every rubric criterion: ${id}`);
  return { valid: errors.length === 0, errors };
}
