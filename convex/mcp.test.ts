import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { DEMO_ORDER_IP_LIMIT } from "../packages/payments/src/demo-order";
import { mcpHashesEqual, mcpToolErrorCode } from "./mcp";
import schema from "./schema";

// Local synthetic fixtures only: these tests establish adapter policy, not live
// model inference, hosted availability, wallet signing, or chain settlement.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const identities = ["buyer", "contributor", "controller"] as const;
type Identity = typeof identities[number];
const keys = Object.fromEntries(identities.map(identity => [identity, `synthetic-mcp-${identity}-credential-for-local-tests`])) as Record<Identity, string>;
const protocolHeaders = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" };
const headers = (identity: Identity = "buyer") => ({ ...protocolHeaders, Authorization: `Bearer ${keys[identity]}` });
const rpc = (method: string, params?: unknown, id: string | number = 1) => ({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });

async function keyHash(key: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

beforeEach(async () => {
  vi.stubEnv("SKARL_MCP_KEYS", JSON.stringify(Object.fromEntries(await Promise.all(identities.map(async identity => [
    await keyHash(keys[identity]), { identity, label: `Synthetic ${identity}` },
  ])))));
});
afterEach(() => vi.unstubAllEnvs());

async function setup() {
  const t = convexTest(schema, modules);
  workflowTest.register(t);
  return { t, ...await t.mutation(internal.seed.demo, {}) };
}
type Test = ReturnType<typeof convexTest>;
async function request(t: Test, message: unknown, identity: Identity = "buyer") {
  return t.fetch("/mcp", { method: "POST", headers: headers(identity), body: JSON.stringify(message) });
}
async function call(t: Test, name: string, arguments_: unknown = {}, identity: Identity = "buyer") {
  return (await request(t, rpc("tools/call", { name, arguments: arguments_ }), identity)).json();
}
function toolValue(response: { result: { content: { type: string; text: string }[] } }) {
  expect(response.result.content).toHaveLength(1);
  expect(response.result.content[0]!.type).toBe("text");
  return JSON.parse(response.result.content[0]!.text);
}

async function guestCall(t: Test, name: string, arguments_: unknown = {}, extraHeaders: Record<string, string> = {}) {
  return (await t.fetch("/mcp", { method: "POST", headers: { ...protocolHeaders, ...extraHeaders },
    body: JSON.stringify(rpc("tools/call", { name, arguments: arguments_ })) })).json();
}

describe("keyless guest MCP", () => {
  it("exposes only the four explicit guest tools without a key or seeded data", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("SKARL_MCP_KEYS", "");
    const response = await t.fetch("/mcp", { method: "POST", headers: protocolHeaders, body: JSON.stringify(rpc("tools/list")) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "skarl_about", "skarl_list_tasks_public", "skarl_create_order_public", "skarl_public_order_status",
    ]);
    // Check the entire advertised tool schema, not just operation names.
    expect(JSON.stringify(body.result.tools)).not.toMatch(/approve|accept|sign|payout/i);
    for (const tool of body.result.tools) expect(tool.inputSchema.additionalProperties).toBe(false);
    const about = toolValue(await guestCall(t, "skarl_about"));
    expect(about).toMatchObject({ guestAccess: expect.stringContaining("No key required"),
      demoOrder: { amountAtomic: "1000000", network: "eip155:84532" } });
    expect(about.safety.join(" ")).toContain("never approve, accept submissions or sign payouts");
  });

  it("refuses every role tool and privileged guessed name before any mutation", async () => {
    const { t } = await setup();
    for (const name of ["skarl_list_tasks", "skarl_create_order", "skarl_order_status", "skarl_get_dataset", "skarl_witness_receipt",
      "skarl_open_tasks", "skarl_liveness_challenge", "skarl_my_submissions_and_earnings", "skarl_explain_outcome",
      "skarl_reconciliation", "skarl_exceptions", "skarl_approve", "skarl_accept", "skarl_sign", "skarl_payout"]) {
      expect(toolValue(await guestCall(t, name))).toEqual({ ok: false, code: "tool_not_allowed" });
    }
    expect(await t.run(ctx => ctx.db.query("livenessChallenges").collect())).toHaveLength(0);
    expect(await t.run(ctx => ctx.db.query("approvals").collect())).toHaveLength(0);
    expect(await t.run(ctx => ctx.db.query("demoOrderLimits").collect())).toHaveLength(0);
  });

  it("creates fixed public orders through the same durable per-IP limits as the public payment API", async () => {
    const { t } = await setup();
    const serviceSecret = "synthetic-mcp-payment-service-secret-at-least-32-chars";
    vi.stubEnv("SKARL_PAYMENTS_SERVICE_SECRET", serviceSecret);
    const ip = "203.0.113.8", ipDigest = await keyHash(ip);
    // Spend one slot through the exact mutation the HTTP API uses. MCP must
    // share its stored limit rather than keeping an independent memory counter.
    await t.mutation(api.payments.createDemoOrder, { serviceSecret, ipDigest, requestId: crypto.randomUUID() });
    for (let count = 1; count < DEMO_ORDER_IP_LIMIT; count++) {
      const created = toolValue(await guestCall(t, "skarl_create_order_public", {}, {
        "x-forwarded-for": ` ${ip}, 192.0.2.9`, "cf-connecting-ip": "198.51.100.8",
      }));
      expect(created).toMatchObject({ ok: true, orderId: expect.any(String), amountAtomic: "1000000", network: "eip155:84532" });
      expect(created.fundingUrl).toBe(`https://skarl.vercel.app/api/orders/${created.orderId}/fund`);
      expect(created.paymentInstructions).toContain("tight maxPayment");
      const order = await t.run(ctx => ctx.db.get(created.orderId));
      expect(order).toMatchObject({ budgetAtomic: 1_000_000n, quantityRequested: 1n, status: "awaiting_funding" });
    }
    const limited = await guestCall(t, "skarl_create_order_public", {}, { "cf-connecting-ip": ip });
    expect(limited.result.isError).toBe(true);
    expect(toolValue(limited)).toMatchObject({ ok: false, code: "demo_order_rate_limited", retryAfterSeconds: expect.any(Number) });
    const rows = await t.run(ctx => ctx.db.query("demoOrderLimits").collect());
    expect(rows).toContainEqual(expect.objectContaining({ key: `ip:${ipDigest}`, count: DEMO_ORDER_IP_LIMIT }));
    expect(JSON.stringify(rows)).not.toContain(ip);
    expect(await t.run(ctx => ctx.db.query("paymentIntents").collect())).toHaveLength(0);
    expect(await t.run(ctx => ctx.db.query("journalEntries").collect())).toHaveLength(0);
  });

  it("shares a hashed fallback bucket without ingress and rejects caller-supplied terms or identity", async () => {
    const { t } = await setup();
    vi.stubEnv("SKARL_PAYMENTS_SERVICE_SECRET", "synthetic-mcp-payment-service-secret-at-least-32-chars");
    for (const arguments_ of [{ amountAtomic: "10000" }, { demoIdentity: "buyer" }, { ipDigest: "a".repeat(64) }, { serviceSecret: "injected" }]) {
      expect(toolValue(await guestCall(t, "skarl_create_order_public", arguments_))).toEqual({ ok: false, code: "invalid_tool_arguments" });
    }
    expect(await t.run(ctx => ctx.db.query("demoOrderLimits").collect())).toHaveLength(0);
    const created = toolValue(await guestCall(t, "skarl_create_order_public"));
    expect(created.ok).toBe(true);
    expect(await t.run(ctx => ctx.db.query("demoOrderLimits").collect())).toContainEqual(
      expect.objectContaining({ key: `ip:${await keyHash("mcp-unknown")}`, count: 1 }));
    vi.stubEnv("SKARL_PAYMENTS_SERVICE_SECRET", "");
    expect(toolValue(await guestCall(t, "skarl_create_order_public"))).toEqual({ ok: false, code: "demo_orders_unavailable" });
  });

  it("projects public rubric, prices, quota and funding without buyer identities or ledger internals", async () => {
    const { t, orderId, defaultOrderId } = await setup();
    await t.run(async ctx => {
      await ctx.db.patch(orderId, { title: "PRIVATE_ROLE_ORDER", buyerTokenIdentifier: "private:buyer" });
      await ctx.db.patch(defaultOrderId, { buyerWalletAddress: `0x${"ab".repeat(20)}`, buyerTokenIdentifier: "private:seed-buyer" });
    });
    const catalog = toolValue(await guestCall(t, "skarl_list_tasks_public"));
    expect(catalog.tasks).toHaveLength(1);
    expect(catalog.tasks[0]).toMatchObject({ orderId: defaultOrderId, criteria: expect.any(Array),
      budgetAtomic: "10000000", pricePerAcceptedClipAtomic: "2500000", remainingQuota: "4" });
    const status = toolValue(await guestCall(t, "skarl_public_order_status", { orderId: defaultOrderId }));
    expect(status).toMatchObject({ orderId: defaultOrderId, acceptedCount: "0", funding: { status: "awaiting_payment" } });
    for (const value of [catalog, status]) expect(JSON.stringify(value)).not.toMatch(/PRIVATE_ROLE_ORDER|private:|buyerTokenIdentifier|buyerWalletAddress|organizationId|balances|ledger|0xabab/i);
    expect(toolValue(await guestCall(t, "skarl_public_order_status", { orderId }))).toEqual({ ok: false, code: "order_not_found" });
    expect(toolValue(await guestCall(t, "skarl_public_order_status", { orderId: "not-an-id" }))).toEqual({ ok: false, code: "order_not_found" });
  });

  it("reports pending funding without returning the stored payer, destination, nonce or internal intent", async () => {
    const { t } = await setup();
    const serviceSecret = "synthetic-mcp-payment-service-secret-at-least-32-chars";
    vi.stubEnv("SKARL_PAYMENTS_SERVICE_SECRET", serviceSecret);
    const created = toolValue(await guestCall(t, "skarl_create_order_public"));
    const payerAddress = `0x${"11".repeat(20)}`, recipientAddress = `0x${"22".repeat(20)}`, authorizationNonce = `0x${"aa".repeat(32)}`;
    const { attemptId } = await t.mutation(api.payments.recordFundingAttempt, { serviceSecret, orderId: created.orderId,
      demoIdentity: "buyer", payerAddress, recipientAddress, authorizationNonce, amountAtomic: 1_000_000n, validBefore: Date.now() + 60_000 });
    const status = toolValue(await guestCall(t, "skarl_public_order_status", { orderId: created.orderId }));
    expect(status).toMatchObject({ status: "awaiting_funding", acceptedCount: "0",
      funding: { status: "settlement_pending", attemptStatus: "prepared", network: "eip155:84532" } });
    for (const privateValue of [serviceSecret, payerAddress, recipientAddress, authorizationNonce, attemptId, "buyerWalletAddress", "paymentIntentId", "organizationId"]) {
      expect(JSON.stringify(status)).not.toContain(privateValue);
    }
  });
});

