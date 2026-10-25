import { configNumber } from "./config.ts";
/** Untrusted client IMU evidence. Validation and summaries confer no acceptance authority. */
export const MAX_SENSOR_TRACE_BYTES = configNumber("SKARL_SENSORTRACE_MAX_SENSOR_TRACE_BYTES");
const NAMES = ["accelerometer", "gyroscope", "deviceMotion", "attitude", "gravity", "magnetometer"] as const;
const STEADY_GYRO_RAD_PER_SEC = configNumber("SKARL_SENSORTRACE_STEADY_GYRO_RAD_PER_SEC");
export type Sensor = typeof NAMES[number];
export interface Sample { sensor: Sensor; timestampMs: number; x: number; y: number; z: number }
export interface Device {
  model: string; os: string; osVersion: string; appVersion: string; cameraFacing: "back";
  requestedVideoQuality: "720p"; resolution?: string; fps?: number;
  codec?: string | null; zoom?: number; requestedCodec?: "avc1"; metadataSource?: "expo-video" | "unavailable"; videoDurationMs?: number | null;
  intrinsics?: { estimated: true; width: number; height: number; fx: number; fy: number; cx: number; cy: number; horizontalFovDegrees: number; source: string } | null;
}
export interface CaptureContext {
  mount: "handheld" | "chest" | "head"; dominantHand: "left" | "right";
  environment: "kitchen" | "desk" | "workshop" | "other"; lighting: "bright" | "dim";
}
export interface Segment { label: string; startMs: number; endMs: number }
export interface Trace {
  version: 1 | 2; sampleRateHz: number; durationMs: number; recordedAt: string; sensors: Sensor[];
  device: Device; clock: "js-callback-performance-now"; samples: Sample[];
  videoStartOffsetMs?: number | null; videoStopOffsetMs?: number | null;
  syncSource?: "expo-recording-progress-estimate"; syncAccuracy?: "approximate";
  segments?: Segment[]; context?: CaptureContext; unavailableSensors?: Sensor[];
}
function fail(): never { throw new Error("invalid_sensor_trace"); }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !keys.includes(key))) return fail();
  return record;
}
function finite(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) return fail();
  return value;
}
function string(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 160) return fail();
  return value;
}
function sensor(value: unknown): Sensor {
  if (!NAMES.includes(value as Sensor)) return fail();
  return value as Sensor;
}
export function validateSensorTrace(value: unknown): Trace {
  const raw = object(value, ["version", "sampleRateHz", "durationMs", "recordedAt", "sensors", "device", "clock", "samples", "videoStartOffsetMs", "videoStopOffsetMs", "syncSource", "syncAccuracy", "segments", "context", "unavailableSensors"]);
  if (raw.version !== 1 && raw.version !== 2) return fail();
  const sampleRateHz = finite(raw.sampleRateHz, 1, 100), durationMs = finite(raw.durationMs, 1, raw.version === 2 ? 60_000 : 31_000);
  const recordedAt = string(raw.recordedAt);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(recordedAt) || !Number.isFinite(Date.parse(recordedAt)) ||
    new Date(recordedAt).toISOString() !== recordedAt) return fail();
  if ((raw.version === 2 || raw.clock !== undefined) && raw.clock !== "js-callback-performance-now") return fail();
  const info = object(raw.device, ["model", "os", "osVersion", "appVersion", "cameraFacing", "requestedVideoQuality", "resolution", "fps", "codec", "zoom", "intrinsics", "requestedCodec", "metadataSource", "videoDurationMs"]);
  if (info.cameraFacing !== "back" || info.requestedVideoQuality !== "720p") return fail();
  const device: Device = { model: string(info.model), os: string(info.os), osVersion: string(info.osVersion), appVersion: string(info.appVersion),
    cameraFacing: "back", requestedVideoQuality: "720p", ...(info.resolution === undefined ? {} : { resolution: string(info.resolution) }),
    ...(info.fps === undefined ? {} : { fps: finite(info.fps, 1, 240) }) };
  if (info.codec !== undefined) device.codec = info.codec === null ? null : string(info.codec);
  if (info.requestedCodec !== undefined) { if (info.requestedCodec !== "avc1") return fail(); device.requestedCodec = "avc1"; }
  if (info.metadataSource !== undefined) { if (info.metadataSource !== "expo-video" && info.metadataSource !== "unavailable") return fail(); device.metadataSource = info.metadataSource; }
  if (info.videoDurationMs !== undefined) device.videoDurationMs = info.videoDurationMs === null ? null : finite(info.videoDurationMs, 1, 31_000);
  if (info.zoom !== undefined) device.zoom = finite(info.zoom, 0, 1);
  if (info.intrinsics !== undefined) {
    if (info.intrinsics === null) device.intrinsics = null;
    else {
      const row = object(info.intrinsics, ["estimated", "width", "height", "fx", "fy", "cx", "cy", "horizontalFovDegrees", "source"]);
      if (row.estimated !== true) return fail();
      const width = finite(row.width, 1, 8192), height = finite(row.height, 1, 8192);
      device.intrinsics = { estimated: true, width, height, fx: finite(row.fx, 1, 100_000), fy: finite(row.fy, 1, 100_000),
        cx: finite(row.cx, 0, width), cy: finite(row.cy, 0, height), horizontalFovDegrees: finite(row.horizontalFovDegrees, 1, 179), source: string(row.source) };
    }
  }
  if (!Array.isArray(raw.sensors) || raw.sensors.length > (raw.version === 1 ? 5 : 6)) return fail();
  const sensors = raw.sensors.map(sensor);
  if (raw.version === 1 && sensors.includes("magnetometer")) return fail();
  if (new Set(sensors).size !== sensors.length) return fail();
  // An empty trace explicitly records sensor unavailability; it is not stationary evidence.
  // Six channels, bounded samples, up to 200 callbacks/second. The upload's independent
  // 2 MiB byte limit still applies; this count does not enlarge stored uploads.
  if (!Array.isArray(raw.samples) || raw.samples.length > 31_000) return fail();
  const last = new Map<Sensor, number>(), counts = new Map<string, number>();
  let previousTimestamp = -1;
  const samples = raw.samples.map((value): Sample => {
    const item = object(value, ["sensor", "timestampMs", "x", "y", "z"]), name = sensor(item.sensor);
    if (!sensors.includes(name)) return fail();
    const timestampMs = finite(item.timestampMs, 0, durationMs);
    // Channels may share a callback millisecond, but the merged timeline cannot run backwards.
    if (timestampMs < previousTimestamp || timestampMs <= (last.get(name) ?? -1)) return fail();
    previousTimestamp = timestampMs;
    last.set(name, timestampMs);
    const bucket = `${name}:${Math.floor(timestampMs / 1000)}`, count = (counts.get(bucket) ?? 0) + 1;
    // Bound actual callback rates as well as the claimed rate; tolerate batched native callbacks.
    if (count > 200) return fail();
    counts.set(bucket, count);
    return { sensor: name, timestampMs, x: finite(item.x, -10_000, 10_000), y: finite(item.y, -10_000, 10_000), z: finite(item.z, -10_000, 10_000) };
  });
  if (sensors.some(name => !last.has(name))) return fail();
  const base: Trace = { version: raw.version, sampleRateHz, durationMs, recordedAt, sensors, device, clock: "js-callback-performance-now", samples };
  if (raw.version === 1) {
    if (["videoStartOffsetMs", "videoStopOffsetMs", "syncSource", "syncAccuracy", "segments", "context", "unavailableSensors"].some(key => raw[key] !== undefined)) return fail();
    return base;
  }
  if (raw.syncSource !== "expo-recording-progress-estimate" || raw.syncAccuracy !== "approximate") return fail();
  const start = raw.videoStartOffsetMs === null ? null : finite(raw.videoStartOffsetMs, 0, durationMs);
  const stop = raw.videoStopOffsetMs === null ? null : finite(raw.videoStopOffsetMs, 0, durationMs);
  if ((start === null) !== (stop === null) || (start !== null && stop! <= start)) return fail();
  if (!Array.isArray(raw.unavailableSensors) || raw.unavailableSensors.length > 6) return fail();
  const unavailableSensors = raw.unavailableSensors.map(sensor);
  // Partition by actual samples: availability promises never manufacture readings.
  if (new Set(unavailableSensors).size !== unavailableSensors.length || NAMES.some(name => sensors.includes(name) === unavailableSensors.includes(name))) return fail();
  const context = object(raw.context, ["mount", "dominantHand", "environment", "lighting"]);
  if (!["handheld", "chest", "head"].includes(String(context.mount)) || !["left", "right"].includes(String(context.dominantHand)) ||
    !["kitchen", "desk", "workshop", "other"].includes(String(context.environment)) || !["bright", "dim"].includes(String(context.lighting))) return fail();
  if (!Array.isArray(raw.segments) || raw.segments.length > 100) return fail();
  let previousEnd = 0;
  const segments = raw.segments.map(value => {
    const row = object(value, ["label", "startMs", "endMs"]);
    if (start === null) return fail();
    const startMs = finite(row.startMs, previousEnd, stop! - start), endMs = finite(row.endMs, startMs, stop! - start);
    if (endMs <= startMs) return fail();
    previousEnd = endMs;
    return { label: string(row.label), startMs, endMs };
  });
  return { ...base, videoStartOffsetMs: start, videoStopOffsetMs: stop, syncSource: raw.syncSource, syncAccuracy: raw.syncAccuracy,
    unavailableSensors, context: context as unknown as CaptureContext, segments };
}

