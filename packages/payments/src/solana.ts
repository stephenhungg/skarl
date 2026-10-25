import { createHash } from "node:crypto";
import {
  address, decompileTransactionMessage, getAddressEncoder, getBase58Decoder, getBase58Encoder,
  getCompiledTransactionMessageDecoder, getProgramDerivedAddress, getPublicKeyFromAddress,
  getTransactionDecoder, getTransactionEncoder, verifySignature, type Instruction,
} from "@solana/kit";
import { MAX_ATOMIC_USDC } from "@skarl/contracts";
import { SOLANA_PAYMENT_NETWORK, SOLANA_USDC_MINT } from "@skarl/contracts/chain";
import type { ExpectedTransfer, TransferObservation } from "./reconciliation.ts";

export const SOLANA_TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const SOLANA_MEMO_PROGRAM = address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const ASSOCIATED_TOKEN_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const COMPUTE_BUDGET_PROGRAM = address("ComputeBudget111111111111111111111111111111");
const HASH = /^0x[0-9a-f]{64}$/;

export async function solanaUsdcAta(owner: string): Promise<string> {
  const encode = getAddressEncoder();
  const [ata] = await getProgramDerivedAddress({ programAddress: ASSOCIATED_TOKEN_PROGRAM,
    seeds: [encode.encode(address(owner)), encode.encode(SOLANA_TOKEN_PROGRAM), encode.encode(address(SOLANA_USDC_MINT))] });
  return ata;
}

export function isSolanaSignature(value: string): boolean {
  try { return getBase58Encoder().encode(value).length === 64; } catch { return false; }
}

function decodeTransaction(transaction: unknown) {
  if (typeof transaction !== "string" || transaction.length > 2000 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(transaction)) {
    throw new Error("invalid_solana_transaction");
  }
  const wire = Buffer.from(transaction, "base64");
  const decoded = getTransactionDecoder().decode(wire);
  if (!Buffer.from(getTransactionEncoder().encode(decoded)).equals(wire)) throw new Error("invalid_solana_transaction");
  return decoded;
}

export type SolanaFundingTerms = Readonly<{ treasuryAddress: string; amountAtomic: bigint; orderId: string; feePayer?: string }>;

/** Hash message bytes, not signatures: the facilitator adds its fee-payer signature after this claim. */
export async function parseSolanaFundingAuthorization(payload: Readonly<Record<string, unknown>>, terms: SolanaFundingTerms) {
  if (terms.amountAtomic <= 0n || terms.amountAtomic > MAX_ATOMIC_USDC) throw new Error("wrong_amount");
  if (!terms.orderId || terms.orderId.length > 256) throw new Error("invalid_order_id");
  const transaction = decodeTransaction(payload.transaction);
  const compiled = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  // The exact client produces static-account v0 messages; do not resolve buyer-controlled lookup tables.
  if (compiled.version !== 0 && compiled.version !== "legacy") throw new Error("unsupported_solana_transaction_version");
  if ("addressTableLookups" in compiled && compiled.addressTableLookups?.length) throw new Error("solana_lookup_tables_not_supported");
  const message = decompileTransactionMessage(compiled);
  if (terms.feePayer !== undefined && message.feePayer.address !== terms.feePayer) throw new Error("wrong_solana_fee_payer");
  const instructions: readonly Instruction[] = message.instructions;
  const transfers = instructions.map((instruction, index) => ({ instruction, index }))
    .filter(({ instruction }) => instruction.programAddress === SOLANA_TOKEN_PROGRAM);
  if (transfers.length !== 1) throw new Error("expected_single_exact_transfer");
  const { instruction, index } = transfers[0]!;
  const data = instruction.data;
  if (!data || data.length !== 10 || data[0] !== 12 || data[9] !== 6 || instruction.accounts?.length !== 4) {
    throw new Error("solana_transfer_checked_required");
  }
  const [source, mint, destination, authority] = instruction.accounts;
  if (mint!.address !== SOLANA_USDC_MINT) throw new Error("wrong_token");
  if (destination!.address !== await solanaUsdcAta(terms.treasuryAddress)) throw new Error("wrong_recipient_ata");
  if (source!.address !== await solanaUsdcAta(authority!.address)) throw new Error("wrong_sender_ata");
  const amount = new DataView(Uint8Array.from(data).buffer).getBigUint64(1, true);
  if (amount !== terms.amountAtomic) throw new Error("wrong_amount");
  const memos = instructions.filter(ix => ix.programAddress === SOLANA_MEMO_PROGRAM);
  if (memos.length !== 1 || !memos[0]!.data ||
    new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(memos[0]!.data)) !== `skarl:${terms.orderId}`) {
    throw new Error("wrong_order_memo");
  }
  if (instructions.some(ix => !new Set<string>([SOLANA_TOKEN_PROGRAM, SOLANA_MEMO_PROGRAM, COMPUTE_BUDGET_PROGRAM]).has(ix.programAddress))) {
    throw new Error("unexpected_solana_instruction");
  }
  const payerSignature = transaction.signatures[authority!.address];
  if (!payerSignature || !await verifySignature(await getPublicKeyFromAddress(authority!.address), payerSignature, transaction.messageBytes)) {
    throw new Error("invalid_payer_signature");
  }
  return { payerAddress: authority!.address as string, recipientAddress: terms.treasuryAddress,
    amountAtomic: amount, authorizationNonce: `0x${createHash("sha256").update(Uint8Array.from(transaction.messageBytes)).digest("hex")}`,
    // A conservative dispatch deadline, not proof that an unobserved transaction failed or is repayable.
    validBefore: Date.now() + 60_000, logIndex: index };
}

