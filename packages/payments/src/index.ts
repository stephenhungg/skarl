import { PAYMENT_CHAIN_ID, PAYMENT_NETWORK, USDC_ADDRESS, USDC_DECIMALS } from "@skarl/contracts/chain";

export { PAYMENT_CHAIN_ID, PAYMENT_NETWORK, USDC_ADDRESS, USDC_DECIMALS };

/** Capability inventory only. Runtime configuration and receipt checks remain mandatory. */
export function getPaymentRuntimeStatus() {
  return {
    implemented: true as const,
    network: PAYMENT_NETWORK,
    usdcAddress: USDC_ADDRESS,
    decimals: USDC_DECIMALS,
    fundingAvailable: false as const,
    payoutsAvailable: false as const,
    refundsAvailable: false as const,
    reason: "Funding and browser payout adapters are implemented; configure the payment service and treasury before use. Refunds are deferred.",
  };
}

export class PaymentIntegrationNotConfiguredError extends Error {
  constructor() {
    super(getPaymentRuntimeStatus().reason);
    this.name = "PaymentIntegrationNotConfiguredError";
  }
}

/** Legacy generic entry point stays closed: use the explicit funding or approved-payout adapters. */
export function requirePaymentRuntime(): never {
  throw new PaymentIntegrationNotConfiguredError();
}

export function assertPaymentNetwork(network: string): asserts network is typeof PAYMENT_NETWORK {
  if (network !== PAYMENT_NETWORK) throw new Error("Skarl currently permits only its configured Base Sepolia network");
}

/**
 * Check network, asset, and decimals together; the right chain with a look-alike token is still the wrong asset.
 * EVM addresses are hex and case-insensitive (mixed case is only an EIP-55 checksum), so compare lowercased.
 */
export function assertPaymentAsset(network: string, asset: string, decimals: number): void {
  assertPaymentNetwork(network);
  if (typeof asset !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(asset) || asset.toLowerCase() !== USDC_ADDRESS.toLowerCase()) {
    throw new Error("Skarl currently permits only Circle's Base Sepolia USDC contract");
  }
  if (decimals !== USDC_DECIMALS) throw new Error("Base Sepolia USDC must use six decimals");
}

export { fundingRouteConfig, parseFundingAuthorization } from "./funding.ts";
export { validateTransfer, reconcilePayments, chainIdentity } from "./reconciliation.ts";
