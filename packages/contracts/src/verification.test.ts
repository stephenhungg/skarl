import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateVerificationReport, validateVerificationReportForRubric } from "./verification.ts";
const report = () => ({ schemaVersion: "1.0", reportId: "r1", submissionId: "s1", taskVersionId: "t1", source: { sha256: "a".repeat(64), durationMs: 1000 }, pipeline: { version: "v1", status: "completed", implementation: "inference", modelRuns: [{ provider: "fixture", model: "test", promptVersion: "v1" }] }, criteria: [{ criterionId: "c1", status: "supported", evidence: [{ modality: "video", startMs: 0, endMs: 500, claim: "fixture evidence" }], reason: "fixture only" }], duplicate: { status: "clear", matches: [] }, recommendation: "accept" });
test("validates an evidence-bearing inference report", () => assert.equal(validateVerificationReport(report()).valid, true));
test("scaffold and failed pipelines cannot recommend acceptance", () => {
  for (const value of [ { ...report(), pipeline: { ...report().pipeline, implementation: "scaffold" } }, { ...report(), pipeline: { ...report().pipeline, status: "failed" } }, { ...report(), criteria: [] }, { ...report(), pipeline: { ...report().pipeline, modelRuns: [] } } ]) assert.equal(validateVerificationReport(value).valid, false);
});
test("rejects invalid evidence ranges and unknown fields", () => {
  const value = report(); value.criteria[0].evidence[0].endMs = 1001;
  assert.equal(validateVerificationReport(value).valid, false);
  value.criteria[0].evidence[0].startMs = 600;
  value.criteria[0].evidence[0].endMs = 500;
  assert.deepEqual(validateVerificationReport(value).errors, ["evidence endMs precedes startMs"]);
  assert.equal(validateVerificationReport({ ...report(), confidence: 1 }).valid, false);
});
test("unavailable scaffold report stays review-only", () => assert.equal(validateVerificationReport({ ...report(), pipeline: { version: "scaffold", status: "ml_unavailable", implementation: "scaffold", modelRuns: [] }, criteria: [], duplicate: { status: "not_checked", matches: [] }, recommendation: "needs_review" }).valid, true));

test("accepts the Python scaffold example against the same contract", () => {
  const example = JSON.parse(readFileSync(new URL("../../../services/verifier/examples/scaffold-report.json", import.meta.url), "utf8"));
  assert.equal(validateVerificationReport(example).valid, true);
});
test("rejects duplicate criterion identity and impossible copy matches", () => {
  const value = report();
  value.criteria.push(value.criteria[0]);
  assert.equal(validateVerificationReport(value).valid, false);
  for (const match of [ { submissionId: "s1", score: 1, overlapMs: 500 }, { submissionId: "other", score: 1, overlapMs: 1001 } ]) {
    const review = { ...report(), recommendation: "needs_review", duplicate: { status: "suspected", matches: [match] } };
    assert.equal(validateVerificationReport(review).valid, false);
  }
});

test("JavaScript-only values outside JSON are rejected", () => {
  const value = report(); value.source.durationMs = Infinity; value.criteria[0].evidence[0].endMs = Infinity;
  assert.equal(validateVerificationReport(value).valid, false);
});

// Shared with services/verifier/tests/test_shared_cases.py so the two validators cannot drift.
const cases = JSON.parse(readFileSync(new URL("../schemas/fixtures/verification-cases.json", import.meta.url), "utf8"));
function withChanges(base: unknown, changes: Record<string, unknown> = {}) {
  const value = structuredClone(base) as Record<string, unknown>;
  for (const [path, replacement] of Object.entries(changes)) {
    const keys = path.split(".");
    let target = value as Record<string, unknown>;
    for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
    target[keys.at(-1)!] = replacement;
  }
  return value;
}
for (const item of cases.cases) {
  test(`shared case: ${item.name}`, () => {
    const value = withChanges(cases.bases[item.base], item.set);
    const result = item.rubric ? validateVerificationReportForRubric(value, item.rubric) : validateVerificationReport(value);
    assert.equal(result.valid, item.valid, JSON.stringify(result.errors));
  });
}