type RpcInstruction = { programId: string; parsed?: string | { type?: string; info?: Record<string, unknown> } };
type RpcParsedTransaction = {
  slot: number; blockTime: number | null;
  meta: { err: unknown; innerInstructions?: { index: number; instructions: RpcInstruction[] }[] } | null;
  transaction: { signatures: string[]; message: { accountKeys: { pubkey: string; signer: boolean }[]; instructions: RpcInstruction[] } };
};
type RpcRawTransaction = { slot: number; transaction: [string, "base64"]; meta: { err: unknown } | null };
type RpcStatus = { slot: number; err: unknown; confirmations: number | null; confirmationStatus?: string };
export type SolanaRpc = <T>(method: string, params: unknown[]) => Promise<T>;

export function solanaRpc(url = process.env.SOLANA_DEVNET_RPC_URL || "https://api.devnet.solana.com"): SolanaRpc {
  return async <T>(method: string, params: unknown[]): Promise<T> => {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`solana_rpc_http_${response.status}`);
    const body = await response.json() as { result?: T; error?: { message?: string } };
    if (body.error || !("result" in body)) throw new Error("solana_rpc_error");
    return body.result as T;
  };
}

/** Trusted RPC evidence only. A client signature is a lookup key, never proof of payment. */
export async function observeSolanaTransfer(signature: string,
  expected: ExpectedTransfer & { authorizationNonce: string; orderId: string },
  options: { rpc?: SolanaRpc; now?: number } = {}): Promise<TransferObservation> {
  if (!isSolanaSignature(signature)) throw new Error("invalid_solana_signature");
  if (!HASH.test(expected.authorizationNonce)) throw new Error("invalid_authorization_nonce");
  const rpc = options.rpc ?? solanaRpc();
  const genesis = await rpc<string>("getGenesisHash", []);
  if (`solana:${genesis.slice(0, 32)}` !== SOLANA_PAYMENT_NETWORK) throw new Error("wrong_rpc_network");
  const [parsed, raw, statuses] = await Promise.all([
    rpc<RpcParsedTransaction | null>("getTransaction", [signature, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 }]),
    rpc<RpcRawTransaction | null>("getTransaction", [signature, { encoding: "base64", commitment: "confirmed", maxSupportedTransactionVersion: 0 }]),
    rpc<{ value: (RpcStatus | null)[] }>("getSignatureStatuses", [[signature], { searchTransactionHistory: true }]),
  ]);
  const status = statuses.value[0];
  if (!parsed || !raw || !status) throw new Error("solana_transaction_pending");
  if (!parsed.meta || !raw.meta || parsed.meta.err !== null || raw.meta.err !== null || status.err !== null) throw new Error("receipt_failed");
  if (status.confirmationStatus !== "confirmed" && status.confirmationStatus !== "finalized") throw new Error("insufficient_confirmations");
  if (status.confirmationStatus !== "finalized" && (status.confirmations === null || status.confirmations < 2)) throw new Error("insufficient_confirmations");
  if (!Number.isSafeInteger(parsed.slot) || parsed.slot < 0 || parsed.slot !== raw.slot || parsed.slot !== status.slot) throw new Error("invalid_block_identity");
  if (parsed.transaction.signatures[0] !== signature) throw new Error("wrong_transaction_signature");
  if (raw.transaction[1] !== "base64") throw new Error("invalid_solana_transaction");
  const decoded = decodeTransaction(raw.transaction[0]);
  const feeSignature = Object.values(decoded.signatures)[0];
  if (!feeSignature || getBase58Decoder().decode(feeSignature) !== signature) throw new Error("wrong_transaction_signature");
  const auth = await parseSolanaFundingAuthorization({ transaction: raw.transaction[0] }, {
    treasuryAddress: expected.toAddress, amountAtomic: expected.amountAtomic, orderId: expected.orderId,
  });
  if (auth.authorizationNonce !== expected.authorizationNonce) throw new Error("authorization_not_in_receipt");
  if (auth.payerAddress !== expected.fromAddress) throw new Error("wrong_sender");
  if (!parsed.transaction.message.accountKeys.some(key => key.pubkey === expected.fromAddress && key.signer)) throw new Error("wrong_sender");
  const instructions = parsed.transaction.message.instructions;
  const transfer = instructions[auth.logIndex];
  if (transfer?.programId !== SOLANA_TOKEN_PROGRAM || typeof transfer.parsed !== "object" || transfer.parsed.type !== "transferChecked") {
    throw new Error("solana_transfer_checked_required");
  }
  const info = transfer.parsed.info;
  if (info?.mint !== SOLANA_USDC_MINT) throw new Error("wrong_token");
  if (info.authority !== expected.fromAddress) throw new Error("wrong_sender");
  if (info.destination !== await solanaUsdcAta(expected.toAddress)) throw new Error("wrong_recipient_ata");
  const tokenAmount = info.tokenAmount as { amount?: unknown; decimals?: unknown } | undefined;
  if (tokenAmount?.amount !== expected.amountAtomic.toString() || tokenAmount.decimals !== 6) throw new Error("wrong_amount");
  const memos = instructions.filter(ix => ix.programId === SOLANA_MEMO_PROGRAM);
  if (memos.length !== 1 || memos[0]!.parsed !== `skarl:${expected.orderId}`) throw new Error("wrong_order_memo");
  if (parsed.meta.innerInstructions?.some(group => group.instructions.some(ix => ix.programId === SOLANA_TOKEN_PROGRAM))) throw new Error("unexpected_inner_transfer");
  const block = await rpc<{ blockhash: string } | null>("getBlock", [parsed.slot, {
    commitment: "confirmed", transactionDetails: "none", rewards: false, maxSupportedTransactionVersion: 0,
  }]);
  if (!block || getBase58Encoder().encode(block.blockhash).length !== 32) throw new Error("invalid_block_identity");
  const observedAt = parsed.blockTime === null ? options.now ?? Date.now() : parsed.blockTime * 1000;
  if (!Number.isFinite(observedAt) || observedAt < 0) throw new Error("invalid_observation_time");
  return { network: SOLANA_PAYMENT_NETWORK, tokenAddress: SOLANA_USDC_MINT, txHash: signature,
    logIndex: auth.logIndex, blockNumber: BigInt(parsed.slot), blockHash: block.blockhash,
    fromAddress: expected.fromAddress, toAddress: expected.toAddress, amountAtomic: expected.amountAtomic,
    confirmations: status.confirmationStatus === "finalized" ? 32 : status.confirmations!, succeeded: true, observedAt };
}
