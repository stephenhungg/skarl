"use node";
import { configNumber } from "./lib/config";

import { randomUUID } from "node:crypto";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { GeminiFailure } from "./lib/gemini";
import { ClaudeFailure } from "./lib/claude";
import { createFinanceProvider, financeProviderConfig } from "./lib/financeAgentProvider";
import { runFinanceLoop, type AgentStep } from "./lib/financeAgentLoop";
import { FINANCE_CHAT_SYSTEM } from "./lib/financeAgentPrompt";
import { financeContextChars, financeJson as json, financeMaxToolCalls } from "./lib/financeAgentBudget";
import { dispatchFinanceTool } from "./lib/financeToolDispatch";
import { collectFinanceReferences } from "./lib/financeEvidenceReferences";

/** Uses the existing bounded finance loop with a separate, strictly read-only dispatcher. */
export const askAgent = action({
  args: { demoIdentity: v.string(), question: v.string(), orderId: v.optional(v.id("orders")), requestId: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ chatId: Id<"agentChats">; replayed: boolean }> => {
    const orderId = args.orderId ?? (await ctx.runQuery(api.dashboard.demoContext, { demoIdentity: args.demoIdentity }))?.orderId;
    if (!orderId) throw new Error("order_not_found");
    const { provider, model } = financeProviderConfig();
    const started = await ctx.runMutation(internal.agentChatData.begin, { demoIdentity: args.demoIdentity, orderId,
      question: args.question, requestId: args.requestId ?? randomUUID(), model });
    if (started.replayed) return started;
    const refs = new Set<string>([orderId]), deadline = Date.now() + configNumber("SKARL_AGENT_CHAT_DEADLINE_MS");
    let persisted: AgentStep[] = [];
    try {
      const result = await runFinanceLoop({ maxToolCalls: financeMaxToolCalls(), deadline, contextChars: financeContextChars(),
        next: createFinanceProvider({ provider, model, system: FINANCE_CHAT_SYSTEM, deadline, readOnly: true,
          prompt: `Order ${orderId}. Read-only question: ${args.question}` }),
        execute: async call => {
          const result = await dispatchFinanceTool(ctx, call, { role: "chat", orderId });
          collectFinanceReferences(result, refs);
          return result;
        },
        persist: async steps => {
          persisted = steps;
          await ctx.runMutation(internal.agentChatData.save, { demoIdentity: args.demoIdentity, chatId: started.chatId,
            transcriptJson: json(steps), citedRecordIds: [] });
        },
      });
      // Only actual retrieved IDs mentioned in the answer become citations. Model-invented IDs never enter this field.
      const citedRecordIds = [...refs].filter(id => result.explanation.includes(id)).slice(0, 200);
      await ctx.runMutation(internal.agentChatData.save, { demoIdentity: args.demoIdentity, chatId: started.chatId,
        transcriptJson: json(result.steps), status: result.status, answer: result.explanation, citedRecordIds });
    } catch (error) {
      await ctx.runMutation(internal.agentChatData.save, { demoIdentity: args.demoIdentity, chatId: started.chatId,
        transcriptJson: json(persisted), status: "failed", failureCode: error instanceof GeminiFailure || error instanceof ClaudeFailure ? error.code : "chat_failed",
        answer: "The read-only chat could not complete. Review stored tool results; no payment changes were made.", citedRecordIds: [] });
    }
    return started;
  },
});
