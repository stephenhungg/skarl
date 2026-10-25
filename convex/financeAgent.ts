"use node";
import process from "node:process";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { GeminiFailure } from "./lib/gemini";
import { ClaudeFailure } from "./lib/claude";
import { FINANCE_SYSTEM } from "./lib/financeAgentPrompt";
import { financeMaxToolCalls, financeContextChars } from "./lib/financeAgentBudget";
import { dispatchFinanceTool } from "./lib/financeToolDispatch";
import { financeProposalAuthorized } from "./lib/financeAgentIntent";
import { createFinanceProvider, financeProviderConfig } from "./lib/financeAgentProvider";
import { runFinanceLoop, positiveAtomic, type AgentStep } from "./lib/financeAgentLoop";

export const run = action({
  args: { demoIdentity: v.string(), orderId: v.id("orders"), requestId: v.string(), prompt: v.string() },
  handler: async (ctx, args): Promise<{ runId: Id<"financeAgentRuns">; replayed: boolean }> => {
    const { provider, model } = financeProviderConfig();
    const maxToolCalls = financeMaxToolCalls();
    const maxBatchAtomic = positiveAtomic(process.env.FINANCE_AGENT_MAX_BATCH_ATOMIC || "10000000").toString();
    const started = await ctx.runMutation(internal.financeAgentData.begin, { ...args, provider, model, maxToolCalls, maxBatchAtomic });
    if (started.replayed) return started;
    let persisted: AgentStep[] = [];
    const proposalAuthorized = financeProposalAuthorized(args.prompt);
    const scope = { demoIdentity: "finance-agent", orderId: args.orderId }, deadline = Date.now() + 120_000;
    try {
      const result = await runFinanceLoop({ maxToolCalls, deadline, contextChars: financeContextChars(),
        next: createFinanceProvider({ provider, model, system: FINANCE_SYSTEM, deadline, readOnly: !proposalAuthorized,
          prompt: `Order ${args.orderId}. Max cumulative proposal ${maxBatchAtomic} micro-USDC. Request: ${args.prompt}` }),
        execute: call => dispatchFinanceTool(ctx, call, { role: "run", orderId: args.orderId }, async call => {
          switch (call.name) {
            case "proposePaymentBatch": return proposalAuthorized ? ctx.runMutation(internal.financeAgentData.proposeBatch, { runId: started.runId, payableIds: call.arguments.payableIds as Id<"payables">[] }) : { ok: false, code: "proposal_not_requested" };
            case "requestApproval": return proposalAuthorized ? ctx.runMutation(internal.financeAgentData.requestApproval, { runId: started.runId, intentId: call.arguments.intentId as Id<"paymentIntents"> }) : { ok: false, code: "proposal_not_requested" };
            case "approve": case "approvePayment": {
              const rows = await ctx.runQuery(api.dashboard.payables, scope);
              if (!rows.some(row => row.intent?._id === call.arguments.intentId)) return { ok: false, code: "not_found" };
              return ctx.runMutation(internal.financeAgentData.refuseApproval, { runId: started.runId, intentId: call.arguments.intentId as Id<"paymentIntents"> });
            }
            default: throw new Error("tool_not_allowed");
          }
        }),
        persist: async steps => { persisted = steps; await ctx.runMutation(internal.financeAgentData.save, { runId: started.runId, transcriptJson: JSON.stringify(steps, (_key, value) => typeof value === "bigint" ? value.toString() : value) }); },
      });
      const taxAdvisory = result.steps.some(step => step.call.name === "taxSummary" || step.call.name === "contributorsNeedingForms");
      // Keep the disclosure even when a provider forgets the system instruction.
      const explanation = taxAdvisory && !result.explanation.startsWith("Not tax advice — demo data")
        ? `Not tax advice — demo data\n${result.explanation}`.slice(0, 6000) : result.explanation;
      await ctx.runMutation(internal.financeAgentData.save, { runId: started.runId, transcriptJson: JSON.stringify(result.steps), status: result.status, explanation });
    } catch (error) {
      const failureCode = error instanceof GeminiFailure || error instanceof ClaudeFailure ? error.code : "agent_run_failed";
      await ctx.runMutation(internal.financeAgentData.save, { runId: started.runId, transcriptJson: JSON.stringify(persisted), status: "failed", failureCode,
        explanation: "Agent stopped. Review persisted tool results; no approval or transfer authority was granted." });
    }
    return started;
  },
});
