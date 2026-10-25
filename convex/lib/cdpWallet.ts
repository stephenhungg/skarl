import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { PAYMENT_CHAIN_ID } from "../../packages/contracts/src/chain";
import { requireRole } from "./demoAuth";
import { normalizeAddress, requireTenant } from "./finance";

/** Operator-only policy inputs, never supplied by model output or the browser. */
export const allowlist = internalQuery({
  args: {},
  handler: async (ctx): Promise<string[]> => {
    const agent = await requireRole(ctx, "finance-agent", "finance-agent");
    const members = await ctx.db.query("memberships").withIndex("by_org_identity", q =>
      q.eq("organizationId", agent.organizationId)).collect();
    return [...new Set(members.filter(member => member.status === "active" &&
      member.roles.includes("contributor") && !member.roles.includes("controller") &&
      member.walletAddress && member.walletVerification?.chainId === PAYMENT_CHAIN_ID &&
      member.walletVerification.verifiedAt > 0 && member.walletVerification.verifiedAt <= Date.now() &&
      member.walletVerification.siweMessageHash && member.walletVerification.nonce && member.walletVerification.signature)
      .map(member => normalizeAddress(member.walletAddress!)))].sort();
  },
});

export const context = internalQuery({
  args: { intentId: v.id("paymentIntents") },
  handler: async (ctx, args) => {
    const agent = await requireRole(ctx, "finance-agent", "finance-agent");
    const intent = await ctx.db.get(args.intentId);
    if (!intent || intent.kind !== "contributor_payout") throw new Error("payout_not_found");
    requireTenant(agent, intent);
    const attempt = await ctx.db.query("paymentAttempts").withIndex("by_intent", q =>
      q.eq("paymentIntentId", intent._id)).unique();
    return { intent, attempt };
  },
});

/** A failure never releases the claim: the send may have reached CDP. */
export const uncertain = internalMutation({
  args: { attemptId: v.id("paymentAttempts") },
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt || attempt.status === "confirmed") return;
    await ctx.db.patch(attempt._id, { status: "reconciling", lastErrorCode: "cdp_execution_requires_reconciliation", updatedAt: Date.now() });
  },
});
