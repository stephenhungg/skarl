import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

/** Compatibility command: every open order now extracts from its own rubric. */
export const backfill = internalAction({
  args: {},
  handler: async (ctx): Promise<{ ready: number; pending: number; skipped: number }> =>
    ctx.runAction(internal.orders.backfillTaskSpecs, {}),
});
