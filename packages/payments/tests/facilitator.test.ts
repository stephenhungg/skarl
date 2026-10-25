import { describe, expect, it, vi } from "vitest";
const cdp = vi.hoisted(() => vi.fn(() => ({ provider: "cdp" })));
vi.mock("@coinbase/cdp-sdk/x402", () => ({ createCdpFacilitatorClient: cdp }));
import { paymentFacilitator } from "../src/facilitator";

describe("facilitator selection", () => {
  it("uses the public facilitator only with no CDP keys", () => {
    expect(paymentFacilitator({})).toMatchObject({ id: "x402.org", url: "https://x402.org/facilitator" });
  });
  it("uses the CDP SDK factory and ignores a public override when credentials exist", () => {
    const selected = paymentFacilitator({ CDP_API_KEY_ID: "synthetic-id", CDP_API_KEY_SECRET: "synthetic-secret", X402_FACILITATOR_URL: "https://other.example" });
    expect(selected).toMatchObject({ id: "cdp", url: "https://api.cdp.coinbase.com/platform/v2/x402", client: { provider: "cdp" } });
    expect(cdp).toHaveBeenCalledWith({ apiKeyId: "synthetic-id", apiKeySecret: "synthetic-secret" });
  });
  it.each([{ CDP_API_KEY_ID: "id" }, { CDP_API_KEY_SECRET: "secret" }])("fails closed for partial credentials", env => {
    expect(() => paymentFacilitator(env)).toThrow("payment_service_not_configured");
  });
  it("does not call a custom endpoint x402.org or CDP", () => {
    expect(paymentFacilitator({ X402_FACILITATOR_URL: "https://custom.example" }).id).toBe("custom");
  });
});
