import { createHmac, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { PAYMENT_NETWORK, PAYMENT_RAILS } from "@skarl/contracts/chain";
import { DEMO_ORDER_BUDGET, DEMO_ORDER_GLOBAL_LIMIT, DEMO_ORDER_IP_LIMIT } from "../../../../../packages/payments/src/demo-order";
import { api, paymentJson, paymentService, treasuryAddress } from "../../../lib/payments/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const terms = { demo: true, testnet: true, price: "1.000000", amountAtomic: DEMO_ORDER_BUDGET.toString(),
  currency: "USDC", network: PAYMENT_NETWORK, asset: PAYMENT_RAILS[PAYMENT_NETWORK].token,
  task: "Pick up the red cup and place it on the marked coaster. Narrate each action.",
  limits: { perIpPerHour: DEMO_ORDER_IP_LIMIT, globalPerHour: DEMO_ORDER_GLOBAL_LIMIT } };

/** Public documentation remains readable even without server configuration. */
export function GET() {
  return paymentJson({ ...terms, method: "POST", path: "/api/orders", body: {}, identityHeaderRequired: false,
    instructions: "POST an empty body or {} to create a fresh demo order, then POST its fundUrl for an x402 challenge. Funding needs Base Sepolia test USDC; never pay a pending order again.",
    hostedUrl: "https://skarl.vercel.app/api/orders" });
}

export async function POST(request: Request) {
  // Read at most a tiny empty JSON object; fields, arrays and primitives cannot override terms.
  const reader = request.body?.getReader();
  let raw = "";
  if (reader) {
    const decoder = new TextDecoder();
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 256) { await reader.cancel(); return paymentJson({ error: "empty_body_required" }, 400); }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  }
  if (raw.trim()) {
    try {
      const body: unknown = JSON.parse(raw);
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length) throw new Error();
    } catch { return paymentJson({ error: "empty_body_required", message: "Send no body or {}. Demo budget and red-cup task are fixed." }, 400); }
  }
  try {
    const payTo = treasuryAddress();
    const { db, serviceSecret } = paymentService();
    // Vercel overwrites this header at ingress. Outside Vercel, callers share a bucket;
    // never trust a client-supplied forwarded header on a directly exposed local server.
    // https://vercel.com/docs/headers/request-headers#x-forwarded-for
    const forwarded = process.env.VERCEL === "1" ? request.headers.get("x-forwarded-for")?.trim() : undefined;
    const ip = forwarded && isIP(forwarded) ? forwarded : "shared-untrusted-ingress";
    const ipDigest = createHmac("sha256", serviceSecret).update(ip).digest("hex");
    const result = await db.mutation(api.payments.createDemoOrder, { serviceSecret, ipDigest, requestId: randomUUID() });
    if (!result.ok) {
      const response = paymentJson({ error: result.code, retryAfterSeconds: result.retryAfterSeconds }, 429);
      response.headers.set("Retry-After", String(result.retryAfterSeconds));
      return response;
    }
    const fundUrl = new URL(`/api/orders/${result.orderId}/fund`, request.url).href;
    return paymentJson({ ...terms, orderId: result.orderId, publicId: result.publicId, fundUrl, payTo, deadlineAt: result.deadlineAt,
      explorer: { treasury: `https://sepolia.basescan.org/address/${payTo}`,
        transaction: "https://sepolia.basescan.org/tx/{txHash}" } }, 201);
  } catch {
    // Do not expose wrapped Convex errors, arguments or secrets.
    return paymentJson({ error: "demo_orders_unavailable",
      message: "The server needs a configured treasury, payment service and deployed/seeded Convex demo backend. For hosted use, retry https://skarl.vercel.app/api/orders or contact the operator." }, 503);
  }
}
