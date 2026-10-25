/** Canonical testnet payment configuration. Base is primary; payouts remain Base only. */
/** CAIP-2 identifier for Base Sepolia (EVM chain ID 84532). */
export const PAYMENT_NETWORK = "eip155:84532" as const;
export const PAYMENT_CHAIN_ID = 84532 as const;
/** Circle's USDC on Base Sepolia: https://developers.circle.com/stablecoins/usdc-contract-addresses */
export const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
export const USDC_DECIMALS = 6 as const;

/** Solana Devnet is an optional funding rail, never a payout target. */
export const SOLANA_PAYMENT_NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" as const;
export const SOLANA_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" as const;

/** Insertion order is deliberate: x402 offers Base first. */
export const PAYMENT_RAILS = {
  [PAYMENT_NETWORK]: {
    token: USDC_ADDRESS, decimals: USDC_DECIMALS,
    explorerTx: (hash: string) => `https://sepolia.basescan.org/tx/${encodeURIComponent(hash)}`,
  },
  [SOLANA_PAYMENT_NETWORK]: {
    token: SOLANA_USDC_MINT, decimals: USDC_DECIMALS,
    explorerTx: (signature: string) => `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`,
  },
} as const;
export type PaymentNetwork = keyof typeof PAYMENT_RAILS;

export function paymentRail(network: string) {
  if (network !== PAYMENT_NETWORK && network !== SOLANA_PAYMENT_NETWORK) throw new Error("unsupported_payment_network");
  return PAYMENT_RAILS[network];
}
