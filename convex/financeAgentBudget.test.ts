import { paymentRail, PAYMENT_NETWORK } from "../packages/contracts/src/chain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compactFinanceSteps, financeContextChars, financeJson, financeMaxToolCalls, financeWrapUp, summarizeFinanceResult } from "./lib/financeAgentBudget";
import { runFinanceLoop, type AgentCall, type AgentStep } from "./lib/financeAgentLoop";

const call = (id: string, name = "getOrderContext", args: Record<string, unknown> = {}): AgentCall => ({ id, name, arguments: args });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("finance planning and context budgets", () => {
  it("starts independent reads in parallel but persists results in model order", async () => {
    const first = deferred(), second = deferred(), bothStarted = deferred();
    const started: string[] = [], completed: string[] = [], persisted: AgentStep[][] = [];
    let turns = 0;
    const loop = runFinanceLoop({ maxToolCalls: 24,
      next: async () => turns++ ? { calls: [], explanation: "Summary\nRetrieved both records." } :
        { calls: [call("first"), call("second", "getTrialBalance")], explanation: "" },
      execute: async request => {
        started.push(request.id);
        if (started.length === 2) bothStarted.resolve();
        await (request.id === "first" ? first.promise : second.promise);
        completed.push(request.id);
        return { recordId: request.id, amountAtomic: "9007199254740993" };
      },
      persist: async steps => { persisted.push([...steps]); },
    });
    await bothStarted.promise; // The second read must start while the first is blocked.
    expect(started).toEqual(["first", "second"]);
    expect(persisted).toEqual([]);
    second.resolve();
    await Promise.resolve();
    expect(completed).toEqual(["second"]);
    first.resolve();
    const result = await loop;
    expect(result.status).toBe("completed");
    expect(completed).toEqual(["second", "first"]);
    expect(result.steps.map(step => step.call.id)).toEqual(["first", "second"]);
    expect(persisted.map(steps => steps.map(step => step.call.id))).toEqual([["first", "second"]]);
  });

  it("serializes proposal/request calls with a durable persistence barrier between them", async () => {
    const proposal = deferred(), proposalStarted = deferred(), request = deferred(), requestStarted = deferred();
    const events: string[] = [];
    let turns = 0;
    const loop = runFinanceLoop({ maxToolCalls: 24,
      next: async () => turns++ ? { calls: [], explanation: "Independent buyer approval is required." } : { calls: [
        call("proposal", "proposePaymentBatch", { payableIds: ["payable_A"] }),
        call("request", "requestApproval", { intentId: "intent_A" }),
      ], explanation: "" },
      execute: async item => {
        events.push(`start:${item.id}`);
        if (item.id === "proposal") { proposalStarted.resolve(); await proposal.promise; }
        else { requestStarted.resolve(); await request.promise; }
        events.push(`finish:${item.id}`);
        return { intentId: "intent_A", amountAtomic: "750000", status: "proposed" };
      },
      persist: async steps => { events.push(`persist:${steps.map(step => step.call.id).join(",")}`); },
    });
    await proposalStarted.promise;
    expect(events).toEqual(["start:proposal"]);
    proposal.resolve();
    await requestStarted.promise;
    expect(events).toEqual(["start:proposal", "finish:proposal", "persist:proposal", "start:request"]);
    request.resolve();
    const result = await loop;
    expect(result.steps).toHaveLength(2);
    expect(events.at(-1)).toBe("persist:proposal,request");
  });

  it("summarizes oldest results before recent evidence and keeps complete IDs, tx hashes and exact integer amounts", () => {
    const txHash = `0x${"ab".repeat(32)}`, txUrl = paymentRail(PAYMENT_NETWORK).explorerTx(txHash);
    const amountAtomic = "9007199254740993", recordId = `record_${"A".repeat(110)}`;
    const oldest: AgentStep = { call: call("oldest"), result: { recordId, amountAtomic, txHash, txUrl,
      settlement: "pending", narration: "untrusted prose ".repeat(3000) } };
    const newest: AgentStep = { call: call("newest", "getPayoutStatus", { intentId: "intent_A" }),
      result: { intentId: "intent_A", amountAtomic: "750000", settlement: "chain_observed" } };
    const original = financeJson([oldest, newest]);
    const compacted = compactFinanceSteps([oldest, newest], 2500);
    expect(financeJson(compacted).length).toBeLessThanOrEqual(2500);
    expect(compacted[0]!.result).toMatchObject({ summarized: true, truncated: true,
      reason: "oldest_tool_result_context_budget", dataGap: expect.stringContaining("not settlement proof"),
      facts: expect.arrayContaining([{ path: "recordId", value: recordId }, { path: "amountAtomic", value: amountAtomic },
        { path: "txHash", value: txHash }, { path: "txUrl", value: txUrl }]) });
    expect(compacted[1]!.result).toEqual(newest.result);
    expect(compacted.map(step => step.call.id)).toEqual(["oldest", "newest"]);
    expect(financeJson([oldest, newest])).toBe(original); // Compaction cannot alter stored caller-owned records.
    expect(summarizeFinanceResult(JSON.parse(financeJson({ amountAtomic: 9007199254740993n })))).toMatchObject({
      facts: [{ path: "amountAtomic", value: "9007199254740993" }] });
  });

  it("finishes near its deadline with the required sections and retrieved evidence", async () => {
    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const next = vi.fn(async () => ({ calls: [call("context"), call("later", "proposePaymentBatch", { payableIds: ["payable_A"] })], explanation: "" }));
    const execute = vi.fn(async () => {
      now = 9900;
      return { payableId: "payable_A", amountAtomic: "750000", status: "accrued" };
    });
    const result = await runFinanceLoop({ maxToolCalls: 24, deadline: 10000, next, execute, persist: async () => {} });
    expect(result.status).toBe("capped");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    for (const heading of ["Summary", "Findings", "Risks/Exceptions", "Recommended next actions", "Data gaps"]) {
      expect(result.explanation.split("\n")).toContain(heading);
    }
    expect(result.explanation).toContain("payable_A");
    expect(result.explanation).toContain("750000");
    expect(result.explanation).toContain("deadline reached");
    expect(result.explanation).toContain("only the policy-engine or owning buyer can approve");
  });

  it("does not execute extra calls when a provider returns more than the configured call budget", async () => {
    const execute = vi.fn(async () => ({ status: "pending" }));
    const result = await runFinanceLoop({ maxToolCalls: 2,
      next: async () => ({ calls: [call("a"), call("b"), call("c")], explanation: "" }),
      execute, persist: async () => {} });
    expect(result.status).toBe("capped");
    expect(result.steps.map(step => step.call.id)).toEqual(["a", "b"]);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.explanation).toContain("tool-call limit reached");
  });

  it("defaults to 24 calls and rejects invalid or unbounded environment budgets", () => {
    vi.stubEnv("FINANCE_AGENT_MAX_TOOL_CALLS", "");
    vi.stubEnv("FINANCE_AGENT_CONTEXT_CHARS", "");
    expect(financeMaxToolCalls()).toBe(24);
    expect(financeContextChars()).toBe(80000);
    for (const value of ["0", "25", "-1", "1.5", "Infinity", "garbage"]) {
      vi.stubEnv("FINANCE_AGENT_MAX_TOOL_CALLS", value);
      expect(() => financeMaxToolCalls()).toThrow("invalid_agent_tool_limit");
    }
    vi.stubEnv("FINANCE_AGENT_MAX_TOOL_CALLS", "1");
    expect(financeMaxToolCalls()).toBe(1);
    for (const value of ["31999", "100001", "NaN", "50000.5"]) {
      vi.stubEnv("FINANCE_AGENT_CONTEXT_CHARS", value);
      expect(() => financeContextChars()).toThrow("invalid_agent_context_limit");
    }
  });

  it("wrap-up never cuts a cited transaction hash or exact amount in half", () => {
    const txHash = `0x${"ab".repeat(32)}`, amountAtomic = "9007199254740993";
    const steps: AgentStep[] = Array.from({ length: 12 }, (_, index) => ({ call: call(`call_${index}`),
      result: { recordId: `record_${index}_${"A".repeat(110)}`, txHash, amountAtomic, status: "pending" } }));
    const answer = financeWrapUp(steps, "context budget reached");
    for (const line of answer.split("\n").filter(line => line.startsWith("getOrderContext: "))) {
      expect(() => JSON.parse(line.slice("getOrderContext: ".length))).not.toThrow();
    }
    for (const match of answer.matchAll(/"value":"(0x[0-9a-f]*)/g)) expect(match[1]).toBe(txHash);
    // Any complete value field containing an atomic prefix must remain the full integer.
    for (const match of answer.matchAll(/"value":"(900[0-9]*)/g)) expect(match[1]).toBe(amountAtomic);
  });
});
