import { authenticateConvexRequest } from "../../../../lib/auth/server";
import { walletMcpSendForClaim } from "../../../../../../packages/payments/src/wallet-mcp";
import { type NextRequest } from "next/server";
import { api, paymentError, paymentJson, paymentService, treasuryAddress, type Id } from "../../../../lib/payments/server";
import { observeTransfer } from "../../../../lib/payments/chain";
import type { Hash } from "viem";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    // Browser entry point; demo selectors remain explicitly impersonable demo policy.
    const origin = request.headers.get("origin");
    if (origin && origin !== request.nextUrl.origin) return paymentJson({ error: "cross_origin_refused" }, 403);
    const body = await request.json();
    if (typeof body.intentId !== "string" || typeof body.demoIdentity !== "string") return paymentJson({ error: "intent_and_identity_required" }, 400);
    const { db, serviceSecret } = paymentService();
    await authenticateConvexRequest(db, request);
    const intentId = body.intentId as Id<"paymentIntents">;
    if (body.action === "claim" || body.action === "claim_mcp") {
      if (typeof body.senderAddress !== "string") return paymentJson({ error: "sender_required" }, 400);
      const claim = await db.mutation(api.payments.claimPayout, { serviceSecret, intentId, demoIdentity: body.demoIdentity,
        senderAddress: body.senderAddress, treasuryAddress: treasuryAddress(), claimId: crypto.randomUUID() });
      return paymentJson(body.action === "claim_mcp" ? { ...claim, mcp: walletMcpSendForClaim(claim) } : claim);
    }
    if (body.action !== "submitted" || typeof body.claimId !== "string" || typeof body.txHash !== "string" ||
      !/^0x[0-9a-fA-F]{64}$/.test(body.txHash)) return paymentJson({ error: "claim_and_hash_required" }, 400);
    const { intent, attempt } = await db.query(api.payments.payoutAttempt, { serviceSecret, intentId,
      demoIdentity: body.demoIdentity, claimId: body.claimId });
    await db.mutation(api.payments.recordTransaction, { serviceSecret, attemptId: attempt._id, txHash: body.txHash });
    try {
      const observation = await observeTransfer(body.txHash as Hash, { fromAddress: attempt.payerAddress!,
        toAddress: intent.recipientAddress, amountAtomic: intent.amountAtomic });
      await db.mutation(api.payments.recordPayoutObservation, { serviceSecret, attemptId: attempt._id, observation });
      return paymentJson({ status: "confirmed", txHash: body.txHash, logIndex: observation.logIndex });
    } catch {
      return paymentJson({ status: "reconciling", txHash: body.txHash, message: "Report this same hash again; do not send again." }, 202);
    }
  } catch (error) { return paymentError(error); }
}
