/** Untrusted client IMU evidence. Validation and summaries confer no acceptance authority. */
export const MAX_SENSOR_TRACE_BYTES = 2 * 1024 * 1024;
const NAMES = ["accelerometer", "gyroscope", "deviceMotion"] as const;
type Sensor = typeof NAMES[number];
interface Sample { sensor: Sensor; timestampMs: number; x: number; y: number; z: number }
interface Device {
  model: string; os: string; osVersion: string; appVersion: string; cameraFacing: "back";
  requestedVideoQuality: "720p"; resolution?: string; fps?: number;
}
interface Trace {
  version: 1; sampleRateHz: number; durationMs: number; recordedAt: string; sensors: Sensor[];
  device: Device; clock: "js-callback-performance-now"; samples: Sample[];
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
  const raw = object(value, ["version", "sampleRateHz", "durationMs", "recordedAt", "sensors", "device", "clock", "samples"]);
  if (raw.version !== 1) return fail();
  const sampleRateHz = finite(raw.sampleRateHz, 1, 100), durationMs = finite(raw.durationMs, 1, 31_000);
  const recordedAt = string(raw.recordedAt);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(recordedAt) || !Number.isFinite(Date.parse(recordedAt)) ||
    new Date(recordedAt).toISOString() !== recordedAt) return fail();
  if (raw.clock !== undefined && raw.clock !== "js-callback-performance-now") return fail();
  const info = object(raw.device, ["model", "os", "osVersion", "appVersion", "cameraFacing", "requestedVideoQuality", "resolution", "fps"]);
  if (info.cameraFacing !== "back" || info.requestedVideoQuality !== "720p") return fail();
  const device: Device = { model: string(info.model), os: string(info.os), osVersion: string(info.osVersion), appVersion: string(info.appVersion),
    cameraFacing: "back", requestedVideoQuality: "720p", ...(info.resolution === undefined ? {} : { resolution: string(info.resolution) }),
    ...(info.fps === undefined ? {} : { fps: finite(info.fps, 1, 240) }) };
  if (!Array.isArray(raw.sensors) || raw.sensors.length > 3) return fail();
  const sensors = raw.sensors.map(sensor);
  if (new Set(sensors).size !== sensors.length) return fail();
  // An empty trace explicitly records sensor unavailability; it is not stationary evidence.
  if (!Array.isArray(raw.samples) || raw.samples.length > 18_600) return fail();
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
  return { version: 1, sampleRateHz, durationMs, recordedAt, sensors, device, clock: "js-callback-performance-now", samples };
}

export function summarizeMotion(trace: Trace) {
  type Accumulator = { count: number; sumSquares: number };
  const empty = (): Record<Sensor, Accumulator> => ({ accelerometer: { count: 0, sumSquares: 0 }, gyroscope: { count: 0, sumSquares: 0 }, deviceMotion: { count: 0, sumSquares: 0 } });
  const total = empty();
  const buckets = Array.from({ length: Math.ceil(trace.durationMs / 250) }, () => ({ ...empty(), active: false }));
  for (const sample of trace.samples) {
    const squared = sample.x ** 2 + sample.y ** 2 + sample.z ** 2;
    const magnitude = Math.sqrt(squared), bucket = buckets[Math.min(buckets.length - 1, Math.floor(sample.timestampMs / 250))]!;
    for (const accumulator of [total[sample.sensor], bucket[sample.sensor]]) { accumulator.count++; accumulator.sumSquares += squared; }
    const active = sample.sensor === "accelerometer" ? Math.abs(magnitude - 1) > 0.08
      : sample.sensor === "gyroscope" ? magnitude > 0.15 : magnitude > 0.8;
    bucket.active ||= active;
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
  return { source: "clientReported" as const, version: 1 as const, binWidthMs: 250 as const, ...values(total), activeMotionIntervals, bins };
}
