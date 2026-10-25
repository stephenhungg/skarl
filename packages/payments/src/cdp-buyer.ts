/** CDP-managed testnet buyer. No private signing key is exported or stored here. */
import { constants, closeSync, existsSync, fchmodSync, fsyncSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { CdpClient } from "@coinbase/cdp-sdk";
import { CdpX402Client, type CdpX402ClientConfig, type SpendControls, type SpendLedgerEntry, type SpendStore } from "@coinbase/cdp-sdk/x402";
import { wrapFetchWithPayment } from "@x402/fetch";
import { decodePaymentResponseHeader } from "@x402/core/http";
import { createPublicClient, erc20Abi, getAddress, http, isAddress } from "viem";
import { baseSepolia } from "viem/chains";
import { MAX_ATOMIC_USDC } from "@skarl/contracts";
import { PAYMENT_CHAIN_ID, PAYMENT_NETWORK, USDC_ADDRESS } from "@skarl/contracts/chain";

export class CdpBuyerError extends Error { override name = "CdpBuyerError"; }
export const EVIDENCE_PRICE_ATOMIC = 250_000n;
const directory = () => join(homedir(), ".config", "skarl");
const hashPattern = /^0x[0-9a-fA-F]{64}$/;
export const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

function writePrivate(path: string, value: unknown, exclusive = false, append = false) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW |
    (exclusive ? constants.O_EXCL : append ? constants.O_APPEND : constants.O_TRUNC), 0o600);
  try { fchmodSync(fd, 0o600); writeFileSync(fd, JSON.stringify(value) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
}
function readPrivate(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { fchmodSync(fd, 0o600); return readFileSync(fd, "utf8"); } finally { closeSync(fd); }
}

/** Append-only reservations conservatively count uncertain and failed attempts. */
export class FileSpendStore implements SpendStore {
  readonly path: string;
  constructor(path: string) { this.path = path; }
  async load(): Promise<SpendLedgerEntry[]> {
    if (!existsSync(this.path)) return [];
    return readPrivate(this.path).trim().split("\n").filter(Boolean).map(line => {
      const entry: unknown = JSON.parse(line);
      if (!isRecord(entry) || typeof entry.atomicAmount !== "string" || !/^[0-9]+$/.test(entry.atomicAmount) ||
        entry.network !== PAYMENT_NETWORK || typeof entry.asset !== "string" || entry.asset.toLowerCase() !== USDC_ADDRESS.toLowerCase() ||
        typeof entry.payTo !== "string" || !isAddress(entry.payTo) || typeof entry.at !== "number" || !Number.isSafeInteger(entry.at) || entry.at < 0) {
        throw new CdpBuyerError("Invalid private spend record; refusing to reset the cumulative cap.");
      }
      return { atomicAmount: BigInt(entry.atomicAmount), network: PAYMENT_NETWORK, asset: entry.asset, payTo: entry.payTo, at: entry.at };
    });
  }
  async append(entry: SpendLedgerEntry): Promise<void> {
    writePrivate(this.path, { ...entry, atomicAmount: entry.atomicAmount.toString() }, false, true);
  }
  // Never release a reservation based on an HTTP/signing error. Operator reconciliation
  // can establish what happened; this store deliberately over-counts failures.
  async removeEntry(): Promise<void> {}
}

export function buyerSpendControls(treasury: string, amount: bigint, store?: SpendStore): SpendControls {
  if (!isAddress(treasury) || /^0x0{40}$/i.test(treasury)) throw new CdpBuyerError("Set SKARL_TREASURY_ADDRESS to the approved treasury address in the buyer environment.");
  if (amount <= 0n || amount > MAX_ATOMIC_USDC) throw new CdpBuyerError("Invalid payment amount.");
  const cumulativeRaw = process.env.SKARL_CDP_MAX_CUMULATIVE_ATOMIC ?? "20000000";
  if (!/^[1-9][0-9]*$/.test(cumulativeRaw) || BigInt(cumulativeRaw) > MAX_ATOMIC_USDC) throw new CdpBuyerError("SKARL_CDP_MAX_CUMULATIVE_ATOMIC must be a positive integer micro-USDC amount.");
  return { allowedPayees: [getAddress(treasury)], allowedNetworks: [PAYMENT_NETWORK], allowedAssets: [USDC_ADDRESS],
    maxAmountPerPayment: { atomic: amount, asset: USDC_ADDRESS },
    maxCumulativeSpend: { atomic: BigInt(cumulativeRaw), asset: USDC_ADDRESS }, maxCumulativeSpendWindow: "24h", ...(store ? { store } : {}) };
}

export function buyerClientConfig(treasury: string, amount: bigint, store: SpendStore): CdpX402ClientConfig {
  return { environment: "development", walletConfig: { type: "eoa", accountName: "skarl-buyer-sepolia" },
    networkSchemes: [{ network: "base-sepolia", rpcUrl: process.env.BASE_SEPOLIA_RPC_URL || baseSepolia.rpcUrls.default.http[0],
      scheme: { exact: true, upto: false, authCapture: false, batchSettlement: false } }],
    spendControls: buyerSpendControls(treasury, amount, store) };
}

export function buyerAppUrl(): URL {
  const app = new URL(process.env.SKARL_APP_URL || "http://localhost:3000");
  if (app.username || app.password || (app.protocol !== "https:" && !(app.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(app.hostname)))) {
    throw new CdpBuyerError("SKARL_APP_URL must use HTTPS, or HTTP on localhost.");
  }
  return app;
}
export async function buyerJson(response: Response): Promise<Record<string, unknown>> {
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok || !isRecord(data) || data.ok === false) throw new CdpBuyerError(`Payment service returned HTTP ${response.status}; inspect the stored attempt before any retry.`);
  return data;
}
export function attemptPath(resource: URL): string {
  return join(directory(), `cdp-payment-${createHash("sha256").update(resource.href).digest("hex")}.json`);
}
export function saveEvidenceResult(resource: URL, result: Record<string, unknown>): string {
  const path = join(directory(), `cdp-evidence-${createHash("sha256").update(resource.href).digest("hex")}.json`);
  writePrivate(path, result, true);
  return path;
}
export function existingAttempt(resource: URL): Record<string, unknown> | null {
  const path = attemptPath(resource);
  if (!existsSync(path)) return null;
  const saved: unknown = JSON.parse(readPrivate(path));
  if (!isRecord(saved) || saved.resource !== resource.href || saved.network !== PAYMENT_NETWORK) throw new CdpBuyerError("Private CDP attempt binding is invalid; reconcile before paying again.");
  return saved;
}