describe("MCP transport and bearer boundary", () => {
  it("compares every digest byte and refuses malformed hashes rather than authenticating a matching prefix", async () => {
    const hash = await keyHash(keys.buyer);
    expect(await mcpHashesEqual(hash, hash)).toBe(true);
    for (const changed of [
      (hash[0] === "0" ? "1" : "0") + hash.slice(1),
      hash.slice(0, -1) + (hash.at(-1) === "0" ? "1" : "0"),
      hash.slice(1), hash + "0", "g".repeat(64), "",
    ]) {
      expect(await mcpHashesEqual(hash, changed)).toBe(false);
      expect(await mcpHashesEqual(changed, hash)).toBe(false);
    }
  });

  it("only publishes known refusal codes, because wrapped exceptions can contain private arguments and credentials", () => {
    expect(mcpToolErrorCode(new Error("forbidden"))).toBe("forbidden");
    expect(mcpToolErrorCode(new Error("[Request ID: fixture]\nUncaught DemoRoleError: inactive_demo_identity\n    at private:location"))).toBe("inactive_demo_identity");
    for (const error of [
      new Error("PRIVATE_RECORDING credentials=sk-secret"),
      new Error("forbidden: PRIVATE_RECORDING"),
      new Error("invented_refusal_code"),
      { message: "forbidden" }, "forbidden", null,
    ]) expect(mcpToolErrorCode(error)).toBe("tool_failed");
  });

  it("refuses present invalid, unknown, near-match and oversized credentials before any tool runs", async () => {
    const t = convexTest(schema, modules);
    for (const authorization of ["", "Basic anything", "Bearer unknown", `Bearer ${keys.buyer.slice(0, -1)}x`, `Bearer ${"x".repeat(4097)}`]) {
      const response = await t.fetch("/mcp", { method: "POST", headers: { ...protocolHeaders,
        ...(authorization === undefined ? {} : { Authorization: authorization }) }, body: JSON.stringify(rpc("tools/list")) });
      expect(response.status).toBe(401);
      const body = await response.text();
      // Authentication failures must not reveal keys or their configured labels.
      expect(body).not.toContain(keys.buyer);
      expect(body).not.toContain("Synthetic buyer");
      expect(response.headers.get("Cache-Control")).toContain("no-store");
    }
    expect(await t.run(ctx => ctx.db.query("livenessChallenges").collect())).toHaveLength(0);
  });

  it("fails closed on absent, malformed or invalid role key configuration without downgrading to guest", async () => {
    const t = convexTest(schema, modules);
    for (const config of ["", "not-json", "[]", "{}", JSON.stringify({ [await keyHash(keys.buyer)]: { identity: "finance-agent", label: "invalid scope" } })]) {
      vi.stubEnv("SKARL_MCP_KEYS", config);
      expect((await request(t, rpc("tools/list"))).status).toBe(401);
      const guest = await t.fetch("/mcp", { method: "POST", headers: protocolHeaders, body: JSON.stringify(rpc("tools/list")) });
      expect(guest.status).toBe(200);
      expect((await guest.json()).result.tools).toHaveLength(4);
    }
  });

  it("rejects untrusted browser origins so bearer access cannot be widened through DNS rebinding", async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch("/mcp", { method: "POST", headers: { ...headers(), Origin: "https://attacker.example" }, body: JSON.stringify(rpc("tools/list")) });
    expect(response.status).toBe(403);
    const allowed = await t.fetch("/mcp", { method: "POST", headers: { ...headers(), Origin: "https://skarl.vercel.app" }, body: JSON.stringify(rpc("tools/list")) });
    expect(allowed.status).toBe(200);
  });

  it("offers JSON Streamable HTTP and explicitly declines an authenticated standalone SSE stream", async () => {
    const t = convexTest(schema, modules);
    expect((await t.fetch("/mcp")).status).toBe(405);
    const get = await t.fetch("/mcp", { headers: headers() });
    expect(get.status).toBe(405);
    expect(get.headers.get("Allow")).toContain("POST");
    const response = await request(t, rpc("ping", {}, "health"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Mcp-Session-Id")).toBeNull();
    expect(await response.json()).toEqual({ jsonrpc: "2.0", id: "health", result: {} });
  });

  it("requires JSON and both response media types so incompatible clients fail before an operation starts", async () => {
    const t = convexTest(schema, modules);
    const body = JSON.stringify(rpc("tools/list"));
    expect((await t.fetch("/mcp", { method: "POST", headers: { ...headers(), "Content-Type": "text/plain" }, body })).status).toBe(415);
    for (const accept of ["application/json", "text/event-stream", "*/*"]) {
      expect((await t.fetch("/mcp", { method: "POST", headers: { ...headers(), Accept: accept }, body })).status).toBe(406);
    }
    // Legacy initialize-era clients without the version header retain the
    // supported transport default instead of requiring stateful sessions.
    const compatibleHeaders = new Headers(headers());
    compatibleHeaders.delete("MCP-Protocol-Version");
    const compatible = await t.fetch("/mcp", { method: "POST", headers: compatibleHeaders, body: JSON.stringify(rpc("ping")) });
    expect(compatible.status).toBe(200);
    expect(await compatible.json()).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  });

  it("caps body bytes before dispatch so a multibyte payload cannot consume unbounded memory or issue a challenge", async () => {
    const { t } = await setup();
    const body = JSON.stringify(rpc("tools/call", { name: "skarl_liveness_challenge", arguments: {}, _meta: { padding: "é".repeat(33_000) } }));
    expect(body.length).toBeLessThan(64 * 1024);
    expect(new TextEncoder().encode(body).byteLength).toBeGreaterThan(64 * 1024);
    const response = await t.fetch("/mcp", { method: "POST", headers: headers("contributor"), body });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "request_too_large" });
    expect(await t.run(ctx => ctx.db.query("livenessChallenges").collect())).toHaveLength(0);
  });

  it("negotiates a supported initialize revision and falls back honestly for an unknown revision", async () => {
    const t = convexTest(schema, modules);
    for (const version of ["2025-11-25", "2025-06-18", "2025-03-26", "2099-01-01"]) {
      const response = await request(t, rpc("initialize", { protocolVersion: version, clientInfo: { name: "synthetic-test-client", version: "1.0" }, capabilities: {} }));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({ jsonrpc: "2.0", id: 1, result: { protocolVersion: version === "2099-01-01" ? "2025-11-25" : version,
        serverInfo: { name: "skarl", version: expect.any(String) }, capabilities: { tools: {} } } });
      expect(response.headers.get("Mcp-Session-Id")).toBeNull();
    }
    const initialized = await request(t, { jsonrpc: "2.0", method: "notifications/initialized" });
    expect(initialized.status).toBe(202);
    expect(await initialized.text()).toBe("");
  });

  it("reports JSON-RPC parse/envelope/method/parameter errors without executing a tool", async () => {
    const t = convexTest(schema, modules);
    const malformed = await t.fetch("/mcp", { method: "POST", headers: headers(), body: "{unclosed" });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ jsonrpc: "2.0", id: null, error: { code: -32700 } });
    for (const message of [null, [], [rpc("ping")], { jsonrpc: "1.0", id: 1, method: "ping" }, { jsonrpc: "2.0", id: {}, method: "ping" }, { jsonrpc: "2.0", id: 1 }, { jsonrpc: "2.0", id: 1, method: "ping", params: [] }]) {
      const response = await request(t, message);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ jsonrpc: "2.0", error: { code: -32600 } });
    }
    expect(await (await request(t, rpc("not/a/method", {}, "unknown"))).json()).toMatchObject({ jsonrpc: "2.0", id: "unknown", error: { code: -32601 } });
    for (const message of [rpc("tools/call", {}), rpc("tools/call", { name: 42 }), rpc("initialize", { protocolVersion: 42 })]) {
      expect(await (await request(t, message)).json()).toMatchObject({ jsonrpc: "2.0", id: 1, error: { code: -32602 } });
    }
  });

  it("rejects unsupported per-request protocol versions rather than silently changing negotiated semantics", async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch("/mcp", { method: "POST", headers: { ...headers(), "MCP-Protocol-Version": "2099-01-01" }, body: JSON.stringify(rpc("ping")) });
    expect(response.status).toBe(400);
  });

  it("never executes a tool disguised as a notification because mutations require a replyable request", async () => {
    const { t } = await setup();
    await request(t, { jsonrpc: "2.0", method: "tools/call", params: { name: "skarl_liveness_challenge", arguments: {} } }, "contributor");
    expect(await t.run(ctx => ctx.db.query("livenessChallenges").collect())).toHaveLength(0);
  });
});

