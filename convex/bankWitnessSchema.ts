import { defineTable } from "convex/server";
import { v } from "convex/values";

/** Nessie is simulated bank evidence, never a cash ledger or payment authority. */
export const bankWitnessTables = {
  bankAccounts: defineTable({
    organizationId: v.id("organizations"), owner: v.string(), nickname: v.string(),
    status: v.union(v.literal("new"), v.literal("creating_customer"), v.literal("customer_ready"),
      v.literal("creating_account"), v.literal("ready")),
    customerId: v.optional(v.string()), accountId: v.optional(v.string()),
    errorCode: v.optional(v.string()), updatedAt: v.number(),
  }).index("by_owner", ["organizationId", "owner"]),
  bankOperations: defineTable({
    organizationId: v.id("organizations"), orderId: v.id("orders"), paymentIntentId: v.id("paymentIntents"),
    intentId: v.string(), kind: v.union(v.literal("deposit"), v.literal("transfer")), amountAtomic: v.int64(),
    accountId: v.string(), payeeId: v.optional(v.string()),
    status: v.union(v.literal("sending"), v.literal("submitted"), v.literal("uncertain"), v.literal("observed")),
    activityId: v.optional(v.string()), errorCode: v.optional(v.string()), createdAt: v.number(), updatedAt: v.number(),
  }).index("by_intent", ["paymentIntentId"]).index("by_order", ["orderId"]).index("by_org", ["organizationId"]),
  bankSnapshots: defineTable({
    organizationId: v.id("organizations"), accountId: v.string(),
    status: v.union(v.literal("available"), v.literal("unavailable")),
    activitiesJson: v.string(), reason: v.optional(v.string()), fetchedAt: v.number(),
  }).index("by_org", ["organizationId"]),
};
