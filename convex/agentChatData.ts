import { configNumber } from "./lib/config";
import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireRole } from "./lib/demoAuth";
import { actorFor, audit, requireBuyerOrder, requireTenant } from "./lib/finance";

export const begin = internalMutation({
  args: { demoIdentity: v.string(), orderId: v.id("orders"), requestId: v.string(), question: v.string(), model: v.string() },
  handler: async (ctx, args) => {
    const principal = await requireRole(ctx, args.demoIdentity, ["buyer", "controller", "finance-agent"]);
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("order_not_found");
    requireBuyerOrder(principal, order);
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(args.requestId) || !args.question.trim() || args.question.length > 2000 ||
      !/^[a-z0-9][a-z0-9._-]{0,80}$/.test(args.model)) throw new Error("invalid_chat_request");
    const prior = await ctx.db.query("agentChats").withIndex("by_request", q => q.eq("organizationId", principal.organizationId)
      .eq("requesterTokenIdentifier", principal.tokenIdentifier).eq("requestId", args.requestId)).unique();
    if (prior) {
      if (prior.orderId !== order._id || prior.question !== args.question) throw new Error("chat_request_conflict");
      return { chatId: prior._id, replayed: true };
    }
    const chatId = await ctx.db.insert("agentChats", { organizationId: principal.organizationId, orderId: order._id,
      requesterTokenIdentifier: principal.tokenIdentifier, requestId: args.requestId, question: args.question,
      model: args.model, status: "running", transcriptJson: "[]", citedRecordIds: [], startedAt: Date.now() });
    await ctx.scheduler.runAfter(configNumber("SKARL_AGENT_CHAT_LEASE_MS"), internal.agentChatData.expire, { chatId });
    await audit(ctx, { organizationId: principal.organizationId, eventKey: `chat:${chatId}`, actor: actorFor(principal),
      action: "finance_chat_requested", entityType: "orders", entityId: order._id,
      reason: "Read-only financial question; chat cannot propose, approve or execute payments.", evidenceReferences: [chatId] });
    return { chatId, replayed: false };
  },
});

export const save = internalMutation({
  args: { demoIdentity: v.string(), chatId: v.id("agentChats"), transcriptJson: v.string(),
    status: v.optional(v.union(v.literal("completed"), v.literal("failed"), v.literal("capped"))),
    answer: v.optional(v.string()), citedRecordIds: v.array(v.string()), failureCode: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const principal = await requireRole(ctx, args.demoIdentity, ["buyer", "controller", "finance-agent"]);
    const row = await ctx.db.get(args.chatId);
    if (!row) throw new Error("chat_not_found");
    requireTenant(principal, row);
    if (row.requesterTokenIdentifier !== principal.tokenIdentifier) throw new Error("chat_not_owned");
    if (args.transcriptJson.length > 100_000 || (args.answer?.length ?? 0) > 6000 || args.citedRecordIds.length > 200 ||
      args.citedRecordIds.some(id => !/^[a-zA-Z0-9_-]{1,128}$/.test(id))) throw new Error("chat_result_limit");
    const steps: unknown = JSON.parse(args.transcriptJson);
    if (!Array.isArray(steps) || steps.length > 24 || steps.length < JSON.parse(row.transcriptJson).length) throw new Error("chat_step_limit");
    if (row.status !== "running") {
      if (row.status === args.status && row.transcriptJson === args.transcriptJson && row.answer === args.answer &&
        JSON.stringify(row.citedRecordIds) === JSON.stringify(args.citedRecordIds) && row.failureCode === args.failureCode) return { replayed: true };
      throw new Error("chat_already_finished");
    }
    await ctx.db.patch(row._id, { transcriptJson: args.transcriptJson, citedRecordIds: args.citedRecordIds,
      ...(args.status ? { status: args.status, completedAt: Date.now() } : {}),
      ...(args.answer === undefined ? {} : { answer: args.answer }), ...(args.failureCode ? { failureCode: args.failureCode } : {}) });
    return { replayed: false };
  },
});

export const history = query({
  args: { demoIdentity: v.string(), orderId: v.id("orders") },
  handler: async (ctx, args) => {
    const principal = await requireRole(ctx, args.demoIdentity, ["buyer", "controller", "finance-agent"]);
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("order_not_found");
    requireBuyerOrder(principal, order);
    const rows = await ctx.db.query("agentChats").withIndex("by_order", q => q.eq("orderId", order._id)).order("desc").take(50);
    for (const row of rows) requireTenant(principal, row);
    return rows.map(({ transcriptJson, ...row }) => ({ ...row, transcript: JSON.parse(transcriptJson) }));
  },
});

/** Killed actions become failed records; never rerun a question automatically. */
export const expire = internalMutation({
  args: { chatId: v.id("agentChats") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.chatId);
    if (!row || row.status !== "running" || Date.now() - row.startedAt < configNumber("SKARL_AGENT_CHAT_LEASE_MS")) return;
    await ctx.db.patch(row._id, { status: "failed", failureCode: "chat_interrupted", completedAt: Date.now(),
      answer: "The read-only chat was interrupted. No payment changes were made." });
  },
});
