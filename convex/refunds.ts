import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { hasOrderAuthority, isFinanceAgent, requireRole, type DemoPrincipal } from "./lib/demoAuth";
import { actorFor, audit, digest, normalizeAddress, paymentBinding, recordJournal, requireTenant, requireBuyerOrder, loadLedger } from "./lib/finance";
import { service, insertObservation } from "./payments";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/chain";
import { createRefundPaidJournal, createRefundReservedJournal, accountBalance } from "../packages/ledger/src/index";
import { chainIdentity, validateTransfer } from "../packages/payments/src/reconciliation";

const evidence = v.object({ network: v.string(), tokenAddress: v.string(), txHash: v.string(), logIndex: v.number(),
  blockNumber: v.int64(), blockHash: v.string(), fromAddress: v.string(), toAddress: v.string(), amountAtomic: v.int64(),
  confirmations: v.number(), succeeded: v.boolean(), observedAt: v.number() });

/** Refunds are standalone payment commands; the original funding intent stays confirmed. */
async function bound(ctx: QueryCtx | MutationCtx, id: Id<"paymentCommands">, member?: DemoPrincipal, settled = false) {
  const command = await ctx.db.get(id);
  if (!command || command.kind !== "buyer_refund") throw new Error("refund_not_found");
  if (member) requireTenant(member, command);
  const order = await ctx.db.get(command.orderId);
  const intents = await ctx.db.query("paymentIntents").withIndex("by_order", q => q.eq("orderId", command.orderId)).collect();
  const funding = intents.filter(intent => intent.kind !== "contributor_payout");
  const intent = funding[0];
  const proposal = await ctx.db.query("auditEvents").withIndex("by_event_key", q =>
    q.eq("organizationId", command.organizationId).eq("eventKey", `refund_proposed:${command.orderId}`)).unique();
  if (!order || order.organizationId !== command.organizationId || (!settled && order.status !== "cancelling") ||
    (settled && !["cancelling", "refunded"].includes(order.status)) || funding.length !== 1 || !intent ||
    intent.status !== "confirmed" || intent.organizationId !== command.organizationId || intent.refundPaymentCommandId !== command._id ||
    intent.amountAtomic !== order.budgetAtomic || intent.termsHash !== order.termsHash ||
    intent.network !== PAYMENT_NETWORK || intent.tokenAddress !== USDC_ADDRESS || order.network !== PAYMENT_NETWORK ||
    order.tokenAddress !== USDC_ADDRESS || normalizeAddress(order.buyerWalletAddress) !== normalizeAddress(intent.buyerWalletAddress) || !proposal || proposal.action !== "buyer_refund_proposed") {
    throw new Error("refund_source_changed");
  }
  const amountAtomic = (order.quantityRequested - order.acceptedCount) * order.pricePerSampleAtomic;
  const sourceVersion = digest({ kind: "buyer_refund", status: "cancelling", orderId: order._id, termsHash: order.termsHash,
    quantityRequested: order.quantityRequested, acceptedCount: order.acceptedCount, pricePerSampleAtomic: order.pricePerSampleAtomic,
    budgetAtomic: order.budgetAtomic, fundingIntentId: intent._id, recipientAddress: normalizeAddress(intent.buyerWalletAddress),
    amountAtomic, reason: proposal.reason });
  if (amountAtomic <= 0n || command.amountAtomic !== amountAtomic || command.sourceVersion !== sourceVersion ||
    command.recipientAddress !== normalizeAddress(intent.buyerWalletAddress) || command.network !== PAYMENT_NETWORK || command.tokenAddress !== USDC_ADDRESS ||
    command.payableId !== undefined ||
    ![order.buyerTokenIdentifier, "demo:skarl:finance-agent"].includes(command.requesterTokenIdentifier) ||
    (command.requesterTokenIdentifier === "demo:skarl:finance-agent" && (command.requestedBy.kind !== "service" || proposal.actor.kind !== "service")) ||
    command.requestedBy.identity !== command.requesterTokenIdentifier || command.bindingHash !== paymentBinding(command)) {
    throw new Error("refund_source_changed");
  }
  if (command.requesterTokenIdentifier === "demo:skarl:finance-agent") {
    const cancellation = await ctx.db.query("auditEvents").withIndex("by_event_key", q =>
      q.eq("organizationId", command.organizationId).eq("eventKey", `cancellation_requested:${order._id}`)).unique();
    if (proposal.actor.kind !== "service" || proposal.actor.identity !== command.requesterTokenIdentifier ||
      !cancellation || cancellation.actor.kind !== "human" || cancellation.action !== "buyer_cancellation_requested" ||
      cancellation.entityId !== order._id || cancellation.reason !== proposal.reason || !cancellation.evidenceReferences.includes(command._id)) {
      throw new Error("refund_source_changed");
    }
  }
  const reservation = await ctx.db.query("journalEntries").withIndex("by_event_key", q =>
    q.eq("organizationId", command.organizationId).eq("eventKey", `refund_reserved:${order._id}`)).unique();
  if (!reservation || reservation.fingerprint !== digest(createRefundReservedJournal({ eventId: `refund_reserved:${order._id}`,
    orderId: order._id, amountMicroUsdc: amountAtomic }))) throw new Error("refund_reservation_changed");
  if (member) requireBuyerOrder(member, order);
  return { command, order, funding: intent };
}

