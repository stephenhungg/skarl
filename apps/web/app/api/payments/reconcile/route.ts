import { type NextRequest } from "next/server";
import { api, paymentError, paymentJson, paymentService } from "../../../../lib/payments/server";
import { observeTransfer, publicClient, usdcEvents } from "../../../../lib/payments/chain";
import { USDC_ADDRESS } from "@skarl/contracts/chain";
import type { Hash, Address } from "viem";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Recovery only: never verifies a new payment, signs, or invokes facilitator settlement. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (typeof body.orderId !== "string") return paymentJson({ error: "orderId_required" }, 400);
    const { db, serviceSecret } = paymentService();
    const { intent, attempt } = await db.query(api.payments.fundingStatus, { serviceSecret, orderId: body.orderId,
      demoIdentity: body.demoIdentity || "buyer" });
    if (!intent || !attempt || !attempt.authorizationNonce) return paymentJson({ error: "funding_attempt_required" }, 409);
    if (intent.status === "confirmed") return paymentJson({ fundingStatus: "confirmed", txHash: attempt.txHash });
    let txHash = attempt.txHash ?? body.txHash;
    if (!txHash) {
      // A facilitator response can be lost before its hash is persisted. Recover via the claimed nonce.
      // Bound public RPC work to the recent ~5.5 hours; older attempts need an explicit explorer hash.
      const client = publicClient();
      const head = await client.getBlockNumber();
      const lookback = 10_000n;
      const floor = head > lookback ? head - lookback : 0n;
      for (let end = head; end >= floor;) {
        const start = end - 999n > floor ? end - 999n : floor;
        const logs = await client.getLogs({ address: USDC_ADDRESS, event: usdcEvents[1],
          args: { authorizer: intent.buyerWalletAddress as Address, nonce: attempt.authorizationNonce as Hash }, fromBlock: start, toBlock: end });
        if (logs.length) { txHash = logs[0]!.transactionHash; break; }
        if (start === floor) break;
        end = start - 1n;
      }
    }
    if (typeof txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      return paymentJson({ fundingStatus: "settlement_pending", error: "transfer_not_observed_do_not_repay" }, 202);
    }
    try {
      const observation = await observeTransfer(txHash as Hash, { fromAddress: intent.buyerWalletAddress,
        toAddress: intent.recipientAddress, amountAtomic: intent.amountAtomic }, attempt.authorizationNonce);
      // Bind caller-supplied recovery hashes ONLY after verifying the nonce and exact transfer.
      await db.mutation(api.payments.confirmFunding, { serviceSecret, attemptId: attempt._id,
        authorizationNonce: attempt.authorizationNonce, observation });
      return paymentJson({ fundingStatus: "confirmed", txHash, explorerUrl: `https://sepolia.basescan.org/tx/${txHash}` });
    } catch {
      return paymentJson({ fundingStatus: "settlement_pending", txHash: attempt.txHash ?? null,
        error: "transfer_not_confirmed_do_not_repay" }, 202);
    }
  } catch (error) { return paymentError(error); }
}
