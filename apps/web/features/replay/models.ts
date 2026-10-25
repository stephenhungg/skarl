import { webConfig } from "../../lib/config";
/** Browser-only advisory adapters. No payment, verdict, or acceptance APIs live here. */
export type ModelInfo = { name: string; version: string; runtime: "browser-wasm" | "browser-webgpu" };
export type Hand = { handedness: "Left" | "Right"; score: number; keypoints: [number, number, number][] };
export type ObjectDetection = { label: string; score: number; box: [number, number, number, number] };
export type Mask = {
  label?: string; prompt: { x: number; y: number }; score: number;
  bbox: [number, number, number, number]; areaFrac: number; polygon?: [number, number][];
};
export type ModelProgress = (message: string, percent?: number) => void;
export type HandsAdapter = { model: ModelInfo; detect(video: HTMLVideoElement, tMs: number): Hand[]; close(): void };
export type ObjectsAdapter = { model: ModelInfo; detect(video: HTMLVideoElement, tMs: number): ObjectDetection[]; close(): void };
export type SegmenterAdapter = {
  model: ModelInfo;
  segment(image: HTMLCanvasElement, prompt: { x: number; y: number }): Promise<{ mask: Mask; bitmap: ImageData }>;
  close(): void;
};

const MEDIAPIPE_VERSION = webConfig.mediapipeVersion;
const WASM_ROOT = webConfig.mediapipeWasmRoot;
export const HAND_MODEL: ModelInfo = { name: webConfig.handModelName, version: `${webConfig.handModelVersion}; tasks-vision@${MEDIAPIPE_VERSION}`, runtime: "browser-wasm" };
export const OBJECT_MODEL: ModelInfo = { name: webConfig.objectModelName, version: `${webConfig.objectModelVersion}; tasks-vision@${MEDIAPIPE_VERSION}`, runtime: "browser-wasm" };
export const SAM_REPOSITORY = webConfig.segmentModelRepository;
export const SAM_REVISION = webConfig.segmentModelRevision;
export const SEGMENT_MODEL: ModelInfo = { name: webConfig.segmentModelName, version: `${SAM_REVISION}; transformers.js@4.3.1`, runtime: "browser-wasm" };
export const HAND_MODEL_URL = webConfig.handModelUrl;
export const OBJECT_MODEL_URL = webConfig.objectModelUrl;

/** v1 requires unit coordinates. MediaPipe's native signed wrist-relative z is encoded as clamp(z + .5). */
export const HAND_DEPTH_ENCODING = "z = clamp(native wrist-relative z + 0.5, 0, 1); x/y = clamped image-normalized coordinates";
const unit = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

async function modelBytes(url: string, progress: ModelProgress, name: string) {
  progress(`Downloading ${name}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${name} download failed (${response.status}). Try again when the model CDN is available.`);
  const length = Number(response.headers.get("Content-Length"));
  if (!response.body || !length) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0, lastPercent = -1;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    const percent = Math.min(99, Math.round(loaded / length * 100));
    if (percent !== lastPercent) { progress(`Downloading ${name}`, percent); lastPercent = percent; }
  }
  const data = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  return data;
}

/** Graph time must increase even when media time moves backwards during seek/replay. */
function graphClock() {
  let last = -1;
  return (mediaTimeMs: number) => (last = Math.max(last + 1, Number.isFinite(mediaTimeMs) ? mediaTimeMs : 0));
}

export async function loadHands(progress: ModelProgress = () => {}): Promise<HandsAdapter> {
  progress("Loading MediaPipe runtime");
  const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
  const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
  const modelAssetBuffer = await modelBytes(HAND_MODEL_URL, progress, HAND_MODEL.name);
  progress("Starting hand landmarks in WASM");
  // MediaPipe's GPU delegate is WebGL, not WebGPU. WASM keeps runtime metadata truthful.
  const task = await HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetBuffer, delegate: "CPU" }, runningMode: "VIDEO", numHands: webConfig.maxHands,
    minHandDetectionConfidence: webConfig.handDetectionConfidence, minHandPresenceConfidence: webConfig.handPresenceConfidence, minTrackingConfidence: webConfig.handTrackingConfidence,
  });
  const clock = graphClock();
  progress("Hand landmarks ready", 100);
  return {
    model: { ...HAND_MODEL },
    detect(video, tMs) {
      const result = task.detectForVideo(video, clock(tMs));
      return result.landmarks.flatMap((landmarks, i) => {
        const category = result.handedness[i]?.[0];
        if (!category || landmarks.length !== 21 || (category.categoryName !== "Left" && category.categoryName !== "Right")) return [];
        return [{ handedness: category.categoryName, score: unit(category.score),
          keypoints: landmarks.map(point => [unit(point.x), unit(point.y), unit(point.z + 0.5)] as [number, number, number]) }];
      });
    },
    close() { task.close(); },
  };
}

