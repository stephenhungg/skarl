/** Testnet buyer CLI. Secrets and signed authorizations never belong in the repo. */
import { constants, closeSync, existsSync, fchmodSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createPublicClient, erc20Abi, getAddress, http, isAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { decodePaymentResponseHeader } from "@x402/core/http";
import { MAX_ATOMIC_USDC } from "@skarl/contracts";
import { PAYMENT_NETWORK, PAYMENT_CHAIN_ID, USDC_ADDRESS } from "@skarl/contracts/chain";

class BuyerError extends Error {}
const treasuryConfigurationMessage = "Set SKARL_TREASURY_ADDRESS in the web server environment to the human controller's Coinbase Wallet receiving address before funding.";
const configurationDirectory = join(homedir(), ".config", "skarl");
const keyPath = join(configurationDirectory, "buyer.env");
const hashPattern = /^0x[0-9a-fA-F]{64}$/;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function privateWrite(path: string, content: string, exclusive = true) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW |
    (exclusive ? constants.O_EXCL : constants.O_TRUNC), 0o600);
  try { fchmodSync(fd, 0o600); writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
}
function privateRead(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { fchmodSync(fd, 0o600); return readFileSync(fd, "utf8"); } finally { closeSync(fd); }
}
function buyerAccount() {
  mkdirSync(configurationDirectory, { recursive: true, mode: 0o700 });
  if (!existsSync(keyPath)) {
    try {
      privateWrite(keyPath, `# Generated exclusively for Base Sepolia test funds. Never use on mainnet.\nSKARL_BUYER_NETWORK=${PAYMENT_NETWORK}\nSKARL_BUYER_PRIVATE_KEY=${generatePrivateKey()}\n`);
    } catch (error) {
      if (!record(error) || error.code !== "EEXIST") throw error;
    }
  }
  const source = privateRead(keyPath);
  if (!source.split(/\r?\n/).includes(`SKARL_BUYER_NETWORK=${PAYMENT_NETWORK}`)) throw new BuyerError("Buyer key must be explicitly marked for Base Sepolia.");
  const key = /^SKARL_BUYER_PRIVATE_KEY=(0x[0-9a-fA-F]{64})$/m.exec(source)?.[1];
  if (!key) throw new BuyerError("The private buyer configuration is invalid.");
  return privateKeyToAccount(key as Hex);
}
function validateEnvironment() {
  for (const name of ["PAYMENT_NETWORK", "SKARL_PAYMENT_NETWORK", "SKARL_BUYER_NETWORK"]) {
    if (process.env[name] && process.env[name] !== PAYMENT_NETWORK) throw new BuyerError(`${name} must be ${PAYMENT_NETWORK}; mainnet is disabled.`);
  }
  for (const name of ["PAYMENT_CHAIN_ID", "SKARL_PAYMENT_CHAIN_ID"]) {
    if (process.env[name] && process.env[name] !== String(PAYMENT_CHAIN_ID)) throw new BuyerError(`${name} must be ${PAYMENT_CHAIN_ID}; mainnet is disabled.`);
  }
}
function printTransaction(value: unknown) {
  if (typeof value === "string" && hashPattern.test(value)) console.log(`${baseSepolia.blockExplorers.default.url}/tx/${value}`);
}
async function jsonResponse(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json().catch(() => null);
  if (record(body) && body.error === "treasury_not_configured") throw new BuyerError(treasuryConfigurationMessage);
  if (!response.ok) throw new BuyerError(`Payment service returned HTTP ${response.status}. No new payment will be attempted automatically.`);
  if (!record(body) || body.ok === false) throw new BuyerError("The payment service refused this operation.");
  return body;
}

