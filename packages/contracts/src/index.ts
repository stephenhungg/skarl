export { SOLANA_DEVNET_NETWORK, SOLANA_DEVNET_USDC_MINT, USDC_DECIMALS } from "./solana.ts";
export const orderStatuses = ["draft", "awaiting_funding", "funded", "collecting", "fulfilled", "cancelling", "refunded", "closed", "funding_failed"] as const;
export const submissionStatuses = ["uploading", "queued", "analysing", "needs_review", "needs_correction", "accepted", "rejected"] as const;
export const paymentStatuses = ["proposed", "approved", "submitted", "pending", "reconciling", "confirmed", "finalized", "failed", "expired", "cancelled"] as const;
export type OrderStatus = typeof orderStatuses[number];
export type SubmissionStatus = typeof submissionStatuses[number];
export type PaymentStatus = typeof paymentStatuses[number];
/** USDC is six decimal places; JSON transports integer atomic units as strings. */
export type AtomicUsdcString = string;
