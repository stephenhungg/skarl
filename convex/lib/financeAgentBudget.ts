import type { AgentStep } from "./financeAgentLoop";

export function financeMaxToolCalls(): number {
  const value = Number(process.env.FINANCE_AGENT_MAX_TOOL_CALLS || "24");
  if (!Number.isSafeInteger(value) || value < 1 || value > 24) throw new Error("invalid_agent_tool_limit");
  return value;
}
export function financeContextChars(): number {
  const value = Number(process.env.FINANCE_AGENT_CONTEXT_CHARS || "80000");
  if (!Number.isSafeInteger(value) || value < 32000 || value > 100000) throw new Error("invalid_agent_context_limit");
  return value;
}
export const financeJson = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item);

/** Deterministic compaction, never another model's interpretation of payment facts.
 * Only complete scalar facts survive. Omitted prose and records are explicit gaps. */
export function summarizeFinanceResult(result: unknown) {
  const facts: { path: string; value: string | number | boolean }[] = [];
  const walk = (value: unknown, path: string) => {
    if (facts.length >= 18) return;
    if (Array.isArray(value)) { value.forEach((item, index) => walk(item, `${path}[${index}]`)); return; }
    if (value && typeof value === "object") {
      const row = value as Record<string, unknown>;
      if (row.trust === "untrusted_data" || row.untrusted === true) return;
      Object.entries(row).forEach(([key, item]) => { if (key !== "untrustedEvidence") walk(item, path ? `${path}.${key}` : key); });
      return;
    }
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return;
    if (String(value).length <= 180 && /(?:Id|_id|Atomic|status|settlement|balanced|code|txHash|txUrl|network|truncated)$/.test(path)) facts.push({ path, value });
  };
  walk(result, "");
  return { summarized: true, truncated: true, reason: "oldest_tool_result_context_budget", facts,
    dataGap: "Original evidence was omitted to fit the context budget. Re-read the scoped tool before relying on omitted details; this summary is not settlement proof." };
}
export function compactFinanceSteps(steps: AgentStep[], maxChars: number): AgentStep[] {
  const output = steps.map(step => ({ ...step }));
  for (let index = 0; financeJson(output).length > maxChars && index < output.length; index++) {
    const step = output[index]!;
    const summary = summarizeFinanceResult(step.result);
    if (financeJson(summary).length < financeJson(step.result).length) step.result = summary;
  }
  return output;
}

/** A deterministic partial answer when there is no time for another provider turn. */
export function financeWrapUp(steps: AgentStep[], reason: string, factBudget = 3600): string {
  const facts: string[] = [];
  let used = 0;
  for (const step of steps) {
    const line = `${step.call.name}: ${financeJson(summarizeFinanceResult(step.result).facts)}`;
    if (used + line.length > factBudget) break;
    facts.push(line); used += line.length;
  }
  return `Summary\nFinished with available evidence (${reason}); no payment approval or execution authority was granted.\n\nFindings\n${facts.join("\n") || "No tool evidence was retrieved."}\n\nRisks/Exceptions\nPartial analysis; retrieved status labels alone do not establish settlement.\n\nRecommended next actions\nBuyer/operator: inspect cited records and resolve missing checks; only the policy-engine or owning buyer can approve a stored intent.\n\nData gaps\nThe tool/context/time budget ended before all questions were resolved. Re-read any truncated or summarized evidence.`;
}
