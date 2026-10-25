import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), cdp: vi.fn(() => ({})) }));
vi.mock("convex/browser", () => ({ ConvexHttpClient: class { query = mocks.query; } }));
vi.mock("@coinbase/cdp-sdk/x402", () => ({ createCdpFacilitatorClient: mocks.cdp }));
import { GET } from "../../../apps/web/app/api/health/route";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://synthetic.convex.cloud");
  vi.stubEnv("SKARL_TREASURY_ADDRESS", `0x${"22".repeat(20)}`);
  vi.stubEnv("SKARL_PAYMENTS_SERVICE_SECRET", "synthetic-service-secret-32-characters");
  vi.stubEnv("CDP_API_KEY_ID", undefined);
  vi.stubEnv("CDP_API_KEY_SECRET", undefined);
  vi.stubEnv("X402_FACILITATOR_URL", undefined);
  mocks.query.mockResolvedValue({ inferenceConfigured: true, paymentsServiceConfigured: true });
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("public health readiness (synthetic dependency responses)", () => {
  it("queries Convex and reports configuration without claiming a live settlement or model call", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.query).toHaveBeenCalledOnce();
    expect(await response.json()).toMatchObject({ status: "ready", demoOnly: true,
      readiness: { convexReachable: true, treasuryConfigured: true, facilitator: "x402.org", inferenceConfigured: true },
      checks: { inferenceExecuted: false, facilitatorContacted: false, settlementVerified: false } });
  });
  it("reports CDP without returning credentials or custom endpoint details", async () => {
    vi.stubEnv("CDP_API_KEY_ID", "synthetic-private-id");
    vi.stubEnv("CDP_API_KEY_SECRET", "synthetic-private-key");
    const response = await GET();
    const body = await response.text();
    expect(JSON.parse(body).readiness.facilitator).toBe("cdp");
    expect(body).not.toContain("synthetic");
  });
  it.each(["SKARL_TREASURY_ADDRESS", "SKARL_PAYMENTS_SERVICE_SECRET"])("fails readiness without %s", async name => {
    vi.stubEnv(name, undefined);
    const response = await GET();
    expect(response.status).toBe(503);
    expect((await response.json()).capabilities.payments).toBe(false);
  });
  it("does not downgrade partial CDP credentials to the public facilitator", async () => {
    vi.stubEnv("CDP_API_KEY_ID", "synthetic-id");
    const response = await GET();
    expect(response.status).toBe(503);
    expect((await response.json()).readiness.facilitator).toBeNull();
  });
  it("reads inference configuration from Convex rather than the web environment", async () => {
    vi.stubEnv("GEMINI_API_KEY", "web-only-secret");
    mocks.query.mockResolvedValue({ inferenceConfigured: false, paymentsServiceConfigured: true });
    const response = await GET();
    expect(response.status).toBe(503);
    expect((await response.json()).readiness.inferenceConfigured).toBe(false);
  });
  it("sanitizes unreachable-backend errors", async () => {
    mocks.query.mockRejectedValue(new Error("private-backend-error-and-secret"));
    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(JSON.parse(body).readiness.convexReachable).toBe(false);
    expect(body).not.toContain("private-backend");
  });
  it("bounds a stalled backend probe to five seconds", async () => {
    vi.useFakeTimers();
    mocks.query.mockReturnValue(new Promise(() => {}));
    const pending = GET();
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await pending).status).toBe(503);
  });
  it("reports missing Convex configuration without calling it", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", undefined);
    const response = await GET();
    expect(response.status).toBe(503);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
