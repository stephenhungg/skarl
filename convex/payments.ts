/// <reference types="node" />
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireRole } from "./lib/demoAuth";
import { normalizeAddress, paymentBinding, recordJournal, requireTenant } from "./lib/finance";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/chain";
import { createFundingJournal, createPayoutJournal } from "../packages/ledger/src/index";
import { chainIdentity, validateTransfer, reconcilePayments, type TransferObservation, type PaymentObligation, type PaymentJournal } from "../packages/payments/src/reconciliation";

// Trusted Next server reads RPC receipts; browsers cannot submit settlement facts directly.
function service(secret: string) {
  const expected = process.env.SKARL_PAYMENTS_SERVICE_SECRET;
  if (!expected || expected.length < 32 || secret.length !== expected.length) throw new Error("payment_service_unauthorized");
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ secret.charCodeAt(i);
  if (mismatch) throw new Error("payment_service_unauthorized");
}
const secretArg = { serviceSecret: v.string() };
const evidence = v.object({ network: v.string(), tokenAddress: v.string(), txHash: v.string(), logIndex: v.number(),
  blockNumber: v.int64(), blockHash: v.string(), fromAddress: v.string(), toAddress: v.string(), amountAtomic: v.int64(),
  confirmations: v.number(), succeeded: v.boolean(), observedAt: v.number() });
