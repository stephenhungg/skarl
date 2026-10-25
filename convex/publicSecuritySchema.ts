import { defineTable } from "convex/server";
import { v } from "convex/values";

export const publicSecurityTables = {
  // Only digests of request fingerprints are persisted, never raw headers/keys.
  publicRateBuckets: defineTable({ key: v.string(), tokens: v.number(), updatedAt: v.number() })
    .index("by_key", ["key"]).index("by_updated", ["updatedAt"]),
  requestIdempotency: defineTable({ scope: v.string(), keyHash: v.string(), requestHash: v.string(),
    resultJson: v.string(), createdAt: v.number() }).index("by_scope_key", ["scope", "keyHash"]),
};
