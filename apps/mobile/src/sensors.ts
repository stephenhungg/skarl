import { Accelerometer, Gyroscope, DeviceMotion } from 'expo-sensors';
import * as Device from 'expo-device';
import Constants from 'expo-constants';

export type Sensor = 'accelerometer' | 'gyroscope' | 'deviceMotion';
export type Sample = { sensor: Sensor; timestampMs: number; x: number; y: number; z: number };
export type Trace = {
  version: 1; sampleRateHz: number; durationMs: number; recordedAt: string;
  clock: 'js-callback-performance-now'; sensors: Sensor[];
  device: { model: string; os: string; osVersion: string; appVersion: string;
    cameraFacing: 'back'; requestedVideoQuality: '720p' };
  samples: Sample[];
};

export async function availableSensors(): Promise<Sensor[]> {
  // Motion permission is separate from camera/microphone permission on iOS.
  const permission = await DeviceMotion.requestPermissionsAsync();
  if (!permission.granted) return [];
  const results = await Promise.allSettled([
    Accelerometer.isAvailableAsync(), Gyroscope.isAvailableAsync(), DeviceMotion.isAvailableAsync(),
  ]);
  return (['accelerometer', 'gyroscope', 'deviceMotion'] as const)
    .filter((_, i) => results[i]?.status === 'fulfilled' && results[i].value);
}

export function startTrace(available: Sensor[]) {
  const start = performance.now();
  const samples: Sample[] = [];
  const last: Partial<Record<Sensor, number>> = {};
  const subscriptions: { remove(): void }[] = [];
  let finished: Trace | undefined;
  const recordedAt = new Date().toISOString();
  function add(sensor: Sensor, value: { x: number; y: number; z: number } | null) {
    const timestampMs = Math.round(performance.now() - start);
    if (finished || !value || timestampMs > 30_000 || timestampMs - (last[sensor] ?? -20) < 15) return;
    if (![value.x, value.y, value.z].every(Number.isFinite)) return;
    last[sensor] = timestampMs;
    samples.push({ sensor, timestampMs, x: value.x, y: value.y, z: value.z });
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
  subscribe('deviceMotion', () => {
    DeviceMotion.setUpdateInterval(20);
    return DeviceMotion.addListener(value => add('deviceMotion', value.acceleration));
  });
  return {
    stop(): Trace {
      if (finished) return finished;
      subscriptions.forEach(subscription => subscription.remove());
      finished = {
        version: 1, sampleRateHz: 50, durationMs: Math.min(30_000, Math.round(performance.now() - start)),
        recordedAt, clock: 'js-callback-performance-now', sensors: [...new Set(samples.map(sample => sample.sensor))],
        device: { model: Device.modelName ?? 'unknown', os: Device.osName ?? 'unknown', osVersion: Device.osVersion ?? 'unknown',
          appVersion: Constants.expoConfig?.version ?? 'unknown', cameraFacing: 'back', requestedVideoQuality: '720p' },
        samples,
      };
      return finished;
    },
  };
}
