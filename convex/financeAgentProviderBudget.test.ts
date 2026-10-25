// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFinanceProvider, type FinanceProvider } from "./lib/financeAgentProvider";
import { claudeModel, requestClaude } from "./lib/claude";
import { financeModel, requestInteraction } from "./lib/gemini";
import { runFinanceLoop, type AgentStep } from "./lib/financeAgentLoop";
import { financeJson } from "./lib/financeAgentBudget";
import { financeReadToolNames } from "./lib/financeToolRegistry";

vi.mock("./lib/claude", async original => ({ ...await original<typeof import("./lib/claude")>(), requestClaude: vi.fn() }));
vi.mock("./lib/gemini", async original => ({ ...await original<typeof import("./lib/gemini")>(), requestInteraction: vi.fn() }));

const claude = vi.mocked(requestClaude), gemini = vi.mocked(requestInteraction);
const forced = (provider: FinanceProvider, ids = ["old", "recent"]) => provider === "claude" ? {
  content: ids.map(id => ({ type: "tool_use", id, name: "getOrderContext", input: {} })), stop_reason: "tool_use",
} : { steps: ids.map(id => ({ type: "function_call", id, name: "getOrderContext", arguments: {} })), status: "requires_action" };
const final = (provider: FinanceProvider) => provider === "claude" ? {
  content: [{ type: "text", text: "Summary\nAdvisory only." }], stop_reason: "end_turn",
} : { steps: [], output_text: "Summary\nAdvisory only.", status: "completed" };
function stub(provider: FinanceProvider, responses: unknown[]) {
  if (provider === "claude") for (const response of responses) claude.mockResolvedValueOnce(response as Awaited<ReturnType<typeof requestClaude>>);
  else for (const response of responses) gemini.mockResolvedValueOnce(response as Awaited<ReturnType<typeof requestInteraction>>);
}
function next(provider: FinanceProvider, extra: { prompt?: string; remaining?: number; readOnly?: boolean } = {}) {
  return createFinanceProvider({ provider, model: provider === "claude" ? claudeModel() : financeModel(), system: "Synthetic finance system; answer using retrieved facts.",
    prompt: extra.prompt ?? "Inspect this order only.", deadline: Date.now() + (extra.remaining ?? 120000), readOnly: extra.readOnly });
}
function sent(provider: FinanceProvider, index: number): Record<string, unknown> {
  return (provider === "claude" ? claude.mock.calls[index]![0] : gemini.mock.calls[index]![0]) as unknown as Record<string, unknown>;
}
beforeEach(() => {
  vi.stubEnv("FINANCE_AGENT_CONTEXT_CHARS", "32000");
  claude.mockReset(); gemini.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

for (const provider of ["claude", "gemini"] as const) describe(`${provider} outbound finance budgets`, () => {
  it("rebuilds canonical history with oldest-result compaction in the actual outbound request", async () => {
    stub(provider, [forced(provider), final(provider)]);
    const model = next(provider);
    const initial = await model([]);
    expect(initial.calls.map(item => item.id)).toEqual(["old", "recent"]);
    const old: AgentStep = { call: initial.calls[0]!, result: { payableId: "payable_old", amountAtomic: "9007199254740993",
      txHash: `0x${"ab".repeat(32)}`, status: "pending", narration: "PRIVATE_UNTRUSTED_OLD_PROSE ".repeat(4000) } };
    const recent: AgentStep = { call: initial.calls[1]!, result: { payableId: "payable_recent", amountAtomic: "750000", status: "accrued" } };
    await model([old, recent]);
    const body = sent(provider, 1), encoded = financeJson(body);
    expect(encoded.length).toBeLessThanOrEqual(32000);
    expect(encoded).not.toContain("PRIVATE_UNTRUSTED_OLD_PROSE");
    const serializedResults: string[] = provider === "claude" ?
      (body.messages as { content: unknown }[]).flatMap(message => Array.isArray(message.content) ? message.content : [])
        .filter((block: { type?: string }) => block.type === "tool_result").map((block: { content: string }) => block.content) :
      (body.input as { type: string; result?: { text: string }[] }[]).filter(item => item.type === "function_result")
        .flatMap(item => item.result!.map(part => part.text));
    expect(serializedResults).toHaveLength(2);
    expect(JSON.parse(serializedResults[0]!)).toMatchObject({ untrusted: true, data: { summarized: true, truncated: true,
      facts: expect.arrayContaining([{ path: "payableId", value: "payable_old" }, { path: "amountAtomic", value: "9007199254740993" }]) } });
    expect(JSON.parse(serializedResults[1]!)).toMatchObject({ untrusted: true, data: recent.result });
    expect(old.result).toHaveProperty("narration");
  });

  it("returns a required-format partial answer without a transport call when static context exceeds its hard cap", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const result = await next(provider, { prompt: "large user prompt ".repeat(4000) })([]);
    expect(result.calls).toEqual([]);
    expect(result.explanation).toContain("context budget reached");
    for (const heading of ["Summary", "Findings", "Risks/Exceptions", "Recommended next actions", "Data gaps"]) {
      expect(result.explanation.split("\n")).toContain(heading);
    }
    expect(claude).not.toHaveBeenCalled(); expect(gemini).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });

  it("near deadline disables tools and suppresses a forced new tool call before dispatch", async () => {
    stub(provider, [forced(provider, ["forced_payment"])]);
    const execute = vi.fn();
    const result = await runFinanceLoop({ maxToolCalls: 24, next: next(provider, { remaining: 10000 }), execute, persist: async () => {} });
    expect(result.steps).toEqual([]);
    expect(result.explanation).toContain("deadline wrap-up refused further calls");
    expect(execute).not.toHaveBeenCalled();
    const body = sent(provider, 0);
    if (provider === "claude") expect(body.tool_choice).toEqual({ type: "none" });
    else expect(body.tools).toEqual([]);
    expect(financeJson(body)).toContain("Finish with what you have");
    expect(financeJson(body).length).toBeLessThanOrEqual(32000);
  });

  it("advertises the complete shared read registry with no proposal or approval capabilities", async () => {
    stub(provider, [final(provider)]);
    await next(provider, { readOnly: true })([]);
    const tools = sent(provider, 0).tools as { name: string; strict?: boolean; input_schema?: unknown }[];
    expect(new Set(tools.map(tool => tool.name))).toEqual(financeReadToolNames);
    expect(tools.some(tool => ["proposePaymentBatch", "requestApproval", "approve", "approvePayment"].includes(tool.name))).toBe(false);
    if (provider === "claude") {
      expect(tools.every(tool => tool.strict)).toBe(true);
      expect(JSON.stringify(tools)).not.toContain("maxItems");
    }
  });
});

it("sets Claude cache breakpoints on the static system and final shared tool definition", async () => {
  stub("claude", [final("claude")]);
  await next("claude")([]);
  const body = sent("claude", 0);
  expect(body.system).toEqual([expect.objectContaining({ type: "text", cache_control: { type: "ephemeral" } })]);
  const tools = body.tools as { cache_control?: { type: string } }[];
  expect(tools.at(-1)?.cache_control).toEqual({ type: "ephemeral" });
  expect(tools.filter(tool => tool.cache_control)).toHaveLength(1);
});
