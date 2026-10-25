import { authenticateConvexRequest } from "../../../../../lib/auth/server";
import { type NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import { fundingTermsHash, type FundingAutoPayRule } from "../../../../../../../packages/payments/src/funding-terms";
import { FundingResourceServer } from "../../../../../../../packages/payments/src/funding-server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { parseSolanaFundingAuthorization, observeSolanaTransfer } from "../../../../../../../packages/payments/src/solana";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentFacilitator } from "../../../../../../../packages/payments/src/facilitator";
import { PAYMENT_NETWORK, SOLANA_PAYMENT_NETWORK, paymentRail } from "@skarl/contracts/chain";
import { fundingRouteConfig, parseFundingAuthorization } from "../../../../../../../packages/payments/src/funding";
import { api, paymentError, paymentJson, paymentService, treasuryAddress, solanaTreasuryAddress, type Id } from "../../../../../lib/payments/server";
import { observeTransfer } from "../../../../../lib/payments/chain";
import type { Hash } from "viem";
export const runtime = "nodejs";
export const maxDuration = 60;
type Context = { params: Promise<{ id: string }> };
function fundingTerms(order: { _id: string; budgetAtomic: bigint; autoPay?: Omit<FundingAutoPayRule, "maxPerClipAtomic"> & { maxPerClipAtomic: bigint } }, payTo: string) {
  return { orderId: order._id, amountAtomic: order.budgetAtomic.toString(), payTo,
    autoPay: order.autoPay ? { enabled: order.autoPay.enabled, maxPerClipAtomic: order.autoPay.maxPerClipAtomic.toString(), requireAllChecks: order.autoPay.requireAllChecks } : null };
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const treasury = treasuryAddress();
    const solanaTreasury = solanaTreasuryAddress();
    const { db, serviceSecret } = paymentService();
    await authenticateConvexRequest(db, request);
    const result = await db.query(api.payments.fundingStatus, { serviceSecret, orderId: (await context.params).id,
      demoIdentity: request.headers.get("x-skarl-demo-identity") || "buyer" });
    const baseTreasury = result.order.fundingPayTo ?? treasury;
    const terms = fundingTerms(result.order, result.intent?.recipientAddress ?? baseTreasury);
    return paymentJson({ recipientAddress: result.intent?.recipientAddress ?? baseTreasury, orderId: result.order._id, status: result.order.status, amountAtomic: result.order.budgetAtomic,
      autoPay: terms.autoPay, fundingTermsHash: fundingTermsHash(terms),
      fundingStatus: result.intent?.status ?? "awaiting_payment", txHash: result.attempt?.txHash ?? null,
      attemptId: result.attempt?._id ?? null, network: result.intent?.network ?? PAYMENT_NETWORK,
      explorerUrl: result.attempt?.txHash ? paymentRail(result.intent?.network ?? PAYMENT_NETWORK).explorerTx(result.attempt.txHash) : null,
      rails: [{ network: PAYMENT_NETWORK, recipientAddress: baseTreasury, asset: paymentRail(PAYMENT_NETWORK).token },
        ...(solanaTreasury && !result.order.fundingPayTo ? [{ network: SOLANA_PAYMENT_NETWORK, recipientAddress: solanaTreasury, asset: paymentRail(SOLANA_PAYMENT_NETWORK).token }] : [])] });
  } catch (error) { return paymentError(error); }
}
export async function POST(request: NextRequest, context: Context) {
  const idempotencyKey = request.headers.get("Idempotency-Key") ?? undefined;
  const expectedFundingTermsHash = request.headers.get("X-Skarl-Funding-Terms") ?? undefined;
  if (expectedFundingTermsHash !== undefined && !/^[0-9a-f]{64}$/.test(expectedFundingTermsHash)) return paymentJson({ error: "invalid_funding_terms_hash" }, 400);
  if (idempotencyKey !== undefined && !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
    return paymentJson({ error: "invalid_idempotency_key" }, 400);
  }
  try {
    const treasury = treasuryAddress();
    const solanaTreasury = solanaTreasuryAddress();
    const { db, serviceSecret } = paymentService();
    await authenticateConvexRequest(db, request);
    const orderId = (await context.params).id;
    const demoIdentity = request.headers.get("x-skarl-demo-identity") || "buyer";
    const { order, intent, attempt } = await db.query(api.payments.fundingStatus, { serviceSecret, orderId, demoIdentity });
    const orderTreasury = order.fundingPayTo ?? treasury;
    const orderSolanaTreasury = order.fundingPayTo ? undefined : solanaTreasury;
    // An interrupted attempt is a status/reconciliation operation, never a new charge.
    if (intent) return paymentJson({ orderId: order._id, status: order.status, fundingStatus: intent.status,
      network: intent.network, explorerUrl: attempt?.txHash ? paymentRail(intent.network).explorerTx(attempt.txHash) : null,
      txHash: attempt?.txHash ?? null, attemptId: attempt?._id, reconcileUrl: "/api/payments/reconcile" }, intent.status === "confirmed" ? 200 : 202);
    if (expectedFundingTermsHash !== undefined && fundingTermsHash(fundingTerms(order, orderTreasury)) !== expectedFundingTermsHash) return paymentJson({ error: "funding_terms_changed", message: "Review the stored buyer rule and original request; do not authorize a replacement automatically." }, 409);
    if (!["draft", "awaiting_funding"].includes(order.status) || Date.now() > order.deadlineAt) throw new Error("order_not_fundable");
    const facilitator = paymentFacilitator();
    const server = new FundingResourceServer(facilitator.client).register(PAYMENT_NETWORK, new ExactEvmScheme());
    if (orderSolanaTreasury) server.register(SOLANA_PAYMENT_NETWORK, new ExactSvmScheme());
    let claimedNetwork: string = PAYMENT_NETWORK;
    let settledBy: string | null = null;
    let attemptId: Id<"paymentAttempts"> | undefined;
    let authorizationNonce: string | undefined;
    server.onBeforeSettle(async ({ paymentPayload }) => {
      try {
        const network = paymentPayload.accepted.network;
        if (expectedFundingTermsHash && network !== PAYMENT_NETWORK) return { abort: true, reason: "funding_terms_network_changed" };
        if (network !== PAYMENT_NETWORK && (network !== SOLANA_PAYMENT_NETWORK || !orderSolanaTreasury)) return { abort: true, reason: "unsupported_payment_network" };
        const parsed = network === SOLANA_PAYMENT_NETWORK
          ? await parseSolanaFundingAuthorization(paymentPayload.payload, { treasuryAddress: orderSolanaTreasury!, amountAtomic: order.budgetAtomic, orderId: order._id,
            feePayer: paymentPayload.accepted.extra.feePayer as string })
          : parseFundingAuthorization(paymentPayload.payload);
        const { payerAddress, recipientAddress, authorizationNonce: nonce, amountAtomic, validBefore } = parsed;
        const authorization = { payerAddress, recipientAddress, authorizationNonce: nonce, amountAtomic, validBefore };
        if ((network === PAYMENT_NETWORK && authorization.recipientAddress.toLowerCase() !== orderTreasury.toLowerCase()) || authorization.amountAtomic !== order.budgetAtomic) {
          return { abort: true, reason: "quote_changed" };
        }
        const recorded = await db.mutation(api.payments.recordFundingAttempt, { serviceSecret, orderId, demoIdentity, ...authorization,
          ...(network === SOLANA_PAYMENT_NETWORK ? { network } : {}), ...(idempotencyKey ? { idempotencyKey } : {}), ...(expectedFundingTermsHash ? { expectedFundingTermsHash } : {}) });
        if (recorded.replayed) return { abort: true, reason: "authorization_already_claimed_reconcile" };
        claimedNetwork = network;
        attemptId = recorded.attemptId; authorizationNonce = authorization.authorizationNonce;
      } catch {
        // x402 treats thrown before-settlement hook errors as non-fatal. Abort explicitly.
        return { abort: true, reason: "payment_claim_refused" };
      }
    });
    server.onAfterSettle(async ({ result }) => {
      if (!attemptId || !result.success || !result.transaction || !authorizationNonce || result.network !== claimedNetwork) return;
      settledBy = facilitator.id;
      console.info("x402_settlement", { facilitator: settledBy, network: claimedNetwork, txHash: result.transaction, orderId: order._id });
      // Persist the hash before RPC polling. A polling failure leaves the attempt reconciling.
      try { await db.mutation(api.payments.recordTransaction, { serviceSecret, attemptId, txHash: result.transaction }); }
      catch { console.error("x402_transaction_record_pending", { attemptId, txHash: result.transaction }); }
    });
    // Bare config intentionally protects every path passed into this single POST route.
    const response = await withX402(async () => NextResponse.json({ orderId: order._id, fundingStatus: "settlement_pending" }),
      fundingRouteConfig(order.budgetAtomic, orderTreasury, orderSolanaTreasury ? { treasuryAddress: orderSolanaTreasury, orderId: order._id } : undefined), server)(request);
    response.headers.set("X-Skarl-Facilitator", facilitator.id);
    if (!attemptId) return response;
    const current = await db.query(api.payments.fundingStatus, { serviceSecret, orderId, demoIdentity });
    if (current.attempt?.txHash && current.intent) {
      try {
        const expected = { fromAddress: current.intent.buyerWalletAddress, toAddress: current.intent.recipientAddress, amountAtomic: current.intent.amountAtomic };
        const observation = current.intent.network === SOLANA_PAYMENT_NETWORK
          ? await observeSolanaTransfer(current.attempt.txHash, { ...expected, authorizationNonce: authorizationNonce!, orderId: order._id })
          : await observeTransfer(current.attempt.txHash as Hash, expected, authorizationNonce);
        const confirmation = await db.mutation(api.payments.confirmFunding, { serviceSecret, attemptId, authorizationNonce: authorizationNonce!, observation,
          ...(idempotencyKey ? { idempotencyKey } : {}) });
        if (confirmation?.ok === false) throw new Error(confirmation.code);
        const confirmed = paymentJson({ orderId: order._id, fundingStatus: "confirmed", txHash: observation.txHash, settledBy,
          network: observation.network, explorerUrl: paymentRail(observation.network).explorerTx(observation.txHash) });
        const paymentResponse = response.headers.get("PAYMENT-RESPONSE");
        if (paymentResponse) confirmed.headers.set("PAYMENT-RESPONSE", paymentResponse);
        confirmed.headers.set("X-Skarl-Facilitator", facilitator.id);
        return confirmed;
      } catch { /* Unknown outcome. The durable attempt must be reconciled, never repaid. */ }
    }
    const pending = paymentJson({ orderId: order._id, fundingStatus: "settlement_pending", attemptId, settledBy, network: claimedNetwork,
      txHash: current.attempt?.txHash ?? null, reconcileUrl: "/api/payments/reconcile" }, 202);
    const paymentResponse = response.headers.get("PAYMENT-RESPONSE");
    if (paymentResponse) pending.headers.set("PAYMENT-RESPONSE", paymentResponse);
    pending.headers.set("X-Skarl-Facilitator", facilitator.id);
    return pending;
  } catch (error) { return paymentError(error); }
}
