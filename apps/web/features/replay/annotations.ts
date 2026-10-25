import type { Hand, ObjectDetection } from "./models";
import { detectorClassForObject } from "../../../../convex/lib/taskSpec";
import { validateAnnotationFile, type AnnotationFile, type AnnotationFrame, type AnnotationKind } from "../../../../convex/lib/derivedAnnotations";

export type { AnnotationFile, AnnotationFrame };
export type LayerKind = AnnotationKind;
export type AnnotationModel = AnnotationFile["model"];
export type AnnotationSummary = {
  kind: LayerKind; frames: number; handsDetectedFrames?: number; maxHands?: number;
  objectLabels?: Record<string, number>; cupInHandFrames?: number; masks?: number; durationMs: number;
};

export function objectInHand(hands: Hand[], objects: ObjectDetection[], taskObject?: string): boolean {
  const detectorClass = taskObject ? detectorClassForObject(taskObject) : null;
  if (!detectorClass) return false;
  return objects.some(object => object.score > 0 && object.label.toLowerCase() === detectorClass && hands.some(hand => {
    if (hand.score <= 0 || !hand.keypoints.length) return false;
    const xs = hand.keypoints.map(point => point[0]), ys = hand.keypoints.map(point => point[1]);
    const [x, y, w, h] = object.box;
    return Math.max(x, Math.min(...xs)) < Math.min(x + w, Math.max(...xs)) &&
      Math.max(y, Math.min(...ys)) < Math.min(y + h, Math.max(...ys));
  }));
}

/** Legacy annotation summaries retain their historical cup-only field. */
export function cupInHand(hands: Hand[], objects: ObjectDetection[]): boolean {
  return objectInHand(hands, objects, "cup");
}

export function summarize(file: AnnotationFile, durationMs: number, pairedFrames?: AnnotationFrame[]): AnnotationSummary {
  const result: AnnotationSummary = { kind: file.kind, frames: file.frames.length, durationMs };
  if (file.kind === "hands") {
    result.handsDetectedFrames = file.frames.filter(frame => (frame.hands?.length ?? 0) > 0).length;
    result.maxHands = Math.max(0, ...file.frames.map(frame => frame.hands?.length ?? 0));
  }
  if (file.kind === "objects") {
    result.objectLabels = {};
    for (const frame of file.frames) for (const object of frame.objects ?? []) {
      result.objectLabels[object.label] = (result.objectLabels[object.label] ?? 0) + 1;
    }
    result.cupInHandFrames = pairedFrames?.filter(frame => cupInHand(frame.hands ?? [], frame.objects ?? [])).length ?? 0;
  }
  if (file.kind === "masks") result.masks = file.frames.reduce((count, frame) => count + (frame.masks?.length ?? 0), 0);
  return result;
}

/** Strict nearest-sample window: never paint a distant detection onto an unrelated frame. */
export function frameAt(frames: AnnotationFrame[], tMs: number, toleranceMs = 150): AnnotationFrame | undefined {
  let best: AnnotationFrame | undefined;
  for (const frame of frames) if (Math.abs(frame.tMs - tMs) <= toleranceMs &&
    (!best || Math.abs(frame.tMs - tMs) < Math.abs(best.tMs - tMs))) best = frame;
  return best;
}

/** Reuse the canonical validator; stored JSON remains untrusted after authorized upload. */
export function readAnnotationFile(value: unknown, submissionId: string, sourceSha256: string | undefined): AnnotationFile {
  const file = validateAnnotationFile(value);
  if (file.submissionId !== submissionId || !sourceSha256 || file.sourceSha256 !== sourceSha256) {
    throw new Error("Saved annotations do not match the current original.");
  }
  return file;
}
