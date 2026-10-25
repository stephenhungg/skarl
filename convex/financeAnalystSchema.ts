import { defineTable } from "convex/server";
import { v } from "convex/values";

export const analystKind = v.union(v.literal("exception"), v.literal("payout"), v.literal("close"));
export const analystRecommendation = v.union(v.literal("approve"), v.literal("reject"), v.literal("needs_info"));
export const analystProvider = v.union(v.literal("claude"), v.literal("gemini"));
export const financeAnalystTables = {
  // Advisory output only. No finance mutation reads this table as authorization.
  analystNotes: defineTable({
    organizationId: v.id("organizations"), orderId: v.id("orders"), kind: analystKind,
    itemKey: v.string(), exceptionKey: v.optional(v.string()), intentId: v.optional(v.id("paymentIntents")),
    promptVersion: v.string(), status: v.union(v.literal("queued"), v.literal("running"), v.literal("completed"), v.literal("provider_error")),
    summary: v.string(), evidenceCited: v.array(v.string()), recommendation: analystRecommendation,
    confidence: v.number(), provider: analystProvider, model: v.string(),
    settlement: v.optional(v.union(v.literal("chain_observed"), v.literal("policy_approved"))),
    txUrl: v.optional(v.string()), checksPassed: v.optional(v.array(v.string())),
    transcriptJson: v.string(), factsJson: v.optional(v.string()), failureCode: v.optional(v.string()),
    attempts: v.number(), createdAt: v.number(), startedAt: v.optional(v.number()), completedAt: v.optional(v.number()),
  }).index("by_item", ["organizationId", "kind", "itemKey", "promptVersion"])
    .index("by_order", ["orderId"]).index("by_org_kind", ["organizationId", "kind"])
    .index("by_status", ["status"]),
  financeAnalystGate: defineTable({ key: v.string(), windowStart: v.number(), runs: v.number() }).index("by_key", ["key"]),
};
