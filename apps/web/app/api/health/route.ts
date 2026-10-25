import { ConvexHttpClient } from "convex/browser";
import { PAYMENT_NETWORK } from "@skarl/contracts/chain";
import { api } from "../../../../../convex/_generated/api";
import { paymentFacilitator } from "../../../../../packages/payments/src/facilitator";
import { treasuryAddress } from "../../../lib/payments/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Configuration/readiness probe; does not execute inference or a payment. */
export async function GET() {
  let backend: { inferenceConfigured?: boolean; paymentsServiceConfigured?: boolean } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (url) {
    try {
      backend = await Promise.race([
        new ConvexHttpClient(url).query(api.health.status, {}),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("health_timeout")), 5_000);
        }),
      ]);
    } catch {
      // Connection errors can contain credentials or deployment internals.
    } finally {
      clearTimeout(timer);
    }
  }
  let treasuryConfigured = false;
  try { treasuryAddress(); treasuryConfigured = true; } catch { /* Report only the boolean. */ }
  let facilitator: "cdp" | "x402.org" | "custom" | null = null;
  try { facilitator = paymentFacilitator().id; } catch { /* Partial credentials fail closed. */ }
  const databaseConnected = !!backend;
  const inferenceConfigured = backend?.inferenceConfigured === true;
  const paymentsServiceConfigured = (process.env.SKARL_PAYMENTS_SERVICE_SECRET?.length ?? 0) >= 32
    && backend?.paymentsServiceConfigured === true;
  const payments = databaseConnected && treasuryConfigured && paymentsServiceConfigured && facilitator !== null;
  const ready = payments && inferenceConfigured;
  return Response.json({
    service: "skarl-web", status: ready ? "ready" : "degraded", network: PAYMENT_NETWORK,
    demoOnly: true,
    capabilities: { contracts: true, authentication: false, databaseConnected,
      mediaCapture: true, inference: inferenceConfigured, payments },
    readiness: { convexReachable: databaseConnected, treasuryConfigured, facilitator,
      paymentsServiceConfigured, inferenceConfigured },
    checks: { inferenceExecuted: false, facilitatorContacted: false, settlementVerified: false },
  }, { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
