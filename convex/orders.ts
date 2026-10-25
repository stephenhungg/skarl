import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireRole } from "./lib/demoAuth";
import { actorFor, audit, digest, normalizeAddress, loadLedger, paymentBinding, recordJournal, requireTenant } from "./lib/finance";
import { MAX_ATOMIC_USDC, parseAtomicUsdc, PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/index";

import { accountBalance, createRefundReservedJournal } from "../packages/ledger/src/index";

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

/** Reserves unused funds; execution requires separate independent controller approval. */
export const cancelRemainder = mutation({
  args: { demoIdentity: v.string(), orderId: v.id("orders"), reason: v.string() },
  handler: async (ctx, args): Promise<{ ok: true; paymentCommandId: Id<"paymentCommands">;
    fundingIntentId: Id<"paymentIntents">; journalEntryId: Id<"journalEntries">; amountAtomic: string;
    controllerApprovalRequired: true; executionAvailable: false; replayed: boolean }> => {
    const principal = await requireRole(ctx, args.demoIdentity, "buyer");
    if (principal.roles.includes("finance-agent")) throw new Error("human_buyer_required");
    const order = await ctx.db.get(args.orderId);
    if (!order || order.buyerTokenIdentifier !== principal.tokenIdentifier) throw new Error("order_not_found");
    requireTenant(principal, order);
    const reason = args.reason.trim();
    if (!reason || reason.length > 2000) throw new Error("invalid_cancellation_reason");
    const intents = await ctx.db.query("paymentIntents").withIndex("by_order", q => q.eq("orderId", order._id)).collect();
    const fundingRows = intents.filter(intent => intent.kind === undefined || intent.kind === "funding");
    const funding = fundingRows[0];
    if (fundingRows.length !== 1 || !funding || funding.kind === "contributor_payout" || funding.organizationId !== order.organizationId ||
      funding.status !== "confirmed" || funding.amountAtomic !== order.budgetAtomic || funding.termsHash !== order.termsHash ||
      funding.network !== PAYMENT_NETWORK || funding.tokenAddress !== USDC_ADDRESS || order.network !== PAYMENT_NETWORK || order.tokenAddress !== USDC_ADDRESS ||
      normalizeAddress(funding.buyerWalletAddress) !== normalizeAddress(order.buyerWalletAddress)) throw new Error("confirmed_funding_required");
    const remaining = order.quantityRequested - order.acceptedCount;
    const amountAtomic = remaining * order.pricePerSampleAtomic;
    if (remaining <= 0n || order.acceptedCount < 0n || order.pricePerSampleAtomic <= 0n ||
      order.budgetAtomic !== order.quantityRequested * order.pricePerSampleAtomic || amountAtomic <= 0n || amountAtomic > MAX_ATOMIC_USDC) throw new Error("no_refundable_remainder");
    const recipientAddress = normalizeAddress(funding.buyerWalletAddress);
    const sourceVersion = digest({ kind: "buyer_refund", status: "cancelling", orderId: order._id, termsHash: order.termsHash,
      quantityRequested: order.quantityRequested, acceptedCount: order.acceptedCount, pricePerSampleAtomic: order.pricePerSampleAtomic,
      budgetAtomic: order.budgetAtomic, fundingIntentId: funding._id, recipientAddress, amountAtomic, reason });
    const binding = { organizationId: order.organizationId, orderId: order._id, network: PAYMENT_NETWORK,
      tokenAddress: USDC_ADDRESS, recipientAddress, amountAtomic, sourceVersion, requesterTokenIdentifier: principal.tokenIdentifier };
    const bindingHash = paymentBinding(binding);
    const previous = await ctx.db.query("paymentCommands").withIndex("by_order_kind", q => q.eq("orderId", order._id).eq("kind", "buyer_refund")).unique();
    const journal = createRefundReservedJournal({ eventId: `refund_reserved:${order._id}`, orderId: order._id, amountMicroUsdc: amountAtomic });
    const ledger = await loadLedger(ctx, order.organizationId);
    if (previous) {
      const reserved = await ctx.db.query("journalEntries").withIndex("by_event_key", q =>
        q.eq("organizationId", order.organizationId).eq("eventKey", journal.eventId)).unique();
      if (order.status !== "cancelling" || funding.refundPaymentCommandId !== previous._id || previous.organizationId !== order.organizationId ||
        previous.payableId !== undefined || previous.sourceVersion !== sourceVersion || previous.bindingHash !== bindingHash ||
        paymentBinding(previous) !== bindingHash || previous.requestedBy.identity !== principal.tokenIdentifier ||
        !reserved || reserved.fingerprint !== digest(journal)) throw new Error("refund_proposal_changed");
      return { ok: true, paymentCommandId: previous._id, fundingIntentId: funding._id, journalEntryId: reserved._id,
        amountAtomic: amountAtomic.toString(), controllerApprovalRequired: true, executionAvailable: false, replayed: true };
    }
    if (!["funded", "collecting"].includes(order.status) || funding.refundPaymentCommandId) throw new Error("order_not_cancellable");
    const reconciled = await ctx.runQuery(api.payments.reconciliation, { demoIdentity: args.demoIdentity, orderId: order._id });
    if (!reconciled.matches.some(match => match.eventKey === funding.intentId)) throw new Error("funding_requires_reconciliation");
    if (accountBalance(ledger, "liability:customer_prepayments", { orderId: order._id }) !== amountAtomic ||
      accountBalance(ledger, "liability:customer_refunds", { orderId: order._id }) !== 0n) throw new Error("refund_balance_mismatch");
    const journalEntryId = await recordJournal(ctx, order.organizationId, journal);
    const paymentCommandId = await ctx.db.insert("paymentCommands", { ...binding, kind: "buyer_refund", commandId: `refund:${order._id}`,
      requestedBy: actorFor(principal), bindingHash, status: "proposed", attemptCount: 0, leaseGeneration: 0, updatedAt: Date.now() });
    await ctx.db.patch(funding._id, { refundPaymentCommandId: paymentCommandId });
    // Conflicts with acceptance on this order record: a unit cannot be fulfilled and refunded concurrently.
    await ctx.db.patch(order._id, { status: "cancelling", updatedAt: Date.now() });
    await audit(ctx, { organizationId: order.organizationId, eventKey: `refund_proposed:${order._id}`, actor: actorFor(principal),
      action: "buyer_refund_proposed", entityType: "orders", entityId: order._id, reason,
      evidenceReferences: [funding._id, paymentCommandId, journalEntryId] });
    return { ok: true, paymentCommandId, fundingIntentId: funding._id, journalEntryId, amountAtomic: amountAtomic.toString(),
      controllerApprovalRequired: true, executionAvailable: false, replayed: false };
  },
});
