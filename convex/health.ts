import { queryGeneric } from "convex/server";
import { v } from "convex/values";
import { PAYMENT_NETWORK } from "../packages/contracts/src/chain";

/** Public, non-sensitive scaffold check. It does not prove payment readiness. */
export const status = queryGeneric({
  args: {},
  returns: v.object({
    service: v.literal("skarl"),
    stage: v.literal("scaffold"),
    network: v.literal(PAYMENT_NETWORK),
    financialMutationsImplemented: v.literal(false),
    workerGatewayImplemented: v.literal(false),
    livePaymentsImplemented: v.literal(false),
  }),
  handler: () => ({
    service: "skarl" as const,
    stage: "scaffold" as const,
    network: PAYMENT_NETWORK,
    financialMutationsImplemented: false as const,
    workerGatewayImplemented: false as const,
    livePaymentsImplemented: false as const,
  }),
});
