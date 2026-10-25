import { configNumber, demoOrderPublicId, publicOrderPrefix } from "./lib/config";
import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { resolveTaskSpec } from "./lib/taskSpec";
import { PAYMENT_NETWORK } from "../packages/contracts/src/chain";

// Only the published demo and orders created by the fixed public demo path are
// public. Knowing an ID must not turn a role-created order into public data.
const isPublic = (order: Doc<"orders">) => order.publicId === demoOrderPublicId() ||
  order.publicId.startsWith(publicOrderPrefix());

export const catalog = internalQuery({
  args: {},
  handler: async ctx => {
    const limit = configNumber("SKARL_PUBLIC_CATALOG_LIMIT");
    const seed = await ctx.db.query("orders").withIndex("by_public_id", q => q.eq("publicId", demoOrderPublicId())).unique();
    const publicOrders = await ctx.db.query("orders").withIndex("by_public_id", q =>
      q.gte("publicId", publicOrderPrefix()).lt("publicId", `${publicOrderPrefix()}\uffff`)).take(limit);
    const tasks = await Promise.all([...(seed ? [seed] : []), ...publicOrders].map(async order => {
      const rubric = order.taskVersionId ? await ctx.db.get(order.taskVersionId) : null;
      if (!rubric || rubric.orderId !== order._id || rubric.organizationId !== order.organizationId) return null;
      const remaining = order.quantityRequested - order.acceptedCount;
      return { orderId: order._id, title: order.title, status: order.status, network: order.network,
        taskPrompt: rubric.taskPrompt, criteria: rubric.criteria, taskSpec: resolveTaskSpec(rubric) ?? null,
        pricePerAcceptedClipAtomic: order.pricePerSampleAtomic.toString(), budgetAtomic: order.budgetAtomic.toString(),
        quantityRequested: order.quantityRequested.toString(), acceptedCount: order.acceptedCount.toString(),
        remainingQuota: (remaining > 0n ? remaining : 0n).toString(), deadlineAt: order.deadlineAt };
    }));
    return { tasks: tasks.filter(task => task !== null), scope: "public_demo_orders", limit: limit + 1,
      truncated: publicOrders.length === limit, demoOnly: true };
  },
});

export const orderStatus = internalQuery({
  args: { orderId: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("orders", args.orderId);
    const order = id ? await ctx.db.get(id) : null;
    if (!order || !isPublic(order)) throw new Error("order_not_found");
    const intents = await ctx.db.query("paymentIntents").withIndex("by_order", q => q.eq("orderId", order._id)).collect();
    const intent = intents.find(row => row.kind === undefined || row.kind === "funding");
    const attempt = intent ? await ctx.db.query("paymentAttempts").withIndex("by_intent", q => q.eq("paymentIntentId", intent._id)).unique() : null;
    // Explicit projection: no wallet addresses, buyer identity, private media,
    // internal intents/attempts, ledger accounts, or outgoing transfers.
    return { orderId: order._id, status: order.status, acceptedCount: order.acceptedCount.toString(),
      quantityRequested: order.quantityRequested.toString(), amountAtomic: order.budgetAtomic.toString(),
      network: order.network, funding: { status: intent?.status ?? "awaiting_payment",
        attemptStatus: attempt?.status ?? null, network: intent?.network ?? PAYMENT_NETWORK }, demoOnly: true };
  },
});
