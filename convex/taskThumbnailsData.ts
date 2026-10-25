import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { isContributorTask } from "./dashboard";

export const task = internalQuery({
  args: { orderId: v.id("orders") },
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.orderId);
    if (!order?.taskVersionId) return null;
    const rubric = await ctx.db.get(order.taskVersionId);
    const spec = rubric?.taskSpecStatus === "ready" ? rubric.taskSpec : undefined;
    return { title: order.title, hasThumbnail: !!order.thumbnailStorageId,
      steps: spec?.steps ?? rubric?.criteria.map(criterion => criterion.description) ?? [] };
  },
});

export const missing = internalQuery({
  args: {},
  handler: async ctx => (await ctx.db.query("orders").order("desc").take(200))
    .filter(order => isContributorTask(order) && !order.thumbnailStorageId).map(order => order._id),
});

export const attach = internalMutation({
  args: { orderId: v.id("orders"), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("order_not_found");
    if (order.thumbnailStorageId) await ctx.storage.delete(order.thumbnailStorageId);
    await ctx.db.patch(args.orderId, { thumbnailStorageId: args.storageId });
  },
});
