import { expect, test } from 'bun:test';
import { createMotionCoach } from './motionCoach';

const gyro = (timestampMs, x = 0.16) => ({ sensor: 'gyroscope', timestampMs, x, y: 0, z: 0 });
const gravity = (timestampMs, degrees, scale = 1, z = 0) => ({ sensor: 'gravity', timestampMs,
  x: Math.sin(degrees * Math.PI / 180) * scale, y: -Math.cos(degrees * Math.PI / 180) * scale, z });

test('brief shakes do not nag contributors; only gyro above 0.15 rad/s for more than 500 ms says hold still', () => {
  const coach = createMotionCoach();
  for (let ms = 0; ms <= 500; ms += 100) coach.sample(gyro(ms));
  expect(coach.status(500).steady).toBe(true);
  coach.sample(gyro(520));
  expect(coach.status(520).steady).toBe(false);
  coach.sample(gyro(540, 0.15));
  expect(coach.status(540).steady).toBe(true);
  coach.sample(gyro(560));
  expect(coach.status(560).steady).toBe(true);
});

test('sustained movement uses all gyro axes, so rotating around y or z cannot escape coaching', () => {
  const coach = createMotionCoach();
  for (let ms = 0; ms <= 600; ms += 100) coach.sample({ ...gyro(ms, 0), y: 0.11, z: 0.11 });
  expect(coach.status(600).steady).toBe(false);
});

test('missing samples cannot prove steadiness or bridge a gap into sustained movement', () => {
  const coach = createMotionCoach();
  expect(coach.status(0)).toEqual({ steady: null, tilted: null });
  coach.sample(gyro(0));
  expect(coach.status(501).steady).toBe(null);
  coach.sample(gyro(600));
  expect(coach.status(600).steady).toBe(true);
  for (let ms = 700; ms <= 1200; ms += 100) coach.sample(gyro(ms));
  expect(coach.status(1200).steady).toBe(false);
  expect(coach.status(1701).steady).toBe(null);
});

test('level advice follows the portrait horizon beyond 15 degrees, not aiming down toward the task', () => {
  const coach = createMotionCoach();
  coach.sample(gravity(0, 14.9));
  expect(coach.status(0).tilted).toBe(false);
  coach.sample(gravity(20, -15.1));
  expect(coach.status(20).tilted).toBe(true);
  coach.sample(gravity(40, 0, 0.5, 0.86));
  expect(coach.status(40).tilted).toBe(false);
  expect(coach.status(541).tilted).toBe(null);
});

test('gravity nearly along the optical axis has no reliable horizon; a retake starts with no advice', () => {
  const coach = createMotionCoach();
  coach.sample(gravity(0, 45, 0.01, 9.8));
  expect(coach.status(0).tilted).toBe(null);
  coach.sample(gravity(20, 45, 0));
  expect(coach.status(20).tilted).toBe(null);
  expect(createMotionCoach().status(0)).toEqual({ steady: null, tilted: null });
});