export async function payWithCdp(resource: URL, amount: bigint, init: RequestInit): Promise<Response> {
  const treasury = process.env.SKARL_TREASURY_ADDRESS ?? "";
  const config = buyerClientConfig(treasury, amount, new FileSpendStore(join(directory(), "cdp-spend.jsonl")));
  for (const name of ["CDP_API_KEY_ID", "CDP_API_KEY_SECRET", "CDP_WALLET_SECRET"]) {
    if (!process.env[name]) throw new CdpBuyerError(`Set ${name} privately before running the CDP buyer.`);
  }
  mkdirSync(directory(), { recursive: true, mode: 0o700 });
  const lockPath = join(directory(), "cdp-buyer.lock");
  try { writePrivate(lockPath, { pid: process.pid, startedAt: Date.now() }, true); }
  catch { throw new CdpBuyerError("Another CDP buyer is active or stopped with a lock. Reconcile its private attempt before removing ~/.config/skarl/cdp-buyer.lock."); }
  try {
    if (existingAttempt(resource)) throw new CdpBuyerError("A CDP attempt already exists for this resource; reconcile it instead of paying again.");
    const cdp = new CdpClient();
    const account = await cdp.evm.getOrCreateAccount({ name: "skarl-buyer-sepolia" });
    console.log(`CDP Base Sepolia buyer: ${account.address}`);
    const chain = createPublicClient({ chain: baseSepolia, transport: http(config.networkSchemes![0].rpcUrl, { retryCount: 0, timeout: 20_000 }) });
    if (await chain.getChainId() !== PAYMENT_CHAIN_ID) throw new CdpBuyerError("RPC is not Base Sepolia; refusing to sign.");
    let balance = await chain.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
    if (balance === 0n) {
      const faucetPath = join(directory(), `cdp-faucet-${account.address.toLowerCase()}.json`);
      // Stable idempotency survives a timeout, so repeated runs cannot repeatedly claim.
      if (!existsSync(faucetPath)) writePrivate(faucetPath, { idempotencyKey: randomUUID() }, true);
      const faucet: unknown = JSON.parse(readPrivate(faucetPath));
      if (!isRecord(faucet) || typeof faucet.idempotencyKey !== "string") throw new CdpBuyerError("Invalid saved faucet request.");
      const result = await cdp.evm.requestFaucet({ address: account.address, network: "base-sepolia", token: "usdc", idempotencyKey: faucet.idempotencyKey });
      console.log(`USDC faucet transaction: ${baseSepolia.blockExplorers.default.url}/tx/${result.transactionHash}`);
      await chain.waitForTransactionReceipt({ hash: result.transactionHash, confirmations: 2, timeout: 60_000 });
      balance = await chain.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
    }
    if (balance < amount) throw new CdpBuyerError(`Insufficient test USDC: ${balance} atomic available, ${amount} required. One faucet claim may not cover order funding; fund this CDP account and retry. Buyer ETH is not required.`);
    const client = new CdpX402Client(config);
    client.registerPolicy((version, requirements) => version === 2 ? requirements.filter(req => req.scheme === "exact" &&
      req.network === PAYMENT_NETWORK && req.asset.toLowerCase() === USDC_ADDRESS.toLowerCase() &&
      req.payTo.toLowerCase() === treasury.toLowerCase() && req.amount === amount.toString() &&
      (!req.extra?.assetTransferMethod || req.extra.assetTransferMethod === "eip3009")) : []);
    const savedPath = attemptPath(resource);
    let saved: Record<string, unknown> | undefined;
    client.onBeforePaymentCreation(async () => {
      saved = { resource: resource.href, network: PAYMENT_NETWORK, payerAddress: account.address, amountAtomic: amount.toString(),
        recipientAddress: getAddress(treasury), status: "signing_started", createdAt: Date.now() };
      writePrivate(savedPath, saved, true);
    });
    client.onAfterPaymentCreation(async ({ paymentPayload }) => {
      const authorization = paymentPayload.payload.authorization;
      if (!isRecord(authorization) || typeof authorization.nonce !== "string" || !hashPattern.test(authorization.nonce) ||
        typeof authorization.from !== "string" || authorization.from.toLowerCase() !== account.address.toLowerCase()) throw new CdpBuyerError("Unexpected CDP signing account or authorization.");
      saved = { ...saved, status: "authorization_saved", authorizationNonce: authorization.nonce, paymentPayload };
      writePrivate(savedPath, saved);
    });
    const restrictedFetch: typeof fetch = (input, options) => {
      const request = new Request(input, options);
      if (request.url !== resource.href) throw new CdpBuyerError("Refusing payment redirect to a different resource.");
      return fetch(request, { redirect: "error", signal: AbortSignal.timeout(90_000) });
    };
    try {
      const response = await wrapFetchWithPayment(restrictedFetch, client)(resource, init);
      const paymentHeader = response.headers.get("PAYMENT-RESPONSE");
      const settlement = paymentHeader ? decodePaymentResponseHeader(paymentHeader) : null;
      if (saved) {
        saved = { ...saved, status: "response_received", httpStatus: response.status,
          ...(settlement && hashPattern.test(settlement.transaction) ? { txHash: settlement.transaction } : {}),
          extensionResponses: response.headers.get("EXTENSION-RESPONSES") };
        writePrivate(savedPath, saved);
      }
      if (settlement && hashPattern.test(settlement.transaction)) console.log(`${baseSepolia.blockExplorers.default.url}/tx/${settlement.transaction}`);
      console.log(`EXTENSION-RESPONSES: ${response.headers.get("EXTENSION-RESPONSES") ?? "absent; listing not proven"}`);
      return response;
    } catch {
      throw new CdpBuyerError(existsSync(savedPath) ? "CDP attempt saved privately; settlement may have occurred. Reconcile before any new payment." : "CDP payment stopped before signing. Check credentials, network and spend controls; no automatic retry was made.");
    }
  } finally { unlinkSync(lockPath); }
}

