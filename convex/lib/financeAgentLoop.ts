import { configNumber } from "./config.ts";
/** Bounded orchestration. Model steps are data; only the dispatcher has authority. */
import { financeReadToolNames, capFinanceToolResult, validateFinanceToolCall } from "./financeToolRegistry";
import { compactFinanceSteps, financeJson, financeWrapUp } from "./financeAgentBudget";
export { financeTools, financeToolNames as toolNames, validateFinanceToolCall as validateToolCall } from "./financeToolRegistry";
export type AgentCall = { id: string; name: string; arguments: Record<string, unknown> };
export type AgentStep = { call: AgentCall; result: unknown };

export async function runFinanceLoop(options: {
  maxToolCalls: number;
  deadline?: number;
  contextChars?: number;
  next: (history: AgentStep[]) => Promise<{ calls: AgentCall[]; explanation: string; stopReason?: "context_budget" | "deadline" }>;
  execute: (call: AgentCall) => Promise<unknown>;
  persist: (steps: AgentStep[]) => Promise<void>;
}) {
  let steps: AgentStep[] = [];
  const ids = new Set<string>();
  const finish = (reason: string) => ({ status: "capped" as const, steps, explanation: financeWrapUp(steps, reason) });
  for (let turn = 0; turn <= options.maxToolCalls; turn++) {
    if (options.deadline && Date.now() >= options.deadline - configNumber("FINANCE_AGENT_DEADLINE_RESERVE_MS")) return finish("deadline reached");
    let response: Awaited<ReturnType<typeof options.next>>;
    try { response = await options.next(compactFinanceSteps(steps, options.contextChars ?? configNumber("FINANCE_AGENT_LOOP_CONTEXT_CHARS"))); }
    catch (error) {
      if (options.deadline && Date.now() >= options.deadline - configNumber("FINANCE_AGENT_DEADLINE_RESERVE_MS")) return finish("provider deadline reached");
      throw error;
    }
    if (!response.calls.length) {
      if (!response.explanation.trim()) throw new Error("empty_agent_response");
      return { status: response.stopReason ? "capped" as const : "completed" as const, steps, explanation: response.explanation.slice(0, 6000) };
    }
    const runCall = async (call: AgentCall): Promise<AgentStep> => {
      if (!call.id || call.id.length > 128 || ids.has(call.id)) throw new Error("duplicate_model_call_id");
      ids.add(call.id);
      let result: unknown;
      try {
        if (call.name.length > 100 || financeJson(call.arguments ?? null).length > 4000) throw new Error("invalid_tool_arguments");
        validateFinanceToolCall(call);
        result = capFinanceToolResult(call.name, await options.execute(call));
      } catch (error) {
        result = { ok: false, code: error instanceof Error && ["tool_not_allowed", "invalid_tool_arguments"].includes(error.message) ? error.message : "tool_refused" };
      }
      return { call, result };
    };
    // Independent reads within a turn can run concurrently; mutations remain in
    // model order with a persistence barrier before any following mutation.
    for (let index = 0; index < response.calls.length;) {
      if (steps.length >= options.maxToolCalls) return finish("tool-call limit reached");
      if (options.deadline && Date.now() >= options.deadline - configNumber("FINANCE_AGENT_DEADLINE_RESERVE_MS")) return finish("deadline reached");
      const group: AgentCall[] = [response.calls[index++]!];
      if (financeReadToolNames.has(group[0]!.name)) {
        while (index < response.calls.length && financeReadToolNames.has(response.calls[index]!.name) && steps.length + group.length < options.maxToolCalls) group.push(response.calls[index++]!);
      }
      const results = await Promise.all(group.map(runCall));
      steps.push(...results);
      // Durable transcripts have a separate hard storage bound. Compaction never
      // discards call IDs and always marks lost evidence.
      steps = compactFinanceSteps(steps, 95000);
      if (financeJson(steps).length > 100000) throw new Error("agent_transcript_limit");
      await options.persist(steps);
    }
  }
  return finish("turn limit reached");
}

/** Strict money parsing; never accept decimal dollars or float amounts. */
export function positiveAtomic(value: string): bigint {
  if (!/^[1-9][0-9]{0,18}$/.test(value) || BigInt(value) > (1n << 63n) - 1n) throw new Error("invalid_agent_amount_limit");
  return BigInt(value);
}

export function trialBalance(entries: { lines: { account: string; side: "debit" | "credit"; amountAtomic: string }[] }[]) {
  const accounts = new Map<string, { debit: bigint; credit: bigint }>();
  let debit = 0n, credit = 0n;
  for (const entry of entries) {
    let entryDebit = 0n, entryCredit = 0n;
    for (const line of entry.lines) {
      const amount = positiveAtomic(line.amountAtomic), row = accounts.get(line.account) ?? { debit: 0n, credit: 0n };
      row[line.side] += amount; accounts.set(line.account, row);
      if (line.side === "debit") entryDebit += amount; else entryCredit += amount;
    }
    if (entry.lines.length < 2 || entryDebit !== entryCredit) throw new Error("unbalanced_journal");
    debit += entryDebit; credit += entryCredit;
  }
  if (debit !== credit) throw new Error("unbalanced_trial_balance");
  return { balanced: true as const, totalDebitAtomic: debit.toString(), totalCreditAtomic: credit.toString(),
    accounts: [...accounts].sort(([a], [b]) => a.localeCompare(b)).map(([account, row]) => ({ account,
      debitAtomic: row.debit.toString(), creditAtomic: row.credit.toString(), netDebitAtomic: (row.debit - row.credit).toString() })) };
}
