/** Runtime defaults live here; task content and commercial terms belong to order data. */
const positive = (value: string | undefined, fallback: number) => {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("invalid_web_numeric_config");
  return parsed;
};
const positiveAtomic = (value: string | undefined, fallback: string) => {
  const parsed = BigInt(value ?? fallback);
  if (parsed <= 0n) throw new Error("invalid_web_integer_config");
  return parsed;
};
const cleanOrigin = (value: string) => new URL(value).origin;
export const webConfig = {
  captureMinSeconds: positive(process.env.NEXT_PUBLIC_CAPTURE_MIN_SECONDS, 10),
  captureMaxSeconds: positive(process.env.NEXT_PUBLIC_CAPTURE_MAX_SECONDS, 30),
  captureMaxBytes: positive(process.env.NEXT_PUBLIC_CAPTURE_MAX_BYTES, 25 * 1024 * 1024),
  captureVideoBitsPerSecond: positive(process.env.NEXT_PUBLIC_CAPTURE_VIDEO_BITS_PER_SECOND, 2_500_000),
  captureWidth: positive(process.env.NEXT_PUBLIC_CAPTURE_WIDTH, 1280),
  captureHeight: positive(process.env.NEXT_PUBLIC_CAPTURE_HEIGHT, 720),
  captureFrameRate: positive(process.env.NEXT_PUBLIC_CAPTURE_FRAME_RATE, 30),
  uploadTimeoutMs: positive(process.env.NEXT_PUBLIC_UPLOAD_TIMEOUT_MS, 120_000),
  mediaTokenMaxLength: positive(process.env.SKARL_MEDIA_TOKEN_MAX_LENGTH, 2048),
  rpcUrl: process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
  rpcTimeoutMs: positive(process.env.SKARL_RPC_TIMEOUT_MS, 15_000),
  rpcRetryCount: Number(process.env.SKARL_RPC_RETRY_COUNT ?? 1),
  receiptTimeoutMs: positive(process.env.SKARL_RECEIPT_TIMEOUT_MS, 20_000),
  webhookMaxBytes: positive(process.env.SKARL_WEBHOOK_MAX_BYTES, 64_000),
  webhookHeaderMaxLength: positive(process.env.SKARL_WEBHOOK_HEADER_MAX_LENGTH, 2048),
  webhookToleranceMs: positive(process.env.SKARL_WEBHOOK_TOLERANCE_MS, 300_000),
  datasetRefreshMs: positive(process.env.SKARL_DATASET_REFRESH_MS, 60_000),
  healthTimeoutMs: positive(process.env.SKARL_HEALTH_TIMEOUT_MS, 5_000),
  replayDecodeTimeoutMs: positive(process.env.NEXT_PUBLIC_REPLAY_DECODE_TIMEOUT_MS, 20_000),
  publicOrigin: cleanOrigin(process.env.NEXT_PUBLIC_SKARL_ORIGIN ?? "https://skarl.devshardat.work"),
  convexSiteOrigin: cleanOrigin(process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "https://keen-marmot-986.convex.site"),
  mediaFetchTimeoutMs: positive(process.env.SKARL_MEDIA_FETCH_TIMEOUT_MS, 30_000),
  reconcileLookbackBlocks: positiveAtomic(process.env.SKARL_RECONCILE_LOOKBACK_BLOCKS, "10000"),
  reconcileChunkBlocks: positiveAtomic(process.env.SKARL_RECONCILE_CHUNK_BLOCKS, "1000"),
  publicOrderBodyMaxBytes: positive(process.env.SKARL_PUBLIC_ORDER_BODY_MAX_BYTES, 512),
  replayMaxDurationMs: positive(process.env.NEXT_PUBLIC_REPLAY_MAX_DURATION_MS, 30_500),
  replayMaxBytes: positive(process.env.NEXT_PUBLIC_REPLAY_MAX_BYTES, 8 * 1024 * 1024),
  replayFrameToleranceMs: positive(process.env.NEXT_PUBLIC_REPLAY_FRAME_TOLERANCE_MS, 150),
  replayMaxTraceMs: positive(process.env.NEXT_PUBLIC_REPLAY_MAX_TRACE_MS, 31_000),
  replayMaxSamples: positive(process.env.NEXT_PUBLIC_REPLAY_MAX_SAMPLES, 31_000),
  replayMaxSensorMagnitude: positive(process.env.NEXT_PUBLIC_REPLAY_MAX_SENSOR_MAGNITUDE, 10_000),
  replayEvidenceTextMax: positive(process.env.NEXT_PUBLIC_REPLAY_EVIDENCE_TEXT_MAX, 2000),
  replayEvidenceRowsMax: positive(process.env.NEXT_PUBLIC_REPLAY_EVIDENCE_ROWS_MAX, 100),
  replayJudgeMax: positive(process.env.NEXT_PUBLIC_REPLAY_JUDGE_MAX, 16),
  replayMotionBinMs: positive(process.env.NEXT_PUBLIC_REPLAY_MOTION_BIN_MS, 100),
  gyroThresholdRadPerSec: positive(process.env.NEXT_PUBLIC_GYRO_THRESHOLD_RAD_PER_SEC, 0.15),
  mediapipeVersion: process.env.NEXT_PUBLIC_MEDIAPIPE_VERSION ?? "1.1.1",
  mediapipeWasmRoot: process.env.NEXT_PUBLIC_MEDIAPIPE_WASM_ROOT ?? `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${process.env.NEXT_PUBLIC_MEDIAPIPE_VERSION ?? "1.1.1"}/wasm`,
  handModelName: process.env.NEXT_PUBLIC_HAND_MODEL_NAME ?? "MediaPipe Hand Landmarker",
  handModelVersion: process.env.NEXT_PUBLIC_HAND_MODEL_VERSION ?? "float16/1",
  handModelUrl: process.env.NEXT_PUBLIC_HAND_MODEL_URL ?? "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
  objectModelName: process.env.NEXT_PUBLIC_OBJECT_MODEL_NAME ?? "MediaPipe EfficientDet-Lite0",
  objectModelVersion: process.env.NEXT_PUBLIC_OBJECT_MODEL_VERSION ?? "float32/1",
  objectModelUrl: process.env.NEXT_PUBLIC_OBJECT_MODEL_URL ?? "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float32/1/efficientdet_lite0.tflite",
  segmentModelName: process.env.NEXT_PUBLIC_SEGMENT_MODEL_NAME ?? "SAM2.1 Hiera Tiny",
  segmentModelRepository: process.env.NEXT_PUBLIC_SEGMENT_MODEL_REPOSITORY ?? "onnx-community/sam2.1-hiera-tiny-ONNX",
  segmentModelRevision: process.env.NEXT_PUBLIC_SEGMENT_MODEL_REVISION ?? "814a066640debee5a91e70aa401fb8e17e030503",
  handDetectionConfidence: positive(process.env.NEXT_PUBLIC_HAND_DETECTION_CONFIDENCE, 0.5),
  handPresenceConfidence: positive(process.env.NEXT_PUBLIC_HAND_PRESENCE_CONFIDENCE, 0.5),
  handTrackingConfidence: positive(process.env.NEXT_PUBLIC_HAND_TRACKING_CONFIDENCE, 0.5),
  objectScoreThreshold: positive(process.env.NEXT_PUBLIC_OBJECT_SCORE_THRESHOLD, 0.4),
  objectMaxResults: positive(process.env.NEXT_PUBLIC_OBJECT_MAX_RESULTS, 15),
  maxHands: positive(process.env.NEXT_PUBLIC_MAX_HANDS, 2),
} as const;
export const paymentOrigin = () => cleanOrigin(process.env.SKARL_PAYMENT_ORIGIN ?? "https://skarl.vercel.app");
export const mcpUrl = `${webConfig.convexSiteOrigin}/mcp`;

if (webConfig.captureMinSeconds > webConfig.captureMaxSeconds || !Number.isSafeInteger(webConfig.rpcRetryCount) || webConfig.rpcRetryCount < 0) throw new Error("invalid_web_capture_or_rpc_config");
