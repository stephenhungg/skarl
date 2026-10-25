import { defineTable } from "convex/server";
import { v } from "convex/values";
export const attestationFields = v.object({
  reportHash: v.string(), sourceSha256: v.string(), rubricHash: v.string(), pipelineVersion: v.string(),
  videoModel: v.string(), recommendation: v.union(v.literal("accept"), v.literal("needs_review"), v.literal("request_correction")),
  verifiedAt: v.number(), licensed: v.boolean(),
});
export const attestationTables = {
  attestations: defineTable({
    analysisId: v.id("analysisResults"), submissionId: v.id("submissions"), schemaUid: v.string(),
    attestor: v.string(), fields: v.optional(attestationFields), requestId: v.string(),
    status: v.union(v.literal("pending"), v.literal("submitted"), v.literal("confirmed"), v.literal("failed")),
    attestationUid: v.optional(v.string()), txHash: v.optional(v.string()), logIndex: v.optional(v.number()),
    error: v.optional(v.string()), startBlock: v.optional(v.string()), firstSendAt: v.optional(v.number()),
    attempt: v.optional(v.number()), previousAttempts: v.optional(v.array(v.object({ txHash: v.string(), requestId: v.string() }))),
    generation: v.number(), leaseUntil: v.number(), nextRetryAt: v.number(), createdAt: v.number(), updatedAt: v.number(),
  }).index("by_analysis", ["analysisId"]).index("by_submission", ["submissionId"]).index("by_retry", ["status", "nextRetryAt"]),
};
