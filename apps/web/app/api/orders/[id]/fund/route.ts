import { type NextRequest, NextResponse } from "next/server";
import { withX402, x402ResourceServer } from "@x402/next";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentFacilitator } from "../../../../../../../packages/payments/src/facilitator";
import { PAYMENT_NETWORK } from "@skarl/contracts/chain";
import { fundingRouteConfig, parseFundingAuthorization } from "../../../../../../../packages/payments/src/funding";
import { api, paymentError, paymentJson, paymentService, treasuryAddress, type Id } from "../../../../../lib/payments/server";
import { observeTransfer } from "../../../../../lib/payments/chain";
import type { Hash } from "viem";
export const runtime = "nodejs";
export const maxDuration = 60;
type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const treasury = treasuryAddress();
    const { db, serviceSecret } = paymentService();
    const result = await db.query(api.payments.fundingStatus, { serviceSecret, orderId: (await context.params).id,
      demoIdentity: request.headers.get("x-skarl-demo-identity") || "buyer" });
    return paymentJson({ recipientAddress: treasury, orderId: result.order._id, status: result.order.status, amountAtomic: result.order.budgetAtomic,
      fundingStatus: result.intent?.status ?? "awaiting_payment", txHash: result.attempt?.txHash ?? null,
      attemptId: result.attempt?._id ?? null });
  } catch (error) { return paymentError(error); }
}
export async function POST(request: NextRequest, context: Context) {
  try {
    const treasury = treasuryAddress();
    const { db, serviceSecret } = paymentService();
    const orderId = (await context.params).id;
    const demoIdentity = request.headers.get("x-skarl-demo-identity") || "buyer";
    const { order, intent, attempt } = await db.query(api.payments.fundingStatus, { serviceSecret, orderId, demoIdentity });
    // An interrupted attempt is a status/reconciliation operation, never a new charge.
    if (intent) return paymentJson({ orderId: order._id, status: order.status, fundingStatus: intent.status,
      txHash: attempt?.txHash ?? null, attemptId: attempt?._id, reconcileUrl: "/api/payments/reconcile" }, intent.status === "confirmed" ? 200 : 202);
    if (!["draft", "awaiting_funding"].includes(order.status) || Date.now() > order.deadlineAt) throw new Error("order_not_fundable");
    const facilitator = paymentFacilitator();
    const server = new x402ResourceServer(facilitator.client).register(PAYMENT_NETWORK, new ExactEvmScheme());
    let settledBy: string | null = null;
    let attemptId: Id<"paymentAttempts"> | undefined;
    let authorizationNonce: string | undefined;
    server.onBeforeSettle(async ({ paymentPayload }) => {
      try {
        const authorization = parseFundingAuthorization(paymentPayload.payload);
        if (authorization.recipientAddress.toLowerCase() !== treasury.toLowerCase() || authorization.amountAtomic !== order.budgetAtomic) {
          return { abort: true, reason: "quote_changed" };
        }
        const recorded = await db.mutation(api.payments.recordFundingAttempt, { serviceSecret, orderId, demoIdentity, ...authorization });
        if (recorded.replayed) return { abort: true, reason: "authorization_already_claimed_reconcile" };
        attemptId = recorded.attemptId; authorizationNonce = authorization.authorizationNonce;
      } catch {
        // x402 treats thrown before-settlement hook errors as non-fatal. Abort explicitly.
        return { abort: true, reason: "payment_claim_refused" };
      }
    });
    server.onAfterSettle(async ({ result }) => {
      if (!attemptId || !result.success || !result.transaction || !authorizationNonce) return;
      settledBy = facilitator.id;
      console.info("x402_settlement", { facilitator: settledBy, network: PAYMENT_NETWORK, txHash: result.transaction, orderId: order._id });
      // Persist the hash before RPC polling. A polling failure leaves the attempt reconciling.
      try { await db.mutation(api.payments.recordTransaction, { serviceSecret, attemptId, txHash: result.transaction }); }
      catch { console.error("x402_transaction_record_pending", { attemptId, txHash: result.transaction }); }
    });
    // Bare config intentionally protects every path passed into this single POST route.
    const response = await withX402(async () => NextResponse.json({ orderId: order._id, fundingStatus: "settlement_pending" }),
      fundingRouteConfig(order.budgetAtomic, treasury), server)(request);
    response.headers.set("X-Skarl-Facilitator", facilitator.id);
    if (!attemptId) return response;
    const current = await db.query(api.payments.fundingStatus, { serviceSecret, orderId, demoIdentity });
    if (current.attempt?.txHash && current.intent) {
      try {
        const observation = await observeTransfer(current.attempt.txHash as Hash, { fromAddress: current.intent.buyerWalletAddress,
          toAddress: current.intent.recipientAddress, amountAtomic: current.intent.amountAtomic }, authorizationNonce);
        await db.mutation(api.payments.confirmFunding, { serviceSecret, attemptId, authorizationNonce: authorizationNonce!, observation });
        const confirmed = paymentJson({ orderId: order._id, fundingStatus: "confirmed", txHash: observation.txHash, settledBy,
          explorerUrl: `https://sepolia.basescan.org/tx/${observation.txHash}` });
        const paymentResponse = response.headers.get("PAYMENT-RESPONSE");
        if (paymentResponse) confirmed.headers.set("PAYMENT-RESPONSE", paymentResponse);
        confirmed.headers.set("X-Skarl-Facilitator", facilitator.id);
        return confirmed;
      } catch { /* Unknown outcome. The durable attempt must be reconciled, never repaid. */ }
    }
    const pending = paymentJson({ orderId: order._id, fundingStatus: "settlement_pending", attemptId, settledBy,
      txHash: current.attempt?.txHash ?? null, reconcileUrl: "/api/payments/reconcile" }, 202);
    const paymentResponse = response.headers.get("PAYMENT-RESPONSE");
    if (paymentResponse) pending.headers.set("PAYMENT-RESPONSE", paymentResponse);
    pending.headers.set("X-Skarl-Facilitator", facilitator.id);
    return pending;
  } catch (error) { return paymentError(error); }
}
