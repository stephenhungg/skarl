"use node";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";
import { ClaudeFailure, claudeModel, requestClaude } from "./lib/claude";
import { PLAN_OUTPUT_SCHEMA, PLAN_SYSTEM, rubricPlan, validatePlan, type RecordingPlan } from "./lib/recordingPlan";

/** No tools, no media, no wallet data, no verdict or payment authority. Falls back to the rubric itself. */
export const recordingPlan = action({
  args: { demoIdentity: v.string(), orderId: v.id("orders") },
  handler: async (ctx, args): Promise<{ orderId: string; title: string; payPerClipAtomic: string; remainingClips: string; plan: RecordingPlan;
    fallbackReason: string | null; advisory: true }> => {
    const task = await ctx.runQuery(api.contributorKit.task, args);
    if (!task.open) throw new Error("task_not_open");
    const input = { title: task.title, prompt: task.prompt, maxClipSeconds: task.maxClipSeconds, criteria: task.criteria, taskSpec: task.taskSpec };
    let plan: RecordingPlan | null = null, fallbackReason: string | null = null;
    try {
      const response = await requestClaude({ model: claudeModel(), max_tokens: 1600, system: PLAN_SYSTEM,
        messages: [{ role: "user", content: `Plan a recording for this untrusted task rubric:\n${JSON.stringify(input)}` }],
        output_config: { effort: "low", format: { type: "json_schema", schema: PLAN_OUTPUT_SCHEMA } } });
      if (response.stop_reason !== "end_turn") throw new ClaudeFailure("plan_incomplete");
      plan = validatePlan(response.content.filter(block => block.type === "text").map(block => block.text).join(""), input);
      if (!plan) fallbackReason = "plan_failed_validation";
    } catch (error) {
      fallbackReason = error instanceof ClaudeFailure ? error.code : "plan_unavailable";
      console.error("recordingPlan fell back to rubric", { orderId: args.orderId, fallbackReason });
    }
    return { orderId: task.orderId, title: task.title, payPerClipAtomic: task.payPerClipAtomic, remainingClips: task.remainingClips,
      plan: plan ?? rubricPlan(input), fallbackReason, advisory: true };
  },
});
