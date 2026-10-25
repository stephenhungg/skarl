import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
const schema = JSON.parse(readFileSync(new URL("../schemas/verification-report.schema.json", import.meta.url), "utf8"));
// Cross-field conditions intentionally refine nested schemas. Base objects require fields.
const validateShape = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
export function validateVerificationReport(value: unknown): { valid: boolean; errors: string[] } {
  if (!validateShape(value)) return { valid: false, errors: (validateShape.errors ?? []).map(e => `${e.instancePath}: ${e.message}`) };
  const report = value as { submissionId: string; source: { durationMs: number }; duplicate: { matches: { submissionId: string; overlapMs: number }[] }; criteria: { criterionId: string; evidence: { modality: string; startMs: number; endMs: number }[] }[] };
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const criterion of report.criteria) {
    if (ids.has(criterion.criterionId)) errors.push(`duplicate criterionId: ${criterion.criterionId}`);
    ids.add(criterion.criterionId);
    for (const evidence of criterion.evidence) {
      if (evidence.endMs < evidence.startMs) errors.push("evidence endMs precedes startMs");
      if (evidence.modality !== "text" && evidence.endMs > report.source.durationMs) errors.push("evidence exceeds source duration");
    }
  }
  for (const match of report.duplicate.matches) {
    if (match.submissionId === report.submissionId) errors.push("duplicate candidate references the source submission");
    if (match.overlapMs > report.source.durationMs) errors.push("duplicate overlap exceeds source duration");
  }
  return { valid: errors.length === 0, errors };
}
