import { test } from "vitest";
import assert from "node:assert/strict";
import { motionMagnitudes, readJudges } from "./evidence.ts";

const report = { pipeline: { implementation: "inference", status: "completed", version: "test-v1" }, criteria: [{ criterionId: "pickup", status: "supported", reason: "visible", evidence: [{ startMs: 100, endMs: 250, claim: "Cup rises", modality: "video" }] }] };

test("unavailable or scaffold jury output cannot display supporting evidence", () => {
  const judges = readJudges(null, { jury: { judges: [
    { model: "failed-model", failureCode: "timeout", report },
    { model: "scaffold-model", report: { ...report, pipeline: { ...report.pipeline, implementation: "scaffold" } } },
  ] } });
  assert.equal(judges.length, 2);
  assert.ok(judges.every(judge => judge.failure && judge.criteria.length === 0));
  assert.deepEqual(readJudges({ ...report, pipeline: { implementation: "scaffold", status: "completed" } }, null), []);
});

test("criterion timestamps are read only when finite, ordered and in clip limits", () => {
  const judges = readJudges(null, { jury: { judges: [{ model: "test-model", report: { ...report, criteria: [{ ...report.criteria[0], evidence: [
    ...report.criteria[0]!.evidence, { startMs: 300, endMs: 100 }, { startMs: NaN, endMs: 900 }, { startMs: 0, endMs: 99_999 },
  ] }] } }] } });
  assert.deepEqual(judges[0]!.criteria[0]!.evidence, report.criteria[0]!.evidence);
  assert.equal(judges[0]!.model, "test-model");
  assert.equal(judges[0]!.version, "test-v1");
});

test("motion magnitude preserves raw units and missing bins without inferred values", () => {
  const points = motionMagnitudes({ samples: [
    { sensor: "gyroscope", timestampMs: 20, x: 3, y: 4, z: 0 },
    { sensor: "gyroscope", timestampMs: 40, x: 0, y: 0, z: 1 },
    { sensor: "accelerometer", timestampMs: 130, x: 9, y: 0, z: 0 },
    { sensor: "gyroscope", timestampMs: 230, x: NaN, y: 0, z: 0 },
    { sensor: "gyroscope", timestampMs: -1, x: 9, y: 0, z: 0 },
  ] }, "gyroscope", 300);
  assert.deepEqual(points, [{ tMs: 0, magnitude: 3 }, { tMs: 100, magnitude: null }, { tMs: 200, magnitude: null }, { tMs: 300, magnitude: null }]);
  assert.deepEqual(motionMagnitudes(null, "accelerometer", 300), [{ tMs: 0, magnitude: null }, { tMs: 100, magnitude: null }, { tMs: 200, magnitude: null }, { tMs: 300, magnitude: null }]);
});
