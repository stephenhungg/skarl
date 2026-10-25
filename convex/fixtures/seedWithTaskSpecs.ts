import type { TestConvex } from "convex-test";
import schema from "../schema";
import { internal } from "../_generated/api";
import { RED_CUP_TASK_SPEC } from "./taskSpecs";

/** Synthetic extraction witness for tests; never run as a production fallback. */
export async function seedWithTaskSpecs(t: TestConvex<typeof schema>) {
  const seeded = await t.mutation(internal.seed.demo, {});
  for (const orderId of new Set([seeded.orderId, seeded.defaultOrderId])) {
    const context = await t.query(internal.orders.taskSpecContext, { orderId });
    if (!context) throw new Error("fixture_rubric_missing");
    await t.mutation(internal.orders.storeTaskSpec, { orderId, taskVersionId: context.rubric._id,
      rubricHash: context.rubric.contentHash, version: "rubric-task-spec-v1", provider: "synthetic",
      model: "synthetic-fixture-extractor", taskSpec: RED_CUP_TASK_SPEC });
  }
  await t.run(async ctx => {
    for (const scheduled of await ctx.db.system.query("_scheduled_functions").collect()) {
      if (scheduled.name === "taskSpecExtraction:extract" && scheduled.state.kind === "pending") await ctx.scheduler.cancel(scheduled._id);
    }
  });
  return seeded;
}
