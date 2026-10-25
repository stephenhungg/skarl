import { type NextRequest, NextResponse } from "next/server";
import { withX402, x402ResourceServer } from "@x402/next";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { PAYMENT_NETWORK } from "@skarl/contracts/chain";
import { paymentFacilitator } from "../../../../../../../packages/payments/src/facilitator";
import { evidenceRouteConfig, bazaarResourceServerExtension, EVIDENCE_PRICE_ATOMIC } from "../../../../../../../packages/payments/src/evidence";
import { parseFundingAuthorization } from "../../../../../../../packages/payments/src/funding";
import { api, paymentJson, paymentError, paymentService, evidencePayTo, type Id } from "../../../../../lib/payments/server";
import { evidenceApi } from "../../../../../lib/payments/evidence-service";
import { observeTransfer } from "../../../../../lib/payments/chain";
import { issueMediaToken } from "../../../../../lib/payments/media-token";
import type { Hash } from "viem";

export const runtime = "nodejs";
export const maxDuration = 60;
type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const sampleId = (await context.params).id;
    if (!/^sample-[a-zA-Z0-9]+$/.test(sampleId)) return paymentJson({ error: "sample_unavailable" }, 404);
    const payTo = evidencePayTo(), { db, serviceSecret } = paymentService();
    // Never challenge for unavailable/rejected/private work; this service read exposes nothing to the caller.
    const sample = await db.query(evidenceApi.sample, { serviceSecret, sampleId });
    // Refuse to charge against an older backend that books sales as order funding.
    if (sample.accountingVersion !== 2 || sample.recipientAddress !== payTo) throw new Error("evidence_accounting_not_configured");
    const facilitator = paymentFacilitator();
    const server = new x402ResourceServer(facilitator.client).register(PAYMENT_NETWORK, new ExactEvmScheme())
      .registerExtension(bazaarResourceServerExtension);
    let attemptId: Id<"paymentAttempts"> | undefined;
    let authorization: ReturnType<typeof parseFundingAuthorization> | undefined;
    let txHash: string | undefined;
    let extensionResponses: string | undefined;
    server.onBeforeSettle(async ({ paymentPayload }) => {
      try {
        const auth = parseFundingAuthorization(paymentPayload.payload);
        if (auth.amountAtomic !== EVIDENCE_PRICE_ATOMIC || auth.recipientAddress.toLowerCase() !== payTo.toLowerCase()) {
          return { abort: true, reason: "quote_changed" };
        }
        const claim = await db.mutation(evidenceApi.claim, { serviceSecret, sampleId, ...auth, facilitator: facilitator.id });
        if (claim.binding !== sample.binding) return { abort: true, reason: "sample_changed" };
        if (claim.replayed) return { abort: true, reason: "authorization_already_claimed_reconcile" };
        attemptId = claim.attemptId;
        authorization = auth;
      } catch {
        // x402 treats thrown before-settlement hook errors as non-fatal. Abort explicitly.
        return { abort: true, reason: "payment_claim_refused" };
      }
    });
    server.onAfterSettle(async ({ result }) => {
      if (!attemptId || !result.success || !result.transaction) return;
      txHash = result.transaction;
      if (result.extensionResponses) extensionResponses = Buffer.from(JSON.stringify(result.extensionResponses)).toString("base64");
      console.info("x402_evidence_settlement", { facilitator: facilitator.id, network: PAYMENT_NETWORK, txHash, sampleId });
      try { await db.mutation(api.payments.recordTransaction, { serviceSecret, attemptId, txHash }); }
      catch { console.error("x402_transaction_record_pending", { attemptId, txHash }); }
    });
    // Middleware settles after the handler. Do not put paid evidence in its pre-settlement response.
    const response = await withX402(async () => NextResponse.json({ sampleId, status: "settlement_pending" }),
      { [`GET ${request.nextUrl.pathname}`]: evidenceRouteConfig(payTo) }, server)(request);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Skarl-Facilitator", facilitator.id);
    // v2 clients use PAYMENT-REQUIRED. Also expose the same public challenge in
    // JSON for bare GET probes; the pinned Next adapter otherwise sends {}.
    const required = response.headers.get("PAYMENT-REQUIRED");
    if (response.status === 402 && required && !request.headers.has("PAYMENT-SIGNATURE")) {
      return NextResponse.json(decodePaymentRequiredHeader(required), { status: 402, headers: response.headers });
    }
    if (!attemptId || !authorization) return response;
    const headers = new Headers({ "X-Skarl-Facilitator": facilitator.id });
    if (extensionResponses) headers.set("EXTENSION-RESPONSES", extensionResponses);
    for (const name of ["PAYMENT-RESPONSE", "EXTENSION-RESPONSES"]) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }
    let confirmed = false;
    if (txHash) {
      try {
        const observation = await observeTransfer(txHash as Hash, { fromAddress: authorization.payerAddress,
          toAddress: payTo, amountAtomic: EVIDENCE_PRICE_ATOMIC }, authorization.authorizationNonce);
        await db.mutation(evidenceApi.confirm, { serviceSecret, attemptId, authorizationNonce: authorization.authorizationNonce, observation });
        confirmed = true;
      } catch { /* Unknown receipt/import outcome: the durable claim owns reconciliation. */ }
    }
    let result;
    if (confirmed) {
      try {
        const current = await db.query(evidenceApi.sample, { serviceSecret, sampleId });
        if (current.binding !== sample.binding) throw new Error("sample_changed_after_payment");
        const grant = issueMediaToken(sampleId, current.binding, serviceSecret);
        const mediaUrl = new URL(`/api/samples/${sampleId}/media`, request.url);
        mediaUrl.searchParams.set("token", grant.token);
        result = paymentJson({ sampleId, report: current.report,
          media: { url: mediaUrl.toString(), expiresAt: grant.expiresAt, mimeType: current.mimeType },
          settlement: { status: "confirmed", txHash, facilitator: facilitator.id }, accountingTreatment: "evidence_sale_inflow" });
      } catch {
        // Quarantine/revocation does not undo payment. Preserve its receipt without releasing content.
        result = paymentJson({ sampleId, status: "paid_content_unavailable", attemptId,
          settlement: { status: "confirmed", txHash, facilitator: facilitator.id },
          message: "Payment is confirmed but content is unavailable. Contact the operator; do not pay again." }, 409);
      }
    } else {
      result = paymentJson({ sampleId, status: "settlement_pending", attemptId, txHash: txHash ?? null,
        settledBy: txHash ? facilitator.id : null, message: "Reconcile this stored attempt; do not pay again." }, 202);
    }
    headers.forEach((value, key) => result.headers.set(key, value));
    return result;
  } catch (error) {
    if (error instanceof Error && error.message.includes("sample_not_available")) return paymentJson({ error: "sample_unavailable" }, 404);
    return paymentError(error);
  }
}
