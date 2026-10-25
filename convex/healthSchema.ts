import { defineTable } from "convex/server";
import { v } from "convex/values";

export const healthProbe = v.object({
  kind: v.union(v.literal("agent_wallet"), v.literal("treasury"), v.literal("nessie")),
  checkedAt: v.number(),
  outcome: v.union(v.literal("success"), v.literal("unconfigured"), v.literal("failed")),
  ethWei: v.optional(v.string()), usdcMicro: v.optional(v.string()),
  blockNumber: v.optional(v.string()),
  bindingHash: v.optional(v.string()),
});
export const healthCron = v.union(v.literal("reconcile"), v.literal("attest"), v.literal("bank"), v.literal("finance"));
export const jiraHealth = {
  lastSyncAt: v.number(), uncertainCount: v.number(), truncated: v.boolean(),
};

/** Operational telemetry only. No credentials, provider bodies, media or prompts. */
export const healthTables = {
  healthProbes: defineTable(healthProbe).index("by_kind", ["kind"]),
  healthCronRuns: defineTable({
    job: healthCron, startedAt: v.number(), completedAt: v.optional(v.number()),
    outcome: v.union(v.literal("running"), v.literal("complete"), v.literal("disabled"), v.literal("failed")),
  }).index("by_job", ["job"]),
  healthJira: defineTable({ ...jiraHealth, receivedAt: v.number() }),
};
