import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { healthCron, healthProbe, jiraHealth } from "./healthSchema";
import { PAYMENT_NETWORK } from "../packages/contracts/src/chain";

export const probeInputs = internalQuery({ args: {}, handler: async ctx => {
  const org = await ctx.db.query("organizations").withIndex("by_demo_key", q => q.eq("demoKey", "skarl-demo-v1")).unique();
  if (!org) return { treasury: null, bankAccountId: null };
  const order = await ctx.db.query("orders").withIndex("by_public_id", q => q.eq("publicId", "skarl-red-cup-demo-v2")).unique();
  const funding = order?.organizationId === org._id ? await ctx.db.query("paymentIntents").withIndex("by_order", q => q.eq("orderId", order._id))
    .filter(q => q.and(q.eq(q.field("network"), PAYMENT_NETWORK), q.neq(q.field("kind"), "contributor_payout"))).order("desc").first() : null;
  const bank = await ctx.db.query("bankAccounts").withIndex("by_owner", q => q.eq("organizationId", org._id).eq("owner", "treasury")).unique();
  return { treasury: funding?.recipientAddress ?? null, bankAccountId: bank?.accountId ?? null };
} });

export const storeProbes = internalMutation({ args: { probes: v.array(healthProbe) }, handler: async (ctx, { probes }) => {
  for (const probe of probes) {
    const prior = await ctx.db.query("healthProbes").withIndex("by_kind", q => q.eq("kind", probe.kind)).unique();
    if (prior && prior.checkedAt > probe.checkedAt) continue;
    // Replace so a failed probe cannot leave an old balance looking current.
    if (prior) await ctx.db.replace(prior._id, probe); else await ctx.db.insert("healthProbes", probe);
  }
} });

export const startCron = internalMutation({ args: { job: healthCron }, handler: async (ctx, { job }) =>
  ctx.db.insert("healthCronRuns", { job, startedAt: Date.now(), outcome: "running" }) });
export const finishCron = internalMutation({ args: { id: v.id("healthCronRuns"),
  outcome: v.union(v.literal("complete"), v.literal("disabled"), v.literal("failed")) }, handler: async (ctx, args) => {
  await ctx.db.patch(args.id, { completedAt: Date.now(), outcome: args.outcome });
  // Bound telemetry storage per job; this is not financial/audit evidence.
  const row = await ctx.db.get(args.id);
  if (row) for (const old of (await ctx.db.query("healthCronRuns").withIndex("by_job", q => q.eq("job", row.job)).order("desc").take(40)).slice(20)) await ctx.db.delete(old._id);
} });

export const recordJira = internalMutation({ args: jiraHealth, handler: async (ctx, args) => {
  const now = Date.now();
  if (!Number.isSafeInteger(args.lastSyncAt) || args.lastSyncAt < 0 || args.lastSyncAt > now + 60_000 ||
    !Number.isSafeInteger(args.uncertainCount) || args.uncertainCount < 0 || args.uncertainCount > 1_000_000) throw new Error("invalid_health_telemetry");
  const prior = await ctx.db.query("healthJira").first();
  if (prior && prior.lastSyncAt > args.lastSyncAt) return;
  const value = { ...args, receivedAt: now };
  if (prior) await ctx.db.replace(prior._id, value); else await ctx.db.insert("healthJira", value);
} });
