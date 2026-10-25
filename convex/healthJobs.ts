import { makeFunctionReference } from "convex/server";
import { internalAction } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { Infer } from "convex/values";
import type { healthCron } from "./healthSchema";

type Job = Infer<typeof healthCron>;
const start = makeFunctionReference<"mutation", { job: Job }, Id<"healthCronRuns">>("healthData:startCron");
const finish = makeFunctionReference<"mutation", { id: Id<"healthCronRuns">; outcome: "complete" | "failed" | "disabled" }, null>("healthData:finishCron");

function observed(job: Job, target: string) {
  return internalAction({ args: {}, handler: async ctx => {
    const id = await ctx.runMutation(start, { job });
    try {
      const result = await ctx.runAction(makeFunctionReference<"action", {}, { status?: string; errors?: number; pending?: number }>(target), {});
      const disabled = result.status === "disabled" || result.status === "nessie_not_configured" ||
        (job === "attest" && process.env.EAS_ATTESTATIONS_ENABLED !== "true");
      await ctx.runMutation(finish, { id, outcome: disabled ? "disabled" :
        result.errors || result.pending || result.status === "partial" ? "failed" : "complete" });
    } catch {
      await ctx.runMutation(finish, { id, outcome: "failed" });
      throw new Error("observed_cron_failed");
    }
  } });
}

// Keep existing jobs' authorization, idempotency and payment behavior intact.
export const reconcile = observed("reconcile", "scheduledJobs:reconcile");
export const finance = observed("finance", "scheduledJobs:finance");
export const attest = observed("attest", "attestations:sweep");
export const bank = observed("bank", "bankWitness:sweep");