export async function loadObjects(progress: ModelProgress = () => {}): Promise<ObjectsAdapter> {
  progress("Loading MediaPipe runtime");
  const { FilesetResolver, ObjectDetector } = await import("@mediapipe/tasks-vision");
  const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
  const modelAssetBuffer = await modelBytes(OBJECT_MODEL_URL, progress, OBJECT_MODEL.name);
  progress(`Starting ${OBJECT_MODEL.name} in WASM`);
  const task = await ObjectDetector.createFromOptions(vision, {
    baseOptions: { modelAssetBuffer, delegate: "CPU" }, runningMode: "VIDEO", scoreThreshold: webConfig.objectScoreThreshold, maxResults: webConfig.objectMaxResults,
  });
  const clock = graphClock();
  progress("Object detection ready", 100);
  return {
    model: { ...OBJECT_MODEL },
    detect(video, tMs) {
      const result = task.detectForVideo(video, clock(tMs));
      return result.detections.flatMap(detection => {
        const box = detection.boundingBox, category = detection.categories[0];
        if (!box || !category || !video.videoWidth || !video.videoHeight) return [];
        const x = unit(box.originX / video.videoWidth), y = unit(box.originY / video.videoHeight);
        const right = unit((box.originX + box.width) / video.videoWidth), bottom = unit((box.originY + box.height) / video.videoHeight);
        return [{ label: category.categoryName || category.displayName || "Unlabelled object", score: unit(category.score),
          box: [x, y, Math.max(0, right - x), Math.max(0, bottom - y)] as [number, number, number, number] }];
      });
    },
    close() { task.close(); },
  };
}

export async function loadSegmenter(progress: ModelProgress = () => {}): Promise<SegmenterAdapter> {
  progress("Loading Transformers.js runtime");
  const transformers = await import("@huggingface/transformers");
  transformers.env.allowLocalModels = false;
  // A single WASM thread works without cross-origin isolation headers.
  if (transformers.env.backends.onnx.wasm) transformers.env.backends.onnx.wasm.numThreads = 1;
  let lastProgress = "";
  const progress_callback: NonNullable<Parameters<typeof transformers.Sam2Model.from_pretrained>[1]>["progress_callback"] = event => {
    const file = "file" in event ? event.file : "SAM2.1";
    const percent = "progress" in event ? Math.round(event.progress) : undefined;
    const key = `${file}:${percent ?? event.status}`;
    if (key !== lastProgress) { progress(`Loading ${file}`, percent); lastProgress = key; }
  };
  const processor = await transformers.AutoProcessor.from_pretrained(SAM_REPOSITORY, { revision: SAM_REVISION, progress_callback });
  if (!(processor instanceof transformers.Sam2Processor)) throw new Error("This Transformers.js runtime cannot process SAM2.1 images.");
  let device: "webgpu" | "wasm" = "wasm";
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (gpu) {
    try { if (await gpu.requestAdapter()) device = "webgpu"; } catch { /* WASM remains available. */ }
  }
  const options = { revision: SAM_REVISION, progress_callback, use_external_data_format: true };
  let model: Awaited<ReturnType<typeof transformers.Sam2Model.from_pretrained>>;
  try {
    model = await transformers.Sam2Model.from_pretrained(SAM_REPOSITORY, { ...options, device, dtype: device === "webgpu" ? "fp16" : "q8" });
  } catch (error) {
    if (device !== "webgpu") throw error;
    progress("WebGPU unavailable for SAM2.1; loading WASM fallback");
    device = "wasm";
    model = await transformers.Sam2Model.from_pretrained(SAM_REPOSITORY, { ...options, device, dtype: "q8" });
  }
  progress(`SAM2.1 ready (${device === "webgpu" ? "WebGPU" : "WASM"})`, 100);
  return {
    model: { ...SEGMENT_MODEL, runtime: device === "webgpu" ? "browser-webgpu" : "browser-wasm" },
    async segment(image, prompt) {
      if (!image.width || !image.height) throw new Error("Pause on a decoded video frame before segmenting.");
      const point = { x: unit(prompt.x), y: unit(prompt.y) };
      const raw = transformers.RawImage.fromCanvas(image);
      const inputs = await processor(raw, { input_points: [[[[point.x * image.width, point.y * image.height]]]], input_labels: [[[1]]] });
      let outputs: import("@huggingface/transformers").Sam2ImageSegmentationOutput | undefined;
      let masks: import("@huggingface/transformers").Tensor[] = [];
      try {
        outputs = await model(inputs);
        if (!outputs) throw new Error("SAM2.1 returned no result.");
        masks = await processor.post_process_masks(outputs.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
        const scores = Array.from(outputs.iou_scores.data, Number);
        if (!scores.length || !masks[0]) throw new Error("SAM2.1 returned no mask.");
        let best = 0;
        scores.forEach((score, i) => { if (score > scores[best]!) best = i; });
        const width = image.width, height = image.height, pixels = width * height;
        const data = masks[0].data, offset = best * pixels;
        const bitmap = new ImageData(width, height);
        let count = 0, xMin = width, yMin = height, xMax = -1, yMax = -1;
        for (let i = 0; i < pixels; i++) {
          if (!data[offset + i]) continue;
          count++;
          const x = i % width, y = Math.floor(i / width);
          xMin = Math.min(xMin, x); yMin = Math.min(yMin, y); xMax = Math.max(xMax, x); yMax = Math.max(yMax, y);
          // White is neutral overlay ink; the renderer controls visual blending.
          bitmap.data[i * 4] = 255; bitmap.data[i * 4 + 1] = 255; bitmap.data[i * 4 + 2] = 255; bitmap.data[i * 4 + 3] = 105;
        }
        const bbox: Mask["bbox"] = count ? [xMin / width, yMin / height, (xMax - xMin + 1) / width, (yMax - yMin + 1) / height] : [0, 0, 0, 0];
        return { mask: { prompt: point, score: unit(scores[best]!), bbox, areaFrac: count / pixels }, bitmap };
      } finally {
        for (const value of Object.values(inputs)) if (value instanceof transformers.Tensor) value.dispose();
        outputs?.pred_masks.dispose(); outputs?.iou_scores.dispose(); outputs?.object_score_logits.dispose();
        masks.forEach(mask => mask.dispose());
      }
    },
    close() { void model.dispose().catch(() => {}); },
  };
}