async function activeApproval(ctx: QueryCtx | MutationCtx, command: Doc<"paymentCommands">, approval: Doc<"approvals"> | null) {
  if (!approval || approval.status !== "approved" || approval.paymentCommandId !== command._id || approval.organizationId !== command.organizationId ||
    approval.bindingHash !== command.bindingHash || approval.requestedBy.identity !== command.requesterTokenIdentifier ||
    approval.approverTokenIdentifier === command.requesterTokenIdentifier || approval.expiresAt <= Date.now()) return false;
  const approver = await ctx.db.query("memberships").withIndex("by_token_identifier", q => q.eq("tokenIdentifier", approval.approverTokenIdentifier)).unique();
  const order = await ctx.db.get(command.orderId);
  return !!order && hasOrderAuthority(approver, order);
}

export const approve = mutation({
  args: { demoIdentity: v.string(), commandId: v.id("paymentCommands"), reason: v.string() },
  handler: async (ctx, args) => {
    const member = await requireRole(ctx, args.demoIdentity, ["controller", "finance-agent", "buyer"]);
    const { command, order } = await bound(ctx, args.commandId, member);
    const refusal = isFinanceAgent(member) ? "agent_cannot_approve" :
      member.tokenIdentifier === command.requesterTokenIdentifier ? "self_approval_forbidden" :
      !hasOrderAuthority(member, order) ? "buyer_required" : null;
    if (refusal) {
      await audit(ctx, { organizationId: command.organizationId, eventKey: `refund_approval_refused:${command._id}:${member.tokenIdentifier}:${refusal}`,
        actor: actorFor(member), action: "refund_approval_refused", entityType: "paymentCommands", entityId: command._id,
        reason: refusal, evidenceReferences: [command.bindingHash] });
      return { ok: false as const, code: refusal };
    }
    const reason = args.reason.trim();
    if (!reason || reason.length > 2000) throw new Error("approval_reason_required");
    if (command.approvalId) {
      const approval = await ctx.db.get(command.approvalId);
      if (await activeApproval(ctx, command, approval) && command.status === "approved") {
        return { ok: true as const, approvalId: command.approvalId, replayed: true };
      }
      throw new Error("refund_approval_already_decided");
    }
    if (command.status !== "proposed" || command.attemptCount !== 0) throw new Error("refund_not_approvable");
    const approvalId = await ctx.db.insert("approvals", { organizationId: command.organizationId, paymentCommandId: command._id,
      requestedBy: command.requestedBy, approverTokenIdentifier: member.tokenIdentifier, bindingHash: command.bindingHash,
      status: "approved", reason, decidedAt: Date.now(), expiresAt: Date.now() + 60 * 60_000 });
    await ctx.db.patch(command._id, { approvalId, status: "approved", updatedAt: Date.now() });
    await audit(ctx, { organizationId: command.organizationId, eventKey: `refund_approved:${command._id}`, actor: actorFor(member),
      action: "refund_approved", entityType: "paymentCommands", entityId: command._id, reason, evidenceReferences: [approvalId, command.bindingHash] });
    return { ok: true as const, approvalId, replayed: false };
  },
});