export function summarizeMotion(trace: Trace) {
  type Accumulator = { count: number; sumSquares: number };
  const empty = (): Record<Sensor, Accumulator> => ({ accelerometer: { count: 0, sumSquares: 0 }, gyroscope: { count: 0, sumSquares: 0 },
    deviceMotion: { count: 0, sumSquares: 0 }, attitude: { count: 0, sumSquares: 0 }, gravity: { count: 0, sumSquares: 0 }, magnetometer: { count: 0, sumSquares: 0 } });
  const total = empty();
  let tiltSumDegrees = 0, tiltCount = 0, steadyGyroCount = 0;
  const buckets = Array.from({ length: Math.ceil(trace.durationMs / 250) }, () => ({ ...empty(), active: false }));
  for (const sample of trace.samples) {
    const squared = sample.x ** 2 + sample.y ** 2 + sample.z ** 2;
    const magnitude = Math.sqrt(squared), bucket = buckets[Math.min(buckets.length - 1, Math.floor(sample.timestampMs / 250))]!;
    for (const accumulator of [total[sample.sensor], bucket[sample.sensor]]) { accumulator.count++; accumulator.sumSquares += squared; }
    const active = sample.sensor === "accelerometer" ? Math.abs(magnitude - 1) > 0.08
      : sample.sensor === "gyroscope" ? magnitude > STEADY_GYRO_RAD_PER_SEC
      : sample.sensor === "deviceMotion" && magnitude > 0.8;
    bucket.active ||= active;
    if (sample.sensor === "gyroscope" && magnitude <= STEADY_GYRO_RAD_PER_SEC) steadyGyroCount++;
    if (sample.sensor === "gravity" && magnitude > 0 && Math.hypot(sample.x, sample.y) >= 0.1 * magnitude) {
      // Portrait horizon roll, not forward pitch. When looking straight up/down,
      // gravity projects poorly onto the image plane, so no level claim is made.
      tiltSumDegrees += Math.atan2(Math.abs(sample.x), Math.abs(sample.y)) * 180 / Math.PI;
      tiltCount++;
    }
  }
  const rms = (item: Accumulator) => item.count ? Math.sqrt(item.sumSquares / item.count) : null;
  const values = (item: Record<Sensor, Accumulator>) => ({ accelRmsG: rms(item.accelerometer), gyroRmsRadPerSec: rms(item.gyroscope), linearAccelerationRmsMps2: rms(item.deviceMotion) });
  const bins = buckets.map((bucket, index) => ({ startMs: index * 250, endMs: Math.min(trace.durationMs, (index + 1) * 250),
    sampleCount: NAMES.reduce((sum, name) => sum + bucket[name].count, 0), ...values(bucket), active: bucket.active }));
  const activeMotionIntervals: { startMs: number; endMs: number }[] = [];
  for (const bin of bins) {
    if (!bin.active) continue;
    const last = activeMotionIntervals.at(-1);
    if (last && last.endMs === bin.startMs) last.endMs = bin.endMs;
    else activeMotionIntervals.push({ startMs: bin.startMs, endMs: bin.endMs });
  }
  return { source: "clientReported" as const, version: 1 as const, binWidthMs: 250 as const, ...values(total),
    magneticFieldRmsMicroTesla: rms(total.magnetometer),
    meanTiltDegrees: tiltCount ? tiltSumDegrees / tiltCount : null,
    steadinessRatio: total.gyroscope.count ? steadyGyroCount / total.gyroscope.count : null,
    activeMotionIntervals, bins };
}
