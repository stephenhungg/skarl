import { v } from "convex/values";
import {
  SOLANA_DEVNET_NETWORK,
  SOLANA_DEVNET_USDC_MINT,
} from "../packages/contracts/src/solana";

// Storage validators constrain types. Business invariants still require mutations.
export const network = v.literal(SOLANA_DEVNET_NETWORK);
export const usdcMint = v.literal(SOLANA_DEVNET_USDC_MINT);
export const amountAtomic = v.int64();

export const actor = v.object({
  kind: v.union(v.literal("human"), v.literal("service")),
  identity: v.string(),
});

export const membershipRole = v.union(
  v.literal("buyer"),
  v.literal("contributor"),
  v.literal("controller"),
);

export const orderStatus = v.union(
  v.literal("draft"),
  v.literal("awaiting_funding"),
  v.literal("funded"),
  v.literal("collecting"),
  v.literal("fulfilled"),
  v.literal("cancelling"),
  v.literal("refunded"),
  v.literal("closed"),
  v.literal("funding_failed"),
);

export const submissionStatus = v.union(
  v.literal("uploading"),
  v.literal("queued"),
  v.literal("analysing"),
  v.literal("needs_review"),
  v.literal("needs_correction"),
  v.literal("accepted"),
  v.literal("rejected"),
);

export const paymentStatus = v.union(
  v.literal("proposed"),
  v.literal("approved"),
  v.literal("submitted"),
  v.literal("pending"),
  v.literal("reconciling"),
  v.literal("confirmed"),
  v.literal("finalized"),
  v.literal("failed"),
  v.literal("expired"),
  v.literal("cancelled"),
);

export const commitment = v.union(
  v.literal("processed"),
  v.literal("confirmed"),
  v.literal("finalized"),
);

export const pipelineStatus = v.union(
  v.literal("completed"),
  v.literal("needs_review"),
  v.literal("failed"),
  v.literal("ml_unavailable"),
);

export const recommendation = v.union(
  v.literal("accept"),
  v.literal("request_correction"),
  v.literal("needs_review"),
);

export const ledgerAccount = v.union(
  v.literal("asset:usdc"),
  v.literal("liability:customer_prepayments"),
  v.literal("liability:contributor_payables"),
  v.literal("liability:customer_refunds"),
  v.literal("revenue:dataset_sales"),
  v.literal("expense:contributor_acquisition"),
);
