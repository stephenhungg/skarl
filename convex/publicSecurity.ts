import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { PUBLIC_RATE_POLICIES, refillBucket } from "./lib/publicRateLimit";

export const consume = internalMutation({
  args: { surface: v.union(v.literal("mcp"), v.literal("discovery"), v.literal("jira")), fingerprint: v.string() },
  handler: async (ctx, args) => {
    if (!/^[a-f0-9]{64}$/.test(args.fingerprint)) throw new Error("invalid_fingerprint");
    const policy = PUBLIC_RATE_POLICIES[args.surface], now = Date.now();
    const buckets = await Promise.all([
      { key: `${args.surface}:${args.fingerprint}`, capacity: policy.capacity, refillPerMinute: policy.refillPerMinute },
      { key: `${args.surface}:global`, capacity: policy.capacity * 10, refillPerMinute: policy.refillPerMinute * 10 },
    ].map(async ({ key, capacity, refillPerMinute }) => {
      const row = await ctx.db.query("publicRateBuckets").withIndex("by_key", q => q.eq("key", key)).unique();
      const state = refillBucket(row?.tokens ?? capacity, row?.updatedAt ?? now, now, capacity, refillPerMinute);
      return { key, row, ...state };
    }));
    const retryAfterSeconds = Math.max(...buckets.map(bucket => bucket.retryAfterSeconds));
    // Denied requests neither drain the global bucket nor postpone the refill.
    if (retryAfterSeconds) return { allowed: false, retryAfterSeconds };
    for (const bucket of buckets) {
      const value = { key: bucket.key, tokens: bucket.tokens - 1, updatedAt: now };
      if (bucket.row) await ctx.db.patch(bucket.row._id, value);
      else await ctx.db.insert("publicRateBuckets", value);
    }
    return { allowed: true, retryAfterSeconds: 0 };
  },
});

export const sweep = internalMutation({
  args: {},
  handler: async ctx => {
    // A day-idle bucket would already be full; deletion cannot increase its cap.
    const rows = await ctx.db.query("publicRateBuckets").withIndex("by_updated", q => q.lt("updatedAt", Date.now() - 86_400_000)).take(500);
    for (const row of rows) await ctx.db.delete(row._id);
    return { removed: rows.length };
  },
});
