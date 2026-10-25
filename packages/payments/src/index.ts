import { PAYMENT_CHAIN_ID, PAYMENT_NETWORK, USDC_ADDRESS, USDC_DECIMALS } from "@skarl/contracts/chain";

export { PAYMENT_CHAIN_ID, PAYMENT_NETWORK, USDC_ADDRESS, USDC_DECIMALS };

/** A scaffold status, never a successful payment or evidence of a configured provider. */
export function getPaymentRuntimeStatus() {
  return {
    implemented: false as const,
    network: PAYMENT_NETWORK,
    usdcAddress: USDC_ADDRESS,
    decimals: USDC_DECIMALS,
    fundingAvailable: false as const,
    payoutsAvailable: false as const,
    refundsAvailable: false as const,
    reason: "The Base Sepolia x402 facilitator, signer, settlement verification, payouts, and refunds are not implemented.",
  };
}

export class PaymentIntegrationNotConfiguredError extends Error {
  constructor() {
    super(getPaymentRuntimeStatus().reason);
    this.name = "PaymentIntegrationNotConfiguredError";
  }
}

/** Every attempted runtime payment path must fail closed until an adapter is implemented and tested. */
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