export const claim = mutation({
  args: { serviceSecret: v.string(), commandId: v.id("paymentCommands"), demoIdentity: v.string(), senderAddress: v.string(), treasuryAddress: v.string(), claimId: v.string() },
  handler: async (ctx, args) => {
    service(args.serviceSecret);
    const member = await requireRole(ctx, args.demoIdentity, ["buyer", "controller"]);
    if (member.roles.includes("finance-agent") || member.roles.includes("contributor")) throw new Error("human_buyer_required");
    const { command } = await bound(ctx, args.commandId, member);
    const approval = command.approvalId ? await ctx.db.get(command.approvalId) : null;
    if (!await activeApproval(ctx, command, approval)) throw new Error("approval_invalidated");
    if (command.status !== "approved" || command.attemptCount !== 0) throw new Error("refund_already_claimed_reconcile_first");
    const ledger = await loadLedger(ctx, command.organizationId);
    if (accountBalance(ledger, "liability:customer_refunds", { orderId: command.orderId }) !== command.amountAtomic) throw new Error("refund_balance_mismatch");
    const senderAddress = normalizeAddress(args.senderAddress);
    if (senderAddress !== normalizeAddress(args.treasuryAddress) || senderAddress === command.recipientAddress) throw new Error("wrong_treasury_wallet");
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(args.claimId)) throw new Error("invalid_claim_id");
    const attemptId = await ctx.db.insert("paymentAttempts", { organizationId: command.organizationId, network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS,
      paymentCommandId: command._id, attemptId: args.claimId, attempt: 1, amountAtomic: command.amountAtomic,
      payerAddress: senderAddress, status: "prepared", createdAt: Date.now(), updatedAt: Date.now() });
    await ctx.db.patch(command._id, { status: "reconciling", attemptCount: 1, updatedAt: Date.now() });
    return { intentId: command._id, commandId: command._id, recipientAddress: command.recipientAddress, amountAtomic: command.amountAtomic.toString(),
      network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, senderAddress, claimId: args.claimId, attemptId };
  },
});

export const attempt = query({
  args: { serviceSecret: v.string(), commandId: v.id("paymentCommands"), demoIdentity: v.string(), claimId: v.string() },
  handler: async (ctx, args) => {
    service(args.serviceSecret);
    const member = await requireRole(ctx, args.demoIdentity, ["buyer", "controller"]);
    if (member.roles.includes("finance-agent") || member.roles.includes("contributor")) throw new Error("human_buyer_required");
    const { command } = await bound(ctx, args.commandId, member, true);
    const paymentAttempt = await ctx.db.query("paymentAttempts").withIndex("by_command", q => q.eq("paymentCommandId", command._id)).unique();
    if (!paymentAttempt || paymentAttempt.attemptId !== args.claimId || paymentAttempt.paymentIntentId ||
      paymentAttempt.organizationId !== command.organizationId || paymentAttempt.amountAtomic !== command.amountAtomic ||
      paymentAttempt.network !== command.network || paymentAttempt.tokenAddress !== command.tokenAddress) throw new Error("claim_not_found");
    return { command, attempt: paymentAttempt };
  },
});

