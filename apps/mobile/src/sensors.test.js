import { validateSensorTrace } from '../../../convex/lib/sensorTrace';
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
  Accelerometer: sensor('accelerometer'), Gyroscope: sensor('gyroscope'), DeviceMotion: sensor('deviceMotion'), Magnetometer: sensor('magnetometer'),
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

test('stop is idempotent, removes listeners, and caps sampling at 31 seconds', () => {
  const capture = startTrace(['accelerometer']);
  const lateCallback = listeners.get('accelerometer');
  emit('accelerometer', 30_990, vector);
  emit('accelerometer', 31_010, vector);
  const result = capture.stop();
  lateCallback(vector);
  expect(capture.stop()).toBe(result);
  expect(result.durationMs).toBe(31_010);
  expect(result.samples).toHaveLength(1);
  expect(removals).toEqual(['accelerometer']);
  expect(listeners.size).toBe(0);
});

test('unavailable channels have no samples; permission denial never means stationary motion', async () => {
  unavailable.add('gyroscope');
  expect(await availableSensors()).toEqual(['accelerometer', 'deviceMotion', 'magnetometer', 'attitude', 'gravity']);
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
  expect(result.version).toBe(2);
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

test('six channels fit the unchanged 2 MiB upload budget even when native callbacks arrive at 1 kHz', () => {
  const capture = startTrace(['accelerometer', 'gyroscope', 'deviceMotion', 'magnetometer']);
  const precise = { x: -1.2345678901234567e-100, y: -9.876543210987654e-100, z: -1.2345678901234567e-99 };
  for (let elapsed = 0; elapsed <= 31_000; elapsed++) {
    emit('accelerometer', elapsed, precise);
    emit('gyroscope', elapsed, precise);
    emit('magnetometer', elapsed, precise);
    emit('deviceMotion', elapsed, { acceleration: precise,
      accelerationIncludingGravity: { x: 0, y: 0, z: 0 },
      rotation: { alpha: precise.x, beta: precise.y, gamma: precise.z } });
  }
  const result = capture.stop();
  expect(result.sensors).toHaveLength(6);
  expect(result.samples).toHaveLength(9_306);
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


test('native video duration corrects invocation lag instead of aligning video frame zero with trace zero', () => {
  const capture = startTrace(['accelerometer']);
  emit('accelerometer', 200, vector); // before native recording starts
  clock = 1520; capture.recordingProgress(200); // start ~320ms after trace origin
  clock = 2000; capture.recordingProgress(700); // lower bridge delay improves estimate to 300ms
  emit('accelerometer', 1300, { x: 7, y: 0, z: 0 }); // video t=1000ms
  clock = 2500; capture.endRecording();
  clock += 3000; // metadata loading must not extend sensor capture
  const result = capture.stop({ videoDurationMs: 1200, metadataSource: 'expo-video', fps: 30, width: 720, height: 1280, resolution: '720x1280' });
  expect(result.videoStartOffsetMs).toBe(300);
  expect(result.videoStopOffsetMs).toBe(1500);
  expect(result.durationMs).toBe(1500);
  expect(result.samples.at(-1).timestampMs - result.videoStartOffsetMs).toBe(1000);
  expect(validateSensorTrace(result)).toEqual(result);
  expect(result.syncAccuracy).toBe('approximate'); // Expo Go exposes no native frame host timestamps.
});

test('optional rubric taps create video-relative sub-task boundaries; no taps or missing timing invent none', () => {
  const options = { context: { mount: 'chest', dominantHand: 'left', environment: 'kitchen', lighting: 'dim' },
    stepLabels: ['Pick up cup', 'Place cup'] };
  const capture = startTrace([], undefined, options);
  expect(capture.nextStep()).toBe(false);
  clock = 1500; capture.recordingProgress(200); // 300ms start offset
  clock = 2300; expect(capture.nextStep()).toBe(true);
  clock = 3300; capture.recordingProgress(2000); expect(capture.nextStep()).toBe(false);
  const result = capture.stop();
  expect(result.segments).toEqual([{ label: 'Pick up cup', startMs: 0, endMs: 1000 },
    { label: 'Place cup', startMs: 1000, endMs: 2000 }]);
  expect(validateSensorTrace(result)).toEqual(result);
  expect(result.context).toEqual(options.context);
  const untapped = startTrace([], undefined, options);
  clock += 1000; untapped.recordingProgress(1000);
  expect(untapped.stop().segments).toEqual([]);
});

test('magnetometer is raw microtesla evidence; failed hardware never fabricates heading', async () => {
  const capture = startTrace(['magnetometer']);
  emit('magnetometer', 20, { x: 22, y: -5, z: 40 });
  const result = capture.stop();
  expect(result.sensors).toEqual(['magnetometer']);
  expect(result.samples[0]).toMatchObject({ sensor: 'magnetometer', x: 22, y: -5, z: 40 });
  expect(result.unavailableSensors).toEqual(['accelerometer', 'gyroscope', 'deviceMotion', 'attitude', 'gravity']);
  failing.add('magnetometer');
  const failed = startTrace(['magnetometer']); clock += 1000;
  expect(failed.stop()).toMatchObject({ sensors: [], samples: [], videoStartOffsetMs: null, videoStopOffsetMs: null });
  expect(validateSensorTrace(failed.stop())).toEqual(failed.stop());
  expect(failed.stop().unavailableSensors).toContain('magnetometer');
});


test('segment taps stay on the final video timeline when a later callback improves the start estimate', () => {
  const capture = startTrace([], undefined, { context: { mount: 'head', dominantHand: 'right', environment: 'desk', lighting: 'bright' }, stepLabels: ['First', 'Second'] });
  clock = 1600; capture.recordingProgress(200); // initial offset 400ms
  clock = 2400; capture.nextStep(); // trace t=1400ms
  clock = 3500; capture.recordingProgress(2200); // corrected offset 300ms
  capture.endRecording();
  clock += 200;
  expect(capture.nextStep()).toBe(false);
  capture.recordingProgress(2400); // late native callbacks cannot alter frozen evidence
  const result = capture.stop();
  expect(result.segments[0].endMs).toBe(1100);
  expect(result.segments[1].startMs).toBe(1100);
});
