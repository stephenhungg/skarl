import { SOLANA_DEVNET_NETWORK, SOLANA_DEVNET_USDC_MINT, USDC_DECIMALS } from "@skarl/contracts/solana";

export { SOLANA_DEVNET_NETWORK, SOLANA_DEVNET_USDC_MINT, USDC_DECIMALS };

/** A scaffold status, never a successful payment or evidence of a configured provider. */
export function getPaymentRuntimeStatus() {
  return {
    implemented: false as const,
    network: SOLANA_DEVNET_NETWORK,
    usdcMint: SOLANA_DEVNET_USDC_MINT,
    decimals: USDC_DECIMALS,
    fundingAvailable: false as const,
    payoutsAvailable: false as const,
    refundsAvailable: false as const,
    reason: "The Solana Devnet x402 facilitator, signer, settlement verification, payouts, and refunds are not implemented.",
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

export function assertDevnetNetwork(network: string): asserts network is typeof SOLANA_DEVNET_NETWORK {
  if (network !== SOLANA_DEVNET_NETWORK) throw new Error("Skarl currently permits only its configured Solana Devnet network");
}
