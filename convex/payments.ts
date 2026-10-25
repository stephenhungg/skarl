/// <reference types="node" />
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { fundingNetwork } from "./validators";
import type { Doc, Id } from "./_generated/dataModel";
import { requireRole } from "./lib/demoAuth";
import { digest, normalizeAddress, paymentBinding, recordJournal, requireTenant } from "./lib/finance";
import { PAYMENT_NETWORK, paymentRail, SOLANA_PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/chain";
import { createFundingJournal, createPayoutJournal } from "../packages/ledger/src/index";
import { chainIdentity, validateTransfer, reconcilePayments, type TransferObservation, type PaymentObligation, type PaymentJournal } from "../packages/payments/src/reconciliation";
import { DEMO_ORDER_BUDGET, DEMO_ORDER_CONTRIBUTOR_RATE, DEMO_ORDER_GLOBAL_LIMIT, DEMO_ORDER_IP_LIMIT, DEMO_ORDER_WINDOW_MS } from "../packages/payments/src/demo-order";
import { audit } from "./lib/finance";

// Trusted Next server reads RPC receipts; browsers cannot submit settlement facts directly.
function service(secret: string) {
  const expected = process.env.SKARL_PAYMENTS_SERVICE_SECRET;
  if (!expected || expected.length < 32 || secret.length !== expected.length) throw new Error("payment_service_unauthorized");
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ secret.charCodeAt(i);
  if (mismatch) throw new Error("payment_service_unauthorized");
}
const secretArg = { serviceSecret: v.string() };

/** Public HTTP entry point calls this with trusted ingress metadata. No caller-supplied terms. */
export const createDemoOrder = mutation({
  args: { ...secretArg, ipDigest: v.string(), requestId: v.string() },
  handler: async (ctx, args) => {
    service(args.serviceSecret);
    if (!/^[a-f0-9]{64}$/.test(args.ipDigest) || !/^[a-f0-9-]{36}$/.test(args.requestId)) throw new Error("invalid_demo_request");
    const buyer = await requireRole(ctx, "buyer", "buyer");
    const source = await ctx.db.query("orders").withIndex("by_public_id", q => q.eq("publicId", "skarl-red-cup-demo-v2")).unique();
    const rubric = source?.taskVersionId ? await ctx.db.get(source.taskVersionId) : null;
    if (!source || !rubric || source.organizationId !== buyer.organizationId || rubric.orderId !== source._id) throw new Error("demo_seed_required");
    const now = Date.now(), windowStart = Math.floor(now / DEMO_ORDER_WINDOW_MS) * DEMO_ORDER_WINDOW_MS;
    const limits = await Promise.all([
      { key: `ip:${args.ipDigest}`, limit: DEMO_ORDER_IP_LIMIT },
      { key: "global", limit: DEMO_ORDER_GLOBAL_LIMIT },
    ].map(async limit => {
      const row = await ctx.db.query("demoOrderLimits").withIndex("by_key", q => q.eq("key", limit.key)).unique();
      return { ...limit, row, count: row?.windowStart === windowStart ? row.count : 0 };
    }));
    if (limits.some(limit => limit.count >= limit.limit)) return { ok: false as const, code: "demo_order_rate_limited" as const,
      retryAfterSeconds: Math.max(1, Math.ceil((windowStart + DEMO_ORDER_WINDOW_MS - now) / 1000)) };
    for (const limit of limits) {
      const value = { key: limit.key, windowStart, count: limit.count + 1 };
      if (limit.row) await ctx.db.patch(limit.row._id, value);
      else await ctx.db.insert("demoOrderLimits", value);
    }
    const publicId = `skarl-outsider-demo-${args.requestId}`;
    const termsHash = digest({ contentHash: rubric.contentHash, quantityRequested: 1n, pricePerSampleAtomic: DEMO_ORDER_BUDGET,
      contributorRateAtomic: DEMO_ORDER_CONTRIBUTOR_RATE, licenseVersion: "demo-consent-v1" });
    const orderId = await ctx.db.insert("orders", {
      organizationId: buyer.organizationId, network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, publicId,
      buyerTokenIdentifier: buyer.tokenIdentifier, buyerWalletAddress: "0x0000000000000000000000000000000000000001",
      title: "DEMO / TESTNET — red-cup narrated demonstration", status: "awaiting_funding", quantityRequested: 1n,
      pricePerSampleAtomic: DEMO_ORDER_BUDGET, contributorRateAtomic: DEMO_ORDER_CONTRIBUTOR_RATE,
      budgetAtomic: DEMO_ORDER_BUDGET, acceptedCount: 0n, deadlineAt: now + 24 * DEMO_ORDER_WINDOW_MS, termsHash, updatedAt: now,
    });
    const taskVersionId = await ctx.db.insert("rubricVersions", {
      organizationId: buyer.organizationId, orderId, version: 1, taskPrompt: rubric.taskPrompt,
      criteria: rubric.criteria, contentHash: rubric.contentHash, createdByTokenIdentifier: buyer.tokenIdentifier, frozenAt: now,
    });
    await ctx.db.patch(orderId, { taskVersionId });
    await audit(ctx, { organizationId: buyer.organizationId, eventKey: `outsider_demo_created:${orderId}`,
      actor: { kind: "service", identity: "public-demo-orders" }, action: "demo_order_created", entityType: "orders", entityId: orderId,
      reason: "Public 1 USDC testnet demo order; no payment or inference performed. Actual payer binds during funding.", evidenceReferences: [taskVersionId, termsHash] });
    return { ok: true as const, orderId, publicId, deadlineAt: now + 24 * DEMO_ORDER_WINDOW_MS };
  },
});
const evidence = v.object({ network: v.string(), tokenAddress: v.string(), txHash: v.string(), logIndex: v.number(),
  blockNumber: v.int64(), blockHash: v.string(), fromAddress: v.string(), toAddress: v.string(), amountAtomic: v.int64(),
  confirmations: v.number(), succeeded: v.boolean(), observedAt: v.number() });
function railAddress(network: string, value: string): string {
  paymentRail(network);
  if (network === PAYMENT_NETWORK) return normalizeAddress(value);
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) throw new Error("invalid_solana_address");
  return value;
}
function transactionHash(network: string, value: string): string {
  paymentRail(network);
  if (network === PAYMENT_NETWORK) return hash(value);
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value)) throw new Error("invalid_solana_signature");
  return value;
}
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
    const network = intent?.network ?? PAYMENT_NETWORK;
    return { order, intent: intent ?? null, attempt, network,
      explorerUrl: attempt?.txHash ? paymentRail(network).explorerTx(attempt.txHash) : null };
  },
});
export const recordFundingAttempt = mutation({
  args: { ...secretArg, orderId: v.string(), demoIdentity: v.string(), payerAddress: v.string(), recipientAddress: v.string(),
    authorizationNonce: v.string(), amountAtomic: v.int64(), validBefore: v.number(), network: v.optional(fundingNetwork) },
  handler: async (ctx, args) => {
    service(args.serviceSecret);
    const order = await orderFor(ctx, args.orderId, args.demoIdentity);
    const network = args.network ?? PAYMENT_NETWORK;
    const rail = paymentRail(network);
    const payerAddress = railAddress(network, args.payerAddress), recipientAddress = railAddress(network, args.recipientAddress);
    if (network === SOLANA_PAYMENT_NETWORK && recipientAddress !== process.env.SKARL_SOLANA_TREASURY_ADDRESS) {
      throw new Error("wrong_solana_treasury");
    }
    const nonce = hash(args.authorizationNonce);
    if (payerAddress === recipientAddress || recipientAddress === `0x${"0".repeat(40)}`) throw new Error("invalid_recipient");
    if (order.network !== PAYMENT_NETWORK || order.tokenAddress !== USDC_ADDRESS || order.budgetAtomic <= 0n ||
      order.budgetAtomic !== order.quantityRequested * order.pricePerSampleAtomic || order.budgetAtomic !== args.amountAtomic) throw new Error("quote_changed");
    // A Solana message hash already commits to its authority. Never let a caller
    // reuse that message under a different (including case-mutated) payer.
    const used = network === SOLANA_PAYMENT_NETWORK
      ? await ctx.db.query("paymentAttempts").withIndex("by_message_hash", q =>
        q.eq("network", network).eq("authorizationNonce", nonce)).unique()
      : await ctx.db.query("paymentAttempts").withIndex("by_authorization_nonce", q =>
        q.eq("network", network).eq("payerAddress", payerAddress).eq("authorizationNonce", nonce)).unique();
    if (used) {
      const prior = used.paymentIntentId && await ctx.db.get(used.paymentIntentId);
      if (!prior || used.payerAddress !== payerAddress || prior.kind === "contributor_payout" || prior.orderId !== order._id || prior.recipientAddress !== recipientAddress || prior.amountAtomic !== args.amountAtomic) throw new Error("authorization_already_claimed");
      // A replay is for status/reconciliation ONLY; the HTTP adapter must not settle twice.
      return { attemptId: used._id, replayed: true };
    }
    if (!["draft", "awaiting_funding"].includes(order.status) || Date.now() > order.deadlineAt) throw new Error("order_not_fundable");
    const existing = await ctx.db.query("paymentIntents").withIndex("by_order", q => q.eq("orderId", order._id)).collect();
    if (existing.some(i => i.kind !== "contributor_payout")) throw new Error("funding_already_pending_reconcile_first");
    if (!Number.isSafeInteger(args.validBefore) || args.validBefore <= Date.now()) throw new Error("authorization_expired");
    const now = Date.now();
    const intentId = await ctx.db.insert("paymentIntents", { organizationId: order.organizationId, kind: "funding", orderId: order._id,
      network, tokenAddress: rail.token, intentId: `funding:${order._id}`, buyerWalletAddress: payerAddress,
      recipientAddress, amountAtomic: order.budgetAtomic, termsHash: order.termsHash, resourcePath: `/api/orders/${order._id}/fund`,
      x402Version: 2, paymentIdentifier: nonce, expiresAt: args.validBefore, status: "settlement_pending", updatedAt: now });
    const attemptId = await ctx.db.insert("paymentAttempts", { organizationId: order.organizationId, network,
      tokenAddress: rail.token, paymentIntentId: intentId, attemptId: `funding:${order._id}`, attempt: 1,
      amountAtomic: order.budgetAtomic, payerAddress, authorizationNonce: nonce, status: "prepared", createdAt: now, updatedAt: now });
    return { attemptId, replayed: false };
  },
});
export const recordTransaction = mutation({
  args: { ...secretArg, attemptId: v.id("paymentAttempts"), txHash: v.string() },
  handler: async (ctx, args) => {
    service(args.serviceSecret);
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt) throw new Error("attempt_not_found");
    const txHash = transactionHash(attempt.network, args.txHash);
    if (attempt.txHash && attempt.txHash !== txHash) throw new Error("transaction_already_bound");
    if (attempt.status === "confirmed") return;
    await ctx.db.patch(attempt._id, { txHash, status: "reconciling", updatedAt: Date.now() });
  },
});
async function insertObservation(ctx: MutationCtx, attempt: Doc<"paymentAttempts">, observation: TransferObservation) {
  if (observation.network !== attempt.network) throw new Error("wrong_network");
  const txHash = transactionHash(attempt.network, observation.txHash);
  if (attempt.txHash && attempt.txHash !== txHash) throw new Error("transaction_already_bound");
  const previous = await ctx.db.query("chainObservations").withIndex("by_transfer", q =>
    q.eq("network", attempt.network).eq("txHash", txHash).eq("logIndex", observation.logIndex)).unique();
  if (previous) {
    if (previous.paymentAttemptId !== attempt._id || previous.blockHash !== observation.blockHash ||
      previous.amountAtomic !== observation.amountAtomic || previous.fromAddress !== railAddress(attempt.network, observation.fromAddress) ||
      previous.toAddress !== railAddress(attempt.network, observation.toAddress)) throw new Error("transfer_already_claimed_or_changed");
    return { observationId: previous._id, replayed: true };
  }
  if (attempt.status === "confirmed") throw new Error("attempt_already_confirmed");
  const observationId = await ctx.db.insert("chainObservations", { ...observation, organizationId: attempt.organizationId,
    paymentAttemptId: attempt._id, network: attempt.network, tokenAddress: paymentRail(attempt.network).token, txHash,
    fromAddress: railAddress(attempt.network, observation.fromAddress), toAddress: railAddress(attempt.network, observation.toAddress) });
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
    if (attempt.network !== intent.network || attempt.tokenAddress !== intent.tokenAddress ||
      intent.tokenAddress !== paymentRail(intent.network).token) throw new Error("funding_rail_changed");
    const order = await ctx.db.get(intent.orderId);
    if (!order || order.budgetAtomic !== intent.amountAtomic || order.termsHash !== intent.termsHash) throw new Error("quote_changed");
    validateTransfer(args.observation, { network: intent.network, fromAddress: intent.buyerWalletAddress, toAddress: intent.recipientAddress, amountAtomic: intent.amountAtomic });
    const result = await insertObservation(ctx, attempt, args.observation);
    if (result.replayed) return result;
    if (!["draft", "awaiting_funding"].includes(order.status)) throw new Error("order_not_fundable");
    const journal = await recordJournal(ctx, order.organizationId, createFundingJournal({ eventId: `funding:${order._id}`,
      orderId: order._id, amountMicroUsdc: intent.amountAtomic }));
    await ctx.db.patch(journal, { network: intent.network, tokenAddress: intent.tokenAddress, sourceReference: chainIdentity(args.observation) });
    await ctx.db.patch(intent._id, { status: "confirmed", updatedAt: Date.now() });
    // Solana funding does not change the Base payout/refund address on the order.
    await ctx.db.patch(order._id, { status: "funded",
      ...(intent.network === PAYMENT_NETWORK ? { buyerWalletAddress: intent.buyerWalletAddress } : {}), updatedAt: Date.now() });
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
    // Recheck the approved source snapshot at dispatch, not just at approval time.
    const currentSource = digest({ payableId: payable._id, orderId: payable.orderId, submissionId: payable.submissionId,
      decisionId: payable.decisionId, contributor: payable.contributorTokenIdentifier,
      recipientAddress: normalizeAddress(payable.recipientAddress), amountAtomic: payable.amountAtomic,
      network: payable.network, tokenAddress: payable.tokenAddress, createdAt: payable.createdAt });
    if (currentSource !== intent.sourceVersion || command.sourceVersion !== intent.sourceVersion ||
      command.organizationId !== intent.organizationId || payable.organizationId !== intent.organizationId ||
      command.payableId !== payable._id || command.orderId !== intent.orderId || payable.orderId !== intent.orderId ||
      approval.paymentCommandId !== command._id || approval.expiresAt !== intent.expiresAt ||
      approval.requestedBy.identity !== intent.requesterTokenIdentifier || command.requesterTokenIdentifier !== intent.requesterTokenIdentifier ||
      command.requestedBy.identity !== intent.requesterTokenIdentifier || intent.network !== PAYMENT_NETWORK || intent.tokenAddress !== USDC_ADDRESS) {
      throw new Error("approved_source_changed");
    }
    const approver = await ctx.db.query("memberships").withIndex("by_token_identifier", q => q.eq("tokenIdentifier", approval.approverTokenIdentifier)).unique();
    if (!approver || approver.status !== "active" || approver.organizationId !== intent.organizationId || !approver.roles.includes("controller") ||
      approver.roles.includes("finance-agent") || approver.roles.includes("contributor")) throw new Error("approval_invalidated");
    const dispatch = await ctx.db.query("outboxEvents").withIndex("by_event_key", q =>
      q.eq("organizationId", intent.organizationId).eq("eventKey", `dispatch:${command._id}`)).unique();
    if (!dispatch || dispatch.kind !== "dispatch_settlement" || dispatch.paymentCommandId !== command._id ||
      dispatch.paymentIntentId !== intent._id || dispatch.orderId !== intent.orderId || dispatch.status !== "pending" ||
      dispatch.availableAt > Date.now()) throw new Error("dispatch_not_ready");
    const senderAddress = normalizeAddress(args.senderAddress);
    if (senderAddress !== normalizeAddress(args.treasuryAddress)) throw new Error("wrong_treasury_wallet");
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(args.claimId)) throw new Error("invalid_claim_id");
    const now = Date.now();
    const attemptId = await ctx.db.insert("paymentAttempts", { organizationId: intent.organizationId, network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS,
      paymentIntentId: intent._id, paymentCommandId: command._id, attemptId: args.claimId, attempt: 1, amountAtomic: intent.amountAtomic,
      payerAddress: senderAddress, status: "prepared", createdAt: now, updatedAt: now });
    // The durable attempt now owns execution; this queue row means dispatched, never settled.
    await ctx.db.patch(dispatch._id, { status: "delivered", attempt: dispatch.attempt + 1 });
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
    if (args.observation.observedAt < attempt.createdAt - 1000) throw new Error("transfer_predates_approval_claim");
    validateTransfer(args.observation, { network: PAYMENT_NETWORK, fromAddress: attempt.payerAddress, toAddress: intent.recipientAddress, amountAtomic: intent.amountAtomic });
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
      obligations.push({ network: intent.network, eventKey: intent.intentId, orderId: order._id, kind: intent.kind === "contributor_payout" ? "payout" : "funding",
        fromAddress: intent.kind === "contributor_payout" ? attempts[0]?.payerAddress ?? "" : intent.buyerWalletAddress,
        toAddress: intent.recipientAddress, amountAtomic: intent.kind === "contributor_payout" ? intent.amountAtomic : order.budgetAtomic,
        deadlineAt: intent.expiresAt, ...(seen[0] ? { transfer: seen[0] } : {}) });
    }
    // Standalone evidence sales bind a durable business intent in their audit row,
    // not in order funding intents. Reconcile them without changing funded quota.
    const saleClaims = await ctx.db.query("auditEvents").withIndex("by_org_time", q => q.eq("organizationId", order.organizationId)).collect();
    for (const claim of saleClaims) {
      if (claim.action !== "evidence_sale_claimed") continue;
      const terms = JSON.parse(claim.reason) as { version: number; orderId: string; payerAddress: string;
        recipientAddress: string; amountAtomic: string; authorizationNonce: string; validBefore: number };
      if (terms.orderId !== order._id) continue;
      const id = ctx.db.normalizeId("paymentAttempts", claim.entityId);
      const attempt = id ? await ctx.db.get(id) : null;
      if (!attempt || attempt.organizationId !== order.organizationId || attempt.paymentIntentId || attempt.paymentCommandId ||
        claim.eventKey !== `evidence-sale:${attempt._id}` || terms.version !== 1 ||
        terms.payerAddress !== attempt.payerAddress || terms.authorizationNonce !== attempt.authorizationNonce ||
        terms.amountAtomic !== attempt.amountAtomic.toString() || attempt.network !== order.network || attempt.tokenAddress !== order.tokenAddress) {
        throw new Error("evidence_sale_binding_changed");
      }
      const eventKey = `evidence:${attempt._id}`;
      const seen = await ctx.db.query("chainObservations").withIndex("by_attempt", q => q.eq("paymentAttemptId", attempt._id)).collect();
      for (const observation of seen) observations.push({ ...observation, eventKey, orderId: order._id });
      obligations.push({ eventKey, orderId: order._id, kind: "evidence_sale", fromAddress: terms.payerAddress,
        toAddress: terms.recipientAddress, amountAtomic: attempt.amountAtomic,
        deadlineAt: terms.validBefore, ...(seen[0] ? { transfer: seen[0] } : {}) });
    }
    const entries = await ctx.db.query("journalEntries").withIndex("by_order", q => q.eq("orderId", order._id)).collect();
    const journals: PaymentJournal[] = [];
    for (const entry of entries) {
      if (entry.kind !== "funding" && entry.kind !== "payout" && entry.kind !== "evidence_sale" && entry.kind !== "evidence_sale_deferred") continue;
      const lines = await ctx.db.query("journalLines").withIndex("by_entry", q => q.eq("journalEntryId", entry._id)).collect();
      const linked = observations.find(o => chainIdentity(o) === entry.sourceReference);
      journals.push({ eventKey: entry.eventKey, orderId: order._id, kind: entry.kind, network: entry.network,
        tokenAddress: entry.tokenAddress, recipientAddress: entry.recipientAddress, lines, ...(linked ? { transfer: linked } : {}) });
    }
    return reconcilePayments({ obligations, journals, observations, now: Date.now() });
  },
});
