import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireRole } from "./lib/demoAuth";
import { actorFor, audit, digest, normalizeAddress } from "./lib/finance";
import { MAX_ATOMIC_USDC, parseAtomicUsdc, PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/index";

const criterion = v.object({ criterionId: v.string(), description: v.string(),
  modality: v.union(v.literal("visual"), v.literal("audio"), v.literal("cross_modal"), v.literal("temporal")) });

/** Frozen commercial terms and rubric are created atomically, with no invented funding. */
export const createOrder = mutation({
  args: { demoIdentity: v.string(), requestId: v.string(), title: v.string(), buyerWalletAddress: v.string(),
    quantityRequested: v.string(), pricePerSampleAtomic: v.string(), contributorRateAtomic: v.string(),
    deadlineAt: v.number(), taskPrompt: v.string(), criteria: v.array(criterion) },
  handler: async (ctx, args) => {
    const principal = await requireRole(ctx, args.demoIdentity, "buyer");
    if (principal.roles.includes("finance-agent")) throw new Error("human_buyer_required");
    const title = args.title.trim(), taskPrompt = args.taskPrompt.trim();
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(args.requestId) || !title || title.length > 200 || !taskPrompt || taskPrompt.length > 10_000 ||
      !Number.isSafeInteger(args.deadlineAt) || args.criteria.length < 1 || args.criteria.length > 50 ||
      args.criteria.some(c => !/^[a-zA-Z0-9_-]{1,80}$/.test(c.criterionId) || !c.description.trim() || c.description.length > 2000) ||
      new Set(args.criteria.map(c => c.criterionId)).size !== args.criteria.length) throw new Error("invalid_order_terms");
    const quantityRequested = parseAtomicUsdc(args.quantityRequested), pricePerSampleAtomic = parseAtomicUsdc(args.pricePerSampleAtomic),
      contributorRateAtomic = parseAtomicUsdc(args.contributorRateAtomic), budgetAtomic = quantityRequested * pricePerSampleAtomic;
    if (quantityRequested <= 0n || pricePerSampleAtomic <= 0n || contributorRateAtomic <= 0n || contributorRateAtomic > pricePerSampleAtomic ||
      budgetAtomic > MAX_ATOMIC_USDC) throw new Error("invalid_order_amounts");
    const buyerWalletAddress = normalizeAddress(args.buyerWalletAddress);
    if (buyerWalletAddress === `0x${"0".repeat(40)}`) throw new Error("invalid_buyer_wallet");
    const contentHash = digest({ version: 1, taskPrompt, criteria: args.criteria });
    const termsHash = digest({ title, quantityRequested, pricePerSampleAtomic, contributorRateAtomic, budgetAtomic,
      deadlineAt: args.deadlineAt, buyerWalletAddress, contentHash, network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS });
    const publicId = `order-${digest({ organizationId: principal.organizationId, buyer: principal.tokenIdentifier, requestId: args.requestId })}`;
    const existing = await ctx.db.query("orders").withIndex("by_public_id", q => q.eq("publicId", publicId)).unique();
    if (existing) {
      if (existing.organizationId !== principal.organizationId || existing.buyerTokenIdentifier !== principal.tokenIdentifier || existing.termsHash !== termsHash) throw new Error("order_request_conflict");
      return { orderId: existing._id, taskVersionId: existing.taskVersionId!, publicId, status: existing.status, budgetAtomic: existing.budgetAtomic.toString(), replayed: true };
    }
    if (args.deadlineAt <= Date.now()) throw new Error("order_deadline_expired");
    const now = Date.now();
    const orderId = await ctx.db.insert("orders", { organizationId: principal.organizationId, network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS,
      publicId, buyerTokenIdentifier: principal.tokenIdentifier, buyerWalletAddress, title, status: "awaiting_funding",
      quantityRequested, pricePerSampleAtomic, contributorRateAtomic, budgetAtomic, acceptedCount: 0n, deadlineAt: args.deadlineAt, termsHash, updatedAt: now });
    const taskVersionId = await ctx.db.insert("rubricVersions", { organizationId: principal.organizationId, orderId, version: 1,
      taskPrompt, criteria: args.criteria, contentHash, createdByTokenIdentifier: principal.tokenIdentifier, frozenAt: now });
    await ctx.db.patch(orderId, { taskVersionId });
    await audit(ctx, { organizationId: principal.organizationId, eventKey: `order_created:${orderId}`, actor: actorFor(principal),
      action: "order_created", entityType: "orders", entityId: orderId,
      reason: "Buyer froze the rubric and exact terms; funding is still required.", evidenceReferences: [taskVersionId, termsHash] });
    return { orderId, taskVersionId, publicId, status: "awaiting_funding" as const, budgetAtomic: budgetAtomic.toString(), replayed: false };
  },
});

export const listOrders = query({
  args: { demoIdentity: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const principal = await requireRole(ctx, args.demoIdentity, ["buyer", "controller", "finance-agent"]);
    const allOrders = principal.roles.includes("controller") || principal.roles.includes("finance-agent");
    const rows = await ctx.db.query("orders").withIndex("by_org_buyer", q => allOrders
      ? q.eq("organizationId", principal.organizationId)
      : q.eq("organizationId", principal.organizationId).eq("buyerTokenIdentifier", principal.tokenIdentifier))
      .order("desc").paginate({ ...args.paginationOpts, numItems: Math.min(100, args.paginationOpts.numItems) });
    return { ...rows, page: rows.page.map(order => ({ ...order, quantityRequested: order.quantityRequested.toString(),
      acceptedCount: order.acceptedCount.toString(), pricePerSampleAtomic: order.pricePerSampleAtomic.toString(),
      contributorRateAtomic: order.contributorRateAtomic.toString(), budgetAtomic: order.budgetAtomic.toString(),
      remainingQuantity: (order.quantityRequested - order.acceptedCount).toString() })) };
  },
});
