/** Browser-computed, untrusted model evidence. Structural validation is not verification of a model run. */
export const MAX_ANNOTATION_BYTES = 5 * 1024 * 1024;
export const MAX_ANNOTATION_FRAMES = 2000;
export type AnnotationKind = "hands" | "objects" | "masks";
type Point = [number, number];
type Box = [number, number, number, number];
type Hand = { handedness: "Left" | "Right"; score: number; keypoints: [number, number, number][] };
type ObjectDetection = { label: string; score: number; box: Box };
type Mask = { label?: string; prompt: { x: number; y: number }; score: number; bbox: Box; areaFrac: number; polygon?: Point[] };
export type AnnotationFrame = { tMs: number; hands?: Hand[]; objects?: ObjectDetection[]; masks?: Mask[] };
export type AnnotationFile = {
  schema: "skarl.annotations.v1"; submissionId: string; sourceSha256: string; kind: AnnotationKind;
  model: { name: string; version: string; runtime: "browser-wasm" | "browser-webgpu" };
  sampleFps: number; videoWidth: number; videoHeight: number; advisory: true; frames: AnnotationFrame[];
};
function fail(): never { throw new Error("invalid_annotations"); }
function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !allowed.includes(key))) return fail();
  return row;
}
function finite(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) return fail();
  return value;
}
function integer(value: unknown, min: number, max: number): number {
  const result = finite(value, min, max);
  if (!Number.isSafeInteger(result)) return fail();
  return result;
}
function text(value: unknown, max = 160): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) return fail();
  return value;
}
function label(value: unknown): string {
  const result = text(value, 80);
  // Label counts become Convex record keys. Prevent unsafe/reserved object keys.
  if (result.startsWith("$") || ["__proto__", "constructor", "prototype"].includes(result) || !/^[\x20-\x7e]+$/.test(result)) return fail();
  return result;
}
function array<T>(value: unknown, max: number, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > max) return fail();
  return value.map(parse);
}
function point(value: unknown, length: 2): Point;
function point(value: unknown, length: 3): [number, number, number];
function point(value: unknown, length: number): number[] {
  if (!Array.isArray(value) || value.length !== length) return fail();
  return value.map(coordinate => finite(coordinate, 0, 1));
}
function box(value: unknown): Box {
  if (!Array.isArray(value) || value.length !== 4) return fail();
  const result = value.map(coordinate => finite(coordinate, 0, 1)) as Box;
  if (result[0] + result[2] > 1 + 1e-9 || result[1] + result[3] > 1 + 1e-9) return fail();
  return result;
}
function hand(value: unknown): Hand {
  const row = object(value, ["handedness", "score", "keypoints"]);
  if (row.handedness !== "Left" && row.handedness !== "Right") return fail();
  const keypoints = array(row.keypoints, 21, item => point(item, 3));
  if (keypoints.length !== 21) return fail();
  return { handedness: row.handedness, score: finite(row.score, 0, 1), keypoints };
}
function detection(value: unknown): ObjectDetection {
  const row = object(value, ["label", "score", "box"]);
  return { label: label(row.label), score: finite(row.score, 0, 1), box: box(row.box) };
}
function mask(value: unknown): Mask {
  const row = object(value, ["label", "prompt", "score", "bbox", "areaFrac", "polygon"]);
  const prompt = object(row.prompt, ["x", "y"]);
  const polygon = row.polygon === undefined ? undefined : array(row.polygon, 256, item => point(item, 2));
  if (polygon && polygon.length < 3) return fail();
  return { ...(row.label === undefined ? {} : { label: label(row.label) }),
    prompt: { x: finite(prompt.x, 0, 1), y: finite(prompt.y, 0, 1) }, score: finite(row.score, 0, 1),
    bbox: box(row.bbox), areaFrac: finite(row.areaFrac, 0, 1), ...(polygon ? { polygon } : {}) };
}
export function validateAnnotationFile(value: unknown): AnnotationFile {
  const row = object(value, ["schema", "submissionId", "sourceSha256", "kind", "model", "sampleFps", "videoWidth", "videoHeight", "advisory", "frames"]);
  if (row.schema !== "skarl.annotations.v1" || row.advisory !== true || !["hands", "objects", "masks"].includes(String(row.kind))) return fail();
  const kind = row.kind as AnnotationKind, model = object(row.model, ["name", "version", "runtime"]);
  if (model.runtime !== "browser-wasm" && model.runtime !== "browser-webgpu") return fail();
  const sourceSha256 = text(row.sourceSha256);
  if (!/^[a-f0-9]{64}$/.test(sourceSha256)) return fail();
  let previous = -1;
  const frames = array(row.frames, MAX_ANNOTATION_FRAMES, (value): AnnotationFrame => {
    const frame = object(value, ["tMs", "hands", "objects", "masks"]), tMs = finite(frame.tMs, 0, 30_000);
    if (tMs <= previous || frame[kind] === undefined) return fail();
    previous = tMs;
    return { tMs, ...(frame.hands === undefined ? {} : { hands: array(frame.hands, 2, hand) }),
      ...(frame.objects === undefined ? {} : { objects: array(frame.objects, 100, detection) }),
      ...(frame.masks === undefined ? {} : { masks: array(frame.masks, 20, mask) }) };
  });
  const labels = new Set(frames.flatMap(frame => (frame.objects ?? []).map(item => item.label)));
  if (labels.size > 100) return fail();
  return { schema: "skarl.annotations.v1", submissionId: text(row.submissionId), sourceSha256, kind,
    model: { name: text(model.name), version: text(model.version), runtime: model.runtime },
    sampleFps: finite(row.sampleFps, Number.MIN_VALUE, 60), videoWidth: integer(row.videoWidth, 1, 8192),
    videoHeight: integer(row.videoHeight, 1, 8192), advisory: true, frames };
}
/** Class-scoped spatial overlap is advisory evidence, never proof of grasp, color or action. */
export function frameHasObjectInHand(frame: AnnotationFrame, detectorClass: string): boolean {
  const objects = (frame.objects ?? []).filter(item => item.label.trim().toLowerCase() === detectorClass && item.score > 0);
  const hands = (frame.objects ?? []).filter(item => /^(?:(?:left|right)[ _-]?)?hand$/i.test(item.label.trim()) && item.score > 0);
  return objects.some(({ box: [x, y, w, h] }) => w > 0 && h > 0 && (
    hands.some(({ box: [hx, hy, hw, hh] }) => hw > 0 && hh > 0 && Math.min(x + w, hx + hw) > Math.max(x, hx) && Math.min(y + h, hy + hh) > Math.max(y, hy)) ||
    (frame.hands ?? []).some(hand => hand.score > 0 && hand.keypoints.some(([px, py]) => px >= x && px <= x + w && py >= y && py <= y + h))
  ));
}
/** Compatibility summary for old cup-only annotation records. */
export function frameHasCupInHand(frame: AnnotationFrame): boolean {
  return frameHasObjectInHand({ ...frame, objects: frame.objects?.map(item =>
    /^(?:red[ _-]?)?cup$/i.test(item.label.trim()) ? { ...item, label: "cup" } : item) }, "cup");
}
export function summarizeAnnotations(file: AnnotationFile, detectorClass?: string | null) {
  const common = { kind: file.kind, frames: file.frames.length, durationMs: file.frames.at(-1)?.tMs ?? 0 };
  if (file.kind === "hands") return { ...common,
    handsDetectedFrames: file.frames.filter(frame => (frame.hands?.length ?? 0) > 0).length,
    maxHands: Math.max(0, ...file.frames.map(frame => frame.hands?.length ?? 0)) };
  if (file.kind === "objects") {
    const counts = new Map<string, number>();
    for (const frame of file.frames) for (const item of frame.objects ?? []) counts.set(item.label, (counts.get(item.label) ?? 0) + 1);
    return { ...common, objectLabels: Object.fromEntries(counts), cupInHandFrames: file.frames.filter(frameHasCupInHand).length,
      ...(detectorClass === undefined ? {} : { objectInHandFrames: detectorClass ? file.frames.filter(frame => frameHasObjectInHand(frame, detectorClass)).length : 0 }) };
  }
  return { ...common, masks: file.frames.reduce((sum, frame) => sum + (frame.masks?.length ?? 0), 0) };
}
