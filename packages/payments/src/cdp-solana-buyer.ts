/** CDP-managed Solana Devnet funding only. All payout authority stays on Base. */
import { constants, closeSync, existsSync, fchmodSync, fsyncSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { CdpClient } from "@coinbase/cdp-sdk";
import { CdpX402Client, type CdpX402ClientConfig, type SpendControls, type SpendLedgerEntry, type SpendStore } from "@coinbase/cdp-sdk/x402";
import { wrapFetchWithPayment } from "@x402/fetch";
import { decodePaymentResponseHeader } from "@x402/core/http";
import type { PaymentRequirements } from "@x402/core/types";
import { MAX_ATOMIC_USDC } from "@skarl/contracts";
import { PAYMENT_RAILS, SOLANA_PAYMENT_NETWORK, SOLANA_USDC_MINT, USDC_DECIMALS } from "@skarl/contracts/chain";
import { buyerAppUrl, buyerJson, CdpBuyerError, isRecord } from "./cdp-buyer.ts";
import { parseSolanaFundingAuthorization, solanaRpc } from "./solana.ts";

const directory = () => join(homedir(), ".config", "skarl");
const addressPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const signaturePattern = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
function writePrivate(path: string, value: unknown, exclusive = false, append = false) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW |
    (exclusive ? constants.O_EXCL : append ? constants.O_APPEND : constants.O_TRUNC), 0o600);
  try { fchmodSync(fd, 0o600); writeFileSync(fd, JSON.stringify(value) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
}
function readPrivate(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { fchmodSync(fd, 0o600); return readFileSync(fd, "utf8"); } finally { closeSync(fd); }
}
function printTransaction(signature: unknown) {
  if (typeof signature === "string" && signaturePattern.test(signature)) console.log(PAYMENT_RAILS[SOLANA_PAYMENT_NETWORK].explorerTx(signature));
}

/** Reservations deliberately survive failures and keep case-sensitive base58 identities. */
export class SolanaFileSpendStore implements SpendStore {
  readonly path: string;
  constructor(path: string) { this.path = path; }
  async load(): Promise<SpendLedgerEntry[]> {
    if (!existsSync(this.path)) return [];
    return readPrivate(this.path).trim().split("\n").filter(Boolean).map(line => {
      const entry: unknown = JSON.parse(line);
      if (!isRecord(entry) || typeof entry.atomicAmount !== "string" || !/^[0-9]+$/.test(entry.atomicAmount) ||
        entry.network !== SOLANA_PAYMENT_NETWORK || entry.asset !== SOLANA_USDC_MINT ||
        typeof entry.payTo !== "string" || !addressPattern.test(entry.payTo) ||
        typeof entry.at !== "number" || !Number.isSafeInteger(entry.at) || entry.at < 0) {
        throw new CdpBuyerError("Invalid private Solana spend record; refusing to reset the cumulative cap.");
      }
      return { atomicAmount: BigInt(entry.atomicAmount), network: SOLANA_PAYMENT_NETWORK, asset: SOLANA_USDC_MINT, payTo: entry.payTo, at: entry.at };
    });
  }
  async append(entry: SpendLedgerEntry): Promise<void> { writePrivate(this.path, { ...entry, atomicAmount: entry.atomicAmount.toString() }, false, true); }
  async removeEntry(): Promise<void> {}
}

export function solanaBuyerSpendControls(treasury: string, amount: bigint, store?: SpendStore): SpendControls {
  if (!addressPattern.test(treasury)) throw new CdpBuyerError("Set SKARL_SOLANA_TREASURY_ADDRESS to the approved Solana treasury address.");
  if (amount <= 0n || amount > MAX_ATOMIC_USDC) throw new CdpBuyerError("Invalid payment amount.");
  const cumulative = process.env.SKARL_CDP_MAX_CUMULATIVE_ATOMIC ?? "20000000";
  if (!/^[1-9][0-9]*$/.test(cumulative) || BigInt(cumulative) > MAX_ATOMIC_USDC) throw new CdpBuyerError("SKARL_CDP_MAX_CUMULATIVE_ATOMIC must be a positive integer micro-USDC amount.");
  return { allowedPayees: [treasury], allowedNetworks: [SOLANA_PAYMENT_NETWORK], allowedAssets: [SOLANA_USDC_MINT],
    maxAmountPerPayment: { atomic: amount, asset: SOLANA_USDC_MINT },
    maxCumulativeSpend: { atomic: BigInt(cumulative), asset: SOLANA_USDC_MINT }, maxCumulativeSpendWindow: "24h", ...(store ? { store } : {}) };
}
export function solanaBuyerClientConfig(treasury: string, amount: bigint, store: SpendStore): CdpX402ClientConfig {
  return { environment: "development", walletConfig: { type: "eoa", accountName: "skarl-buyer-devnet" }, networkSchemes: [
    // CdpX402Client otherwise adds Base as a baseline even when only Solana is requested.
    { network: "base-sepolia", scheme: { exact: false, upto: false, authCapture: false, batchSettlement: false } },
    { network: "solana-devnet", rpcUrl: process.env.SOLANA_DEVNET_RPC_URL || "https://api.devnet.solana.com",
      scheme: { exact: true, upto: false, authCapture: false, batchSettlement: false } },
  ], spendControls: solanaBuyerSpendControls(treasury, amount, store) };
}
export function allowedSolanaFundingRequirement(requirement: PaymentRequirements, treasury: string, amount: bigint, orderId: string): boolean {
  return requirement.scheme === "exact" && requirement.network === SOLANA_PAYMENT_NETWORK && requirement.asset === SOLANA_USDC_MINT &&
    requirement.payTo === treasury && requirement.amount === amount.toString() && requirement.extra?.memo === `skarl:${orderId}` &&
    typeof requirement.extra?.feePayer === "string" && addressPattern.test(requirement.extra.feePayer);
}
export function solanaAttemptPath(resource: URL) {
  return join(directory(), `cdp-solana-payment-${createHash("sha256").update(resource.href).digest("hex")}.json`);
}
export function existingSolanaAttempt(resource: URL): Record<string, unknown> | null {
  const path = solanaAttemptPath(resource);
  if (!existsSync(path)) return null;
  const saved: unknown = JSON.parse(readPrivate(path));
  if (!isRecord(saved) || saved.resource !== resource.href || saved.network !== SOLANA_PAYMENT_NETWORK) throw new CdpBuyerError("Private Solana attempt binding is invalid; reconcile before paying again.");
  return saved;
}
async function usdcBalance(cdp: CdpClient, payer: string): Promise<bigint> {
  let balance = 0n;
  let pageToken: string | undefined;
  do {
    const result = await cdp.solana.listTokenBalances({ address: payer, network: "solana-devnet", pageToken });
    for (const item of result.balances) if (item.token.mintAddress === SOLANA_USDC_MINT) {
      if (item.amount.decimals !== USDC_DECIMALS) throw new CdpBuyerError("Unexpected USDC decimals; refusing to sign.");
      balance += item.amount.amount;
    }
    pageToken = result.nextPageToken;
  } while (pageToken);
  return balance;
}
async function ensureFunds(cdp: CdpClient, payer: string, amount: bigint) {
  if (await usdcBalance(cdp, payer) >= amount) return;
  // At most two USDC claims, with durable idempotency keys; never request buyer SOL.
  for (let index = 0; index < 2; index++) {
    const path = join(directory(), `cdp-solana-faucet-${payer}-${index}.json`);
    if (!existsSync(path)) writePrivate(path, { idempotencyKey: randomUUID() }, true);
    const saved: unknown = JSON.parse(readPrivate(path));
    if (!isRecord(saved) || typeof saved.idempotencyKey !== "string") throw new CdpBuyerError("Invalid saved Solana faucet request.");
    if (typeof saved.signature !== "string") {
      const result = await cdp.solana.requestFaucet({ address: payer, token: "usdc", idempotencyKey: saved.idempotencyKey });
      saved.signature = result.signature;
      writePrivate(path, saved);
      printTransaction(result.signature);
    }
    // Two identical faucet transfers within one recent blockhash can return the
    // same transaction signature, even with distinct idempotency keys. Finalize
    // the first before asking for the second, including after an interrupted run.
    const rpc = solanaRpc();
    for (let poll = 0; poll < 30; poll++) {
      const status = await rpc<{ value: ({ err: unknown; confirmationStatus?: string } | null)[] }>(
        "getSignatureStatuses", [[saved.signature], { searchTransactionHistory: true }]);
      const transaction = status.value[0];
      if (transaction && transaction.err !== null) throw new CdpBuyerError("Saved Solana faucet transaction failed; inspect it before another claim.");
      if (transaction?.confirmationStatus === "finalized") break;
      if (poll === 29) throw new CdpBuyerError("Solana faucet transaction is still pending; its signature is saved. Retry after finalization.");
      await new Promise(resolve => setTimeout(resolve, 2_000));
    }
  }
  for (let poll = 0; poll < 15; poll++) {
    const balance = await usdcBalance(cdp, payer);
    if (balance >= amount) return;
    if (poll === 14) throw new CdpBuyerError(`Insufficient confirmed test USDC: ${balance} atomic available, ${amount} required. Faucet requests are saved; retry after they confirm. Buyer SOL is not required.`);
    await new Promise(resolve => setTimeout(resolve, 2_000));
  }
}

export async function payWithSolanaCdp(resource: URL, amount: bigint, orderId: string, init: RequestInit): Promise<Response> {
  const treasury = process.env.SKARL_SOLANA_TREASURY_ADDRESS ?? "";
  const config = solanaBuyerClientConfig(treasury, amount, new SolanaFileSpendStore(join(directory(), "cdp-solana-spend.jsonl")));
  for (const name of ["CDP_API_KEY_ID", "CDP_API_KEY_SECRET", "CDP_WALLET_SECRET"]) {
    if (!process.env[name]) throw new CdpBuyerError(`Set ${name} privately before running the CDP buyer.`);
  }
  mkdirSync(directory(), { recursive: true, mode: 0o700 });
  const lockPath = join(directory(), "cdp-solana-buyer.lock");
  try { writePrivate(lockPath, { pid: process.pid, startedAt: Date.now() }, true); }
  catch { throw new CdpBuyerError("Another Solana buyer is active or stopped with a lock. Reconcile its private attempt before removing ~/.config/skarl/cdp-solana-buyer.lock."); }
  try {
    if (existingSolanaAttempt(resource)) throw new CdpBuyerError("A Solana attempt already exists for this resource; reconcile it instead of paying again.");
    const cdp = new CdpClient();
    const account = await cdp.solana.getOrCreateAccount({ name: "skarl-buyer-devnet" });
    console.log(`CDP Solana Devnet buyer: ${account.address}`);
    await ensureFunds(cdp, account.address, amount);
    const client = new CdpX402Client(config);
    client.registerPolicy((version, requirements) => version === 2 ? requirements.filter(req => allowedSolanaFundingRequirement(req, treasury, amount, orderId)) : []);
    const savedPath = solanaAttemptPath(resource);
    let saved: Record<string, unknown> | undefined;
    client.onBeforePaymentCreation(async () => {
      saved = { resource: resource.href, orderId, network: SOLANA_PAYMENT_NETWORK, payerAddress: account.address, amountAtomic: amount.toString(),
        recipientAddress: treasury, status: "signing_started", createdAt: Date.now() };
      writePrivate(savedPath, saved, true);
    });
    client.onAfterPaymentCreation(async ({ paymentPayload }) => {
      const authorization = await parseSolanaFundingAuthorization(paymentPayload.payload, { treasuryAddress: treasury, amountAtomic: amount, orderId });
      if (authorization.payerAddress !== account.address) throw new CdpBuyerError("Unexpected CDP Solana signing account.");
      saved = { ...saved, status: "authorization_saved", authorizationNonce: authorization.authorizationNonce, paymentPayload };
      writePrivate(savedPath, saved);
    });
    const restrictedFetch: typeof fetch = (input, options) => {
      const request = new Request(input, options);
      if (request.url !== resource.href) throw new CdpBuyerError("Refusing payment redirect to a different resource.");
      if (request.headers.has("PAYMENT-SIGNATURE") && saved?.status !== "authorization_saved") throw new CdpBuyerError("Refusing to dispatch a Solana payment without durable validated authorization.");
      return fetch(request, { redirect: "error", signal: AbortSignal.timeout(90_000) });
    };
    try {
      const response = await wrapFetchWithPayment(restrictedFetch, client)(resource, init);
      const paymentHeader = response.headers.get("PAYMENT-RESPONSE");
      const settlement = paymentHeader ? decodePaymentResponseHeader(paymentHeader) : null;
      if (saved) {
        saved = { ...saved, status: "response_received", httpStatus: response.status,
          ...(settlement?.network === SOLANA_PAYMENT_NETWORK && signaturePattern.test(settlement.transaction) ? { txHash: settlement.transaction } : {}) };
        writePrivate(savedPath, saved);
      }
      printTransaction(saved?.txHash);
      return response;
    } catch {
      throw new CdpBuyerError(existsSync(savedPath) ? "Solana attempt saved privately; settlement may have occurred. Reconcile before any new payment." : "Solana payment stopped before signing. Check credentials, network and spend controls; no automatic retry was made.");
    }
  } finally { unlinkSync(lockPath); }
}

export async function fundOrderWithSolana(args: string[]) {
  const orderId = args[0] ?? "skarl-red-cup-demo-sol";
  if (args.length > 1 || !/^[a-zA-Z0-9_-]+$/.test(orderId)) throw new CdpBuyerError("Usage: pnpm agent:fund --rail solana [orderId]");
  const app = buyerAppUrl();
  const resource = new URL(`/api/orders/${orderId}/fund`, app);
  const headers = { "Content-Type": "application/json", "x-skarl-demo-identity": "buyer" };
  const status = await buyerJson(await fetch(resource, { headers, redirect: "error", signal: AbortSignal.timeout(20_000) }));
  if (status.fundingStatus === "confirmed") { console.log("Funding already confirmed; no payment sent."); printTransaction(status.txHash); return; }
  const saved = existingSolanaAttempt(resource);
  if (saved || status.fundingStatus !== "awaiting_payment" || status.attemptId) {
    const result = await buyerJson(await fetch(new URL("/api/payments/reconcile", app), {
      method: "POST", headers, redirect: "error", signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ orderId, demoIdentity: "buyer", ...(saved?.txHash ?? status.txHash ? { txHash: saved?.txHash ?? status.txHash } : {}),
        ...(saved?.authorizationNonce ? { authorizationNonce: saved.authorizationNonce, payerAddress: saved.payerAddress } : {}) }),
    }));
    printTransaction(result.txHash ?? saved?.txHash);
    console.log(`Funding reconciliation status: ${String(result.fundingStatus ?? "pending")}`); return;
  }
  const rail = Array.isArray(status.rails) ? status.rails.find((item: unknown) => isRecord(item) && item.network === SOLANA_PAYMENT_NETWORK) : null;
  const treasury = process.env.SKARL_SOLANA_TREASURY_ADDRESS;
  if (typeof status.amountAtomic !== "string" || !/^[1-9][0-9]*$/.test(status.amountAtomic) || BigInt(status.amountAtomic) > MAX_ATOMIC_USDC ||
    !isRecord(rail) || rail.asset !== SOLANA_USDC_MINT || rail.recipientAddress !== treasury || typeof status.orderId !== "string") {
    throw new CdpBuyerError("Funding quote does not match the approved Solana rail, treasury, canonical order or amount.");
  }
  const result = await buyerJson(await payWithSolanaCdp(resource, BigInt(status.amountAtomic), status.orderId, { method: "POST", headers, body: JSON.stringify({ demoIdentity: "buyer" }) }));
  printTransaction(result.txHash);
  console.log(`Funding status: ${String(result.fundingStatus ?? "unknown; reconcile before paying again")}`);
  console.log(`Facilitator: ${String(result.settledBy ?? "not reported")}`);
}
