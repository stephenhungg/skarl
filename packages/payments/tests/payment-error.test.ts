import { describe, expect, it } from "vitest";
import { paymentError } from "../../../apps/web/lib/payments/server";

describe("payment refusal responses", () => {
  it.each(["dispatch_not_ready", "approved_source_changed", "approval_invalidated"])("preserves actionable %s without exposing Convex wrapper details", async code => {
    const response = paymentError(new Error(`[Request ID: synthetic] Server Error: ${code}; private context must not leak`));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error: code });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("still hides unrecognized errors", async () => {
    const response = paymentError(new Error("synthetic confidential request details"));
    expect(await response.json()).toEqual({ ok: false, error: "payment_request_refused" });
  });
});
