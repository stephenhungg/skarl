import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { GET, POST } from "../../../apps/web/app/api/orders/route";

const mocks = vi.hoisted(() => ({ mutation: vi.fn() }));
const secret = "synthetic-secret-for-public-order-tests";
vi.mock("../../../apps/web/lib/payments/server", async importOriginal => ({
  ...await importOriginal<typeof import("../../../apps/web/lib/payments/server")>(),
  paymentService: () => ({ serviceSecret: "synthetic-secret-for-public-order-tests", db: { mutation: mocks.mutation } }),
}));
const request = (body?: string, headers?: HeadersInit) => new Request("https://skarl.vercel.app/api/orders", { method: "POST", body, headers });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SKARL_TREASURY_ADDRESS", "0x8408a922ea400af33d7c2080a9edd5d3495b695f");
  vi.stubEnv("VERCEL", "1");
  mocks.mutation.mockResolvedValue({ ok: true, orderId: "fresh-demo", publicId: "demo-public", deadlineAt: 123 });
});
afterEach(() => vi.unstubAllEnvs());

describe("public order HTTP contract", () => {
  it("serves unauthenticated documentation without a treasury or database call", async () => {
    vi.stubEnv("SKARL_TREASURY_ADDRESS", undefined);
    expect(await GET().json()).toMatchObject({ price: "1.000000", amountAtomic: "1000000", identityHeaderRequired: false });
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
  it.each([undefined, "{}", " \n"])("creates a fixed demo order without identity headers (%s)", async body => {
    const response = await POST(request(body, { "x-forwarded-for": "203.0.113.1" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ orderId: "fresh-demo", fundUrl: "https://skarl.vercel.app/api/orders/fresh-demo/fund",
      price: "1.000000", amountAtomic: "1000000", network: "eip155:84532", demo: true, testnet: true });
    const args = mocks.mutation.mock.calls[0]![1];
    expect(Object.keys(args).sort()).toEqual(["ipDigest", "requestId", "serviceSecret"]);
    expect(args.ipDigest).toBe(createHmac("sha256", secret).update("203.0.113.1").digest("hex"));
    expect(args.ipDigest).not.toContain("203.0.113.1");
  });
  it.each(['{"budgetAtomic":"9999999"}', '{"taskPrompt":"injected"}', '{"payTo":"attacker"}', "[]", "null", "false", "invalid", " ".repeat(513)])("refuses arbitrary body %s", async body => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
  it("records the buyer-selected cap and disable switch without accepting arbitrary terms", async () => {
    const autoPay = { enabled: false, maxPerClipAtomic: "500000", requireAllChecks: true };
    const response = await POST(request(JSON.stringify({ autoPay })));
    expect(response.status).toBe(201);
    expect(mocks.mutation.mock.calls[0]![1].autoPay).toEqual(autoPay);
    expect(await response.json()).toMatchObject({ autoPay });
  });
  it.each([
    { enabled: true, maxPerClipAtomic: "1.5", requireAllChecks: true },
    { enabled: true, maxPerClipAtomic: "0", requireAllChecks: true },
    { enabled: true, maxPerClipAtomic: "1000000", requireAllChecks: false },
    { enabled: true, maxPerClipAtomic: "1000000", requireAllChecks: true, setBy: "policy-engine" },
    { enabled: true, maxPerClipAtomic: "9223372036854775808", requireAllChecks: true },
  ])("refuses invalid or caller-forged policy fields: %j", async autoPay => {
    expect((await POST(request(JSON.stringify({ autoPay })))).status).toBe(400);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
  it("does not trust forwarded headers outside Vercel", async () => {
    vi.stubEnv("VERCEL", undefined);
    await POST(request(undefined, { "x-forwarded-for": "203.0.113.1" }));
    await POST(request(undefined, { "x-forwarded-for": "203.0.113.2" }));
    expect(mocks.mutation.mock.calls[0]![1].ipDigest).toBe(mocks.mutation.mock.calls[1]![1].ipDigest);
  });
  it("returns durable rate limit refusals with Retry-After", async () => {
    mocks.mutation.mockResolvedValue({ ok: false, code: "demo_order_rate_limited", retryAfterSeconds: 72 });
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("72");
  });
  it("sanitizes backend failures and fails before creation if treasury is missing", async () => {
    mocks.mutation.mockRejectedValue(new Error(`wrapped ${secret}`));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(secret);
    mocks.mutation.mockClear();
    vi.stubEnv("SKARL_TREASURY_ADDRESS", undefined);
    expect((await POST(request())).status).toBe(503);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
});
