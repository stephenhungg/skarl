import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireRole } from "./lib/demoAuth";
import { requireBuyerOrder } from "./lib/finance";
const scope = { demoIdentity: v.string(), orderId: v.id("orders") };
async function access(ctx: QueryCtx, args: { demoIdentity: string; orderId: Id<"orders"> }) {
  const principal = await requireRole(ctx, args.demoIdentity, ["buyer", "controller", "finance-agent"]);
  const order = await ctx.db.get(args.orderId);
  if (!order) throw new Error("order_not_found");
  requireBuyerOrder(principal, order);
  return order;
}
export const notesFor = query({ args: scope, handler: async (ctx, args) => {
  const order = await access(ctx, args);
  return (await ctx.db.query("analystNotes").withIndex("by_order", q => q.eq("orderId", order._id)).order("desc").take(100))
    .filter(note => note.organizationId === order.organizationId && note.kind !== "close")
    .map(({ transcriptJson: _transcript, factsJson: _facts, ...note }) => note);
} });
export const latestClose = query({ args: scope, handler: async (ctx, args) => {
  const order = await access(ctx, args);
  const note = await ctx.db.query("analystNotes").withIndex("by_org_kind", q => q.eq("organizationId", order.organizationId).eq("kind", "close")).order("desc").first();
  if (!note) return null;
  const { transcriptJson: _transcript, factsJson, ...visible } = note;
  return { ...visible, facts: factsJson ? JSON.parse(factsJson) : null };
} });
