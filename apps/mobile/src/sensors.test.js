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
  expect(await availableSensors()).toEqual(['accelerometer', 'deviceMotion']);
  permission = false;
  expect(await availableSensors()).toEqual([]);
  const capture = startTrace([]);
  clock += 10_000;
  expect(capture.stop()).toMatchObject({ sensors: [], samples: [], durationMs: 10_000 });
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
