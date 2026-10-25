import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { action, internalMutation, mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireRole } from "./lib/demoAuth";
import { normalizeAddress, requireTenant } from "./lib/finance";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/chain";
import { chainIdentity, type ReconciliationException, type reconcilePayments } from "../packages/payments/src/reconciliation";
import { compareCdpWitness, fetchCdpTransfers } from "./lib/cdpSql";

type SqlResult = Awaited<ReturnType<typeof fetchCdpTransfers>>;
type BaseReconciliation = ReturnType<typeof reconcilePayments>;
type Witness = ReturnType<typeof compareCdpWitness> & { chainIdentity: string };
type ReconciliationWithWitness = Omit<BaseReconciliation, "matches"> & {
  matches: (BaseReconciliation["matches"][number] & { witness: Witness })[];
  witnesses: Witness[];
  witness: { status: SqlResult["status"]; fetchedAt: number | null; reason?: string };
};
const scope = { demoIdentity: v.string(), orderId: v.id("orders") };
type Scope = { demoIdentity: string; orderId: Id<"orders"> };
const transfer = { eventId: v.string(), network: v.string(), tokenAddress: v.string(), txHash: v.string(),
  logIndex: v.number(), fromAddress: v.string(), toAddress: v.string(), amountAtomic: v.string() };
function service(secret: string) {
  const expected = process.env.SKARL_PAYMENTS_SERVICE_SECRET;
  if (!expected || expected.length < 32 || secret.length !== expected.length) throw new Error("payment_service_unauthorized");
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= secret.charCodeAt(i) ^ expected.charCodeAt(i);
  if (difference) throw new Error("payment_service_unauthorized");
}

async function orderScope(ctx: QueryCtx, args: Scope) {
  const principal = await requireRole(ctx, args.demoIdentity, ["controller", "finance-agent"]);
  const order = await ctx.db.get(args.orderId);
  if (!order) throw new Error("order_not_found");
  requireTenant(principal, order);
  const intents = await ctx.db.query("paymentIntents").withIndex("by_order", q => q.eq("orderId", order._id)).collect();
  const observations: Doc<"chainObservations">[] = [];
  for (const intent of intents) {
    const attempts = await ctx.db.query("paymentAttempts").withIndex("by_intent", q => q.eq("paymentIntentId", intent._id)).collect();
    for (const attempt of attempts) observations.push(...await ctx.db.query("chainObservations")
      .withIndex("by_attempt", q => q.eq("paymentAttemptId", attempt._id)).collect());
  }
  const treasury = intents.find(i => i.kind !== "contributor_payout")?.recipientAddress.toLowerCase() ?? null;
  return { order, treasury, observations };
}

