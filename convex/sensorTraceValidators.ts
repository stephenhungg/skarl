import { v } from "convex/values";

export const sensorName = v.union(v.literal("accelerometer"), v.literal("gyroscope"), v.literal("deviceMotion"));
export const sensorDevice = v.object({
  model: v.string(), os: v.string(), osVersion: v.string(), appVersion: v.string(), cameraFacing: v.literal("back"),
  requestedVideoQuality: v.literal("720p"), resolution: v.optional(v.string()), fps: v.optional(v.number()),
});
const nullableNumber = v.union(v.number(), v.null());
export const motionSummary = v.object({
  source: v.literal("clientReported"), version: v.literal(1), binWidthMs: v.literal(250),
  accelRmsG: nullableNumber, gyroRmsRadPerSec: nullableNumber, linearAccelerationRmsMps2: nullableNumber,
  activeMotionIntervals: v.array(v.object({ startMs: v.number(), endMs: v.number() })),
  bins: v.array(v.object({ startMs: v.number(), endMs: v.number(), sampleCount: v.number(),
    accelRmsG: nullableNumber, gyroRmsRadPerSec: nullableNumber, linearAccelerationRmsMps2: nullableNumber, active: v.boolean() })),
});
export const sensorTrace = v.object({
  storageId: v.id("_storage"), sampleRateHz: v.number(), sampleCount: v.number(), durationMs: v.number(),
  sensors: v.array(sensorName), device: sensorDevice, recordedAt: v.string(), clock: v.literal("js-callback-performance-now"),
  sizeBytes: v.number(), attachedAt: v.number(), motionSummary,
});
