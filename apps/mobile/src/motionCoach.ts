import { mobileConfig } from './config';
import type { Sample } from './sensors';

// Match the server's existing active-motion gyro threshold. Coaching is visual
// advice for the fixed-camera task, never an acceptance or upload gate.
const GYRO_THRESHOLD_RAD_PER_SEC = mobileConfig.gyroThresholdRadPerSec;
const SUSTAINED_MS = mobileConfig.sustainedMotionMs;
const MAX_SAMPLE_GAP_MS = mobileConfig.maxSampleGapMs;
const STALE_MS = mobileConfig.staleMotionMs;
const TILT_THRESHOLD_DEGREES = mobileConfig.tiltThresholdDegrees;
export type MotionCoaching = { steady: boolean | null; tilted: boolean | null };

export function createMotionCoach() {
  let gyroAt: number | undefined, highSince: number | undefined;
  let gravityAt: number | undefined, tilt: number | null = null;
  return {
    sample(sample: Sample) {
      if (sample.sensor === 'gyroscope') {
        const high = Math.hypot(sample.x, sample.y, sample.z) > GYRO_THRESHOLD_RAD_PER_SEC;
        const gap = gyroAt === undefined || sample.timestampMs - gyroAt > MAX_SAMPLE_GAP_MS;
        highSince = high ? (gap ? sample.timestampMs : highSince ?? sample.timestampMs) : undefined;
        gyroAt = sample.timestampMs;
      } else if (sample.sensor === 'gravity') {
        const projected = Math.hypot(sample.x, sample.y);
        const magnitude = Math.hypot(sample.x, sample.y, sample.z);
        // Portrait horizon roll, not pitch: contributors may aim down at a table.
        // Looking nearly straight down/up makes the horizon undefined.
        tilt = magnitude > 0 && projected >= mobileConfig.horizonMinProjectionRatio * magnitude
          ? Math.atan2(Math.abs(sample.x), Math.abs(sample.y)) * 180 / Math.PI : null;
        gravityAt = sample.timestampMs;
      }
    },
    status(timestampMs: number): MotionCoaching {
      return {
        steady: gyroAt === undefined || timestampMs - gyroAt > STALE_MS ? null
          : !(highSince !== undefined && gyroAt - highSince > SUSTAINED_MS),
        tilted: gravityAt === undefined || timestampMs - gravityAt > STALE_MS || tilt === null
          ? null : tilt > TILT_THRESHOLD_DEGREES,
      };
    },
  };
}
