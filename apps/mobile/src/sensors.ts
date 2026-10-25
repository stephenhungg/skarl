import { Accelerometer, Gyroscope, DeviceMotion, Magnetometer } from 'expo-sensors';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { estimateIntrinsics, type Intrinsics } from './cameraIntrinsics';
import type { CaptureContext } from './captureContext';
import type { CameraMetadata } from './cameraMetadata';

export const SENSOR_NAMES = ['accelerometer', 'gyroscope', 'deviceMotion', 'attitude', 'gravity', 'magnetometer'] as const;
export type Sensor = typeof SENSOR_NAMES[number];
export type Sample = { sensor: Sensor; timestampMs: number; x: number; y: number; z: number };
export type Segment = { label: string; startMs: number; endMs: number };
type TraceBase = {
  sampleRateHz: number; durationMs: number; recordedAt: string;
  clock: 'js-callback-performance-now'; sensors: Sensor[];
  device: { model: string; os: string; osVersion: string; appVersion: string;
    cameraFacing: 'back'; requestedVideoQuality: '720p'; resolution?: string; fps?: number;
    codec?: string | null; zoom?: number; intrinsics?: Intrinsics | null;
    metadataSource?: 'expo-video' | 'unavailable'; videoDurationMs?: number | null; requestedCodec?: 'avc1' };
  samples: Sample[];
};
export type Trace = TraceBase & ({ version: 1 } | {
  version: 2; videoStartOffsetMs: number | null; videoStopOffsetMs: number | null;
  syncSource: 'expo-recording-progress-estimate'; syncAccuracy: 'approximate';
  unavailableSensors: Sensor[]; context: CaptureContext; segments: Segment[];
});

export async function availableSensors(): Promise<Sensor[]> {
  // Motion permission is separate from camera/microphone permission on iOS.
  const permission = await DeviceMotion.requestPermissionsAsync();
  if (!permission.granted) return [];
  const results = await Promise.allSettled([
    Accelerometer.isAvailableAsync(), Gyroscope.isAvailableAsync(), DeviceMotion.isAvailableAsync(), Magnetometer.isAvailableAsync(),
  ]);
  const available: Sensor[] = (['accelerometer', 'gyroscope', 'deviceMotion', 'magnetometer'] as const)
    .filter((_, i) => results[i]?.status === 'fulfilled' && results[i].value);
  if (available.includes('deviceMotion')) available.push('attitude', 'gravity');
  return available;
}

