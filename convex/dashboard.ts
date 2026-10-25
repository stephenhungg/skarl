import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireRole } from "./lib/demoAuth";
import { loadLedger, requireTenant } from "./lib/finance";
import { accountBalance, ACCOUNTS, type Account } from "../packages/ledger/src/index";

const args = { demoIdentity: v.string(), orderId: v.id("orders") };
async function access(ctx: QueryCtx, identity: string, orderId: Id<"orders">, financeOnly = false) {
  const principal = await requireRole(ctx, identity, financeOnly ? ["controller", "finance-agent"] : ["buyer", "contributor", "controller", "finance-agent"]);
  const order = await ctx.db.get(orderId);
  if (!order) throw new Error("order_not_found");
  requireTenant(principal, order);
  if (principal.roles.includes("buyer") && !principal.roles.includes("controller") && !principal.roles.includes("finance-agent") && order.buyerTokenIdentifier !== principal.tokenIdentifier) {
    throw new Error("order_not_owned");
  }
  return { principal, order };
}

export const orderSummary = query({
  args,
  handler: async (ctx, input) => {
    const { order } = await access(ctx, input.demoIdentity, input.orderId);
    const ledger = await loadLedger(ctx, order.organizationId);
    const balances = Object.fromEntries((Object.keys(ACCOUNTS) as Account[]).map(account =>
      [account, accountBalance(ledger, account, { orderId: order._id }).toString()]));
    const rubric = order.taskVersionId ? await ctx.db.get(order.taskVersionId) : null;
    if (rubric && (rubric.organizationId !== order.organizationId || rubric.orderId !== order._id)) throw new Error("cross_organization_reference");
    return { order: { ...order, quantityRequested: order.quantityRequested.toString(), acceptedCount: order.acceptedCount.toString(),
      pricePerSampleAtomic: order.pricePerSampleAtomic.toString(), contributorRateAtomic: order.contributorRateAtomic.toString(), budgetAtomic: order.budgetAtomic.toString() },
      rubric, balances, demoOnly: true, realFundingRequired: order.status === "awaiting_funding" };
  },
});

export const submissions = query({
  args,
  handler: async (ctx, input) => {
    const { principal, order } = await access(ctx, input.demoIdentity, input.orderId);
    const all = await ctx.db.query("submissions").withIndex("by_order_status", q => q.eq("orderId", order._id)).collect();
    const controllerView = principal.roles.includes("controller") || principal.roles.includes("finance-agent");
    const visible = all.filter(submission => controllerView || submission.contributorTokenIdentifier === principal.tokenIdentifier ||
      (principal.roles.includes("buyer") && submission.status === "accepted"));
    return Promise.all(visible.map(async submission => {
      const analysis = submission.currentAnalysisId ? await ctx.db.get(submission.currentAnalysisId) : null;
      const decision = submission.currentDecisionId ? await ctx.db.get(submission.currentDecisionId) : null;
      const delivery = await ctx.db.query("deliveries").withIndex("by_submission", q => q.eq("submissionId", submission._id)).unique();
      for (const reference of [submission, analysis, decision, delivery]) {
        if (reference && reference.organizationId !== order.organizationId) throw new Error("cross_organization_reference");
      }
      if ((analysis && analysis.submissionId !== submission._id) || (decision && decision.submissionId !== submission._id)) throw new Error("submission_reference_mismatch");
      return { ...submission, analysis, decision, delivery };
    }));
  },
});

export const payables = query({
  args,
  handler: async (ctx, input) => {
    const { principal, order } = await access(ctx, input.demoIdentity, input.orderId);
    const all = await ctx.db.query("payables").withIndex("by_order", q => q.eq("orderId", order._id)).collect();
    const controllerView = principal.roles.includes("controller") || principal.roles.includes("finance-agent");
    const visible = all.filter(payable => controllerView || payable.contributorTokenIdentifier === principal.tokenIdentifier);
    return Promise.all(visible.map(async payable => {
      const intent = await ctx.db.query("paymentIntents").withIndex("by_payable", q => q.eq("payableId", payable._id)).unique();
      const command = intent?.kind === "contributor_payout" ? await ctx.db.get(intent.paymentCommandId) : null;
      const approval = command?.approvalId ? await ctx.db.get(command.approvalId) : null;
      for (const reference of [payable, intent, command, approval]) {
        if (reference && reference.organizationId !== order.organizationId) throw new Error("cross_organization_reference");
      }
      if ((intent && intent.orderId !== order._id) || (command && command.orderId !== order._id)) throw new Error("payment_reference_mismatch");
      return { ...payable, amountAtomic: payable.amountAtomic.toString(),
        intent: intent ? { ...intent, amountAtomic: intent.amountAtomic.toString() } : null,
        command: command ? { ...command, amountAtomic: command.amountAtomic.toString() } : null, approval };
    }));
  },
});

export const journal = query({
  args,
  handler: async (ctx, input) => {
    const { order } = await access(ctx, input.demoIdentity, input.orderId, true);
    const entries = await ctx.db.query("journalEntries").withIndex("by_order", q => q.eq("orderId", order._id)).collect();
    return Promise.all(entries.map(async entry => {
      const lines = await ctx.db.query("journalLines").withIndex("by_entry", q => q.eq("journalEntryId", entry._id)).collect();
      if (entry.organizationId !== order.organizationId || lines.some(line => line.organizationId !== order.organizationId)) throw new Error("cross_organization_reference");
      return { ...entry, lines: lines.map(line => ({ ...line, amountAtomic: line.amountAtomic.toString() })) };
    }));
  },
});

export const auditEvents = query({
  args,
  handler: async (ctx, input) => {
    const { order } = await access(ctx, input.demoIdentity, input.orderId, true);
    const [submissions, payables, intents] = await Promise.all([
      ctx.db.query("submissions").withIndex("by_order_status", q => q.eq("orderId", order._id)).collect(),
      ctx.db.query("payables").withIndex("by_order", q => q.eq("orderId", order._id)).collect(),
      ctx.db.query("paymentIntents").withIndex("by_order", q => q.eq("orderId", order._id)).collect(),
    ]);
    const entities = new Set<string>([order._id, ...submissions.map(row => row._id), ...payables.map(row => row._id), ...intents.map(row => row._id)]);
    return (await ctx.db.query("auditEvents").withIndex("by_org_time", q => q.eq("organizationId", order.organizationId)).order("desc").collect())
      .filter(event => entities.has(event.entityId));
  },
});

/** Discovery for the shared synthetic demo; no hard-coded Convex document IDs needed in the UI. */
export const demoContext = query({
  args: { demoIdentity: v.string() },
  handler: async (ctx, input) => {
    const principal = await requireRole(ctx, input.demoIdentity, ["buyer", "contributor", "controller", "finance-agent"]);
    const order = await ctx.db.query("orders").withIndex("by_public_id", q => q.eq("publicId", "skarl-red-cup-demo-v2")).unique()
      ?? await ctx.db.query("orders").withIndex("by_public_id", q => q.eq("publicId", "skarl-red-cup-demo-v1")).unique();
    if (!order) return null;
    requireTenant(principal, order);
    return { organizationId: order.organizationId, orderId: order._id, taskVersionId: order.taskVersionId,
      demoOnly: true, network: order.network };
  },
});
