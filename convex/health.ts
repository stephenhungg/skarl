import { queryGeneric } from "convex/server";
import { v } from "convex/values";
import { SOLANA_DEVNET_NETWORK } from "../packages/contracts/src/solana";

/** Public, non-sensitive scaffold check. It does not prove payment readiness. */
export const status = queryGeneric({
  args: {},
  returns: v.object({
    service: v.literal("skarl"),
    stage: v.literal("scaffold"),
    network: v.literal(SOLANA_DEVNET_NETWORK),
    financialMutationsImplemented: v.literal(false),
    workerGatewayImplemented: v.literal(false),
    livePaymentsImplemented: v.literal(false),
  }),
  handler: () => ({
    service: "skarl" as const,
    stage: "scaffold" as const,
    network: SOLANA_DEVNET_NETWORK,
    financialMutationsImplemented: false as const,
    workerGatewayImplemented: false as const,
    livePaymentsImplemented: false as const,
  }),
});