export async function fundOrderWithCdp(args: string[]) {
  const orderId = args[0] ?? "skarl-red-cup-demo-v2";
  if (args.length > 1 || !/^[a-zA-Z0-9_-]+$/.test(orderId)) throw new CdpBuyerError("Usage: pnpm agent:fund --cdp [orderId]");
  const app = buyerAppUrl();
  const resource = new URL(`/api/orders/${orderId}/fund`, app);
  const headers = { "Content-Type": "application/json", "x-skarl-demo-identity": "buyer" };
  const status = await buyerJson(await fetch(resource, { headers, redirect: "error", signal: AbortSignal.timeout(20_000) }));
  if (status.fundingStatus === "confirmed") { console.log("Funding already confirmed; no payment sent."); return; }
  const saved = existingAttempt(resource);
  if (saved || status.fundingStatus !== "awaiting_payment" || status.attemptId) {
    const result = await buyerJson(await fetch(new URL("/api/payments/reconcile", app), {
      method: "POST", headers, redirect: "error", signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ orderId, demoIdentity: "buyer", ...(saved?.txHash ? { txHash: saved.txHash } : {}),
        ...(saved?.authorizationNonce ? { authorizationNonce: saved.authorizationNonce, payerAddress: saved.payerAddress } : {}) }),
    }));
    console.log(`Funding reconciliation status: ${String(result.fundingStatus ?? "pending")}`); return;
  }
  if (typeof status.amountAtomic !== "string" || !/^[1-9][0-9]*$/.test(status.amountAtomic) ||
    typeof status.recipientAddress !== "string" || status.recipientAddress.toLowerCase() !== process.env.SKARL_TREASURY_ADDRESS?.toLowerCase()) {
    throw new CdpBuyerError("Funding quote does not match the approved SKARL_TREASURY_ADDRESS or has an invalid amount.");
  }
  const result = await buyerJson(await payWithCdp(resource, BigInt(status.amountAtomic), { method: "POST", headers, body: JSON.stringify({ demoIdentity: "buyer" }) }));
  console.log(`Funding status: ${String(result.fundingStatus ?? "unknown; reconcile before paying again")}`);
  console.log(`Facilitator: ${String(result.settledBy ?? "not reported")}`);
}
