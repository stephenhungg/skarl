"use client";

import { createWalletClient, custom, erc20Abi, getAddress, isAddress, type Address, type EIP1193Provider, type Hash } from "viem";
import { baseSepolia } from "viem/chains";
import { PAYMENT_CHAIN_ID, PAYMENT_NETWORK, USDC_ADDRESS } from "@skarl/contracts/chain";
import { MAX_ATOMIC_USDC } from "@skarl/contracts";

const PAYOUT_ENDPOINT = "/api/payments/payout";

export type PayoutRecovery = {
  intentId: string;
  claimId: string;
  /** Refund command IDs reuse the transfer client but route to the refund authority. */
  paymentKind?: "buyer_refund";
  txHash?: Hash;
};
export type PayoutProgress = "connecting" | "claiming" | "awaiting_signature" | "recording";
export type PayoutSubmission = PayoutRecovery & {
  txHash: Hash;
  explorerUrl: string;
  /** The server's reconciliation result. Submission alone does not mean paid. */
  observation: unknown;
};
export type ExecutePayoutOptions = {
  intentId: string;
  demoIdentity: string;
  /** Supply the connected Coinbase Wallet or other EIP-1193 provider. */
  provider: EIP1193Provider;
  onProgress?: (progress: PayoutProgress) => void;
  paymentKind?: "buyer_refund";
};

type ClaimedPayout = {
  intentId: string;
  claimId: string;
  recipientAddress: Address;
  senderAddress: Address;
  amountAtomic: string;
  network: typeof PAYMENT_NETWORK;
  tokenAddress: Address;
};

export class PayoutExecutionError extends Error {
  readonly recovery?: PayoutRecovery;
  constructor(message: string, recovery?: PayoutRecovery, cause?: unknown) {
    super(message, { cause });
    this.name = "PayoutExecutionError";
    this.recovery = recovery;
  }
}

function recoveryKey(intentId: string) { return `skarl:payout:${intentId}`; }

/** No identity credentials or private keys are persisted here. */
function saveRecovery(recovery: PayoutRecovery) {
  window.localStorage.setItem(recoveryKey(recovery.intentId), JSON.stringify(recovery));
}

export function getPayoutRecovery(intentId: string): PayoutRecovery | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(recoveryKey(intentId));
  if (!value) return null;
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed) || parsed.intentId !== intentId || typeof parsed.claimId !== "string" || !parsed.claimId ||
    (parsed.paymentKind !== undefined && parsed.paymentKind !== "buyer_refund") ||
    (parsed.txHash !== undefined && (typeof parsed.txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(parsed.txHash)))) {
    throw new PayoutExecutionError("Invalid saved payout recovery. Reconcile the stored intent before sending.");
  }
  return parsed as PayoutRecovery;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function requestPayout(body: Record<string, string>, paymentKind?: "buyer_refund"): Promise<unknown> {
  const response = await fetch(paymentKind === "buyer_refund" ? "/api/payments/refund" : PAYOUT_ENDPOINT, {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const result: unknown = await response.json();
  if (!response.ok || (isRecord(result) && result.ok === false)) {
    const code = isRecord(result) && typeof result.error === "string" ? result.error :
      isRecord(result) && typeof result.code === "string" ? result.code : `payout_http_${response.status}`;
    throw new Error(code);
  }
  return result;
}

function validateClaim(value: unknown, intentId: string): ClaimedPayout {
  if (!isRecord(value) || value.intentId !== intentId || typeof value.claimId !== "string" || !value.claimId ||
    value.network !== PAYMENT_NETWORK || typeof value.tokenAddress !== "string" ||
    value.tokenAddress.toLowerCase() !== USDC_ADDRESS.toLowerCase() ||
    typeof value.recipientAddress !== "string" || !isAddress(value.recipientAddress) ||
    typeof value.senderAddress !== "string" || !isAddress(value.senderAddress) ||
    typeof value.amountAtomic !== "string" || !/^[1-9][0-9]*$/.test(value.amountAtomic) ||
    BigInt(value.amountAtomic) > MAX_ATOMIC_USDC ||
    /^0x0{40}$/i.test(value.recipientAddress)) {
    throw new Error("Invalid stored payout terms; refusing to request a wallet signature.");
  }
  return value as ClaimedPayout;
}

/** Reports an already-submitted hash. This function never asks the wallet to send. */
export async function reportPayoutTransaction(input: PayoutRecovery & { txHash: Hash; demoIdentity: string }): Promise<PayoutSubmission> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.txHash) || !input.claimId || !input.intentId) {
    throw new PayoutExecutionError("A stored claim and valid transaction hash are required.", input);
  }
  const recovery: PayoutRecovery & { txHash: Hash } = { intentId: input.intentId, claimId: input.claimId, txHash: input.txHash, ...(input.paymentKind ? { paymentKind: input.paymentKind } : {}) };
  // Keep trying the durable server write even if local browser storage becomes unavailable.
  try { saveRecovery(recovery); } catch { /* The thrown error below still retains the hash. */ }
  try {
    const observation = await requestPayout({ action: "submitted", demoIdentity: input.demoIdentity, ...recovery }, input.paymentKind);
    return { ...recovery, explorerUrl: `${baseSepolia.blockExplorers.default.url}/tx/${input.txHash}`, observation };
  } catch (error) {
    throw new PayoutExecutionError("The transaction may have settled. Report this same hash again to reconcile; do not send again.", recovery, error);
  }
}

