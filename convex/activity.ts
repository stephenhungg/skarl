import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { financeScope, ledgerRows, orderRows, pageRows } from "./lib/dashboardRead";

const args = { demoIdentity: v.string(), orderId: v.optional(v.id("orders")), cursor: v.optional(v.string()), limit: v.optional(v.number()) };

async function observationsFor(ctx: QueryCtx, intent: Doc<"paymentIntents">) {
  const attempts = await ctx.db.query("paymentAttempts").withIndex("by_intent", q => q.eq("paymentIntentId", intent._id)).collect();
  const observations = (await Promise.all(attempts.map(async attempt => {
    if (attempt.organizationId !== intent.organizationId || (intent.kind === "contributor_payout" && attempt.paymentCommandId !== intent.paymentCommandId)) throw new Error("payment_reference_mismatch");
    const rows = await ctx.db.query("chainObservations").withIndex("by_attempt", q => q.eq("paymentAttemptId", attempt._id)).collect();
    if (rows.some(row => row.organizationId !== intent.organizationId)) throw new Error("cross_organization_reference");
    return rows;
  }))).flat();
  return { attempts, observations };
}

export const contributors = query({
  args,
  handler: async (ctx, input) => {
    const scope = await financeScope(ctx, input.demoIdentity, input.orderId);
    const { rows } = await ledgerRows(ctx, scope.principal.organizationId, scope.orderIds);
    const { submissions } = await orderRows(ctx, scope.orders);
    const memberships = await ctx.db.query("memberships").withIndex("by_org_identity", q => q.eq("organizationId", scope.principal.organizationId)).collect();
    const totals = new Map<string, { earned: bigint; paid: bigint; outstanding: bigint }>();
    for (const row of rows) for (const line of row.lines) {
      if (line.account !== "liability:contributor_payables") continue;
      if (!row.contributorTokenIdentifier?.trim()) throw new Error("payables_contributor_required");
      const total = totals.get(row.contributorTokenIdentifier) ?? { earned: 0n, paid: 0n, outstanding: 0n }, amount = BigInt(line.amountAtomic);
      total.outstanding += line.side === "credit" ? amount : -amount;
      if (row.kind === "fulfillment" && line.side === "credit") total.earned += amount;
      if (row.kind === "payout" && line.side === "debit") total.paid += amount;
      totals.set(row.contributorTokenIdentifier, total);
    }
    const tokens = new Set([...memberships.filter(row => row.roles.includes("contributor")).map(row => row.tokenIdentifier), ...totals.keys(), ...submissions.map(row => row.contributorTokenIdentifier)]);
    const result = [...tokens].map(tokenIdentifier => {
      const member = memberships.find(row => row.tokenIdentifier === tokenIdentifier), total = totals.get(tokenIdentifier);
      const own = submissions.filter(row => row.contributorTokenIdentifier === tokenIdentifier);
      return { id: tokenIdentifier, occurredAt: member?._creationTime ?? 0, tokenIdentifier, membershipId: member?._id ?? null,
        status: member?.status ?? "unavailable", submitted: own.filter(row => row.status !== "uploading").length.toString(),
        accepted: own.filter(row => row.status === "accepted").length.toString(),
        earningsAccruedAtomic: (total?.earned ?? 0n).toString(), earningsPaidAtomic: (total?.paid ?? 0n).toString(), outstandingAtomic: (total?.outstanding ?? 0n).toString() };
    });
    return pageRows(result, `contributors:${scope.principal.organizationId}:${input.orderId ?? "all"}`, input.cursor, input.limit);
  },
});

