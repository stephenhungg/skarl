import { v } from "convex/values";

export const sensorName = v.union(v.literal("accelerometer"), v.literal("gyroscope"), v.literal("deviceMotion"), v.literal("attitude"), v.literal("gravity"), v.literal("magnetometer"));
export const sensorDevice = v.object({
  model: v.string(), os: v.string(), osVersion: v.string(), appVersion: v.string(), cameraFacing: v.literal("back"),
  requestedVideoQuality: v.literal("720p"), resolution: v.optional(v.string()), fps: v.optional(v.number()),
  codec: v.optional(v.union(v.string(), v.null())), zoom: v.optional(v.number()), requestedCodec: v.optional(v.literal("avc1")),
  metadataSource: v.optional(v.union(v.literal("expo-video"), v.literal("unavailable"))), videoDurationMs: v.optional(v.union(v.number(), v.null())),
  intrinsics: v.optional(v.union(v.null(), v.object({ estimated: v.literal(true), width: v.number(), height: v.number(),
    fx: v.number(), fy: v.number(), cx: v.number(), cy: v.number(), horizontalFovDegrees: v.number(), source: v.string() }))),
});
const nullableNumber = v.union(v.number(), v.null());
export const captureContext = v.object({ mount: v.union(v.literal("handheld"), v.literal("chest"), v.literal("head")),
  dominantHand: v.union(v.literal("left"), v.literal("right")), environment: v.union(v.literal("kitchen"), v.literal("desk"), v.literal("workshop"), v.literal("other")),
  lighting: v.union(v.literal("bright"), v.literal("dim")) });
export const captureSegments = v.array(v.object({ label: v.string(), startMs: v.number(), endMs: v.number() }));
export const motionSummary = v.object({
  source: v.literal("clientReported"), version: v.literal(1), binWidthMs: v.literal(250),
  accelRmsG: nullableNumber, gyroRmsRadPerSec: nullableNumber, linearAccelerationRmsMps2: nullableNumber,
  // Optional so existing version-1 stored summaries remain valid without migration.
  magneticFieldRmsMicroTesla: v.optional(nullableNumber), meanTiltDegrees: v.optional(nullableNumber), steadinessRatio: v.optional(nullableNumber),
  activeMotionIntervals: v.array(v.object({ startMs: v.number(), endMs: v.number() })),
  bins: v.array(v.object({ startMs: v.number(), endMs: v.number(), sampleCount: v.number(),
    accelRmsG: nullableNumber, gyroRmsRadPerSec: nullableNumber, linearAccelerationRmsMps2: nullableNumber, active: v.boolean() })),
});
export const sensorTrace = v.object({
  version: v.optional(v.union(v.literal(1), v.literal(2))),
  videoStartOffsetMs: v.optional(nullableNumber), videoStopOffsetMs: v.optional(nullableNumber),
  syncSource: v.optional(v.literal("expo-recording-progress-estimate")), syncAccuracy: v.optional(v.literal("approximate")),
  segments: v.optional(captureSegments), context: v.optional(captureContext), unavailableSensors: v.optional(v.array(sensorName)),
  storageId: v.id("_storage"), sampleRateHz: v.number(), sampleCount: v.number(), durationMs: v.number(),
  sensors: v.array(sensorName), device: sensorDevice, recordedAt: v.string(), clock: v.literal("js-callback-performance-now"),
  sizeBytes: v.number(), attachedAt: v.number(), motionSummary,
});
