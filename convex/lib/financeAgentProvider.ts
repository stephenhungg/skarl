import type { MessageParam, Tool } from "@anthropic-ai/sdk/resources/messages";
import { claudeModel, ClaudeFailure, requestClaude } from "./claude";
import { financeModel, GeminiFailure, GEMINI_REQUEST_TIMEOUT_MS, requestInteraction } from "./gemini";
import { financeTools, type AgentStep } from "./financeAgentLoop";

export type FinanceProvider = "gemini" | "claude";
export function financeProviderConfig(): { provider: FinanceProvider; model: string } {
  const provider = process.env.FINANCE_AGENT_PROVIDER || "gemini";
  if (provider !== "gemini" && provider !== "claude") throw new Error("invalid_agent_provider");
  const model = provider === "claude" ? process.env.ANTHROPIC_FINANCE_MODEL || claudeModel() : financeModel();
  if (!/^[a-z0-9][a-z0-9._-]{0,80}$/.test(model)) throw new Error("invalid_agent_model");
  return { provider, model };
}

// Both providers advertise the exact same allowlist; never advertise approve/sign/send.
export const claudeFinanceTools: Tool[] = financeTools.map(tool => ({
  name: tool.name, description: tool.description, strict: true,
  input_schema: { ...tool.parameters, type: "object" },
}));
const serialize = (value: unknown) => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);

/** Provider state stays in action memory. The shared loop alone dispatches and persists tools. */
export function createFinanceProvider(options: { provider: FinanceProvider; model: string; system: string; prompt: string; deadline: number }) {
  let consumedSteps = 0;
  const geminiHistory: unknown[] = [{ type: "user_input", content: [{ type: "text", text: options.prompt }] }];
  const messages: MessageParam[] = [{ role: "user", content: options.prompt }];
  return async (steps: AgentStep[]) => {
    if (Date.now() >= options.deadline) throw new ClaudeFailure("agent_deadline");
    const fresh = steps.slice(consumedSteps);
    consumedSteps = steps.length;
    if (options.provider === "claude") {
      if (fresh.length) messages.push({ role: "user", content: fresh.map(step => ({
        type: "tool_result" as const, tool_use_id: step.call.id, content: serialize(step.result),
        is_error: !!step.result && typeof step.result === "object" && "ok" in step.result && step.result.ok === false,
      })) });
      const response = await requestClaude({ model: options.model, system: options.system, messages,
        tools: claudeFinanceTools, tool_choice: { type: "auto" }, output_config: { effort: "low" }, max_tokens: 2048,
      }, options.deadline - Date.now());
      // Never execute incomplete/truncated tool requests or treat truncated prose as a completed run.
      if (response.stop_reason !== "tool_use" && response.stop_reason !== "end_turn") throw new ClaudeFailure("claude_response_incomplete");
      messages.push({ role: "assistant", content: response.content }); // Actual response, never an assistant prefill.
      return {
        calls: response.content.filter(block => block.type === "tool_use").map(block => ({
          id: typeof block.id === "string" ? block.id : "", name: typeof block.name === "string" ? block.name : "",
          // Keep malformed input for the shared runtime validator; never silently coerce it to {}.
          arguments: (block.input ?? null) as Record<string, unknown>,
        })),
        explanation: response.content.filter(block => block.type === "text").map(block => block.text).join(""),
      };
    }
    for (const step of fresh) geminiHistory.push({ type: "function_result", name: step.call.name, call_id: step.call.id,
      result: [{ type: "text", text: serialize(step.result) }] });
    const response = await requestInteraction({ model: options.model, system_instruction: options.system, input: geminiHistory, tools: financeTools,
      generation_config: { temperature: 0, thinking_level: "low", max_output_tokens: 2048 } }, fetch, Math.min(GEMINI_REQUEST_TIMEOUT_MS, options.deadline - Date.now()), 1000, true);
    const raw = response as unknown as { steps: { type: string; id?: string; name?: string; arguments?: Record<string, unknown> }[]; output_text?: string };
    if (!Array.isArray(raw.steps)) throw new GeminiFailure("agent_response_invalid");
    geminiHistory.push(...raw.steps); // Preserve thought signatures only in memory.
    return { calls: raw.steps.filter(step => step.type === "function_call").map(step => ({ id: step.id ?? "", name: step.name ?? "", arguments: step.arguments! })),
      explanation: raw.output_text ?? raw.steps.filter(step => step.type === "model_output").flatMap(step => (step as { content?: { text?: string }[] }).content ?? []).map(part => part.text ?? "").join("") };
  };
}
