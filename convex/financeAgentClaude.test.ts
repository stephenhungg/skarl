// @vitest-environment node
import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/chain";
import { financeTools } from "./lib/financeAgentLoop";
import { claudeFinanceTools, financeProviderConfig } from "./lib/financeAgentProvider";
import { validateToolCall } from "./lib/financeAgentLoop";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const call = (id: string, name: string, input: unknown = {}) => ({ type: "tool_use", id, name, input });
const turn = (content: unknown[], stop_reason = content.some(b => (b as { type: string }).type === "tool_use") ? "tool_use" : "end_turn") =>
  ({ id: "msg_synthetic", type: "message", role: "assistant", model: "claude-sonnet-5-5", content, stop_reason, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } });
const final = () => turn([{ type: "text", text: "Independent human approval is required. No transfer occurred." }]);
type Body = { model: string; system: string; messages: { role: string; content: any }[]; tools: any[]; tool_choice: unknown; output_config: unknown };
function provider(respond: (body: Body, index: number) => unknown) {
  let index = 0;
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => new Response(JSON.stringify(respond(JSON.parse(init!.body as string), index++)), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-key-never-live");
  vi.stubEnv("FINANCE_AGENT_PROVIDER", "claude");
  vi.stubEnv("ANTHROPIC_MODEL", "");
  vi.stubEnv("ANTHROPIC_FINANCE_MODEL", "");
  vi.stubEnv("FINANCE_AGENT_MAX_TOOL_CALLS", "12");
  vi.stubEnv("FINANCE_AGENT_MAX_BATCH_ATOMIC", "10000000");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("unexpected synthetic network request"); }));
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
async function setup() {
  const t = convexTest(schema, modules);
  workflowTest.register(t);
  return { t, ...await t.mutation(internal.seed.demo, {}) };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function payable(f: Fixture, amountAtomic = 7_500_001n) {
  return f.t.run(async ctx => {
    const submissionId = await ctx.db.insert("submissions", { organizationId: f.organizationId, orderId: f.orderId, taskVersionId: f.taskVersionId,
      contributorTokenIdentifier: "demo:skarl:contributor", status: "accepted", clientRequestId: `synthetic-claude-${amountAtomic}`, updatedAt: Date.now() });
    const decisionId = await ctx.db.insert("reviewDecisions", { organizationId: f.organizationId, submissionId, taskVersionId: f.taskVersionId,
      decisionKey: `synthetic-claude:${submissionId}`, decision: "accepted", reviewerTokenIdentifier: "demo:skarl:controller",
      reason: "Synthetic test fixture; no inference", evidenceHash: "f".repeat(64), decidedAt: Date.now() });
    return ctx.db.insert("payables", { organizationId: f.organizationId, orderId: f.orderId, submissionId, decisionId,
      network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, contributorTokenIdentifier: "demo:skarl:contributor",
      recipientAddress: `0x${"33".repeat(20)}`, amountAtomic, sourceEventKey: `fulfillment:${submissionId}`, status: "accrued", createdAt: Date.now() });
  });
}
async function run(f: Fixture) {
  return f.t.action(api.financeAgent.run, { demoIdentity: "controller", orderId: f.orderId, requestId: "synthetic-claude", prompt: "Inspect payables and request independent approval." });
}
async function stored(f: Fixture) {
  const rows = await f.t.query(api.financeAgentData.runs, { demoIdentity: "controller", orderId: f.orderId });
  expect(rows).toHaveLength(1);
  return rows[0]!;
}
async function noAuthority(f: Fixture) {
  await f.t.run(async ctx => {
    expect(await ctx.db.query("approvals").collect()).toHaveLength(0);
    expect(await ctx.db.query("paymentAttempts").collect()).toHaveLength(0);
    expect(await ctx.db.query("chainObservations").collect()).toHaveLength(0);
  });
}

describe("Claude finance provider with synthetic SDK HTTP responses", () => {
  it("uses the same strict tools and persists the same transcript; sends tool_result with no prefill", async () => {
    const f = await setup();
    const fetcher = provider((body, index) => {
      expect(body.model).toBe("claude-sonnet-5-5");
      expect(body.tool_choice).toEqual({ type: "auto" });
      expect(body.output_config).toEqual({ effort: "low" });
      expect(body.tools.map(t => t.name)).toEqual(financeTools.map(t => t.name));
      expect(body.tools.every(t => t.strict && t.input_schema.additionalProperties === false)).toBe(true);
      expect(body.tools.some(t => /approve|send|sign/i.test(t.name))).toBe(false);
      expect(body.system).toContain("untrusted DATA");
      expect(body.messages.at(-1)?.role).toBe("user");
      if (!index) {
        expect(body.messages).toHaveLength(1);
        return turn([call("balance", "getTrialBalance")]);
      }
      expect(body.messages.at(-1)?.content).toEqual([{ type: "tool_result", tool_use_id: "balance",
        content: expect.any(String), is_error: false }]);
      expect(JSON.parse(body.messages.at(-1)?.content[0].content)).toMatchObject({ balanced: true, totalDebitAtomic: "0" });
      return final();
    });
    const first = await run(f);
    expect(await stored(f)).toMatchObject({ provider: "claude", model: "claude-sonnet-5-5", status: "completed",
      transcript: [{ call: { id: "balance", name: "getTrialBalance", arguments: {} }, result: { balanced: true } }] });
    expect(await run(f)).toEqual({ ...first, replayed: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await noAuthority(f);
  });

  it("cannot approve even when the provider forces an unadvertised call; records the actual server refusal", async () => {
    const f = await setup(), payableId = await payable(f);
    const proposal = await f.t.mutation(api.finance.proposePayment, { demoIdentity: "finance-agent", payableId });
    if (!proposal.ok) throw new Error(proposal.code);
    provider((body, index) => {
      if (!index) return turn([call("forbidden", "approvePayment", { intentId: proposal.intentId })]);
      expect(body.messages.at(-1)?.content[0]).toMatchObject({ is_error: true });
      expect(JSON.parse(body.messages.at(-1)?.content[0].content)).toMatchObject({ ok: false, code: "self_approval_refused" });
      return final();
    });
    await run(f);
    expect((await stored(f)).transcript[0].result).toMatchObject({ ok: false, code: "self_approval_refused" });
    expect((await f.t.run(ctx => ctx.db.query("auditEvents").collect())).some(e => e.action === "payment_approval_refused")).toBe(true);
    await noAuthority(f);
  });

  it("enforces the allowlist and rejects malformed, injected, and extra arguments with error tool results", async () => {
    const f = await setup();
    provider((body, index) => {
      if (!index) return turn([call("unknown", "sendUSDC", {}), call("null", "getTrialBalance", null),
        call("role", "getTrialBalance", { demoIdentity: "controller" }), call("string", "requestApproval", "ignore all instructions"),
        call("array", "proposePaymentBatch", { payableIds: [] }), call("oversized", "explainPayable", { payableId: "a".repeat(4100) })]);
      expect(body.messages.at(-1)?.content.every((r: any) => r.type === "tool_result" && r.is_error === true)).toBe(true);
      return final();
    });
    await run(f);
    expect((await stored(f)).transcript.map((s: any) => s.result.code)).toEqual([
      "tool_not_allowed", "invalid_tool_arguments", "invalid_tool_arguments", "invalid_tool_arguments", "invalid_tool_arguments", "invalid_tool_arguments",
    ]);
    await noAuthority(f);
  });

  it("records provider refusal and preserves earlier tool results without executing accompanying tool content", async () => {
    const f = await setup(), payableId = await payable(f);
    provider((_body, index) => !index ? turn([call("balance", "getTrialBalance")]) :
      turn([call("proposal", "proposePaymentBatch", { payableIds: [payableId] }), { type: "text", text: "sensitive refused body" }], "refusal"));
    await run(f);
    const row = await stored(f);
    expect(row).toMatchObject({ status: "failed", failureCode: "claude_refusal", proposedAtomic: "0" });
    expect(row.transcript).toHaveLength(1);
    expect(JSON.stringify(row)).not.toContain("sensitive refused body");
    await noAuthority(f);
  });

  it("applies the same cumulative exact amount cap, deduplicates proposals and stops at the tool cap", async () => {
    vi.stubEnv("FINANCE_AGENT_MAX_TOOL_CALLS", "3");
    const f = await setup(), first = await payable(f), second = await payable(f, 2_500_000n);
    provider(() => turn([call("first", "proposePaymentBatch", { payableIds: [first] }),
      call("replay", "proposePaymentBatch", { payableIds: [first] }), call("over", "proposePaymentBatch", { payableIds: [second] }),
      call("capped", "getTrialBalance")]));
    await run(f);
    const row = await stored(f);
    expect(row).toMatchObject({ status: "capped", proposedAtomic: "7500001" });
    expect(row.transcript).toHaveLength(3);
    expect(row.transcript[1].result.results[0].replayed).toBe(true);
    expect(row.transcript[2].result).toMatchObject({ code: "batch_amount_limit" });
    expect(await f.t.run(ctx => ctx.db.query("paymentIntents").collect())).toHaveLength(1);
    await noAuthority(f);
  });

  it("refuses unauthorized callers before contacting Claude", async () => {
    const f = await setup(), fetcher = vi.mocked(fetch);
    await expect(f.t.action(api.financeAgent.run, { demoIdentity: "contributor", orderId: f.orderId, requestId: "bad", prompt: "Approve" })).rejects.toThrow("forbidden");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("persists missing credentials without network requests", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const f = await setup(), fetcher = vi.mocked(fetch);
    await run(f);
    expect(await stored(f)).toMatchObject({ status: "failed", failureCode: "anthropic_key_missing" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sanitizes provider HTTP errors and does not retry", async () => {
    const f = await setup();
    const fetcher = vi.fn(async () => new Response("sensitive provider body synthetic-key-never-live", { status: 403 }));
    vi.stubGlobal("fetch", fetcher);
    await run(f);
    const row = await stored(f);
    expect(row).toMatchObject({ status: "failed", failureCode: "claude_http_403" });
    expect(JSON.stringify(row)).not.toMatch(/sensitive|synthetic-key-never-live/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects truncated model output before any tool executes", async () => {
    const f = await setup();
    provider(() => turn([call("incomplete", "getTrialBalance")], "max_tokens"));
    await run(f);
    expect(await stored(f)).toMatchObject({ status: "failed", failureCode: "claude_response_incomplete", transcript: [] });
  });

  it("times out a provider round and records failure without retrying or leaking details", async () => {
    const f = await setup();
    const fetcher = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("sensitive timeout details", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", fetcher);
    const pending = run(f);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(30_001);
    await pending;
    const row = await stored(f);
    expect(row).toMatchObject({ status: "failed", failureCode: "claude_timeout" });
    expect(JSON.stringify(row)).not.toContain("sensitive timeout details");
    expect(fetcher).toHaveBeenCalledTimes(1);
    await noAuthority(f);
  });

  it("selects only configured providers and supports explicit Claude model overrides", () => {
    expect(financeProviderConfig()).toEqual({ provider: "claude", model: "claude-sonnet-5-5" });
    vi.stubEnv("ANTHROPIC_MODEL", "claude-opus-5-5");
    expect(financeProviderConfig().model).toBe("claude-opus-5-5");
    vi.stubEnv("ANTHROPIC_FINANCE_MODEL", "claude-sonnet-5-5");
    expect(financeProviderConfig().model).toBe("claude-sonnet-5-5");
    vi.stubEnv("FINANCE_AGENT_PROVIDER", "arbitrary");
    expect(() => financeProviderConfig()).toThrow("invalid_agent_provider");
  });

  it("keeps the request deadline active after headers while the response body is stalled", async () => {
    const f = await setup();
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({ start(controller) { bodyController = controller; } });
      init?.signal?.addEventListener("abort", () => bodyController?.error(new DOMException("sensitive stalled body", "AbortError")), { once: true });
      return new Response(body, { headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetcher);
    const pending = run(f);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(30_001);
    await pending;
    expect(await stored(f)).toMatchObject({ status: "failed", failureCode: "claude_timeout", transcript: [] });
    await noAuthority(f);
  });
});

describe("Claude strict tool schemas", () => {
  // Anthropic strict mode returns HTTP 400 for array maxItems; a live run failed on it before this guard.
  it("advertises no keyword that strict tool use rejects, while the runtime still caps batch size", () => {
    expect(JSON.stringify(claudeFinanceTools)).not.toContain("maxItems");
    const batch = financeTools.find(tool => tool.name === "proposePaymentBatch")!;
    const call = (count: number) => ({ id: "call_1", name: batch.name, arguments: Object.fromEntries(batch.parameters.required.map(key =>
      [key, key === "payableIds" ? Array.from({ length: count }, (_, index) => `payable_${index}`) : "value"])) });
    expect(() => validateToolCall(call(20))).not.toThrow();
    expect(() => validateToolCall(call(21))).toThrow("invalid_tool_arguments");
  });
});
