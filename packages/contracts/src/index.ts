export { PAYMENT_CHAIN_ID, PAYMENT_NETWORK, USDC_ADDRESS, USDC_DECIMALS } from "./chain.ts";
export const orderStatuses = ["draft", "awaiting_funding", "funded", "collecting", "fulfilled", "cancelling", "refunded", "closed", "funding_failed"] as const;
export const submissionStatuses = ["uploading", "queued", "analysing", "needs_review", "needs_correction", "accepted", "rejected"] as const;
/**
 * Buyer funding lifecycle (see the payments docs). A timeout is not `failed`: an unknown outcome stays
 * `settlement_pending` or moves to `reconciliation_required` until chain history settles it.
 */
export const fundingStatuses = ["awaiting_payment", "verification_pending", "settlement_pending", "confirmed", "failed", "reconciliation_required"] as const;
/**
 * Outgoing payout/refund transfer lifecycle. There is deliberately no `expired` state: a transaction whose blockhash
 * expired is `failed` only once history shows it did not land, otherwise it stays `reconciling`.
 */
export const payoutStatuses = ["proposed", "approved", "submitted", "pending", "reconciling", "confirmed", "finalized", "failed", "cancelled"] as const;
/**
 * @deprecated Combined legacy enum kept for existing Convex validators. Prefer `fundingStatuses` or `payoutStatuses`.
 * `expired` must never be treated as proof of failure; it requires the same evidence as `failed`.
 */
export const paymentStatuses = ["proposed", "approved", "submitted", "pending", "reconciling", "confirmed", "finalized", "failed", "expired", "cancelled"] as const;
export type OrderStatus = typeof orderStatuses[number];
export type SubmissionStatus = typeof submissionStatuses[number];
export type FundingStatus = typeof fundingStatuses[number];
export type PayoutStatus = typeof payoutStatuses[number];
export type PaymentStatus = typeof paymentStatuses[number];

/** Largest micro-USDC amount representable in Convex `v.int64()` storage. */
export const MAX_ATOMIC_USDC = (1n << 63n) - 1n;
declare const atomicUsdcBrand: unique symbol;
/** USDC is six decimal places; JSON transports integer atomic units (micro-USDC) as canonical decimal strings. */
export type AtomicUsdcString = string & { readonly [atomicUsdcBrand]: true };

/**
 * Parse a JSON-boundary atomic amount ("7500000" = 7.5 USDC). Unlike a dollar parser, it never scales the input,
 * so a micro-unit string cannot be inflated a millionfold. Rejects signs, leading zeros, exponents and whitespace.
 */
export function parseAtomicUsdc(value: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error("Atomic USDC must be a canonical unsigned integer string");
  }
  const amount = BigInt(value);
  if (amount > MAX_ATOMIC_USDC) throw new Error("Atomic USDC exceeds signed Int64 storage range");
  return amount;
}

export function toAtomicUsdcString(amount: bigint): AtomicUsdcString {
  if (typeof amount !== "bigint" || amount < 0n || amount > MAX_ATOMIC_USDC) {
    throw new Error("Atomic USDC must be a non-negative bigint within Int64 range");
  }
  return amount.toString() as AtomicUsdcString;
}