/** Executes only terms returned by the server's atomic claim of a stored approval. */
export async function executeApprovedPayout(options: ExecutePayoutOptions): Promise<PayoutSubmission> {
  const { intentId, demoIdentity, provider, onProgress, paymentKind } = options;
  let recovery: PayoutRecovery | undefined;
  try {
    const existing = getPayoutRecovery(intentId);
    if (existing) throw new PayoutExecutionError("This intent already has an execution claim. Reconcile it before any further action.", existing);
    onProgress?.("connecting");
    const wallet = createWalletClient({ chain: baseSepolia, transport: custom(provider, { retryCount: 0 }) });
    const [account] = await wallet.requestAddresses();
    if (!account) throw new Error("Connect the treasury wallet first.");
    await wallet.switchChain({ id: PAYMENT_CHAIN_ID });
    if (await wallet.getChainId() !== PAYMENT_CHAIN_ID) throw new Error("Payouts require Base Sepolia.");
    onProgress?.("claiming");
    const claim = validateClaim(await requestPayout({ action: "claim", intentId, demoIdentity, senderAddress: account }, paymentKind), intentId);
    recovery = { intentId, claimId: claim.claimId, ...(paymentKind ? { paymentKind } : {}) };
    // Abort before any signature if durable local recovery is unavailable.
    saveRecovery(recovery);
    const [currentAccount] = await wallet.getAddresses();
    if (!currentAccount || getAddress(currentAccount) !== getAddress(account) || getAddress(account) !== getAddress(claim.senderAddress)) {
      throw new Error("The connected account must be the configured treasury wallet.");
    }
    if (await wallet.getChainId() !== PAYMENT_CHAIN_ID) throw new Error("The wallet network changed; reconcile the claim before continuing.");
    onProgress?.("awaiting_signature");
    const txHash = await wallet.writeContract({
      account, chain: baseSepolia, address: USDC_ADDRESS, abi: erc20Abi,
      functionName: "transfer", args: [claim.recipientAddress, BigInt(claim.amountAtomic)],
    });
    recovery = { ...recovery, txHash };
    try { saveRecovery(recovery); } catch { /* Continue directly to the durable server write. */ }
    onProgress?.("recording");
    return await reportPayoutTransaction({ ...recovery, txHash, demoIdentity });
  } catch (error) {
    if (error instanceof PayoutExecutionError) throw error;
    throw new PayoutExecutionError(recovery
      ? "The payout was claimed and may have been submitted. Check the wallet and reconcile this claim; do not send again."
      : error instanceof Error ? error.message : "Payout could not start.", recovery, error);
  }
}
