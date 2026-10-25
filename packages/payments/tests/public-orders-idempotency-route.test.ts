import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { POST } from "../../../apps/web/app/api/orders/route";

const mocks = vi.hoisted(() => ({ mutation: vi.fn() }));
vi.mock("../../../apps/web/lib/payments/server", async importOriginal => {
  const actual = await importOriginal<typeof import("../../../apps/web/lib/payments/server")>();
  return { ...actual, paymentService: () => ({ serviceSecret: "synthetic-public-orders-service-secret",
    db: { mutation: mocks.mutation } }) };
});
const request = (key: string) => new Request("https://example.test/api/orders", {
  method: "POST", headers: { "Idempotency-Key": key, "Content-Type": "application/json" }, body: "{}",
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SKARL_TREASURY_ADDRESS", `0x${"22".repeat(20)}`);
  mocks.mutation.mockResolvedValue({ ok: true, orderId: "synthetic-order", publicId: "synthetic-public-order", deadlineAt: 1_800_000_000_000 });
});
afterEach(() => vi.unstubAllEnvs());

describe("public order idempotency HTTP boundary (synthetic backend)", () => {
  it("forwards the stable caller key despite fresh transport request IDs so a lost response can recover the same order", async () => {
    expect((await POST(request("public-order-request-1"))).status).toBe(201);
    expect((await POST(request("public-order-request-1"))).status).toBe(201);
    const calls = mocks.mutation.mock.calls;
    expect(calls).toHaveLength(2);
    expect(getFunctionName(calls[0][0])).toBe("payments:createDemoOrder");
    expect(calls[0][1]).toMatchObject({ idempotencyKey: "public-order-request-1" });
    expect(calls[1][1]).toMatchObject({ idempotencyKey: "public-order-request-1" });
    expect(calls[0][1].requestId).not.toBe(calls[1][1].requestId);
  });
  it("rejects malformed keys before reaching durable state instead of silently creating a new order", async () => {
    const response = await POST(request("too big ".repeat(30)));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_idempotency_key" });
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
  it("reports conflicting intent as 409 without echoing a wrapped backend error or service arguments", async () => {
    mocks.mutation.mockRejectedValue(new Error("Convex wrapper: idempotency_key_conflict; synthetic-private-details"));
    const response = await POST(request("public-order-request-1"));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "idempotency_key_conflict" });
  });
});
