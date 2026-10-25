import { defineTable } from "convex/server";
import { v } from "convex/values";

/** Advisory explanations have no references to payment commands or approvals. */
export const coachTables = {
  coachExplanations: defineTable({
    organizationId: v.id("organizations"), submissionId: v.id("submissions"),
    contributorTokenIdentifier: v.string(), analysisId: v.id("analysisResults"),
    sourceKey: v.string(), reportHash: v.string(), model: v.string(),
    promptVersion: v.string(), inputJson: v.string(),
    status: v.union(v.literal("running"), v.literal("completed"), v.literal("unavailable")),
    generation: v.number(), startedAt: v.number(), completedAt: v.optional(v.number()),
    outputJson: v.optional(v.string()), failureCode: v.optional(v.string()),
  }).index("by_source", ["submissionId", "sourceKey"])
    .index("by_submission", ["submissionId"]),
};
