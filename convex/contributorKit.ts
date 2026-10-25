import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireRole } from "./lib/demoAuth";
import { requireTenant } from "./lib/finance";
import { configNumber } from "./lib/config";
import { isContributorTask } from "./dashboard";

const OPEN = ["funded", "collecting"];

/** Contributor-visible task: what to record and what it pays. Never buyer balances, wallets or other contributors. */
function taskView(order: Doc<"orders">, rubric: Doc<"rubricVersions"> | null, now: number) {
  const remaining = order.quantityRequested - order.acceptedCount;
  return { orderId: order._id, title: order.title, status: order.status,
    payPerClipAtomic: order.contributorRateAtomic.toString(), remainingClips: (remaining > 0n ? remaining : 0n).toString(),
    deadlineAt: order.deadlineAt, hoursLeft: Math.max(0, Math.floor((order.deadlineAt - now) / 3_600_000)),
    open: OPEN.includes(order.status) && order.deadlineAt > now && remaining > 0n,
    prompt: rubric?.taskPrompt ?? null, criteria: rubric?.criteria ?? [], taskSpec: rubric?.taskSpec ?? null,
    maxClipSeconds: configNumber("SKARL_MEDIA_MAX_DURATION_MS") / 1000, currency: "USDC", atomicDecimals: 6 };
}

async function rubricFor(ctx: QueryCtx, order: Doc<"orders">) {
  const rubric = order.taskVersionId ? await ctx.db.get(order.taskVersionId) : null;
  if (rubric && (rubric.organizationId !== order.organizationId || rubric.orderId !== order._id)) throw new Error("cross_organization_reference");
  return rubric;
}

/** Open tasks in the contributor's organization, best-paying first, then soonest deadline. */
export const tasks = query({
  args: { demoIdentity: v.string() },
  handler: async (ctx, args) => {
    const principal = await requireRole(ctx, args.demoIdentity, "contributor");
    const now = Date.now();
    const orders = await ctx.db.query("orders").withIndex("by_org_buyer", q => q.eq("organizationId", principal.organizationId)).collect();
    const views = await Promise.all(orders.filter(isContributorTask).map(async order => taskView(order, await rubricFor(ctx, order), now)));
    const open = views.filter(view => view.open).sort((a, b) =>
      BigInt(b.payPerClipAtomic) > BigInt(a.payPerClipAtomic) ? 1 : BigInt(b.payPerClipAtomic) < BigInt(a.payPerClipAtomic) ? -1 : a.deadlineAt - b.deadlineAt);
    return { tasks: open.slice(0, 20), ranking: "pay_per_clip_desc_then_deadline_asc", demoOnly: true };
  },
});

/** One task with its frozen rubric, for planning a recording. */
export const task = query({
  args: { demoIdentity: v.string(), orderId: v.id("orders") },
  handler: async (ctx, args) => {
    const principal = await requireRole(ctx, args.demoIdentity, "contributor");
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("order_not_found");
    requireTenant(principal, order);
    return taskView(order, await rubricFor(ctx, order), Date.now());
  },
});

/** What still blocks this contributor from getting paid. Statuses only; no form contents or keys. */
export const readiness = query({
  args: { demoIdentity: v.string() },
  handler: async (ctx, args) => {
    const principal = await requireRole(ctx, args.demoIdentity, "contributor");
    const walletVerified = !!principal.walletAddress && !!principal.walletVerification;
    const taxForm = principal.taxProfile?.taxForm ?? "none";
    const checks = [
      { id: "payout_wallet", ok: walletVerified, detail: walletVerified ? `Payouts go to ${principal.walletAddress} (Base Sepolia).` :
        "Call skarl_earnings_wallet_challenge with your wallet address, sign the returned message with your wallet, then skarl_earnings_wallet_verify." },
      { id: "tax_profile", ok: taxForm !== "none", detail: taxForm !== "none" ? `Attested ${taxForm} for ${principal.taxProfile?.country}.` :
        "Call skarl_tax_profile with your country and which form is on file. Without it, payouts at the reporting threshold are held." },
    ];
    return { contributor: principal.tokenIdentifier as string, readyToGetPaid: checks.every(check => check.ok), checks, demoOnly: true };
  },
});

export type ContributorTaskView = ReturnType<typeof taskView>;