const hash = (value: string) => { if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error("invalid_hash"); return value.toLowerCase(); };
async function orderFor(ctx: QueryCtx | MutationCtx, orderId: string, demoIdentity: string) {
  const member = await requireRole(ctx, demoIdentity, "buyer");
  const id = ctx.db.normalizeId("orders", orderId);
  const order = id ? await ctx.db.get(id) : await ctx.db.query("orders").withIndex("by_public_id", q => q.eq("publicId", orderId)).unique();
  if (!order || order.buyerTokenIdentifier !== member.tokenIdentifier) throw new Error("order_not_found");
  requireTenant(member, order);
  return order;
}
export const fundingStatus = query({
  args: { ...secretArg, orderId: v.string(), demoIdentity: v.string() },
  handler: async (ctx, args) => {
    service(args.serviceSecret);
    const order = await orderFor(ctx, args.orderId, args.demoIdentity);
    const intents = await ctx.db.query("paymentIntents").withIndex("by_order", q => q.eq("orderId", order._id)).collect();
    const intent = intents.find(i => i.kind !== "contributor_payout");
    const attempt = intent ? await ctx.db.query("paymentAttempts").withIndex("by_intent", q => q.eq("paymentIntentId", intent._id)).unique() : null;
    return { order, intent: intent ?? null, attempt };
  },
});
export const recordFundingAttempt = mutation({
  args: { ...secretArg, orderId: v.string(), demoIdentity: v.string(), payerAddress: v.string(), recipientAddress: v.string(),
    authorizationNonce: v.string(), amountAtomic: v.int64(), validBefore: v.number() },
  handler: async (ctx, args) => {
    service(args.serviceSecret);
    const order = await orderFor(ctx, args.orderId, args.demoIdentity);
    const payerAddress = normalizeAddress(args.payerAddress), recipientAddress = normalizeAddress(args.recipientAddress);
    const nonce = hash(args.authorizationNonce);
    if (payerAddress === recipientAddress || recipientAddress === `0x${"0".repeat(40)}`) throw new Error("invalid_recipient");
    if (order.network !== PAYMENT_NETWORK || order.tokenAddress !== USDC_ADDRESS || order.budgetAtomic <= 0n ||
      order.budgetAtomic !== order.quantityRequested * order.pricePerSampleAtomic || order.budgetAtomic !== args.amountAtomic) throw new Error("quote_changed");
    const used = await ctx.db.query("paymentAttempts").withIndex("by_authorization_nonce", q =>
      q.eq("network", PAYMENT_NETWORK).eq("payerAddress", payerAddress).eq("authorizationNonce", nonce)).unique();
    if (used) {
      const prior = used.paymentIntentId && await ctx.db.get(used.paymentIntentId);
      if (!prior || prior.kind === "contributor_payout" || prior.orderId !== order._id || prior.recipientAddress !== recipientAddress || prior.amountAtomic !== args.amountAtomic) throw new Error("authorization_already_claimed");
      // A replay is for status/reconciliation ONLY; the HTTP adapter must not settle twice.
      return { attemptId: used._id, replayed: true };
    }
    if (!["draft", "awaiting_funding"].includes(order.status) || Date.now() > order.deadlineAt) throw new Error("order_not_fundable");
    const existing = await ctx.db.query("paymentIntents").withIndex("by_order", q => q.eq("orderId", order._id)).collect();
    if (existing.some(i => i.kind !== "contributor_payout")) throw new Error("funding_already_pending_reconcile_first");
    if (!Number.isSafeInteger(args.validBefore) || args.validBefore <= Date.now()) throw new Error("authorization_expired");
    const now = Date.now();
    const intentId = await ctx.db.insert("paymentIntents", { organizationId: order.organizationId, kind: "funding", orderId: order._id,
      network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, intentId: `funding:${order._id}`, buyerWalletAddress: payerAddress,
      recipientAddress, amountAtomic: order.budgetAtomic, termsHash: order.termsHash, resourcePath: `/api/orders/${order._id}/fund`,
      x402Version: 2, paymentIdentifier: nonce, expiresAt: args.validBefore, status: "settlement_pending", updatedAt: now });
    const attemptId = await ctx.db.insert("paymentAttempts", { organizationId: order.organizationId, network: PAYMENT_NETWORK,
      tokenAddress: USDC_ADDRESS, paymentIntentId: intentId, attemptId: `funding:${order._id}`, attempt: 1,
      amountAtomic: order.budgetAtomic, payerAddress, authorizationNonce: nonce, status: "prepared", createdAt: now, updatedAt: now });
    return { attemptId, replayed: false };
  },
});
export const recordTransaction = mutation({
  args: { ...secretArg, attemptId: v.id("paymentAttempts"), txHash: v.string() },
  handler: async (ctx, args) => {
    service(args.serviceSecret); const txHash = hash(args.txHash);
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt) throw new Error("attempt_not_found");
    if (attempt.txHash && attempt.txHash !== txHash) throw new Error("transaction_already_bound");
    if (attempt.status === "confirmed") return;
    await ctx.db.patch(attempt._id, { txHash, status: "reconciling", updatedAt: Date.now() });
  },
});
async function insertObservation(ctx: MutationCtx, attempt: Doc<"paymentAttempts">, observation: TransferObservation) {
  const txHash = hash(observation.txHash);
  if (attempt.txHash && attempt.txHash !== txHash) throw new Error("transaction_already_bound");
  const previous = await ctx.db.query("chainObservations").withIndex("by_transfer", q =>
    q.eq("network", PAYMENT_NETWORK).eq("txHash", txHash).eq("logIndex", observation.logIndex)).unique();
  if (previous) {
    if (previous.paymentAttemptId !== attempt._id || previous.blockHash !== observation.blockHash ||
      previous.amountAtomic !== observation.amountAtomic || previous.fromAddress !== normalizeAddress(observation.fromAddress) ||
      previous.toAddress !== normalizeAddress(observation.toAddress)) throw new Error("transfer_already_claimed_or_changed");
    return { observationId: previous._id, replayed: true };
  }
  if (attempt.status === "confirmed") throw new Error("attempt_already_confirmed");
  const observationId = await ctx.db.insert("chainObservations", { ...observation, organizationId: attempt.organizationId,
    paymentAttemptId: attempt._id, network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, txHash,
    fromAddress: normalizeAddress(observation.fromAddress), toAddress: normalizeAddress(observation.toAddress) });
  await ctx.db.patch(attempt._id, { txHash, status: "confirmed", updatedAt: Date.now() });
  return { observationId, replayed: false };
}
export const confirmFunding = mutation({
  args: { ...secretArg, attemptId: v.id("paymentAttempts"), authorizationNonce: v.string(), observation: evidence },
  handler: async (ctx, args) => {
    service(args.serviceSecret);
    const attempt = await ctx.db.get(args.attemptId);
    const intent = attempt?.paymentIntentId && await ctx.db.get(attempt.paymentIntentId);
    if (!attempt || !intent || intent.kind === "contributor_payout") throw new Error("funding_attempt_not_found");
    if (hash(args.authorizationNonce) !== attempt.authorizationNonce) throw new Error("authorization_mismatch");
    const order = await ctx.db.get(intent.orderId);
    if (!order || order.budgetAtomic !== intent.amountAtomic || order.termsHash !== intent.termsHash) throw new Error("quote_changed");
    validateTransfer(args.observation, { fromAddress: intent.buyerWalletAddress, toAddress: intent.recipientAddress, amountAtomic: intent.amountAtomic });
    const result = await insertObservation(ctx, attempt, args.observation);
    if (result.replayed) return result;
    if (!["draft", "awaiting_funding"].includes(order.status)) throw new Error("order_not_fundable");
    const journal = await recordJournal(ctx, order.organizationId, createFundingJournal({ eventId: `funding:${order._id}`,
      orderId: order._id, amountMicroUsdc: intent.amountAtomic }));
    await ctx.db.patch(journal, { sourceReference: chainIdentity(args.observation) });
    await ctx.db.patch(intent._id, { status: "confirmed", updatedAt: Date.now() });
    await ctx.db.patch(order._id, { status: "funded", buyerWalletAddress: intent.buyerWalletAddress, updatedAt: Date.now() });
    return result;
  },
});

