import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';

const listeners = new Map(), removals = [], intervals = new Map();
let unavailable = new Set(), failing = new Set(), permission = true, clock = 1000;
function sensor(name) {
  return {
    requestPermissionsAsync: async () => ({ granted: permission }),
    isAvailableAsync: async () => !unavailable.has(name),
    setUpdateInterval: value => { intervals.set(name, value); },
    addListener: callback => {
      if (failing.has(name)) throw new Error('Hardware unavailable');
      listeners.set(name, callback);
      return { remove: () => { removals.push(name); listeners.delete(name); } };
    },
  };
}
mock.module('expo-sensors', () => ({
  Accelerometer: sensor('accelerometer'), Gyroscope: sensor('gyroscope'), DeviceMotion: sensor('deviceMotion'),
}));
mock.module('expo-device', () => ({ modelName: 'Test phone', osName: 'iOS', osVersion: 'test' }));
mock.module('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0' } } }));
const { availableSensors, startTrace } = await import('./sensors');
let now;
beforeEach(() => {
  listeners.clear(); removals.length = 0; intervals.clear(); unavailable = new Set(); failing = new Set(); permission = true; clock = 1000;
  now = spyOn(performance, 'now').mockImplementation(() => clock);
});
afterEach(() => now.mockRestore());
const emit = (name, elapsed, value) => { clock = 1000 + elapsed; listeners.get(name)?.(value); };
const vector = { x: 0, y: 0, z: 1 };

test('capture uses relative monotonic timestamps, finite values and per-channel throttling', () => {
  const capture = startTrace(['accelerometer', 'gyroscope', 'deviceMotion']);
  emit('accelerometer', 0, vector);
  emit('accelerometer', 0, vector);
  emit('accelerometer', 4, vector);
  emit('accelerometer', 20, { ...vector, x: NaN });
  emit('accelerometer', 40, vector);
  emit('gyroscope', 40, { x: 0.2, y: 0, z: 0 });
  emit('deviceMotion', 40, { acceleration: null });
  emit('deviceMotion', 60, { acceleration: { x: 1, y: 2, z: 3, timestamp: 9999 } });
  const result = capture.stop();
  expect(result.samples.map(sample => sample.timestampMs)).toEqual([0, 40, 40, 60]);
  expect(result.samples.at(-1)).toEqual({ sensor: 'deviceMotion', timestampMs: 60, x: 1, y: 2, z: 3 });
  expect(result.durationMs).toBe(60);
  expect(result.sampleRateHz).toBe(50);
  expect([...intervals.values()]).toEqual([20, 20, 20]);
  expect(result.device).toMatchObject({ model: 'Test phone', cameraFacing: 'back', requestedVideoQuality: '720p' });
  expect(result).not.toHaveProperty('location');
});

test('stop is idempotent, removes listeners, and excludes samples beyond 30 seconds', () => {
  const capture = startTrace(['accelerometer']);
  const lateCallback = listeners.get('accelerometer');
  emit('accelerometer', 29_990, vector);
  emit('accelerometer', 30_010, vector);
  const result = capture.stop();
  lateCallback(vector);
  expect(capture.stop()).toBe(result);
  expect(result.durationMs).toBe(30_000);
  expect(result.samples).toHaveLength(1);
  expect(removals).toEqual(['accelerometer']);
  expect(listeners.size).toBe(0);
});

test('unavailable channels have no samples; permission denial never means stationary motion', async () => {
  unavailable.add('gyroscope');
  expect(await availableSensors()).toEqual(['accelerometer', 'deviceMotion', 'attitude', 'gravity']);
  permission = false;
  expect(await availableSensors()).toEqual([]);
  const capture = startTrace([]);
  clock += 10_000;
  expect(capture.stop()).toMatchObject({ sensors: [], samples: [], durationMs: 10_000 });
});

test('one DeviceMotion event keeps orientation and gravity synchronized without mixing angular units', () => {
  const live = [];
  const capture = startTrace(['deviceMotion'], sample => live.push(sample));
  emit('deviceMotion', 20, {
    acceleration: { x: 1, y: 2, z: 3 },
    accelerationIncludingGravity: { x: 1, y: -7.8, z: 3 },
    rotation: { alpha: 0.1, beta: 0.2, gamma: -0.3 },
    rotationRate: { alpha: 90, beta: 45, gamma: 30 },
  });
  const result = capture.stop();
  expect(result.samples).toEqual([
    { sensor: 'deviceMotion', timestampMs: 20, x: 1, y: 2, z: 3 },
    { sensor: 'attitude', timestampMs: 20, x: 0.1, y: 0.2, z: -0.3 },
    { sensor: 'gravity', timestampMs: 20, x: 0, y: -9.8, z: 0 },
  ]);
  expect(live).toEqual(result.samples);
  expect(result.version).toBe(1);
  expect(removals).toEqual(['deviceMotion']); // Derived channels need no extra native listeners.
});

test('missing or nonfinite components never invent orientation or gravity for labs or live coaching', () => {
  const live = [];
  const capture = startTrace(['deviceMotion'], sample => live.push(sample));
  emit('deviceMotion', 20, { acceleration: null, accelerationIncludingGravity: vector, rotation: null });
  emit('deviceMotion', 40, { acceleration: vector, accelerationIncludingGravity: null,
    rotation: { alpha: NaN, beta: 0, gamma: 0 } });
  emit('deviceMotion', 60, { acceleration: vector, accelerationIncludingGravity: { ...vector, x: Infinity } });
  const result = capture.stop();
  expect(result.sensors).toEqual(['deviceMotion']);
  expect(live).toEqual(result.samples);
});

test('live callbacks end with recording and cannot mutate the stored trace', () => {
  let calls = 0;
  const capture = startTrace(['gyroscope'], sample => { calls++; sample.x = 999; });
  const callback = listeners.get('gyroscope');
  emit('gyroscope', 20, vector);
  const result = capture.stop();
  callback(vector);
  expect(calls).toBe(1);
  expect(result.samples[0].x).toBe(0);
});

test('five channels fit the unchanged 2 MiB upload budget even when native callbacks arrive at 1 kHz', () => {
  const capture = startTrace(['accelerometer', 'gyroscope', 'deviceMotion']);
  const precise = { x: -1.2345678901234567e-100, y: -9.876543210987654e-100, z: -1.2345678901234567e-99 };
  for (let elapsed = 0; elapsed <= 30_000; elapsed++) {
    emit('accelerometer', elapsed, precise);
    emit('gyroscope', elapsed, precise);
    emit('deviceMotion', elapsed, { acceleration: precise,
      accelerationIncludingGravity: { x: 0, y: 0, z: 0 },
      rotation: { alpha: precise.x, beta: precise.y, gamma: precise.z } });
  }
  const result = capture.stop();
  expect(result.sensors).toHaveLength(5);
  expect(result.samples).toHaveLength(7_505);
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(2 * 1024 * 1024);
});

test('a channel failing to register preserves other capture channels and their cleanup', () => {
  failing.add('gyroscope');
  const capture = startTrace(['accelerometer', 'gyroscope', 'deviceMotion']);
  emit('accelerometer', 20, vector);
  emit('deviceMotion', 20, { acceleration: vector });
  expect(capture.stop().sensors).toEqual(['accelerometer', 'deviceMotion']);
  expect(removals).toEqual(['accelerometer', 'deviceMotion']);
  expect(listeners.size).toBe(0);
});
