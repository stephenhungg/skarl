import { createHash } from "node:crypto";
import { makeFunctionReference, type ApiFromModules, type FunctionArgs, type FunctionReturnType } from "convex/server";
import type { receiveWebhook, finishWebhook } from "../../../../../../convex/chainWitness";
import { api, paymentJson, paymentService, treasuryAddress } from "../../../../lib/payments/server";
import { observeTransfer } from "../../../../lib/payments/chain";
import { parseCdpTransfer, verifyCdpSignature } from "../../../../lib/cdp/webhook";
import type { Hash } from "viem";

export const runtime = "nodejs";
export const maxDuration = 60;
type WebhookApi = ApiFromModules<{ chainWitness: { receiveWebhook: typeof receiveWebhook; finishWebhook: typeof finishWebhook } }>["chainWitness"];
const receive = makeFunctionReference<"mutation", FunctionArgs<WebhookApi["receiveWebhook"]>, FunctionReturnType<WebhookApi["receiveWebhook"]>>("chainWitness:receiveWebhook");
const finish = makeFunctionReference<"mutation", FunctionArgs<WebhookApi["finishWebhook"]>, FunctionReturnType<WebhookApi["finishWebhook"]>>("chainWitness:finishWebhook");
export function HEAD() { return new Response(null, { status: 200 }); }

export async function POST(request: Request) {
  const secrets = [process.env.CDP_WEBHOOK_SECRET_TO, process.env.CDP_WEBHOOK_SECRET_FROM, process.env.CDP_WEBHOOK_SECRET]
    .filter((secret): secret is string => !!secret);
  if (!secrets.length) return paymentJson({ error: "webhook_not_configured" }, 503);
  if (Number(request.headers.get("content-length")) > 64_000) return paymentJson({ error: "payload_too_large" }, 413);
  // Bound streamed requests too; the body used for HMAC is never parsed/re-serialized first.
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  if (reader) for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 64_000) { await reader.cancel(); return paymentJson({ error: "payload_too_large" }, 413); }
    chunks.push(value);
  }
  const raw = Buffer.concat(chunks);
  if (!verifyCdpSignature(raw, request.headers.get("x-webhook-signature"), secrets)) return paymentJson({ error: "invalid_signature" }, 401);
  let treasury: string;
  try { treasury = treasuryAddress(); }
  catch { return paymentJson({ error: "treasury_not_configured" }, 503); }
  let event;
  try {
    // X-Event-Id is not authenticated by v0. Body digest is the safe fallback identity.
    event = parseCdpTransfer(JSON.parse(raw.toString("utf8")), treasury, createHash("sha256").update(raw).digest("hex"));
  } catch { return paymentJson({ error: "invalid_webhook_payload" }, 400); }
  try {
    const { db, serviceSecret } = paymentService();
    const received = await db.mutation(receive, { ...event, treasury, serviceSecret });
    if (received.processed) return paymentJson({ status: "processed", replayed: true });
    if (!received.candidates.length) {
      await db.mutation(finish, { serviceSecret, receiptId: received.receiptId, status: "unknown_transfer" });
      return paymentJson({ status: "unknown_transfer" });
    }
    const expected = { fromAddress: event.fromAddress, toAddress: event.toAddress, amountAtomic: BigInt(event.amountAtomic) };
    let transientFailure = false;
    // Funding candidates must prove their stored nonce; matching amount alone never binds a payment.
    for (const candidate of received.candidates) {
      let observation;
      try { observation = await observeTransfer(event.txHash as Hash, expected, candidate.authorizationNonce); }
      catch (error) {
        if (!(error instanceof Error) || error.message !== "authorization_not_in_receipt") transientFailure = true;
        continue;
      }
      if (observation.logIndex !== event.logIndex) continue;
      // Persist only the verified candidate hash, then reuse the canonical payment mutations.
      await db.mutation(api.payments.recordTransaction, { serviceSecret, attemptId: candidate.attemptId, txHash: event.txHash });
      if (candidate.kind === "funding" && candidate.authorizationNonce) {
        const confirmation = await db.mutation(api.payments.confirmFunding, { serviceSecret, attemptId: candidate.attemptId,
          authorizationNonce: candidate.authorizationNonce, observation });
        if (confirmation?.ok === false) return paymentJson({ status: "reconciliation_exception", error: confirmation.code });
      } else {
        await db.mutation(api.payments.recordPayoutObservation, { serviceSecret, attemptId: candidate.attemptId, observation });
      }
      await db.mutation(finish, { serviceSecret, receiptId: received.receiptId, status: "processed" });
      return paymentJson({ status: "processed" });
    }
    if (!transientFailure) {
      await db.mutation(finish, { serviceSecret, receiptId: received.receiptId, status: "unknown_transfer" });
      return paymentJson({ status: "unknown_transfer" });
    }
    // Receipt not confirmed / nonce not matched: CDP must retry, never infer payment failure.
    return paymentJson({ status: "pending", error: "reconciliation_pending" }, 503);
  } catch { return paymentJson({ status: "pending", error: "reconciliation_unavailable" }, 503); }
}
