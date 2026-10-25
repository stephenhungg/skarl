import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { envNumber } from "./lib/config";

/** Abuse control for the public testnet-USDC faucet: per address, per caller and global windows. */
export const reserveFaucet = internalMutation({
  args: { address: v.string(), ipDigest: v.string() },
  handler: async (ctx, args) => {
    const windowMs = envNumber("SKARL_FAUCET_WINDOW_MS", 3_600_000, 60_000);
    const now = Date.now(), windowStart = Math.floor(now / windowMs) * windowMs;
    const limits = await Promise.all([
      { key: `faucet:address:${args.address.toLowerCase()}`, limit: envNumber("SKARL_FAUCET_PER_ADDRESS", 2, 1) },
      { key: `faucet:ip:${args.ipDigest}`, limit: envNumber("SKARL_FAUCET_PER_CALLER", 3, 1) },
      { key: "faucet:global", limit: envNumber("SKARL_FAUCET_GLOBAL", 40, 1) },
    ].map(async limit => {
      const row = await ctx.db.query("demoOrderLimits").withIndex("by_key", q => q.eq("key", limit.key)).unique();
      return { ...limit, row, count: row?.windowStart === windowStart ? row.count : 0 };
    }));
    if (limits.some(limit => limit.count >= limit.limit)) {
      return { ok: false as const, code: "faucet_rate_limited" as const, retryAfterSeconds: Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)) };
    }
    for (const limit of limits) {
      const value = { key: limit.key, windowStart, count: limit.count + 1 };
      if (limit.row) await ctx.db.patch(limit.row._id, value);
      else await ctx.db.insert("demoOrderLimits", value);
    }
    return { ok: true as const };
  },
});
