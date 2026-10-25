import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireRole } from "./lib/demoAuth";
import { actorFor, audit, requireTenant } from "./lib/finance";
import { positiveAtomic } from "./lib/financeAgentLoop";
import { proposePaymentFor } from "./finance";

async function running(ctx: MutationCtx, runId: Id<"financeAgentRuns">) {
  const principal = await requireRole(ctx, "finance-agent", "finance-agent");
  const run = await ctx.db.get(runId);
  if (!run) throw new Error("run_not_found");
  requireTenant(principal, run);
  if (run.status !== "running" || Date.now() - run.startedAt > 180_000) throw new Error("run_not_active");
  return { run, principal };
}
export const begin = internalMutation({
  args: { demoIdentity: v.string(), orderId: v.id("orders"), requestId: v.string(), prompt: v.string(), provider: v.optional(v.union(v.literal("gemini"), v.literal("claude"))), model: v.string(), maxToolCalls: v.number(), maxBatchAtomic: v.string() },
  handler: async (ctx, args) => {
    const principal = await requireRole(ctx, args.demoIdentity, ["controller", "finance-agent"]);
    await requireRole(ctx, "finance-agent", "finance-agent");
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("order_not_found");
    requireTenant(principal, order);
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(args.requestId) || !args.prompt.trim() || args.prompt.length > 2000 ||
      !Number.isSafeInteger(args.maxToolCalls) || args.maxToolCalls < 1 || args.maxToolCalls > 24) throw new Error("invalid_agent_request");
    const existing = await ctx.db.query("financeAgentRuns").withIndex("by_request", q => q.eq("organizationId", order.organizationId).eq("requestId", args.requestId)).unique();
    if (existing) {
      if (existing.orderId !== order._id || existing.prompt !== args.prompt || existing.requesterTokenIdentifier !== principal.tokenIdentifier) throw new Error("agent_request_conflict");
      return { runId: existing._id, replayed: true };
    }
    const runId = await ctx.db.insert("financeAgentRuns", { organizationId: order.organizationId, orderId: order._id,
      requestId: args.requestId, prompt: args.prompt, requesterTokenIdentifier: principal.tokenIdentifier,
      provider: args.provider ?? "gemini", model: args.model, maxToolCalls: args.maxToolCalls, maxBatchAtomic: positiveAtomic(args.maxBatchAtomic), proposedAtomic: 0n,
      reservedPayableIds: [], status: "running", transcriptJson: "[]", startedAt: Date.now() });
    await ctx.scheduler.runAfter(180_000, internal.financeAgentData.expire, { runId });
    return { runId, replayed: false };
  },
});
export const save = internalMutation({
  args: { runId: v.id("financeAgentRuns"), transcriptJson: v.string(), status: v.optional(v.union(v.literal("completed"), v.literal("failed"), v.literal("capped"))), explanation: v.optional(v.string()), failureCode: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { run } = await running(ctx, args.runId);
    if (args.transcriptJson.length > 100_000 || (args.explanation?.length ?? 0) > 6000) throw new Error("agent_transcript_limit");
    const steps: unknown = JSON.parse(args.transcriptJson);
    if (!Array.isArray(steps) || steps.length > run.maxToolCalls || steps.length < JSON.parse(run.transcriptJson).length) throw new Error("agent_step_limit");
    await ctx.db.patch(run._id, { transcriptJson: args.transcriptJson, ...(args.status ? { status: args.status, completedAt: Date.now() } : {}),
      ...(args.explanation === undefined ? {} : { explanation: args.explanation }), ...(args.failureCode ? { failureCode: args.failureCode } : {}) });
  },
});
export const proposeBatch = internalMutation({
  args: { runId: v.id("financeAgentRuns"), payableIds: v.array(v.id("payables")) },
  handler: async (ctx, args) => {
    const { run } = await running(ctx, args.runId);
    if (!args.payableIds.length || args.payableIds.length > 20 || new Set(args.payableIds).size !== args.payableIds.length) throw new Error("invalid_batch");
    const rows = await Promise.all(args.payableIds.map(id => ctx.db.get(id)));
    if (rows.some(row => !row || row.organizationId !== run.organizationId || row.orderId !== run.orderId || row.status !== "accrued" || row.amountAtomic <= 0n)) throw new Error("batch_payable_not_open");
    const newRows = rows.filter(row => !run.reservedPayableIds.includes(row!._id));
    const proposedAtomic = run.proposedAtomic + newRows.reduce((sum, row) => sum + row!.amountAtomic, 0n);
    if (proposedAtomic > run.maxBatchAtomic) return { ok: false, code: "batch_amount_limit", maxBatchAtomic: run.maxBatchAtomic.toString() };
    // Same transaction: recomputation, policy and existing proposal writes cannot race.
    const results = [];
    for (const row of rows) {
      const result = await proposePaymentFor(ctx, { demoIdentity: "finance-agent", payableId: row!._id });
      if (!result.ok) throw new Error("batch_proposal_refused");
      results.push({ payableId: row!._id, amountAtomic: row!.amountAtomic.toString(), ...result });
    }
    await ctx.db.patch(run._id, { proposedAtomic, reservedPayableIds: [...new Set([...run.reservedPayableIds, ...args.payableIds])] });
    return { ok: true, proposedAtomic: proposedAtomic.toString(), results };
  },
});
export const requestApproval = internalMutation({
  args: { runId: v.id("financeAgentRuns"), intentId: v.id("paymentIntents") },
  handler: async (ctx, args) => {
    const { run, principal } = await running(ctx, args.runId), intent = await ctx.db.get(args.intentId);
    if (!intent || intent.kind !== "contributor_payout" || intent.organizationId !== run.organizationId || intent.orderId !== run.orderId || intent.status !== "proposed" || intent.expiresAt <= Date.now()) throw new Error("intent_not_requestable");
    await audit(ctx, { organizationId: run.organizationId, eventKey: `approval_requested:${intent._id}`, actor: actorFor(principal),
      action: "independent_approval_requested", entityType: "paymentIntents", entityId: intent._id,
      reason: "Finance agent requested independent controller approval; no approval or transfer occurred.", evidenceReferences: [run._id, intent.paymentCommandId] });
    return { ok: true, status: "approval_required", intentId: intent._id };
  },
});
export const runs = query({
  args: { demoIdentity: v.string(), orderId: v.id("orders") },
  handler: async (ctx, args) => {
    const principal = await requireRole(ctx, args.demoIdentity, ["controller", "finance-agent"]), order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("order_not_found");
    requireTenant(principal, order);
    const rows = await ctx.db.query("financeAgentRuns").withIndex("by_order", q => q.eq("orderId", order._id)).order("desc").take(20);
    return rows.map(row => ({ ...row, provider: row.provider ?? "gemini", maxBatchAtomic: row.maxBatchAtomic.toString(), proposedAtomic: row.proposedAtomic.toString(),
      transcript: JSON.parse(row.transcriptJson), transcriptJson: undefined }));
  },
});

/** Recover a killed action without rerunning proposal tools or inventing an answer. */
export const expire = internalMutation({
  args: { runId: v.id("financeAgentRuns") },
  handler: async (ctx, args) => {
    const principal = await requireRole(ctx, "finance-agent", "finance-agent"), run = await ctx.db.get(args.runId);
    if (!run) return;
    requireTenant(principal, run);
    if (run.status === "running" && Date.now() - run.startedAt >= 180_000) await ctx.db.patch(run._id, {
      status: "failed", failureCode: "agent_interrupted", completedAt: Date.now(),
      explanation: "Agent interrupted. Inspect persisted proposals and tool results before a new request.",
    });
  },
});
