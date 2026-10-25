import { webConfig } from "../../../../lib/config";
import { DEMO_BUYER } from "../../../../lib/auth/identities";
import { authenticateConvexRequest } from "../../../../lib/auth/server";
import { type NextRequest } from "next/server";
import { api, paymentError, paymentJson, paymentService } from "../../../../lib/payments/server";
import { observeTransfer, publicClient, usdcEvents } from "../../../../lib/payments/chain";
import { observeSolanaTransfer } from "../../../../../../packages/payments/src/solana";
import { SOLANA_PAYMENT_NETWORK, paymentRail, USDC_ADDRESS } from "@skarl/contracts/chain";
import type { Hash, Address } from "viem";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Recovery only: never verifies a new payment, signs, or invokes facilitator settlement. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (typeof body.orderId !== "string") return paymentJson({ error: "orderId_required" }, 400);
    const { db, serviceSecret } = paymentService();
    await authenticateConvexRequest(db, request);
    const { order, intent, attempt } = await db.query(api.payments.fundingStatus, { serviceSecret, orderId: body.orderId,
      demoIdentity: body.demoIdentity || DEMO_BUYER });
    if (!intent || !attempt || !attempt.authorizationNonce) return paymentJson({ error: "funding_attempt_required" }, 409);
    if (intent.status === "confirmed") return paymentJson({ fundingStatus: "confirmed", network: intent.network, txHash: attempt.txHash,
      explorerUrl: attempt.txHash ? paymentRail(intent.network).explorerTx(attempt.txHash) : null });
    let txHash = attempt.txHash ?? body.txHash;
    if (!txHash && intent.network !== SOLANA_PAYMENT_NETWORK) {
      // A facilitator response can be lost before its hash is persisted. Recover via the claimed nonce.
      // Bound public RPC work to the recent ~5.5 hours; older attempts need an explicit explorer hash.
      const client = publicClient();
      const head = await client.getBlockNumber();
      const lookback = webConfig.reconcileLookbackBlocks;
      const floor = head > lookback ? head - lookback : 0n;
      for (let end = head; end >= floor;) {
        const start = end - webConfig.reconcileChunkBlocks + 1n > floor ? end - webConfig.reconcileChunkBlocks + 1n : floor;
        const logs = await client.getLogs({ address: USDC_ADDRESS, event: usdcEvents[1],
          args: { authorizer: intent.buyerWalletAddress as Address, nonce: attempt.authorizationNonce as Hash }, fromBlock: start, toBlock: end });
        if (logs.length) { txHash = logs[0]!.transactionHash; break; }
        if (start === floor) break;
        end = start - 1n;
      }
    }
    if (typeof txHash !== "string" || !(intent.network === SOLANA_PAYMENT_NETWORK ? /^[1-9A-HJ-NP-Za-km-z]{64,88}$/ : /^0x[0-9a-fA-F]{64}$/).test(txHash)) {
      return paymentJson({ fundingStatus: "settlement_pending", network: intent.network, error: "transfer_not_observed_do_not_repay" }, 202);
    }
    try {
      const expected = { fromAddress: intent.buyerWalletAddress, toAddress: intent.recipientAddress, amountAtomic: intent.amountAtomic };
      const observation = intent.network === SOLANA_PAYMENT_NETWORK
        ? await observeSolanaTransfer(txHash, { ...expected, authorizationNonce: attempt.authorizationNonce, orderId: order._id })
        : await observeTransfer(txHash as Hash, expected, attempt.authorizationNonce);
      // Bind caller-supplied recovery hashes ONLY after verifying the nonce and exact transfer.
      const confirmation = await db.mutation(api.payments.confirmFunding, { serviceSecret, attemptId: attempt._id,
        authorizationNonce: attempt.authorizationNonce, observation });
      if (confirmation?.ok === false) return paymentJson({ fundingStatus: "reconciliation_exception", network: intent.network,
        txHash, error: confirmation.code }, 409);
      return paymentJson({ fundingStatus: "confirmed", txHash, network: intent.network, explorerUrl: paymentRail(intent.network).explorerTx(txHash) });
    } catch {
      return paymentJson({ fundingStatus: "settlement_pending", network: intent.network, txHash: attempt.txHash ?? null,
        error: "transfer_not_confirmed_do_not_repay" }, 202);
    }
  } catch (error) { return paymentError(error); }
}