/** Service-only ingress: durable dedupe before any RPC work. No payment facts are trusted here. */
export async function receiveWebhookFor(ctx: MutationCtx, args: { treasury: string; eventId: string; network: string; tokenAddress: string; txHash: string; logIndex: number; fromAddress: string; toAddress: string; amountAtomic: string }) {
    const treasury = normalizeAddress(args.treasury), from = normalizeAddress(args.fromAddress), to = normalizeAddress(args.toAddress);
    if (args.network !== PAYMENT_NETWORK || args.tokenAddress.toLowerCase() !== USDC_ADDRESS.toLowerCase() ||
      ![from, to].includes(treasury) || !/^(0|[1-9]\d{0,77})$/.test(args.amountAtomic) ||
      BigInt(args.amountAtomic) >= 2n ** 256n || !args.eventId || args.eventId.length > 200) throw new Error("invalid_webhook_transfer");
    const transferKey = chainIdentity(args);
    // Treasury ownership comes from stored business intent, never webhook-supplied tenant IDs.
    const intents = await ctx.db.query("paymentIntents").collect();
    const owners = [...new Set(intents.filter(i => i.kind !== "contributor_payout" &&
      i.recipientAddress.toLowerCase() === treasury).map(i => i.organizationId))];
    if (owners.length !== 1) throw new Error("treasury_scope_unavailable");
    const priorEvent = await ctx.db.query("cdpWebhookReceipts").withIndex("by_event", q => q.eq("eventId", args.eventId)).unique();
    const prior = priorEvent ?? await ctx.db.query("cdpWebhookReceipts").withIndex("by_transfer", q => q.eq("transferKey", transferKey)).unique();
    if (prior && (prior.transferKey !== transferKey || prior.fromAddress !== from || prior.toAddress !== to ||
      prior.amountAtomic !== args.amountAtomic || prior.organizationId !== owners[0])) throw new Error("webhook_event_conflict");
    if (prior?.status === "processed") return { receiptId: prior._id, replayed: true, processed: true, candidates: [] };
    const receiptId = prior?._id ?? await ctx.db.insert("cdpWebhookReceipts", {
      organizationId: owners[0]!, treasury, eventId: args.eventId, transferKey, txHash: args.txHash.toLowerCase(),
      logIndex: args.logIndex, fromAddress: from, toAddress: to, amountAtomic: args.amountAtomic,
      status: "pending", receivedAt: Date.now(), updatedAt: Date.now(),
    });
    const candidates: { attemptId: Id<"paymentAttempts">; kind: "funding" | "payout"; authorizationNonce?: string }[] = [];
    for (const intent of intents.filter(i => i.organizationId === owners[0] && i.amountAtomic.toString() === args.amountAtomic && i.recipientAddress.toLowerCase() === to)) {
      const attempts = await ctx.db.query("paymentAttempts").withIndex("by_intent", q => q.eq("paymentIntentId", intent._id)).collect();
      for (const attempt of attempts) {
        if (attempt.network !== PAYMENT_NETWORK || attempt.payerAddress?.toLowerCase() !== from ||
          (attempt.txHash && attempt.txHash.toLowerCase() !== args.txHash.toLowerCase())) continue;
        if (intent.kind === "contributor_payout") {
          // A hashless payout is ambiguous: only the signer can bind its submitted transaction.
          if (!attempt.txHash) continue;
          candidates.push({ attemptId: attempt._id, kind: "payout" });
        } else if (attempt.authorizationNonce) candidates.push({ attemptId: attempt._id, kind: "funding", authorizationNonce: attempt.authorizationNonce });
      }
    }
    return { receiptId, replayed: !!prior, processed: false, candidates };
}
export const receiveWebhook = mutation({
  args: { serviceSecret: v.string(), treasury: v.string(), ...transfer },
  handler: async (ctx, args) => { service(args.serviceSecret); return receiveWebhookFor(ctx, args); },
});

export async function finishWebhookFor(ctx: MutationCtx, args: {receiptId: Id<"cdpWebhookReceipts">; status: "processed" | "unknown_transfer"}) {
    const receipt = await ctx.db.get(args.receiptId);
    if (!receipt) throw new Error("webhook_receipt_not_found");
    const linked = await ctx.db.query("chainObservations").withIndex("by_transfer", q => q.eq("network", PAYMENT_NETWORK)
      .eq("txHash", receipt.txHash).eq("logIndex", receipt.logIndex)).unique();
    if (args.status === "processed" && (!linked || linked.organizationId !== receipt.organizationId ||
      linked.fromAddress.toLowerCase() !== receipt.fromAddress || linked.toAddress.toLowerCase() !== receipt.toAddress ||
      linked.amountAtomic.toString() !== receipt.amountAtomic)) throw new Error("webhook_not_reconciled");
    if (receipt.status !== "processed") await ctx.db.patch(receipt._id, { status: args.status, updatedAt: Date.now() });
}
export const finishWebhook = mutation({
  args: { serviceSecret: v.string(), receiptId: v.id("cdpWebhookReceipts"), status: v.union(v.literal("processed"), v.literal("unknown_transfer")) },
  handler: async (ctx, args) => { service(args.serviceSecret); return finishWebhookFor(ctx, args); },
});

/** Treasury-wide exceptions are visible only within the owning organization. */
export const webhookExceptions = query({
  args: scope,
  handler: async (ctx, args): Promise<ReconciliationException[]> => {
    const { order, treasury } = await orderScope(ctx, args);
    if (!treasury) return [];
    const rows = await ctx.db.query("cdpWebhookReceipts").withIndex("by_treasury", q =>
      q.eq("organizationId", order.organizationId).eq("treasury", treasury)).collect();
    const exceptions: ReconciliationException[] = [];
    for (const row of rows.filter(row => row.status === "unknown_transfer")) {
      const linked = await ctx.db.query("chainObservations").withIndex("by_transfer", q => q.eq("network", PAYMENT_NETWORK)
        .eq("txHash", row.txHash).eq("logIndex", row.logIndex)).unique();
      if (!linked) exceptions.push({ code: "unknown_transfer", chainIdentity: row.transferKey,
        detail: `${order.publicId.startsWith("scenario:") ? `SIMULATED ${order.publicId.slice("scenario:".length)}: ` : ""}CDP reported a treasury USDC transfer without a reconciled business intent; treasury-wide advisory evidence, not posted cash.` });
    }
    return exceptions;
  },
});

