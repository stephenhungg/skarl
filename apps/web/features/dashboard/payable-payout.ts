import type { Id } from "../../../../convex/_generated/dataModel";
import { getPayoutRecovery, PayoutExecutionError, type PayoutRecovery } from "../../lib/payments/payout";
import type { PayableRow } from "./data";

type PayoutIntent = Pick<NonNullable<PayableRow["intent"]>, "_id" | "intentId">;

/** Browser execution/claim storage use the Convex document ID, never the business event key. */
function documentId(intent: PayoutIntent): Id<"paymentIntents"> {
  if (!intent || typeof intent !== "object" || typeof intent._id !== "string" || !intent._id || intent._id === intent.intentId) {
    throw new PayoutExecutionError("A stored payout intent document is required before signing or recovery.");
  }
  return intent._id;
}

export function executePayablePayout<Result>(intent: PayoutIntent, execute: (intentId: Id<"paymentIntents">) => Promise<Result>) {
  return execute(documentId(intent));
}

export function getPayablePayoutRecovery(intent: PayoutIntent, cached?: PayoutRecovery): PayoutRecovery | null {
  const intentId = documentId(intent);
  // A card can outlive a proposal change. Never reconcile another intent's cached claim.
  const recovery = cached?.intentId === intentId ? cached : getPayoutRecovery(intentId);
  if (recovery?.paymentKind) throw new PayoutExecutionError("Saved recovery belongs to another payment kind; reconcile its original command.", recovery);
  return recovery;
}
