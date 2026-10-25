import { v } from "convex/values";

export const annotationKind = v.union(v.literal("hands"), v.literal("objects"), v.literal("masks"));
export const annotationModel = v.object({
  name: v.string(), version: v.string(), runtime: v.union(v.literal("browser-wasm"), v.literal("browser-webgpu")),
});
export const annotationSummary = v.object({
  kind: annotationKind, frames: v.number(), handsDetectedFrames: v.optional(v.number()), maxHands: v.optional(v.number()),
  objectLabels: v.optional(v.record(v.string(), v.number())), cupInHandFrames: v.optional(v.number()),
  masks: v.optional(v.number()), durationMs: v.number(),
});
