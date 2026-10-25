"use client";
import { createPublicClient, createWalletClient, custom, erc20Abi, getAddress, http, isAddress, type EIP1193Provider, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { decodePaymentResponseHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { PAYMENT_CHAIN_ID, PAYMENT_NETWORK, USDC_ADDRESS } from "@skarl/contracts/chain";

export type FundingStep = "checking" | "connecting" | "signing" | "settling" | "reconciling";
export type FundingResult = { status: "confirmed" | "submitted" | "reconciling"; txHash: string | null };
export class FundingError extends Error {}

type Status = { fundingStatus?: string; attemptId?: string | null; txHash?: string | null; amountAtomic?: string; recipientAddress?: string; fundingTermsHash?: string };
const RECOVERY = (orderId: string) => `skarl:funding:${orderId}`;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

async function json(response: Response) {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || !record(body)) throw new FundingError(record(body) && typeof body.error === "string" ? body.error.replace(/_/g, " ") : `Payment service returned HTTP ${response.status}`);
  return body;
}

/**
 * The browser twin of `pnpm agent:fund`: one EIP-3009 authorization signed in the buyer's wallet,
 * settled by the x402 facilitator. An order with any prior attempt is reconciled, never paid again.
 */
export async function fundOrderInBrowser({ orderId, provider, onStep }: { orderId: string; provider: EIP1193Provider; onStep?: (step: FundingStep) => void }): Promise<FundingResult> {
  const resource = new URL(`/api/orders/${encodeURIComponent(orderId)}/fund`, window.location.origin).href;
  onStep?.("checking");
  const status = await json(await fetch(resource, { redirect: "error" })) as Status;
  if (status.fundingStatus === "confirmed") return { status: "confirmed", txHash: status.txHash ?? null };

  let saved: Record<string, unknown> | null = null;
  try { saved = JSON.parse(localStorage.getItem(RECOVERY(orderId)) ?? "null"); } catch { saved = null; }
  if (saved || status.attemptId || status.fundingStatus !== "awaiting_payment") {
    // A timeout never proves failure. Ask the server to reconcile what was already signed.
    onStep?.("reconciling");
    const reconciled = await json(await fetch("/api/payments/reconcile", { method: "POST", headers: { "Content-Type": "application/json" }, redirect: "error",
      body: JSON.stringify({ orderId, demoIdentity: "buyer", ...(status.txHash || saved?.txHash ? { txHash: status.txHash ?? saved?.txHash } : {}),
        ...(typeof saved?.authorizationNonce === "string" ? { authorizationNonce: saved.authorizationNonce, payerAddress: saved.payerAddress } : {}) }) }));
    return { status: "reconciling", txHash: typeof reconciled.txHash === "string" ? reconciled.txHash : status.txHash ?? null };
  }

  if (!status.amountAtomic || !/^[1-9]\d*$/.test(status.amountAtomic) || !status.recipientAddress || !isAddress(status.recipientAddress)) {
    throw new FundingError("The stored funding quote is invalid.");
  }
  const amount = BigInt(status.amountAtomic), recipient = getAddress(status.recipientAddress);

  onStep?.("connecting");
  const wallet = createWalletClient({ chain: baseSepolia, transport: custom(provider, { retryCount: 0 }) });
  const [account] = await wallet.requestAddresses();
  if (!account) throw new FundingError("Connect a wallet first.");
  await wallet.switchChain({ id: PAYMENT_CHAIN_ID });
  if (await wallet.getChainId() !== PAYMENT_CHAIN_ID) throw new FundingError("Switch your wallet to Base Sepolia.");
  const chain = createPublicClient({ chain: baseSepolia, transport: http(undefined, { retryCount: 0, timeout: 20_000 }) });
  const balance = await chain.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [account] });
  if (balance < amount) throw new FundingError(`This wallet has ${Number(balance) / 1e6} test USDC and the task needs ${Number(amount) / 1e6}. Get test USDC at faucet.circle.com.`);

  const signer = { address: account,
    signTypedData: (message: Record<string, unknown>) => wallet.signTypedData({ account, ...message } as never) as Promise<Hex> };
  const client = new x402Client()
    .register(PAYMENT_NETWORK, new ExactEvmScheme(signer as never))
    .registerPolicy((version, requirements) => version === 2 ? requirements.filter(requirement =>
      requirement.scheme === "exact" && requirement.network === PAYMENT_NETWORK &&
      requirement.asset.toLowerCase() === USDC_ADDRESS.toLowerCase() && requirement.payTo.toLowerCase() === recipient.toLowerCase() &&
      requirement.amount === amount.toString()) : [])
    .onAfterPaymentCreation(async ({ paymentPayload }) => {
      const authorization = record(paymentPayload.payload) && record(paymentPayload.payload.authorization) ? paymentPayload.payload.authorization : null;
      if (!authorization || typeof authorization.nonce !== "string") throw new FundingError("Only EIP-3009 funding authorizations are allowed.");
      // Saved before the signed request leaves the browser, so a lost response reconciles instead of paying twice.
      localStorage.setItem(RECOVERY(orderId), JSON.stringify({ authorizationNonce: authorization.nonce, payerAddress: account, amountAtomic: amount.toString(), createdAt: Date.now() }));
    });
  const httpClient = new x402HTTPClient(client);
  const headers: Record<string, string> = { "Content-Type": "application/json", "Idempotency-Key": `fund-${orderId}`,
    ...(status.fundingTermsHash ? { "X-Skarl-Funding-Terms": status.fundingTermsHash } : {}) };

  const challenge = await fetch(resource, { method: "POST", headers, body: "{}", redirect: "error" });
  if (challenge.status !== 402) throw new FundingError(`Expected a payment challenge, got HTTP ${challenge.status}.`);
  const required = httpClient.getPaymentRequiredResponse(name => challenge.headers.get(name), await challenge.json().catch(() => undefined));
  onStep?.("signing");
  const payload = await httpClient.createPaymentPayload(required);
  onStep?.("settling");
  const paid = await fetch(resource, { method: "POST", headers: { ...headers, ...httpClient.encodePaymentSignatureHeader(payload) }, body: "{}", redirect: "error" });
  const receipt = paid.headers.get("PAYMENT-RESPONSE");
  let txHash: string | null = null;
  if (receipt) {
    try { txHash = decodePaymentResponseHeader(receipt).transaction || null; } catch { txHash = null; }
  }
  if (txHash) {
    try { localStorage.setItem(RECOVERY(orderId), JSON.stringify({ ...JSON.parse(localStorage.getItem(RECOVERY(orderId)) ?? "{}"), txHash })); } catch { /* storage unavailable */ }
  }
  await json(paid);
  return { status: "submitted", txHash };
}
