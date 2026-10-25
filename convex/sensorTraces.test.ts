import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { MAX_SENSOR_TRACE_BYTES, summarizeMotion, validateSensorTrace } from "./lib/sensorTrace";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const trace = () => ({ version: 1, sampleRateHz: 50, durationMs: 1000, recordedAt: "2026-10-25T10:30:00.000Z",
  clock: "js-callback-performance-now", sensors: ["accelerometer", "gyroscope", "deviceMotion"],
  device: { model: "Synthetic iPhone", os: "iOS", osVersion: "26", appVersion: "1.0.0", cameraFacing: "back", requestedVideoQuality: "720p" },
  samples: [
    { sensor: "accelerometer", timestampMs: 0, x: 0, y: 0, z: 1 },
    { sensor: "gyroscope", timestampMs: 0, x: 0, y: 0, z: 0 },
    { sensor: "deviceMotion", timestampMs: 0, x: 0, y: 0, z: 0 },
    { sensor: "accelerometer", timestampMs: 250, x: 0, y: 0, z: 2 },
    { sensor: "gyroscope", timestampMs: 250, x: 0, y: 0, z: 2 },
    { sensor: "deviceMotion", timestampMs: 500, x: 0, y: 0, z: 3 },
  ] });

// Synthetic storage only. Never calls a model, device sensor, or chain.
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
async function setup() {
  const t = convexTest(schema, modules), seeded = await t.mutation(internal.seed.demo, {});
  const video = await t.run(ctx => ctx.storage.store(new Blob(["synthetic"], { type: "video/mp4" })));
  const { submissionId } = await t.mutation(api.submissions.create, { demoIdentity: "contributor", orderId: seeded.orderId,
    storageId: video, clientRequestId: "sensor-fixture", consentAcknowledged: true });
  const storageId = await t.run(ctx => ctx.storage.store(new Blob([JSON.stringify(trace())], { type: "application/json" })));
  return { t, ...seeded, submissionId, storageId, args: { demoIdentity: "contributor", submissionId, storageId } };
}

describe("sensor trace validation and untrusted motion summary", () => {
  it("computes RMS magnitudes with gravity-aware activity, plot bins, and missing channels as null", () => {
    const summary = summarizeMotion(validateSensorTrace(trace()));
    expect(summary.accelRmsG).toBeCloseTo(Math.sqrt(2.5));
    expect(summary.gyroRmsRadPerSec).toBeCloseTo(Math.sqrt(2));
    expect(summary.linearAccelerationRmsMps2).toBeCloseTo(Math.sqrt(4.5));
    expect(summary.activeMotionIntervals).toEqual([{ startMs: 250, endMs: 750 }]);
    expect(summary.bins[0]?.active).toBe(false);
    expect(summary.bins[3]).toMatchObject({ sampleCount: 0, accelRmsG: null, gyroRmsRadPerSec: null, linearAccelerationRmsMps2: null });
    const empty = summarizeMotion(validateSensorTrace({ ...trace(), sensors: [], samples: [] }));
    expect(empty).toMatchObject({ source: "clientReported", accelRmsG: null, gyroRmsRadPerSec: null, activeMotionIntervals: [] });
  });
  it("rejects malformed, nonfinite, nonmonotonic, out-of-range, excessive-rate and unexpected private fields", () => {
    const valid = trace();
    const invalid = [null, [], { ...valid, sampleRateHz: 1000 }, { ...valid, sampleRateHz: NaN }, { ...valid, durationMs: 31_001 },
      { ...valid, recordedAt: "not-a-date" }, { ...valid, recordedAt: "2026-02-30T10:30:00.000Z" },
      { ...valid, clock: "hardware-verified" }, { ...valid, location: { lat: 1 } },
      { ...valid, sensors: ["accelerometer", "accelerometer"] }, { ...valid, sensors: ["magnetometer"] },
      { ...valid, sensors: [] }, { ...valid, samples: [] },
      { ...valid, device: { ...valid.device, location: "private" } },
      ...[{ timestampMs: -1 }, { timestampMs: 1001 }, { x: Infinity }, { z: NaN }, { x: 10_001 }, { sensor: "unknown" }]
        .map(patch => ({ ...valid, samples: [{ ...valid.samples[0], ...patch }] })),
      { ...valid, samples: [valid.samples[0], valid.samples[0]] },
      { ...valid, samples: [valid.samples[3], valid.samples[0]] },
      { ...valid, samples: [valid.samples[0], valid.samples[3], valid.samples[1], valid.samples[2], valid.samples[4], valid.samples[5]] },
      { ...valid, sensors: ["accelerometer"], samples: Array.from({ length: 201 }, (_, timestampMs) => ({ ...valid.samples[0], timestampMs })) },
    ];
    for (const input of invalid) expect(() => validateSensorTrace(input)).toThrow("invalid_sensor_trace");
  });
});