export const claimPayout = mutation({
  args: { ...secretArg, intentId: v.id("paymentIntents"), demoIdentity: v.string(), senderAddress: v.string(), treasuryAddress: v.string(), claimId: v.string() },
  handler: async (ctx, args) => {
    service(args.serviceSecret);
    const member = await requireRole(ctx, args.demoIdentity, ["controller", "finance-agent"]);
    const intent = await ctx.db.get(args.intentId);
    if (!intent || intent.kind !== "contributor_payout") throw new Error("payout_not_found");
    requireTenant(member, intent);
    const command = await ctx.db.get(intent.paymentCommandId), payable = await ctx.db.get(intent.payableId);
    const approval = command?.approvalId && await ctx.db.get(command.approvalId);
    if (!command || !payable || !approval || approval.status !== "approved" || approval.bindingHash !== intent.bindingHash ||
      approval.approverTokenIdentifier === intent.requesterTokenIdentifier || approval.expiresAt <= Date.now() || intent.expiresAt <= Date.now() ||
      command.bindingHash !== intent.bindingHash || paymentBinding(command) !== intent.bindingHash ||
      command.status !== "approved" || intent.status !== "approved" || command.attemptCount !== 0 ||
      payable.status !== "payout_in_progress" || payable.amountAtomic !== intent.amountAtomic ||
      normalizeAddress(payable.recipientAddress) !== intent.recipientAddress || command.recipientAddress !== intent.recipientAddress ||
      command.amountAtomic !== intent.amountAtomic || command.network !== PAYMENT_NETWORK || command.tokenAddress !== USDC_ADDRESS) throw new Error("payout_not_executable");
    const approver = await ctx.db.query("memberships").withIndex("by_token_identifier", q => q.eq("tokenIdentifier", approval.approverTokenIdentifier)).unique();
    if (!approver || approver.status !== "active" || approver.organizationId !== intent.organizationId || !approver.roles.includes("controller") ||
      approver.roles.includes("finance-agent") || approver.roles.includes("contributor")) throw new Error("approval_invalidated");
    const senderAddress = normalizeAddress(args.senderAddress);
    if (senderAddress !== normalizeAddress(args.treasuryAddress)) throw new Error("wrong_treasury_wallet");
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(args.claimId)) throw new Error("invalid_claim_id");
    const now = Date.now();
    const attemptId = await ctx.db.insert("paymentAttempts", { organizationId: intent.organizationId, network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS,
      paymentIntentId: intent._id, paymentCommandId: command._id, attemptId: args.claimId, attempt: 1, amountAtomic: intent.amountAtomic,
      payerAddress: senderAddress, status: "prepared", createdAt: now, updatedAt: now });
    await ctx.db.patch(command._id, { attemptCount: 1, status: "reconciling", updatedAt: now });
    await ctx.db.patch(intent._id, { status: "reconciling", updatedAt: now });
    return { intentId: intent._id, recipientAddress: intent.recipientAddress, amountAtomic: intent.amountAtomic.toString(),
      network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, senderAddress, claimId: args.claimId, attemptId };
  },
});
export const payoutAttempt = query({
  args: { ...secretArg, intentId: v.id("paymentIntents"), demoIdentity: v.string(), claimId: v.string() },
  handler: async (ctx, args) => {
    service(args.serviceSecret);
    const member = await requireRole(ctx, args.demoIdentity, ["controller", "finance-agent"]);
    const intent = await ctx.db.get(args.intentId);
    if (!intent || intent.kind !== "contributor_payout") throw new Error("payout_not_found");
    requireTenant(member, intent);
    const attempt = await ctx.db.query("paymentAttempts").withIndex("by_intent", q => q.eq("paymentIntentId", intent._id)).unique();
    if (!attempt || attempt.attemptId !== args.claimId) throw new Error("claim_not_found");
    return { intent, attempt };
  },
});
export const recordPayoutObservation = mutation({
  args: { ...secretArg, attemptId: v.id("paymentAttempts"), observation: evidence },
  handler: async (ctx, args) => {
    service(args.serviceSecret);
    const attempt = await ctx.db.get(args.attemptId);
    const intent = attempt?.paymentIntentId && await ctx.db.get(attempt.paymentIntentId);
    if (!attempt || !intent || intent.kind !== "contributor_payout" || !attempt.payerAddress) throw new Error("payout_attempt_not_found");
    const command = await ctx.db.get(intent.paymentCommandId), payable = await ctx.db.get(intent.payableId);
    if (!command || !command.approvalId || !payable || command.attemptCount !== 1) throw new Error("payout_not_dispatched");
    validateTransfer(args.observation, { fromAddress: attempt.payerAddress, toAddress: intent.recipientAddress, amountAtomic: intent.amountAtomic });
    const result = await insertObservation(ctx, attempt, args.observation);
    if (result.replayed) return result;
    const journal = await recordJournal(ctx, intent.organizationId, createPayoutJournal({ eventId: intent.intentId, orderId: intent.orderId,
      amountMicroUsdc: intent.amountAtomic, contributorId: payable.contributorTokenIdentifier, payableId: payable.submissionId }));
    await ctx.db.patch(journal, { sourceReference: chainIdentity(args.observation) });
    await ctx.db.patch(intent._id, { status: "confirmed", updatedAt: Date.now() });
    await ctx.db.patch(command._id, { status: "confirmed", updatedAt: Date.now() });
    await ctx.db.patch(payable._id, { status: "paid" });
    return result;
  },
});

