import { PAYMENT_NETWORK, SOLANA_PAYMENT_NETWORK, SOLANA_USDC_MINT, USDC_ADDRESS } from "@skarl/contracts/chain";
import { MAX_ATOMIC_USDC } from "@skarl/contracts";
import type { RouteConfig } from "@x402/core/server";

/** AssetAmount uses micro-units directly, without decimal-dollar parsing. */
export function fundingRouteConfig(amountAtomic: bigint, treasuryAddress: string, solana?: { treasuryAddress: string; orderId: string }): RouteConfig {
  if (amountAtomic <= 0n || amountAtomic > MAX_ATOMIC_USDC) throw new Error("invalid_budget");
  if (!/^0x[0-9a-fA-F]{40}$/.test(treasuryAddress) || /^0x0{40}$/i.test(treasuryAddress)) throw new Error("invalid_treasury");
  const base = { scheme: "exact", network: PAYMENT_NETWORK, payTo: treasuryAddress,
    price: { asset: USDC_ADDRESS, amount: amountAtomic.toString(), extra: { name: "USDC", version: "2" } },
    maxTimeoutSeconds: 300, extra: { assetTransferMethod: "eip3009" } };
  if (solana && (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(solana.treasuryAddress) || !solana.orderId)) throw new Error("invalid_solana_treasury");
  return { accepts: solana ? [base, { scheme: "exact", network: SOLANA_PAYMENT_NETWORK, payTo: solana.treasuryAddress,
    price: { asset: SOLANA_USDC_MINT, amount: amountAtomic.toString() }, maxTimeoutSeconds: 60,
    extra: { memo: `skarl:${solana.orderId}` } }] : base,
    description: "Fund the stored Skarl collection order on Base Sepolia", mimeType: "application/json" };
}
export function parseFundingAuthorization(payload: Readonly<Record<string, unknown>>) {
  const auth = payload.authorization;
  if (!auth || typeof auth !== "object") throw new Error("eip3009_authorization_required");
  const a = auth as Record<string, unknown>;
  if (typeof a.from !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(a.from) ||
    typeof a.to !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(a.to) ||
    typeof a.nonce !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(a.nonce) ||
    typeof a.value !== "string" || !/^[1-9][0-9]*$/.test(a.value) || BigInt(a.value) > MAX_ATOMIC_USDC ||
    typeof a.validBefore !== "string" || !/^[0-9]+$/.test(a.validBefore)) throw new Error("invalid_authorization");
  const validBefore = Number(a.validBefore) * 1000;
  if (!Number.isSafeInteger(validBefore)) throw new Error("invalid_authorization_expiry");
  return { payerAddress: a.from as string, recipientAddress: a.to as string, authorizationNonce: a.nonce as string,
    amountAtomic: BigInt(a.value as string), validBefore };
}
