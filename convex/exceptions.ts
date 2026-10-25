import { v } from "convex/values";
import { api } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrderAuthority, requireRole } from "./lib/demoAuth";
import { requireBuyerOrder, actorFor, audit, digest, requireTenant } from "./lib/finance";
import type { ReconciliationException as PaymentReconciliationException } from "../packages/payments/src/reconciliation";
import { makeFunctionReference } from "convex/server";
const webhookExceptions = makeFunctionReference<"query", { demoIdentity: string; orderId: Id<"orders"> }, ReconciliationException[]>("chainWitness:webhookExceptions");

import type { TaxException } from "./lib/tax";
import type { PolicyException } from "./lib/policyReview";
import type { BankException } from "./bankWitness";
type ReconciliationException = PaymentReconciliationException | BankException | PolicyException | TaxException;
const bankExceptions = makeFunctionReference<"query", { demoIdentity: string; orderId: Id<"orders"> }, BankException[]>("bankWitness:bankExceptions");

const scope = { demoIdentity: v.string(), orderId: v.id("orders") };
const exceptionKey = (exception: ReconciliationException) => digest(exception);
type QueueItem = {
  exceptionKey: string; exception: ReconciliationException; stillDetected: boolean;
  disposition: Doc<"reconciliationDispositions"> | null;
};

/** Dispositions annotate reconciliation evidence; even resolved discrepancies remain visible while detected. */
export const list = query({
  args: scope,
  handler: async (ctx, args): Promise<QueueItem[]> => {
    const principal = await requireRole(ctx, args.demoIdentity, ["buyer", "controller", "finance-agent"]);
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("order_not_found");
    requireBuyerOrder(principal, order);
    const result: { exceptions: ReconciliationException[] } = await ctx.runQuery(api.payments.reconciliation, args);
    result.exceptions.push(...await ctx.runQuery(webhookExceptions, args));
    result.exceptions.push(...await ctx.runQuery(bankExceptions, args));
    const dispositions = await ctx.db.query("reconciliationDispositions").withIndex("by_order", q => q.eq("orderId", order._id)).collect();
    for (const row of dispositions) requireTenant(principal, row);
    const current = new Map(result.exceptions.map(exception => [exceptionKey(exception), exception]));
    return [
      ...[...current].map(([key, exception]) => ({ exceptionKey: key, exception, stillDetected: true,
        disposition: dispositions.find(row => row.exceptionKey === key) ?? null })),
      ...dispositions.filter(row => !current.has(row.exceptionKey)).map(row => ({ exceptionKey: row.exceptionKey,
        exception: JSON.parse(row.snapshotJson) as ReconciliationException, stillDetected: ["policy_review", "info_return_needed"].includes(JSON.parse(row.snapshotJson).code) && row.status !== "resolved", disposition: row })),
    ];
  },
});

export const acknowledge = mutation({
  args: { ...scope, exceptionKey: v.string(), reason: v.string() },
  handler: async (ctx, args) => setDisposition(ctx, args, "acknowledged"),
});
export const resolve = mutation({
  args: { ...scope, exceptionKey: v.string(), reason: v.string() },
  handler: async (ctx, args) => setDisposition(ctx, args, "resolved"),
});

import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
async function setDisposition(ctx: MutationCtx, args: {
  demoIdentity: string; orderId: Id<"orders">; exceptionKey: string; reason: string;
}, status: "acknowledged" | "resolved"): Promise<{ dispositionId: Id<"reconciliationDispositions">; replayed: boolean }> {
  const { principal, order } = await requireOrderAuthority(ctx, args.demoIdentity, args.orderId);
  const reason = args.reason.trim();
  if (!reason || reason.length > 2000 || !/^[a-f0-9]{64}$/.test(args.exceptionKey)) throw new Error("invalid_exception_disposition");
  const prior = await ctx.db.query("reconciliationDispositions").withIndex("by_exception", q =>
    q.eq("organizationId", principal.organizationId).eq("orderId", order._id).eq("exceptionKey", args.exceptionKey)).unique();
  if (prior?.status === status) {
    if (prior.reason !== reason || prior.actorTokenIdentifier !== principal.tokenIdentifier) throw new Error("exception_disposition_conflict");
    return { dispositionId: prior._id, replayed: true };
  }
  if (prior?.status === "resolved") throw new Error("exception_already_resolved");
  const current: { exceptions: ReconciliationException[] } = await ctx.runQuery(api.payments.reconciliation, { demoIdentity: args.demoIdentity, orderId: order._id });
  current.exceptions.push(...await ctx.runQuery(webhookExceptions, { demoIdentity: args.demoIdentity, orderId: order._id }));
  current.exceptions.push(...await ctx.runQuery(bankExceptions, { demoIdentity: args.demoIdentity, orderId: order._id }));
  const exception = current.exceptions.find(row => exceptionKey(row) === args.exceptionKey);
  if (!exception && !prior) throw new Error("exception_not_found");
  const values = { status, reason, actorTokenIdentifier: principal.tokenIdentifier, updatedAt: Date.now() };
  const dispositionId = prior ? prior._id : await ctx.db.insert("reconciliationDispositions", {
    organizationId: principal.organizationId, orderId: order._id, exceptionKey: args.exceptionKey,
    snapshotJson: JSON.stringify(exception), ...values,
  });
  if (prior) await ctx.db.patch(prior._id, values);
  await audit(ctx, { organizationId: principal.organizationId, eventKey: `exception:${args.exceptionKey}:${status}`,
    actor: actorFor(principal), action: `reconciliation_exception_${status}`, entityType: "orders", entityId: order._id,
    reason, evidenceReferences: [dispositionId, args.exceptionKey] });
  return { dispositionId, replayed: false };
}
