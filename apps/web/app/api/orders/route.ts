import { RED_CUP_TASK_SPEC } from "../../../../../convex/lib/taskSpec";
import { authenticateConvexRequest } from "../../../lib/auth/server";
import { createHmac, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { parseAtomicUsdc } from "@skarl/contracts";
import { PAYMENT_NETWORK, PAYMENT_RAILS } from "@skarl/contracts/chain";
import { DEMO_ORDER_BUDGET, DEMO_ORDER_GLOBAL_LIMIT, DEMO_ORDER_IP_LIMIT } from "../../../../../packages/payments/src/demo-order";
import { api, paymentJson, paymentService, treasuryAddress } from "../../../lib/payments/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const terms = { demo: true, testnet: true, price: "1.000000", amountAtomic: DEMO_ORDER_BUDGET.toString(),
  currency: "USDC", network: PAYMENT_NETWORK, asset: PAYMENT_RAILS[PAYMENT_NETWORK].token,
  task: [...RED_CUP_TASK_SPEC.steps, ...(RED_CUP_TASK_SPEC.narration ?? [])].join(". ") + ".",
  autoPay: { enabled: true, maxPerClipAtomic: DEMO_ORDER_BUDGET.toString(), requireAllChecks: true },
  limits: { perIpPerHour: DEMO_ORDER_IP_LIMIT, globalPerHour: DEMO_ORDER_GLOBAL_LIMIT } };

/** Public documentation remains readable even without server configuration. */
export function GET() {
  return paymentJson({ ...terms, method: "POST", path: "/api/orders", body: { autoPay: terms.autoPay }, identityHeaderRequired: false,
    idempotency: "Send a stable Idempotency-Key header (8–128 letters, numbers, dots, underscores, colons or hyphens); retries return the original order. Changed autoPay under that key returns 409.",
    instructions: "POST {} for the default auto-pay rule, or {autoPay:{enabled,maxPerClipAtomic,requireAllChecks:true}} to choose it. Then POST its fundUrl for an x402 challenge. Funding needs Base Sepolia test USDC; never pay a pending order again.",
    hostedUrl: "https://skarl.vercel.app/api/orders" });
}

export async function POST(request: Request) {
  const idempotencyKey = request.headers.get("Idempotency-Key") ?? undefined;
  if (idempotencyKey !== undefined && !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
    return paymentJson({ error: "invalid_idempotency_key" }, 400);
  }
  // Commercial terms stay fixed; the buyer can select only the auto-pay rule.
  let autoPay: { enabled: boolean; maxPerClipAtomic: string; requireAllChecks: true } | undefined;
  const reader = request.body?.getReader();
  let raw = "";
  if (reader) {
    const decoder = new TextDecoder();
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 512) { await reader.cancel(); return paymentJson({ error: "invalid_order_body" }, 400); }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  }
  if (raw.trim()) {
    try {
      const body: unknown = JSON.parse(raw);
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => key !== "autoPay")) throw new Error();
      if ("autoPay" in body) {
        const rule = body.autoPay;
        if (!rule || typeof rule !== "object" || Array.isArray(rule) || Object.keys(rule).sort().join(",") !== "enabled,maxPerClipAtomic,requireAllChecks" ||
          !("enabled" in rule) || typeof rule.enabled !== "boolean" || !("maxPerClipAtomic" in rule) || typeof rule.maxPerClipAtomic !== "string" ||
          !("requireAllChecks" in rule) || rule.requireAllChecks !== true || parseAtomicUsdc(rule.maxPerClipAtomic) <= 0n) throw new Error();
        autoPay = { enabled: rule.enabled, maxPerClipAtomic: rule.maxPerClipAtomic, requireAllChecks: true };
      }
    } catch { return paymentJson({ error: "invalid_order_body", message: "Send {} or a valid autoPay rule. Demo budget and task rubric are fixed." }, 400); }
  }
  try {
    const payTo = treasuryAddress();
    const { db, serviceSecret } = paymentService();
    await authenticateConvexRequest(db, request);
    // Vercel overwrites this header at ingress. Outside Vercel, callers share a bucket;
    // never trust a client-supplied forwarded header on a directly exposed local server.
    // https://vercel.com/docs/headers/request-headers#x-forwarded-for
    const forwarded = process.env.VERCEL === "1" ? request.headers.get("x-forwarded-for")?.trim() : undefined;
    const ip = forwarded && isIP(forwarded) ? forwarded : "shared-untrusted-ingress";
    const ipDigest = createHmac("sha256", serviceSecret).update(ip).digest("hex");
    const result = await db.mutation(api.payments.createDemoOrder, { serviceSecret, ipDigest, requestId: randomUUID(), ...(idempotencyKey ? { idempotencyKey } : {}), ...(autoPay ? { autoPay } : {}) });
    if (!result.ok) {
      const response = paymentJson({ error: result.code, retryAfterSeconds: result.retryAfterSeconds }, 429);
      response.headers.set("Retry-After", String(result.retryAfterSeconds));
      return response;
    }
    const fundUrl = new URL(`/api/orders/${result.orderId}/fund`, request.url).href;
    return paymentJson({ ...terms, orderId: result.orderId, publicId: result.publicId, fundUrl, payTo, deadlineAt: result.deadlineAt,
      autoPay: result.autoPay ?? autoPay ?? terms.autoPay,
      explorer: { treasury: `https://sepolia.basescan.org/address/${payTo}`,
        transaction: "https://sepolia.basescan.org/tx/{txHash}" } }, 201);
  } catch (error) {
    if (error instanceof Error && error.message.includes("idempotency_key_conflict")) {
      return paymentJson({ error: "idempotency_key_conflict" }, 409);
    }
    // Do not expose wrapped Convex errors, arguments or secrets.
    return paymentJson({ error: "demo_orders_unavailable",
      message: "The server needs a configured treasury, payment service and deployed/seeded Convex demo backend. For hosted use, retry https://skarl.vercel.app/api/orders or contact the operator." }, 503);
  }
}
