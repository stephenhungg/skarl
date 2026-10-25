/** Canonical demo payment configuration: Base Sepolia testnet USDC for x402. Mainnet is intentionally not enabled. */
/** CAIP-2 identifier for Base Sepolia (EVM chain ID 84532). */
export const PAYMENT_NETWORK = "eip155:84532" as const;
export const PAYMENT_CHAIN_ID = 84532 as const;
/** Circle's USDC on Base Sepolia: https://developers.circle.com/stablecoins/usdc-contract-addresses */
export const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
export const USDC_DECIMALS = 6 as const;
