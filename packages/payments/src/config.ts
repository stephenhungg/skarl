/** Shared server/operator payment defaults. Integer micro-USDC only. */
import { MAX_ATOMIC_USDC } from "@skarl/contracts";

function positiveAtomic(name: string, fallback: string): bigint {
  const value = process.env[name] ?? fallback;
  if (!/^[1-9][0-9]*$/.test(value) || BigInt(value) > MAX_ATOMIC_USDC) throw new Error(`${name} must be positive integer micro-USDC within Int64`);
  return BigInt(value);
}
function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`);
  return value;
}
export const paymentConfig = {
  get cumulativeSpendWindowMs(): number { return positiveInteger("SKARL_CDP_SPEND_WINDOW_MS", 86_400_000); },
  get solanaFaucetMaxClaims(): number { return positiveInteger("SKARL_SOLANA_FAUCET_MAX_CLAIMS", 2); },
  get requiredConfirmations(): number { return positiveInteger("SKARL_REQUIRED_CONFIRMATIONS", 2); },
  get publicOrderIpLimit(): number { return positiveInteger("SKARL_PUBLIC_ORDER_IP_LIMIT", 3); },
  get publicOrderGlobalLimit(): number { return positiveInteger("SKARL_PUBLIC_ORDER_GLOBAL_LIMIT", 30); },
  get publicOrderWindowMs(): number { return positiveInteger("SKARL_PUBLIC_ORDER_WINDOW_MS", 3_600_000); },
  get mediaTokenTtlMs(): number { return positiveInteger("SKARL_MEDIA_TOKEN_TTL_MS", 300_000); },
  get fundingMaxTimeoutSeconds(): number { return positiveInteger("SKARL_FUNDING_TIMEOUT_SECONDS", 300); },
  get solanaFundingMaxTimeoutSeconds(): number { return positiveInteger("SKARL_SOLANA_FUNDING_TIMEOUT_SECONDS", 60); },
  get facilitatorCacheTtlMs(): number { return positiveInteger("SKARL_FACILITATOR_CACHE_TTL_MS", 30_000); },
  get evidencePriceAtomic(): bigint { return positiveAtomic("SKARL_EVIDENCE_PRICE_ATOMIC", "250000"); },
  get cumulativeSpendAtomic(): bigint { return positiveAtomic("SKARL_CDP_MAX_CUMULATIVE_ATOMIC", "20000000"); },
  get buyerAutoPayCapAtomic(): string { return positiveAtomic("SKARL_BUYER_AUTO_PAY_CAP_ATOMIC", "1000000").toString(); },
  get buyerIdentity(): string { return process.env.SKARL_BUYER_IDENTITY || "buyer"; },
  get evmAccountName(): string { return process.env.SKARL_CDP_BUYER_ACCOUNT || "skarl-buyer-sepolia"; },
  get solanaAccountName(): string { return process.env.SKARL_CDP_SOLANA_BUYER_ACCOUNT || "skarl-buyer-devnet"; },
  get appUrl(): string { return process.env.SKARL_APP_URL || "http://localhost:3000"; },
};