describe("private sensor attachment", () => {
  it("reads stored JSON, attaches once, exposes bounded evidence to owner/controller, and never accepts or pays", async () => {
    const f = await setup();
    expect(await f.t.action(api.sensorTraces.attachSensorTrace, f.args)).toEqual({ submissionId: f.submissionId, replayed: false });
    expect(await f.t.action(api.sensorTraces.attachSensorTrace, f.args)).toEqual({ submissionId: f.submissionId, replayed: true });
    for (const demoIdentity of ["contributor", "controller"]) {
      const evidence = await f.t.query(api.media.submissionEvidence, { demoIdentity, submissionId: f.submissionId });
      expect(evidence.sensorTrace).toMatchObject({ storageId: f.storageId, sampleCount: 6, sampleRateHz: 50, durationMs: 1000,
        motionSummary: { source: "clientReported", activeMotionIntervals: [{ startMs: 250, endMs: 750 }] } });
      expect(evidence.sensorTrace?.url).toMatch(/^https?:/);
    }
    for (const demoIdentity of ["buyer", "finance-agent"]) {
      await expect(f.t.query(api.media.submissionEvidence, { demoIdentity, submissionId: f.submissionId })).rejects.toThrow("forbidden");
    }
    const state = await f.t.run(async ctx => ({ submission: await ctx.db.get(f.submissionId), payables: await ctx.db.query("payables").collect(),
      audits: await ctx.db.query("auditEvents").collect(), decisions: await ctx.db.query("reviewDecisions").collect() }));
    expect(state.submission?.status).toBe("queued");
    expect(state.payables).toHaveLength(0); expect(state.decisions).toHaveLength(0);
    expect(state.audits.filter(row => row.action === "sensor_trace_attached")).toHaveLength(1);
    const other = await f.t.run(ctx => ctx.storage.store(new Blob([JSON.stringify(trace())], { type: "application/json" })));
    await expect(f.t.action(api.sensorTraces.attachSensorTrace, { ...f.args, storageId: other })).rejects.toThrow("sensor_trace_already_attached");
  });
  it("rejects wrong role, foreign contributor, foreign tenant and missing consent before reading the blob", async () => {
    const f = await setup();
    await expect(f.t.action(api.sensorTraces.attachSensorTrace, { ...f.args, demoIdentity: "controller" })).rejects.toThrow("forbidden");
    await f.t.run(ctx => ctx.db.patch(f.submissionId, { contributorTokenIdentifier: "demo:other-contributor" }));
    await expect(f.t.action(api.sensorTraces.attachSensorTrace, f.args)).rejects.toThrow("submission_not_owned");
    await f.t.run(ctx => ctx.db.patch(f.submissionId, { contributorTokenIdentifier: "demo:skarl:contributor", consentRecordId: undefined }));
    await expect(f.t.action(api.sensorTraces.attachSensorTrace, f.args)).rejects.toThrow("consent_required");
    await f.t.run(async ctx => { const organizationId = await ctx.db.insert("organizations", { name: "Foreign", status: "active", createdByTokenIdentifier: "foreign" });
      await ctx.db.patch(f.submissionId, { organizationId }); });
    await expect(f.t.action(api.sensorTraces.attachSensorTrace, f.args)).rejects.toThrow("cross_organization_access");
  });
  it("rejects oversize files, unsupported MIME, invalid JSON and invalid trace before persistence", async () => {
    const f = await setup();
    for (const [content, type, error] of [["x".repeat(MAX_SENSOR_TRACE_BYTES + 1), "application/json", "sensor_trace_size_invalid"],
      [JSON.stringify(trace()), "text/plain", "sensor_trace_type_invalid"], ["{bad", "application/json", "invalid_sensor_trace"],
      [JSON.stringify({ ...trace(), sampleRateHz: 1000 }), "application/json", "invalid_sensor_trace"]]) {
      const storageId = await f.t.run(ctx => ctx.storage.store(new Blob([content!], { type })));
      await expect(f.t.action(api.sensorTraces.attachSensorTrace, { ...f.args, storageId })).rejects.toThrow(error!);
    }
    expect((await f.t.run(ctx => ctx.db.get(f.submissionId)))?.sensorTrace).toBeUndefined();
  });
  it("rechecks ownership at the write boundary and freezes attachments after terminal review", async () => {
    const f = await setup(), validated = validateSensorTrace(trace());
    const metadata = await f.t.query(internal.sensorTraces.authorize, f.args);
    const args = { ...f.args, trace: { storageId: f.storageId, sampleRateHz: validated.sampleRateHz, sampleCount: validated.samples.length,
      durationMs: validated.durationMs, sensors: validated.sensors, device: validated.device, recordedAt: validated.recordedAt,
      clock: validated.clock, sizeBytes: metadata.sizeBytes, attachedAt: Date.now(), motionSummary: summarizeMotion(validated) } };
    await f.t.run(ctx => ctx.db.patch(f.submissionId, { contributorTokenIdentifier: "demo:other" }));
    await expect(f.t.mutation(internal.sensorTraces.attachValidated, args)).rejects.toThrow("submission_not_owned");
    await f.t.run(ctx => ctx.db.patch(f.submissionId, { contributorTokenIdentifier: "demo:skarl:contributor", status: "accepted" }));
    await expect(f.t.action(api.sensorTraces.attachSensorTrace, f.args)).rejects.toThrow("submission_evidence_closed");
  });
  it("does not permit the same stored trace to be rebound to another submission", async () => {
    const f = await setup();
    await f.t.action(api.sensorTraces.attachSensorTrace, f.args);
    const otherId = await f.t.run(async ctx => { const source = (await ctx.db.get(f.submissionId))!;
      const { _id, _creationTime, sensorTrace, ...fields } = source;
      return ctx.db.insert("submissions", { ...fields, clientRequestId: "second-synthetic" }); });
    await expect(f.t.action(api.sensorTraces.attachSensorTrace, { ...f.args, submissionId: otherId })).rejects.toThrow("sensor_trace_upload_already_attached");
  });
  it("allows an already attached trace to replay after review but refuses new evidence on either terminal state", async () => {
    const f = await setup();
    for (const status of ["accepted", "rejected"] as const) {
      await f.t.run(ctx => ctx.db.patch(f.submissionId, { status }));
      await expect(f.t.query(internal.sensorTraces.authorize, f.args)).rejects.toThrow("submission_evidence_closed");
    }
    await f.t.run(ctx => ctx.db.patch(f.submissionId, { status: "needs_review" }));
    await f.t.action(api.sensorTraces.attachSensorTrace, f.args);
    await f.t.run(ctx => ctx.db.patch(f.submissionId, { status: "accepted" }));
    expect(await f.t.action(api.sensorTraces.attachSensorTrace, f.args)).toEqual({ submissionId: f.submissionId, replayed: true });
    expect((await f.t.run(ctx => ctx.db.query("auditEvents").collect())).filter(row => row.action === "sensor_trace_attached")).toHaveLength(1);
  });
});