export async function fundOrder(args = process.argv.slice(2)) {
  const railIndex = args.indexOf("--rail");
  if (railIndex !== -1) {
    const rail = args[railIndex + 1];
    if (rail !== "solana" && rail !== "base") throw new BuyerError("Usage: pnpm agent:fund --rail solana|base [orderId]");
    args = args.filter((_, index) => index !== railIndex && index !== railIndex + 1);
    if (rail === "solana") {
      const { fundOrderWithSolana } = await import("./cdp-solana-buyer.ts");
      return fundOrderWithSolana(args.filter(arg => arg !== "--cdp"));
    }
  }
  validateEnvironment();
  if (args.includes("--cdp")) {
    const { fundOrderWithCdp } = await import("./cdp-buyer.ts");
    return fundOrderWithCdp(args.filter(arg => arg !== "--cdp"));
  }
  const orderId = args[0] ?? "skarl-red-cup-demo-v2";
  if (args.length > 1 || (!/^[a-zA-Z0-9_-]+$/.test(orderId) && orderId !== "--address")) {
    throw new BuyerError("Usage: pnpm agent:fund [orderId] (default: skarl-red-cup-demo-v2; or --address)");
  }
  const account = buyerAccount();
  console.log(account.address);
  if (args[0] === "--address") return;
  const app = new URL(process.env.SKARL_APP_URL || "http://localhost:3000");
  if (app.username || app.password || (app.protocol !== "https:" && !(app.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(app.hostname)))) {
    throw new BuyerError("SKARL_APP_URL must use HTTPS, or HTTP on localhost.");
  }
  const resource = new URL(`/api/orders/${encodeURIComponent(orderId)}/fund`, app);
  const headers = { "Content-Type": "application/json", "x-skarl-demo-identity": "buyer" };
  const status = await jsonResponse(await fetch(resource, { headers, redirect: "error", signal: AbortSignal.timeout(20_000) }));
  const savedPath = join(configurationDirectory, `funding-${orderId}.json`);
  const saved: unknown = existsSync(savedPath) ? JSON.parse(privateRead(savedPath)) : null;
  if (status.fundingStatus === "confirmed") {
    console.log("Funding already confirmed; no payment sent."); printTransaction(status.txHash); return;
  }
  if (saved || status.fundingStatus !== "awaiting_payment" || status.attemptId) {
    if (saved && (!record(saved) || saved.resource !== resource.href || saved.payerAddress !== account.address || saved.network !== PAYMENT_NETWORK)) {
      throw new BuyerError("Saved authorization belongs to another wallet, network or application. Inspect it privately before continuing.");
    }
    console.log("Existing authorization or funding attempt: reconciling without signing or paying again.");
    const txHash = status.txHash ?? (record(saved) ? saved.txHash : undefined);
    const reconciled = await jsonResponse(await fetch(new URL("/api/payments/reconcile", app), {
      method: "POST", headers, redirect: "error", signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ orderId, demoIdentity: "buyer", ...(typeof txHash === "string" ? { txHash } : {}),
        ...(record(saved) && typeof saved.authorizationNonce === "string" ? { authorizationNonce: saved.authorizationNonce, payerAddress: account.address } : {}) }),
    }));
    printTransaction(reconciled.txHash ?? txHash);
    console.log(`Funding status: ${typeof reconciled.fundingStatus === "string" ? reconciled.fundingStatus : "reconciliation requested"}`);
    return;
  }
  if (typeof status.recipientAddress !== "string" || !status.recipientAddress.trim()) {
    throw new BuyerError(treasuryConfigurationMessage);
  }
  if (typeof status.amountAtomic !== "string" || !/^[1-9][0-9]*$/.test(status.amountAtomic) ||
    BigInt(status.amountAtomic) > MAX_ATOMIC_USDC || typeof status.recipientAddress !== "string" ||
    !isAddress(status.recipientAddress) || /^0x0{40}$/i.test(status.recipientAddress)) {
    throw new BuyerError("The stored funding quote is invalid.");
  }
  const amount = BigInt(status.amountAtomic);
  const recipient = getAddress(status.recipientAddress);
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || baseSepolia.rpcUrls.default.http[0];
  const chain = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl, { retryCount: 0, timeout: 20_000 }) });
  if (await chain.getChainId() !== PAYMENT_CHAIN_ID) throw new BuyerError("RPC is not Base Sepolia; refusing to sign.");
  // EIP-3009 signs an offchain authorization; the facilitator submits it and pays gas.
  const usdc = await chain.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  if (usdc < amount) {
    console.log(`Insufficient test funds. USDC atomic balance: ${usdc}; required: ${amount}. Buyer ETH is not required.`);
    console.log("Base Sepolia USDC: https://faucet.circle.com");
    process.exitCode = 2;
    return;
  }
  let savedAuthorization: Record<string, unknown> | undefined;
  const client = new x402Client()
    .register(PAYMENT_NETWORK, new ExactEvmScheme(account, { rpcUrl }))
    .setSpendControls({ maxAmountPerPayment: false, allowedAssets: [{ network: PAYMENT_NETWORK, asset: USDC_ADDRESS, maxAmountPerPayment: amount.toString() }] })
    .registerPolicy((version, requirements) => version === 2 ? requirements.filter(requirement =>
      requirement.scheme === "exact" && requirement.network === PAYMENT_NETWORK &&
      requirement.asset.toLowerCase() === USDC_ADDRESS.toLowerCase() && requirement.payTo.toLowerCase() === recipient.toLowerCase() &&
      requirement.amount === amount.toString() && (!requirement.extra?.assetTransferMethod || requirement.extra.assetTransferMethod === "eip3009"),
    ) : [])
    .onAfterPaymentCreation(async ({ paymentPayload }) => {
      const payload = paymentPayload.payload;
      const authorization = record(payload.authorization) ? payload.authorization : null;
      if (!authorization || typeof authorization.nonce !== "string" || !hashPattern.test(authorization.nonce)) {
        throw new BuyerError("Only EIP-3009 funding authorizations are allowed.");
      }
      savedAuthorization = { orderId, resource: resource.href, payerAddress: account.address, network: PAYMENT_NETWORK,
        amountAtomic: amount.toString(), recipientAddress: recipient, authorizationNonce: authorization.nonce,
        paymentPayload, createdAt: new Date().toISOString() };
      // Exclusive creation and fsync happen before the signed request leaves this process.
      // A competing process cannot send a second authorization for the same order.
      privateWrite(savedPath, JSON.stringify(savedAuthorization));
    });
  const restrictedFetch: typeof fetch = (input, init) => {
    const request = new Request(input, init);
    if (request.url !== resource.href) throw new BuyerError("Refusing to send payment to a different resource.");
    return fetch(request, { redirect: "error", signal: AbortSignal.timeout(90_000) });
  };
  try {
    const response = await wrapFetchWithPayment(restrictedFetch, client)(resource, { method: "POST", headers, body: JSON.stringify({ demoIdentity: "buyer" }) });
    const paymentResponse = response.headers.get("PAYMENT-RESPONSE");
    if (paymentResponse && savedAuthorization) {
      const settlement = decodePaymentResponseHeader(paymentResponse);
      if (settlement.transaction && hashPattern.test(settlement.transaction)) {
        savedAuthorization.txHash = settlement.transaction;
        privateWrite(savedPath, JSON.stringify(savedAuthorization), false);
        printTransaction(settlement.transaction);
      }
    }
    const result = await jsonResponse(response);
    if (typeof result.txHash === "string" && hashPattern.test(result.txHash)) {
      if (savedAuthorization) { savedAuthorization.txHash = result.txHash; privateWrite(savedPath, JSON.stringify(savedAuthorization), false); }
      printTransaction(result.txHash);
    }
    console.log(`Funding status: ${typeof result.fundingStatus === "string" ? result.fundingStatus : "unknown; reconcile before paying again"}`);
  } catch (error) {
    if (!existsSync(savedPath) && error instanceof BuyerError) throw error;
    throw new BuyerError(existsSync(savedPath)
      ? "The signed authorization is saved privately. Settlement may have occurred. Rerun this command to reconcile; do not delete the saved attempt or pay again."
      : "Funding request failed before a signed request was sent. Check the app configuration and stored quote.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fundOrder().catch(error => {
    console.error((error instanceof BuyerError || (error instanceof Error && error.name === "CdpBuyerError")) ? error.message : "Buyer agent stopped. Check the application/RPC connection and private configuration; no automatic retry was made.");
    process.exitCode = 1;
  });
}
