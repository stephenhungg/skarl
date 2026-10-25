import { v, type VLiteral } from "convex/values";
import {
  fundingStatuses,
  orderStatuses,
  payoutStatuses,
  submissionStatuses,
} from "../packages/contracts/src/index";
import { PAYMENT_NETWORK, SOLANA_PAYMENT_NETWORK, SOLANA_USDC_MINT, USDC_ADDRESS } from "../packages/contracts/src/chain";
import { EVALUATION_VIDEO_MODELS } from "./lib/verificationReport";

// Storage validators constrain types. Business invariants still require mutations.

type Literals<T extends readonly string[]> = { -readonly [K in keyof T]: VLiteral<T[K]> };

/** Build a union validator from a shared `as const` list so storage cannot drift from the contracts. */
function literalUnion<const T extends readonly [string, string, ...string[]]>(values: T) {
  return v.union(...(values.map((value) => v.literal(value)) as Literals<T>));
}

export const network = v.literal(PAYMENT_NETWORK);
export const usdcToken = v.literal(USDC_ADDRESS);
/** Funding and its evidence may use either rail; orders and outgoing payments remain Base only. */
export const fundingNetwork = v.union(v.literal(PAYMENT_NETWORK), v.literal(SOLANA_PAYMENT_NETWORK));
export const fundingToken = v.union(v.literal(USDC_ADDRESS), v.literal(SOLANA_USDC_MINT));
/** EVM 0x address. Mutations must validate and lowercase before writing so equality checks hold. */
export const evmAddress = v.string();
export const amountAtomic = v.int64();
export const evaluationVideoModel = literalUnion(EVALUATION_VIDEO_MODELS);
/** Whole-number counters that feed bigint budget and capacity arithmetic. */
export const count = v.int64();

/**
 * Convex `identity.tokenIdentifier` (issuer + subject). Store this, not a bare
 * subject, wherever identities are compared (for example self-approval checks).
 */
export const tokenIdentifier = v.string();

export const actor = v.object({
  kind: v.union(v.literal("human"), v.literal("service")),
  // tokenIdentifier for humans, service ID for services.
  identity: v.string(),
});

export const membershipRole = v.union(
  v.literal("buyer"),
  v.literal("contributor"),
  v.literal("controller"),
  v.literal("finance-agent"),
);

export const orderStatus = literalUnion(orderStatuses);
export const submissionStatus = literalUnion(submissionStatuses);
/** Buyer funding lifecycle for `paymentIntents`. */
export const fundingStatus = literalUnion(fundingStatuses);
/** Outgoing payout/refund lifecycle for `paymentCommands`. */
export const payoutStatus = literalUnion(payoutStatuses);

// TODO(contracts owner): move these storage lifecycles into packages/contracts
// once a client needs them; they are not exchanged across service boundaries yet.
/** Compensation obligation lifecycle. `paid` requires a confirmed chain observation. */
export const payableStatus = v.union(
  v.literal("accrued"),
  v.literal("payout_in_progress"),
  v.literal("paid"),
  v.literal("reversed"),
);
/** One broadcast attempt. A timeout stays `reconciling`; it is not `failed`. */
export const attemptStatus = v.union(
  v.literal("prepared"),
  v.literal("submitted"),
  v.literal("reconciling"),
  v.literal("confirmed"),
  v.literal("finalized"),
  v.literal("failed"),
);

export const ledgerAccount = v.union(
  v.literal("asset:usdc"),
  v.literal("asset:evidence_usdc"),
  v.literal("liability:evidence_receipts"),
  v.literal("revenue:evidence_sales"),
  v.literal("liability:customer_prepayments"),
  v.literal("liability:contributor_payables"),
  v.literal("liability:customer_refunds"),
  v.literal("revenue:dataset_sales"),
  v.literal("expense:contributor_acquisition"),
);

export const journalSide = v.union(v.literal("debit"), v.literal("credit"));

/**
 * Mirrors the verification report schema: only completed inference may
 * recommend acceptance. Scaffold output and any non-completed pipeline are
 * stored as `needs_review` and can never carry `accept`. Spread each variant
 * into its own `v.object` so the table validator is a union.
 */
export const completedInferenceOutcome = {
  implementation: v.literal("inference"),
  pipelineStatus: v.literal("completed"),
  recommendation: v.union(
    v.literal("accept"),
    v.literal("request_correction"),
    v.literal("needs_review"),
  ),
};

export const reviewOnlyOutcome = {
  implementation: v.union(v.literal("inference"), v.literal("scaffold")),
  pipelineStatus: v.union(
    v.literal("completed"),
    v.literal("needs_review"),
    v.literal("failed"),
    v.literal("ml_unavailable"),
  ),
  recommendation: v.literal("needs_review"),
};