/** Includes every proposal state. A proposal/attempt is never labeled as paid. */
export const payoutHistory = query({
  args,
  handler: async (ctx, input) => {
    const scope = await financeScope(ctx, input.demoIdentity, input.orderId), data = await orderRows(ctx, scope.orders);
    const result = [];
    for (const intent of data.intents) {
      if (intent.kind !== "contributor_payout") continue;
      const payable = data.payables.find(row => row._id === intent.payableId);
      if (!payable || payable.orderId !== intent.orderId) throw new Error("payment_reference_mismatch");
      const { attempts, observations } = await observationsFor(ctx, intent);
      result.push({ id: intent._id, occurredAt: intent._creationTime, intentId: intent._id, orderId: intent.orderId, payableId: payable._id,
        contributorTokenIdentifier: payable.contributorTokenIdentifier, recipientAddress: intent.recipientAddress, amountAtomic: intent.amountAtomic.toString(),
        network: intent.network, status: intent.status, payableStatus: payable.status,
        attempts: attempts.map(row => ({ id: row._id, status: row.status, txHash: row.txHash ?? null, createdAt: row.createdAt })),
        observations: observations.map(row => ({ id: row._id, network: row.network, txHash: row.txHash, logIndex: row.logIndex,
          amountAtomic: row.amountAtomic.toString(), blockNumber: row.blockNumber.toString(), succeeded: row.succeeded, confirmations: row.confirmations, observedAt: row.observedAt })) });
    }
    return pageRows(result, `payouts:${scope.principal.organizationId}:${input.orderId ?? "all"}`, input.cursor, input.limit);
  },
});

export const feed = query({
  args,
  handler: async (ctx, input) => {
    const scope = await financeScope(ctx, input.demoIdentity, input.orderId), data = await orderRows(ctx, scope.orders);
    const entities = new Set<string>([...scope.orderIds, ...data.submissions.map(row => row._id), ...data.payables.map(row => row._id), ...data.intents.map(row => row._id), ...data.runs.map(row => row._id)]);
    const audits = (await ctx.db.query("auditEvents").withIndex("by_org_time", q => q.eq("organizationId", scope.principal.organizationId)).collect())
      .filter(row => !input.orderId || entities.has(row.entityId));
    const events: { id: string; occurredAt: number; source: "audit" | "chain" | "agent"; recordId: string; action: string; summary: string; evidenceReferences: string[]; amountAtomic?: string; txHash?: string; logIndex?: number }[] = audits.map(row => ({
      id: `audit:${row._id}`, occurredAt: row.occurredAt, source: "audit", recordId: row._id, action: row.action, summary: row.reason, evidenceReferences: row.evidenceReferences }));
    const observations = await ctx.db.query("chainObservations").filter(q => q.eq(q.field("organizationId"), scope.principal.organizationId)).collect();
    for (const row of observations) {
      const attempt = await ctx.db.get(row.paymentAttemptId);
      if (!attempt || attempt.organizationId !== scope.principal.organizationId) throw new Error("payment_reference_mismatch");
      const intent = attempt.paymentIntentId ? await ctx.db.get(attempt.paymentIntentId) : null;
      const command = attempt.paymentCommandId ? await ctx.db.get(attempt.paymentCommandId) : null;
      if ((intent && intent.organizationId !== scope.principal.organizationId) || (command && command.organizationId !== scope.principal.organizationId)) throw new Error("cross_organization_reference");
      const orderId = intent?.orderId ?? command?.orderId;
      if (input.orderId && orderId !== input.orderId) continue;
      events.push({ id: `chain:${row._id}`, occurredAt: row.observedAt, source: "chain", recordId: row._id,
        action: row.succeeded ? "transfer_observed" : "transfer_failed", summary: `${intent?.kind ?? command?.kind ?? "unlinked_transfer"}: ${row.confirmations} confirmations`,
        evidenceReferences: [row.paymentAttemptId, ...(intent ? [intent._id] : []), ...(command ? [command._id] : [])],
        amountAtomic: row.amountAtomic.toString(), txHash: row.txHash, logIndex: row.logIndex });
    }
    // Use the immutable start time so an in-flight run completing does not move between pages.
    for (const run of data.runs) events.push({ id: `agent:${run._id}`, occurredAt: run.startedAt, source: "agent", recordId: run._id,
      action: `finance_agent_${run.status}`, summary: run.explanation ?? run.failureCode ?? "Finance agent run in progress.", evidenceReferences: [run.orderId, ...run.reservedPayableIds] });
    return pageRows(events, `activity:${scope.principal.organizationId}:${input.orderId ?? "all"}`, input.cursor, input.limit);
  },
});