export const recordObservation = mutation({
  args: { serviceSecret: v.string(), attemptId: v.id("paymentAttempts"), observation: evidence },
  handler: async (ctx, args) => {
    service(args.serviceSecret);
    const paymentAttempt = await ctx.db.get(args.attemptId);
    if (!paymentAttempt?.paymentCommandId || paymentAttempt.paymentIntentId || !paymentAttempt.payerAddress) throw new Error("refund_attempt_not_found");
    const { command, order } = await bound(ctx, paymentAttempt.paymentCommandId, undefined, true);
    if (paymentAttempt.organizationId !== command.organizationId || paymentAttempt.network !== command.network ||
      paymentAttempt.tokenAddress !== command.tokenAddress || !command.approvalId || command.attemptCount !== 1 || !["reconciling", "confirmed"].includes(command.status) ||
      paymentAttempt.amountAtomic !== command.amountAtomic || args.observation.observedAt < paymentAttempt.createdAt - 1000) throw new Error("refund_not_dispatched");
    validateTransfer(args.observation, { network: PAYMENT_NETWORK, fromAddress: paymentAttempt.payerAddress,
      toAddress: command.recipientAddress, amountAtomic: command.amountAtomic });
    const result = await insertObservation(ctx, paymentAttempt, args.observation);
    if (result.replayed) return result;
    const journal = await recordJournal(ctx, command.organizationId, { ...createRefundPaidJournal({ eventId: `refund_paid:${command._id}`,
      orderId: order._id, amountMicroUsdc: command.amountAtomic }), reference: chainIdentity(args.observation) });
    await ctx.db.patch(journal, { sourceReference: chainIdentity(args.observation) });
    await ctx.db.patch(command._id, { status: "confirmed", updatedAt: Date.now() });
    await ctx.db.patch(order._id, { status: "refunded", updatedAt: Date.now() });
    await audit(ctx, { organizationId: command.organizationId, eventKey: `refund_paid:${command._id}`, actor: { kind: "service", identity: "refund-reconciler" },
      action: "refund_paid", entityType: "paymentCommands", entityId: command._id,
      reason: "Buyer-approved refund confirmed from the exact USDC Transfer log.", evidenceReferences: [result.observationId, journal] });
    return result;
  },
});

/** Buyer dashboard can inspect the proposal before approval/signing. */
export const forOrder = query({
  args: { demoIdentity: v.string(), orderId: v.id("orders") },
  handler: async (ctx, args) => {
    const member = await requireRole(ctx, args.demoIdentity, ["controller", "buyer"]);
    if (member.roles.includes("finance-agent")) throw new Error("forbidden");
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("order_not_found");
    requireTenant(member, order);
    requireBuyerOrder(member, order);
    const found = await ctx.db.query("paymentCommands").withIndex("by_order_kind", q => q.eq("orderId", order._id).eq("kind", "buyer_refund")).unique();
    if (!found) return null;
    const { command } = await bound(ctx, found._id, member, true);
    const approval = command.approvalId ? await ctx.db.get(command.approvalId) : null;
    const paymentAttempt = await ctx.db.query("paymentAttempts").withIndex("by_command", q => q.eq("paymentCommandId", command._id)).unique();
    if (approval && (approval.organizationId !== command.organizationId || approval.paymentCommandId !== command._id)) throw new Error("approval_source_changed");
    if (paymentAttempt && (paymentAttempt.organizationId !== command.organizationId || paymentAttempt.paymentIntentId ||
      paymentAttempt.amountAtomic !== command.amountAtomic || paymentAttempt.network !== command.network || paymentAttempt.tokenAddress !== command.tokenAddress)) throw new Error("refund_attempt_binding_changed");
    return { commandId: command._id, orderId: order._id, status: command.status, recipientAddress: command.recipientAddress,
      amountAtomic: command.amountAtomic.toString(), network: command.network, tokenAddress: command.tokenAddress,
      controllerApprovalRequired: command.status === "proposed", executionAvailable: command.status === "approved" && command.attemptCount === 0 && await activeApproval(ctx, command, approval),
      approval: approval ? { status: approval.status, approverTokenIdentifier: approval.approverTokenIdentifier, expiresAt: approval.expiresAt, reason: approval.reason } : null,
      claimId: paymentAttempt?.attemptId ?? null, txHash: paymentAttempt?.txHash ?? null,
      explorerUrl: paymentAttempt?.txHash ? `https://sepolia.basescan.org/tx/${paymentAttempt.txHash}` : null };
  },
});
