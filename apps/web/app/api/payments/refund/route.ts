import { makeFunctionReference } from "convex/server";
import { type NextRequest } from "next/server";
import { api, paymentError, paymentJson, paymentService, treasuryAddress, type Id } from "../../../../lib/payments/server";
import { observeTransfer } from "../../../../lib/payments/chain";
import type { Hash } from "viem";
const refunds = { claim: makeFunctionReference<"mutation">("refunds:claim"), attempt: makeFunctionReference<"query">("refunds:attempt"),
  recordObservation: makeFunctionReference<"mutation">("refunds:recordObservation") };
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== request.nextUrl.origin) return paymentJson({ error: "cross_origin_refused" }, 403);
    const body = await request.json();
    if (typeof body.intentId !== "string" || typeof body.demoIdentity !== "string") return paymentJson({ error: "command_and_identity_required" }, 400);
    // intentId is the browser transfer client's opaque identifier; refunds bind a paymentCommands ID.
    const commandId = body.intentId as Id<"paymentCommands">;
    const { db, serviceSecret } = paymentService();
    if (body.action === "claim") {
      if (typeof body.senderAddress !== "string") return paymentJson({ error: "sender_required" }, 400);
      return paymentJson(await db.mutation(refunds.claim, { serviceSecret, commandId, demoIdentity: body.demoIdentity,
        senderAddress: body.senderAddress, treasuryAddress: treasuryAddress(), claimId: crypto.randomUUID() }));
    }
    if (body.action !== "submitted" || typeof body.claimId !== "string" || typeof body.txHash !== "string" ||
      !/^0x[0-9a-fA-F]{64}$/.test(body.txHash)) return paymentJson({ error: "claim_and_hash_required" }, 400);
    const { command, attempt } = await db.query(refunds.attempt, { serviceSecret, commandId,
      demoIdentity: body.demoIdentity, claimId: body.claimId });
    await db.mutation(api.payments.recordTransaction, { serviceSecret, attemptId: attempt._id, txHash: body.txHash });
    try {
      const observation = await observeTransfer(body.txHash as Hash, { fromAddress: attempt.payerAddress!,
        toAddress: command.recipientAddress, amountAtomic: command.amountAtomic });
      await db.mutation(refunds.recordObservation, { serviceSecret, attemptId: attempt._id, observation });
      return paymentJson({ status: "confirmed", txHash: body.txHash, logIndex: observation.logIndex });
    } catch {
      return paymentJson({ status: "reconciling", txHash: body.txHash, message: "Report this same hash again; do not send again." }, 202);
    }
  } catch (error) { return paymentError(error); }
}