export const reconciliation = query({
  args: { demoIdentity: v.string(), orderId: v.id("orders") },
  handler: async (ctx, args) => {
    const member = await requireRole(ctx, args.demoIdentity, ["controller", "finance-agent", "buyer"]);
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("order_not_found");
    requireTenant(member, order);
    if (member.roles.includes("buyer") && order.buyerTokenIdentifier !== member.tokenIdentifier) throw new Error("order_not_found");
    const intents = await ctx.db.query("paymentIntents").withIndex("by_order", q => q.eq("orderId", order._id)).collect();
    const obligations: PaymentObligation[] = [];
    const observations: (TransferObservation & { eventKey: string; orderId: string })[] = [];
    for (const intent of intents) {
      const attempts = await ctx.db.query("paymentAttempts").withIndex("by_intent", q => q.eq("paymentIntentId", intent._id)).collect();
      const seen: Doc<"chainObservations">[] = [];
      for (const attempt of attempts) seen.push(...await ctx.db.query("chainObservations").withIndex("by_attempt", q => q.eq("paymentAttemptId", attempt._id)).collect());
      for (const observation of seen) observations.push({ ...observation, eventKey: intent.intentId, orderId: order._id });
      obligations.push({ eventKey: intent.intentId, orderId: order._id, kind: intent.kind === "contributor_payout" ? "payout" : "funding",
        fromAddress: intent.kind === "contributor_payout" ? attempts[0]?.payerAddress ?? "" : intent.buyerWalletAddress,
        toAddress: intent.recipientAddress, amountAtomic: intent.kind === "contributor_payout" ? intent.amountAtomic : order.budgetAtomic,
        deadlineAt: intent.expiresAt, ...(seen[0] ? { transfer: seen[0] } : {}) });
    }
    const entries = await ctx.db.query("journalEntries").withIndex("by_order", q => q.eq("orderId", order._id)).collect();
    const journals: PaymentJournal[] = [];
    for (const entry of entries) {
      if (entry.kind !== "funding" && entry.kind !== "payout") continue;
      const lines = await ctx.db.query("journalLines").withIndex("by_entry", q => q.eq("journalEntryId", entry._id)).collect();
      const linked = observations.find(o => chainIdentity(o) === entry.sourceReference);
      journals.push({ eventKey: entry.eventKey, orderId: order._id, kind: entry.kind, network: entry.network,
        tokenAddress: entry.tokenAddress, lines, ...(linked ? { transfer: linked } : {}) });
    }
    return reconcilePayments({ obligations, journals, observations, now: Date.now() });
  },
});
