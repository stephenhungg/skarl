import { internalMutation } from "./_generated/server";
import { audit, digest } from "./lib/finance";
import { CAN_TO_HAT_TASK_SPEC, normalizeTaskSpec, resolveTaskSpec } from "./lib/taskSpec";

const CAN_ORDER_ID = "kh7c6cy844fyjxzpsg945v0c618gzsha";
const CAN_RUBRIC_HASH = "a276054dbfea4a981ad5e925372c420e063649e7b82fb2952d80f28f37fb1079";

/** Operator-only, idempotent enrichment. Retains all frozen commercial/rubric hashes. */
export const backfill = internalMutation({
  args: {},
  handler: async ctx => {
    const orders = await ctx.db.query("orders").take(501);
    if (orders.length > 500) throw new Error("task_spec_migration_requires_bounded_scope");
    const changed: string[] = [], skipped: string[] = [];
    for (const order of orders) {
      if (!order.taskVersionId) continue;
      const rubric = await ctx.db.get(order.taskVersionId);
      if (!rubric || rubric.orderId !== order._id || rubric.organizationId !== order.organizationId) throw new Error("task_spec_rubric_scope_mismatch");
      const can = order._id === CAN_ORDER_ID;
      if (can && rubric.contentHash !== CAN_RUBRIC_HASH) throw new Error("can_task_rubric_changed");
      const spec = can && rubric.contentHash === CAN_RUBRIC_HASH
        ? normalizeTaskSpec(CAN_TO_HAT_TASK_SPEC) : resolveTaskSpec(rubric);
      if (!spec) { skipped.push(order._id); continue; }
      const taskSpecHash = digest({ contentHash: rubric.contentHash, taskSpec: spec });
      if (rubric.taskSpec && digest(normalizeTaskSpec(rubric.taskSpec)) !== digest(spec)) throw new Error("frozen_task_spec_conflict");
      if (order.taskSpec && digest(normalizeTaskSpec(order.taskSpec)) !== digest(spec)) throw new Error("order_task_spec_conflict");
      if (rubric.taskSpec && rubric.taskSpecHash === taskSpecHash && order.taskSpec) continue;
      await ctx.db.patch(rubric._id, { taskSpec: spec, taskSpecHash });
      await ctx.db.patch(order._id, { taskSpec: spec });
      await audit(ctx, { organizationId: order.organizationId, eventKey: `task_spec_backfill:v1:${rubric._id}`,
        actor: { kind: "service", identity: "task-spec-migration-v1" }, action: "task_spec_backfilled", entityType: "orders", entityId: order._id,
        reason: "Structured task vocabulary bound to the existing immutable rubric hash; financial terms and historical reports retained.",
        evidenceReferences: [rubric._id, rubric.contentHash, taskSpecHash] });
      changed.push(order._id);
    }
    return { changed, skipped, migration: "task-spec-backfill-v1" };
  },
});
