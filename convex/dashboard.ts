import { demoOrderPublicId, fixtureOrderPrefixes, legacyDemoOrderPublicId, publicOrderPrefix } from "./lib/config";
import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { hasOrderAuthority, isFinanceAgent, requireRole } from "./lib/demoAuth";
import { loadLedger, requireBuyerOrder, requireTenant } from "./lib/finance";
import { accountBalance, ACCOUNTS, type Account } from "../packages/ledger/src/index";

const args = { demoIdentity: v.string(), orderId: v.id("orders") };
async function access(ctx: QueryCtx, identity: string, orderId: Id<"orders">, financeOnly = false) {
  const principal = await requireRole(ctx, identity, financeOnly ? ["buyer", "controller", "finance-agent"] : ["buyer", "contributor", "controller", "finance-agent"]);
  const order = await ctx.db.get(orderId);
  if (!order) throw new Error("order_not_found");
  requireTenant(principal, order);
  if (financeOnly || !principal.roles.includes("contributor")) requireBuyerOrder(principal, order);
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
      autoPay: order.autoPay ? { ...order.autoPay, maxPerClipAtomic: order.autoPay.maxPerClipAtomic.toString() } : undefined,
      pricePerSampleAtomic: order.pricePerSampleAtomic.toString(), contributorRateAtomic: order.contributorRateAtomic.toString(), budgetAtomic: order.budgetAtomic.toString() },
      rubric, balances, demoOnly: true, realFundingRequired: order.status === "awaiting_funding",
      thumbnailUrl: order.thumbnailStorageId ? await ctx.storage.getUrl(order.thumbnailStorageId) : null };
  },
});

export const submissions = query({
  args,
  handler: async (ctx, input) => {
    const { principal, order } = await access(ctx, input.demoIdentity, input.orderId);
    const all = await ctx.db.query("submissions").withIndex("by_order_status", q => q.eq("orderId", order._id)).collect();
    const orderView = hasOrderAuthority(principal, order) || isFinanceAgent(principal);
    const visible = all.filter(submission => orderView || submission.contributorTokenIdentifier === principal.tokenIdentifier);
    const analystNotes = (await ctx.db.query("analystNotes").withIndex("by_order", q => q.eq("orderId", order._id)).order("desc").take(200))
      .filter(note => orderView && note.organizationId === order.organizationId && note.kind === "exception")
      .map(({ transcriptJson: _transcript, factsJson: _facts, ...note }) => note);
    const dispositions = await ctx.db.query("reconciliationDispositions").withIndex("by_order", q => q.eq("orderId", order._id)).collect();
    return Promise.all(visible.map(async submission => {
      const analysis = submission.currentAnalysisId ? await ctx.db.get(submission.currentAnalysisId) : null;
      const decision = submission.currentDecisionId ? await ctx.db.get(submission.currentDecisionId) : null;
      const delivery = await ctx.db.query("deliveries").withIndex("by_submission", q => q.eq("submissionId", submission._id)).unique();
      for (const reference of [submission, analysis, decision, delivery]) {
        if (reference && reference.organizationId !== order.organizationId) throw new Error("cross_organization_reference");
      }
      if ((analysis && analysis.submissionId !== submission._id) || (decision && decision.submissionId !== submission._id)) throw new Error("submission_reference_mismatch");
      const exceptionKeys = dispositions.filter(row => JSON.parse(row.snapshotJson).submissionId === submission._id).map(row => row.exceptionKey);
      return { ...submission, analysis, decision, delivery, analystNotes: analystNotes.filter(note => note.itemKey === `submission:${submission._id}` || exceptionKeys.includes(note.exceptionKey ?? "")) };
    }));
  },
});

export const payables = query({
  args,
  handler: async (ctx, input) => {
    const { principal, order } = await access(ctx, input.demoIdentity, input.orderId);
    const all = await ctx.db.query("payables").withIndex("by_order", q => q.eq("orderId", order._id)).collect();
    const orderView = hasOrderAuthority(principal, order) || isFinanceAgent(principal);
    const visible = all.filter(payable => orderView || payable.contributorTokenIdentifier === principal.tokenIdentifier);
    return Promise.all(visible.map(async payable => {
      const intent = await ctx.db.query("paymentIntents").withIndex("by_payable", q => q.eq("payableId", payable._id)).unique();
      const command = intent?.kind === "contributor_payout" ? await ctx.db.get(intent.paymentCommandId) : null;
      const approval = command?.approvalId ? await ctx.db.get(command.approvalId) : null;
      for (const reference of [payable, intent, command, approval]) {
        if (reference && reference.organizationId !== order.organizationId) throw new Error("cross_organization_reference");
      }
      if ((intent && intent.orderId !== order._id) || (command && command.orderId !== order._id)) throw new Error("payment_reference_mismatch");
      const dispatch = command ? await ctx.db.query("outboxEvents").withIndex("by_event_key", q =>
        q.eq("organizationId", order.organizationId).eq("eventKey", `dispatch:${command._id}`)).unique() : null;
      return { ...payable, dispatchReady: command?.status === "approved" && dispatch?.status === "pending" && dispatch.availableAt <= Date.now(),
        amountAtomic: payable.amountAtomic.toString(),
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
      const { usdValueAtPayment, ...metadata } = entry;
      return { ...metadata, ...(usdValueAtPayment === undefined ? {} : { usdValueAtPayment: usdValueAtPayment.toString() }),
        lines: lines.map(line => ({ ...line, amountAtomic: line.amountAtomic.toString() })) };
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
const FIXTURE_PREFIXES = fixtureOrderPrefixes();
/** Tasks a contributor can record for, newest first. Test fixtures, payment checks and the retired v1 order stay hidden. */
/** Real recordable orders: fixtures, webhook probes and finished orders are not contributor work. */
export const isContributorTask = (order: Doc<"orders">) => !!order.taskVersionId && !FIXTURE_PREFIXES.some(prefix => order.publicId.startsWith(prefix)) &&
  !/webhook verification/i.test(order.title) && !["closed", "cancelled", "cancelling", "fulfilled", "refunded"].includes(order.status);

export const openTasks = query({
  args: { demoIdentity: v.string() },
  handler: async (ctx, input) => {
    const principal = await requireRole(ctx, input.demoIdentity, ["contributor", "controller"]);
    const orders = await ctx.db.query("orders").withIndex("by_org_buyer", q => q.eq("organizationId", principal.organizationId)).collect();
    return orders.filter(isContributorTask)
      .sort((a, b) => b._creationTime - a._creationTime).slice(0, 20).map(order => order._id);
  },
});

export const demoContext = query({
  args: { demoIdentity: v.string() },
  handler: async (ctx, input) => {
    const principal = await requireRole(ctx, input.demoIdentity, ["buyer", "contributor", "controller", "finance-agent"]);
    let order = await ctx.db.query("orders").withIndex("by_public_id", q => q.eq("publicId", demoOrderPublicId())).unique()
      ?? await ctx.db.query("orders").withIndex("by_public_id", q => q.eq("publicId", legacyDemoOrderPublicId())).unique();
    if (!order || order.organizationId !== principal.organizationId) {
      order = await ctx.db.query("orders").withIndex("by_org_buyer", q =>
        q.eq("organizationId", principal.organizationId)).order("desc").first();
    }
    if (!order) return null;
    requireTenant(principal, order);
    return { organizationId: order.organizationId, orderId: order._id, taskVersionId: order.taskVersionId,
      demoOnly: true, network: order.network };
  },
});
