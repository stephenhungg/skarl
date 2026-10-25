const positive = (value: string | undefined, fallback: number) => {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('invalid_mobile_numeric_config');
  return parsed;
};
/** Public capture configuration. Task objects, steps and rewards come from the order. */
export const mobileConfig = {
  livenessMinRemainingMs: positive(process.env.EXPO_PUBLIC_LIVENESS_MIN_REMAINING_MS, 60_000),
  videoBitsPerSecond: positive(process.env.EXPO_PUBLIC_VIDEO_BITS_PER_SECOND, 4_000_000),
  minCaptureMs: positive(process.env.EXPO_PUBLIC_CAPTURE_MIN_MS, 10_000),
  maxCaptureMs: positive(process.env.EXPO_PUBLIC_CAPTURE_MAX_MS, 30_000),
  maxCaptureBytes: positive(process.env.EXPO_PUBLIC_CAPTURE_MAX_BYTES, 24 * 1024 * 1024),
  gyroThresholdRadPerSec: positive(process.env.EXPO_PUBLIC_GYRO_THRESHOLD_RAD_PER_SEC, 0.15),
  sustainedMotionMs: positive(process.env.EXPO_PUBLIC_SUSTAINED_MOTION_MS, 500),
  maxSampleGapMs: positive(process.env.EXPO_PUBLIC_MAX_SAMPLE_GAP_MS, 250),
  staleMotionMs: positive(process.env.EXPO_PUBLIC_STALE_MOTION_MS, 500),
  tiltThresholdDegrees: positive(process.env.EXPO_PUBLIC_TILT_THRESHOLD_DEGREES, 15),
  horizonMinProjectionRatio: positive(process.env.EXPO_PUBLIC_HORIZON_MIN_PROJECTION_RATIO, 0.1),
  uploadMaxVideoBytes: positive(process.env.EXPO_PUBLIC_UPLOAD_MAX_VIDEO_BYTES, 25 * 1024 * 1024),
  uploadMaxTraceBytes: positive(process.env.EXPO_PUBLIC_UPLOAD_MAX_TRACE_BYTES, 2 * 1024 * 1024),
  uploadTimeoutMs: positive(process.env.EXPO_PUBLIC_UPLOAD_TIMEOUT_MS, 120_000),
  traceMaxDurationMs: positive(process.env.EXPO_PUBLIC_TRACE_MAX_DURATION_MS, 31_000),
  sensorIntervalMs: positive(process.env.EXPO_PUBLIC_SENSOR_INTERVAL_MS, 20),
  maxStepLabels: positive(process.env.EXPO_PUBLIC_MAX_STEP_LABELS, 100),
  newTaskWindowMs: positive(process.env.EXPO_PUBLIC_NEW_TASK_WINDOW_MS, 7 * 24 * 60 * 60 * 1000),
  maxStepLabelLength: positive(process.env.EXPO_PUBLIC_MAX_STEP_LABEL_LENGTH, 160),
} as const;
export const captureDurationLabel = `${mobileConfig.minCaptureMs / 1000} to ${mobileConfig.maxCaptureMs / 1000} s`;

if (mobileConfig.minCaptureMs > mobileConfig.maxCaptureMs || mobileConfig.horizonMinProjectionRatio > 1) throw new Error('invalid_mobile_capture_config');