export function startTrace(available: Sensor[], onSample?: (sample: Sample) => void, options?: { context: CaptureContext; stepLabels: string[] }) {
  const start = performance.now();
  const samples: Sample[] = [];
  const last: Partial<Record<Sensor, number>> = {};
  const subscriptions: { remove(): void }[] = [];
  let finished: Trace | undefined;
  let stoppedAt: number | null = null;
  let videoStartOffsetMs: number | null = null, lastVideoDurationMs = 0;
  const stepBoundaries: number[] = [];
  const defaultContext: CaptureContext = { mount: 'handheld', dominantHand: 'right', environment: 'other', lighting: 'bright' };
  const labels = (options?.stepLabels ?? []).slice(0, 100).map(label => label.slice(0, 160));
  const recordedAt = new Date().toISOString();
  function add(sensor: Sensor, value: { x: number; y: number; z: number } | null, timestampMs = Math.round(performance.now() - start)) {
    // Bound raw samples to 31 seconds (30s video plus startup), at 50 Hz.
    // Longer startup delays remain explicit gaps; never fill missing readings.
    if (finished || stoppedAt !== null || !value || timestampMs > 31_000 || timestampMs - (last[sensor] ?? -20) < 20) return;
    if (![value.x, value.y, value.z].every(Number.isFinite)) return;
    last[sensor] = timestampMs;
    const sample = { sensor, timestampMs, x: value.x, y: value.y, z: value.z };
    samples.push(sample);
    onSample?.({ ...sample });
  }
  // Availability can change after permission checks. An optional channel failing
  // to start must not abort video capture or leak previously registered listeners.
  const subscribe = (sensor: Sensor, register: () => { remove(): void }) => {
    if (!available.includes(sensor)) return;
    try { subscriptions.push(register()); } catch { /* No samples means unavailable, never stationary. */ }
  };
  subscribe('accelerometer', () => {
    Accelerometer.setUpdateInterval(20);
    return Accelerometer.addListener(value => add('accelerometer', value));
  });
  subscribe('gyroscope', () => {
    Gyroscope.setUpdateInterval(20);
    return Gyroscope.addListener(value => add('gyroscope', value));
  });
  subscribe('magnetometer', () => {
    Magnetometer.setUpdateInterval(20);
    return Magnetometer.addListener(value => add('magnetometer', value));
  });
  subscribe('deviceMotion', () => {
    DeviceMotion.setUpdateInterval(20);
    return DeviceMotion.addListener(value => {
      const timestampMs = Math.round(performance.now() - start);
      add('deviceMotion', value.acceleration, timestampMs);
      const rotation = value.rotation;
      // Keep the v1 vector shape: x/y/z store alpha/beta/gamma (radians),
      // respectively; these are Euler components, not Cartesian vector axes.
      if (rotation) add('attitude', { x: rotation.alpha, y: rotation.beta, z: rotation.gamma }, timestampMs);
      const linear = value.acceleration, total = value.accelerationIncludingGravity;
      // Both values must exist in the same native event; missing acceleration
      // is unknown, not zero, and must never fabricate a gravity direction.
      if (linear && total) add('gravity', {
        x: total.x - linear.x, y: total.y - linear.y, z: total.z - linear.z,
      }, timestampMs);
    });
  });
  function endRecording() {
    if (stoppedAt !== null) return;
    stoppedAt = performance.now();
    subscriptions.forEach(subscription => subscription.remove());
  }
  return {
    endRecording,
    recordingProgress(durationMs: number) {
      if (finished || stoppedAt !== null || !Number.isFinite(durationMs) || durationMs <= 0) return;
      // Expo Go exposes recordedDuration but no native host timestamp. Subtract
      // it from this callback's clock; minimum reduces (cannot eliminate) bridge lag.
      const offset = Math.max(0, performance.now() - start - durationMs);
      videoStartOffsetMs = videoStartOffsetMs === null ? offset : Math.min(videoStartOffsetMs, offset);
      lastVideoDurationMs = Math.max(lastVideoDurationMs, durationMs);
    },
    nextStep(): boolean {
      if (finished || stoppedAt !== null || videoStartOffsetMs === null || stepBoundaries.length >= labels.length - 1) return false;
      const t = Math.max(0, performance.now() - start);
      if (t <= (stepBoundaries.at(-1) ?? 0)) return false;
      stepBoundaries.push(t);
      return true;
    },
    stop(metadata?: CameraMetadata): Trace {
      if (finished) return finished;
      endRecording();
      const elapsedMs = Math.min(60_000, Math.max(1, Math.round(stoppedAt! - start)));
      const videoDuration = metadata?.videoDurationMs ?? lastVideoDurationMs;
      const videoStopOffsetMs = videoStartOffsetMs === null ? null : Math.min(elapsedMs, videoStartOffsetMs + videoDuration);
      const duration = videoStopOffsetMs === null ? 0 : videoStopOffsetMs - videoStartOffsetMs!;
      const boundaries = stepBoundaries.map(t => t - (videoStartOffsetMs ?? 0)).filter(t => t > 0 && t < duration);
      const sensors = [...new Set(samples.map(sample => sample.sensor))];
      const width = metadata?.width, height = metadata?.height;
      finished = {
        version: 2, sampleRateHz: 50, durationMs: elapsedMs,
        videoStartOffsetMs, videoStopOffsetMs, syncSource: 'expo-recording-progress-estimate', syncAccuracy: 'approximate',
        context: { ...(options?.context ?? defaultContext) }, unavailableSensors: SENSOR_NAMES.filter(sensor => !sensors.includes(sensor)),
        segments: boundaries.length ? [0, ...boundaries].map((startMs, index) =>
          ({ label: labels[index]!, startMs, endMs: boundaries[index] ?? duration })) : [],
        recordedAt, clock: 'js-callback-performance-now', sensors,
        device: { model: Device.modelName ?? 'unknown', os: Device.osName ?? 'unknown', osVersion: Device.osVersion ?? 'unknown',
          appVersion: Constants.expoConfig?.version ?? 'unknown', cameraFacing: 'back', requestedVideoQuality: '720p',
          codec: metadata?.codec ?? null, requestedCodec: 'avc1', zoom: 0, metadataSource: metadata?.metadataSource ?? 'unavailable',
          videoDurationMs: metadata?.videoDurationMs ?? null,
          ...(metadata?.resolution ? { resolution: metadata.resolution } : {}), ...(metadata?.fps ? { fps: metadata.fps } : {}),
          intrinsics: width && height ? estimateIntrinsics(Device.modelName ?? 'unknown', width, height) : null },
        samples,
      };
      return finished;
    },
  };
}