export const witnessInputs = query({ args: scope, handler: async (ctx, args) => {
  const { treasury, observations } = await orderScope(ctx, args);
  return { treasury, txHashes: [...new Set(observations.map(row => row.txHash))] };
} });

// One durable global gate prevents concurrent isolates exceeding CDP's 2 qps.
// Reserve 15 seconds (longer than the HTTP deadline); cache each order for 30 seconds.
export const reserveRefresh = internalMutation({ args: scope, handler: async (ctx, args) => {
  const { order, treasury } = await orderScope(ctx, args);
  if (!treasury) return false;
  const snapshot = await ctx.db.query("cdpWitnessSnapshots").withIndex("by_order", q => q.eq("orderId", order._id)).unique();
  if (snapshot && Date.now() - snapshot.fetchedAt < 30_000) return false;
  const gate = await ctx.db.query("cdpQueryGate").withIndex("by_key", q => q.eq("key", "sql")).unique();
  if (gate && gate.nextAt > Date.now()) return false;
  if (gate) await ctx.db.patch(gate._id, { nextAt: Date.now() + 15_000 });
  else await ctx.db.insert("cdpQueryGate", { key: "sql", nextAt: Date.now() + 15_000 });
  return true;
} });
export const storeSnapshot = internalMutation({ args: { ...scope, treasury: v.string(), resultJson: v.string() }, handler: async (ctx, args) => {
  const { order, treasury } = await orderScope(ctx, args);
  if (treasury !== args.treasury) throw new Error("treasury_changed");
  const prior = await ctx.db.query("cdpWitnessSnapshots").withIndex("by_order", q => q.eq("orderId", order._id)).unique();
  const values = { organizationId: order.organizationId, orderId: order._id, treasury, resultJson: args.resultJson, fetchedAt: Date.now() };
  if (prior) await ctx.db.patch(prior._id, values); else await ctx.db.insert("cdpWitnessSnapshots", values);
} });

export const refresh = action({ args: scope, handler: async (ctx, args): Promise<{ status: string }> => {
  const inputs = await ctx.runQuery(makeFunctionReference<"query", Scope, { treasury: string | null; txHashes: string[] }>("chainWitness:witnessInputs"), args);
  if (!inputs.treasury) return { status: "witness_unavailable" };
  const reserved = await ctx.runMutation(makeFunctionReference<"mutation", Scope, boolean>("chainWitness:reserveRefresh"), args);
  if (!reserved) return { status: "cached_or_rate_limited" };
  const result = await fetchCdpTransfers({ treasury: inputs.treasury, txHashes: inputs.txHashes, apiKey: process.env.CDP_CLIENT_API_KEY });
  await ctx.runMutation(makeFunctionReference<"mutation", Scope & { treasury: string; resultJson: string }, null>("chainWitness:storeSnapshot"),
    { ...args, treasury: inputs.treasury, resultJson: JSON.stringify(result) });
  return { status: result.status };
} });

export const reconciliationWithWitness = query({ args: scope, handler: async (ctx, args): Promise<ReconciliationWithWitness> => {
  const { treasury, observations } = await orderScope(ctx, args);
  const reconciliation = await ctx.runQuery(api.payments.reconciliation, args);
  const snapshot = await ctx.db.query("cdpWitnessSnapshots").withIndex("by_order", q => q.eq("orderId", args.orderId)).unique();
  const fresh = snapshot && snapshot.treasury === treasury && Date.now() - snapshot.fetchedAt < 120_000;
  const result: SqlResult = fresh ? JSON.parse(snapshot.resultJson) as SqlResult :
    { status: "witness_unavailable", reason: "not_refreshed_or_stale", fetchedAt: Date.now() };
  const witnesses = observations.map(row => ({ chainIdentity: chainIdentity(row), ...compareCdpWitness(row, result) }));
  const extra = await ctx.runQuery(makeFunctionReference<"query", Scope, ReconciliationException[]>("chainWitness:webhookExceptions"), args);
  return { ...reconciliation, matches: reconciliation.matches.map(row => ({ ...row,
    witness: witnesses.find(witness => witness.chainIdentity === row.chainIdentity) ?? { chainIdentity: row.chainIdentity, status: "witness_unavailable" as const } })),
    exceptions: [...reconciliation.exceptions, ...extra], witnesses,
    witness: { status: result.status, fetchedAt: snapshot?.fetchedAt ?? null,
      ...(result.status === "witness_unavailable" ? { reason: result.reason } : {}) } };
} });