describe("MCP role-scoped tools and human authority", () => {
  const expected = {
    buyer: ["skarl_list_tasks", "skarl_create_order", "skarl_order_status", "skarl_get_dataset", "skarl_witness_receipt"],
    contributor: ["skarl_open_tasks", "skarl_liveness_challenge", "skarl_my_submissions_and_earnings", "skarl_explain_outcome"],
    controller: ["skarl_reconciliation", "skarl_exceptions"],
  };

  it.each(identities)("lists only %s tools with strict schemas, so a key never grants another persona's capabilities", async identity => {
    const t = convexTest(schema, modules);
    const response = await request(t, rpc("tools/list"), identity);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.tools.map((tool: { name: string }) => tool.name).sort()).toEqual([...expected[identity]].sort());
    for (const tool of body.result.tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.inputSchema.properties).not.toHaveProperty("demoIdentity");
    }
    expect(await (await request(t, rpc("tools/list"), identity)).json()).toEqual(body);
  });

  it.each(identities)("gives %s no advertised approval, acceptance, signing or payout operation because every payment claim needs a human witness", async identity => {
    const t = convexTest(schema, modules);
    const body = await (await request(t, rpc("tools/list"), identity)).json();
    for (const tool of body.result.tools) {
      expect(tool.name).not.toMatch(/(?:^|_)(?:approve|accept|sign|payout|pay_out)(?:_|$)/i);
      expect(tool.description).not.toMatch(/\b(?:approve|accept|sign|pay[\s_-]?out)\b/i);
    }
    // The existing finance action can propose payments, so it is deliberately
    // omitted instead of being mislabeled as a read-only controller tool.
    expect(body.result.tools.some((tool: { name: string }) => tool.name === "skarl_ask_finance_agent")).toBe(false);
  });

  it("refuses cross-role and invented privileged tools before reaching any mutation", async () => {
    const { t } = await setup();
    for (const name of ["skarl_liveness_challenge", "skarl_reconciliation", "skarl_approve", "finance.approve", "skarl_accept", "skarl_sign", "skarl_payout"]) {
      const response = await call(t, name);
      expect(response).toMatchObject({ jsonrpc: "2.0", id: 1, result: { isError: true } });
      expect(toolValue(response)).toMatchObject({ ok: false, code: "tool_not_allowed" });
    }
    expect(await t.run(ctx => ctx.db.query("livenessChallenges").collect())).toHaveLength(0);
    expect(await t.run(ctx => ctx.db.query("approvals").collect())).toHaveLength(0);
  });

  it("refuses unknown tool arguments so model output cannot replace the key's identity or select arbitrary server functions", async () => {
    const { t } = await setup();
    for (const arguments_ of [{ demoIdentity: "controller" }, { function: "finance.approve" }, [], null, { walletAddress: "attacker" }]) {
      const response = await call(t, "skarl_liveness_challenge", arguments_, "contributor");
      expect(response.result.isError).toBe(true);
      expect(toolValue(response)).toMatchObject({ ok: false, code: "invalid_tool_arguments" });
    }
    expect(await t.run(ctx => ctx.db.query("livenessChallenges").collect())).toHaveLength(0);
    const response = await call(t, "skarl_liveness_challenge", {}, "contributor");
    expect(response.result.isError).not.toBe(true);
    const result = toolValue(response);
    const stored = await t.run(ctx => ctx.db.get(result.challengeId));
    expect(stored).toMatchObject({ contributorTokenIdentifier: "demo:skarl:contributor", words: result.words });
  });

  it("honors a revoked persisted membership despite a valid bearer key, because transport auth cannot replace domain role checks", async () => {
    const { t } = await setup();
    await t.run(async ctx => {
      const member = await ctx.db.query("memberships").withIndex("by_token_identifier", q => q.eq("tokenIdentifier", "demo:skarl:contributor")).unique();
      await ctx.db.patch(member!._id, { status: "revoked" });
    });
    const response = await call(t, "skarl_liveness_challenge", {}, "contributor");
    expect(response.result.isError).toBe(true);
    expect(toolValue(response)).toMatchObject({ ok: false, code: "inactive_demo_identity" });
    expect(await t.run(ctx => ctx.db.query("livenessChallenges").collect())).toHaveLength(0);
  });

  it("maps domain ownership errors to refusal codes without disclosing another buyer's data", async () => {
    const { t, orderId } = await setup();
    await t.run(ctx => ctx.db.patch(orderId, { buyerTokenIdentifier: "private:other-buyer", title: "PRIVATE_FOREIGN_ORDER" }));
    const response = await call(t, "skarl_order_status", { orderId });
    expect(response.result.isError).toBe(true);
    expect(toolValue(response)).toMatchObject({ ok: false, code: "order_not_owned" });
    expect(JSON.stringify(response)).not.toContain("PRIVATE_FOREIGN_ORDER");
  });

  it("does not advertise an unfunded seeded order as contributor work, because a budget is not cash", async () => {
    const { t } = await setup();
    const response = await call(t, "skarl_open_tasks", {}, "contributor");
    expect(response.result.isError).not.toBe(true);
    expect(toolValue(response)).toMatchObject({ tasks: [], demoOnly: true, scope: "seeded_demo_order" });
  });

  it("reads buyer rubrics and a licensed dataset manifest through the existing visibility checks", async () => {
    const { t, orderId, taskVersionId } = await setup();
    const listed = await call(t, "skarl_list_tasks");
    expect(listed.result.isError).toBe(false);
    const result = toolValue(listed);
    expect(result).toMatchObject({ cursor: null, demoOnly: true });
    expect(result.tasks).toContainEqual(expect.objectContaining({ order: expect.objectContaining({ _id: orderId, acceptedCount: "0", budgetAtomic: "100000000" }),
      rubric: expect.objectContaining({ _id: taskVersionId, criteria: expect.any(Array) }) }));
    const dataset = await call(t, "skarl_get_dataset", { orderId });
    expect(dataset.result.isError).toBe(false);
    // An unfunded order with no human-published delivery has no licensed media.
    expect(toolValue(dataset)).toMatchObject({ schema: "skarl.dataset.v1", orderId, samples: [], task: { id: taskVersionId } });
  });

  it("keeps unknown funding explicit and does not infer chain confirmation from an order label", async () => {
    const { t, orderId } = await setup();
    vi.stubEnv("SKARL_PAYMENTS_SERVICE_SECRET", "");
    const unavailable = await call(t, "skarl_order_status", { orderId });
    expect(unavailable.result.isError).toBe(false);
    expect(toolValue(unavailable)).toMatchObject({ orderId, status: "awaiting_funding", acceptedCount: "0",
      funding: { status: "unavailable", code: "funding_status_unavailable" } });

    vi.stubEnv("SKARL_PAYMENTS_SERVICE_SECRET", "synthetic-mcp-payment-service-secret-at-least-32-chars");
    // Deliberately inconsistent fixture: state labels alone are not cash.
    await t.run(ctx => ctx.db.patch(orderId, { status: "funded" }));
    const noIntent = await call(t, "skarl_order_status", { orderId });
    expect(noIntent.result.isError).toBe(false);
    expect(toolValue(noIntent)).toMatchObject({ status: "funded", funding: { status: "awaiting_payment", txHash: null, attemptStatus: null, explorerUrl: null } });
    expect(await t.run(ctx => ctx.db.query("paymentIntents").collect())).toHaveLength(0);
  });

  it("lets a controller agent inspect reconciliation and exceptions without writing financial state or resolving discrepancies", async () => {
    const { t, orderId } = await setup();
    const snapshot = () => t.run(async ctx => ({
      audit: await ctx.db.query("auditEvents").collect(),
      approvals: await ctx.db.query("approvals").collect(),
      commands: await ctx.db.query("paymentCommands").collect(),
      attempts: await ctx.db.query("paymentAttempts").collect(),
      dispositions: await ctx.db.query("reconciliationDispositions").collect(),
      journals: await ctx.db.query("journalEntries").collect(),
    }));
    const before = await snapshot();
    const reconciliation = await call(t, "skarl_reconciliation", { orderId }, "controller");
    expect(reconciliation.result.isError).toBe(false);
    expect(toolValue(reconciliation)).toMatchObject({ simulated: true, rows: expect.any(Array), exceptions: expect.any(Array) });
    const exceptions = await call(t, "skarl_exceptions", { orderId }, "controller");
    expect(exceptions.result.isError).toBe(false);
    expect(Array.isArray(toolValue(exceptions))).toBe(true);
    expect(await snapshot()).toEqual(before);
  });

  it("reuses exact-money order creation and its durable request id, so a lost response cannot duplicate business intent", async () => {
    const { t } = await setup();
    const args = { requestId: "synthetic-mcp-order", title: "Record an upright cup", buyerWalletAddress: `0x${"1".repeat(40)}`,
      quantityRequested: "3", pricePerSampleAtomic: "9007199254740993", contributorRateAtomic: "1000000", deadlineAt: Date.now() + 3600000,
      taskPrompt: "Place the cup upright", criteria: [{ criterionId: "upright", description: "The cup stands upright", modality: "visual" }] };
    const before = await t.run(ctx => ctx.db.query("orders").collect());
    const first = await call(t, "skarl_create_order", args);
    expect(first.result.isError).not.toBe(true);
    const created = toolValue(first);
    expect(created).toMatchObject({ orderId: expect.any(String), replayed: false });
    expect(JSON.stringify(created)).toContain("27021597764222979");
    expect(JSON.stringify(created)).toContain(`https://skarl.vercel.app/api/orders/${created.orderId}/fund`);
    expect(JSON.stringify(created)).toContain("initiate_x402_request");
    const replay = toolValue(await call(t, "skarl_create_order", args));
    expect(replay).toMatchObject({ orderId: created.orderId, replayed: true });
    const conflict = await call(t, "skarl_create_order", { ...args, title: "Changed terms" });
    expect(conflict.result.isError).toBe(true);
    expect(toolValue(conflict)).toMatchObject({ ok: false, code: "order_request_conflict" });
    const after = await t.run(ctx => ctx.db.query("orders").collect());
    expect(after).toHaveLength(before.length + 1);
    expect(after.find(order => order._id === created.orderId)?.budgetAtomic).toBe(27021597764222979n);
    expect(await t.run(ctx => ctx.db.query("paymentIntents").collect())).toHaveLength(0);
    expect(await t.run(ctx => ctx.db.query("journalEntries").collect())).toHaveLength(0);
  });
});
