import { paymentConfig } from "./config.ts";
import { PAYMENT_NETWORK, SOLANA_PAYMENT_NETWORK, USDC_ADDRESS, USDC_DECIMALS } from "@skarl/contracts/chain";
import { parseAtomicUsdc } from "@skarl/contracts";

function decimal(amountAtomic: string) {
  const amount = parseAtomicUsdc(amountAtomic);
  if (amount <= 0n) throw new Error("positive_amount_required");
  const scale = 10n ** BigInt(USDC_DECIMALS);
  return `${amount / scale}.${(amount % scale).toString().padStart(USDC_DECIMALS, "0")}`;
}

/** Call ONLY with the server's newly claimed approved intent, never model-authored terms. */
export function walletMcpSendForClaim(claim: {
  claimId: string; network: string; tokenAddress: string; recipientAddress: string; amountAtomic: string;
}) {
  if (!claim.claimId || claim.network !== PAYMENT_NETWORK || claim.tokenAddress.toLowerCase() !== USDC_ADDRESS.toLowerCase() ||
    !/^0x[0-9a-fA-F]{40}$/.test(claim.recipientAddress) || /^0x0{40}$/i.test(claim.recipientAddress)) throw new Error("invalid_payment_claim");
  return { tool: "send" as const, arguments: { recipient: claim.recipientAddress, amount: decimal(claim.amountAtomic),
    asset: USDC_ADDRESS, decimals: USDC_DECIMALS, chain: "base-sepolia" as const } };
}

/** Prepare exact capped Wallet MCP arguments; the caller still completes the human approval flow. */
export function walletMcpFundingRequest(url: string, amountAtomic: string) {
  const resource = new URL(url);
  if (resource.protocol !== "https:" || resource.username || resource.password ||
    !/^\/api\/orders\/[A-Za-z0-9_-]+\/fund$/.test(resource.pathname) || resource.search || resource.hash) throw new Error("invalid_funding_resource");
  return { tool: "initiate_x402_request" as const, arguments: { url: resource.href, method: "POST" as const,
    scheme: "exact" as const, maxPayment: decimal(amountAtomic) } };
}


export type WalletMcpFundingPreparation = {
  /** Caller-approved HTTPS funding URL. The caller must refuse HTTP redirects. */
  resource: string;
  status: unknown;
  challenge: unknown;
  maxPaymentAtomic: string;
  expectedPayTo: string;
  payerAddress?: string;
};
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function fundingAddress(value: unknown): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value)) throw new Error("invalid_funding_address");
  return value.toLowerCase();
}
function fundingAmount(value: unknown): bigint {
  if (typeof value !== "string") throw new Error("invalid_funding_amount");
  const amount = parseAtomicUsdc(value);
  if (amount <= 0n) throw new Error("positive_amount_required");
  return amount;
}

/** Validate untrusted status/quote data before preparing a capped, human-approved MCP call.
 * This performs no wallet, network or payment operation. Redirect refusal belongs to the fetch caller.
 */
export function prepareWalletMcpFunding(input: WalletMcpFundingPreparation): ReturnType<typeof walletMcpFundingRequest> {
  const request = walletMcpFundingRequest(input.resource, input.maxPaymentAtomic);
  // Reject normalization surprises (credentials, empty query/fragment markers, dot segments, whitespace).
  if (input.resource !== request.arguments.url || /[?#\\]/.test(input.resource)) throw new Error("invalid_funding_resource");
  const resource = new URL(request.arguments.url);
  const orderId = resource.pathname.match(/^\/api\/orders\/([A-Za-z0-9_-]+)\/fund$/)![1];
  const payTo = fundingAddress(input.expectedPayTo), cap = fundingAmount(input.maxPaymentAtomic);
  if (input.payerAddress !== undefined && fundingAddress(input.payerAddress) === payTo) throw new Error("payer_is_funding_recipient");
  const status = input.status;
  if (!record(status) || status.orderId !== orderId || status.network !== PAYMENT_NETWORK ||
    fundingAddress(status.recipientAddress) !== payTo) throw new Error("funding_status_binding_mismatch");
  if (typeof status.status !== "string" || !["draft", "awaiting_funding"].includes(status.status) || status.fundingStatus !== "awaiting_payment" ||
    status.attemptId !== null || status.txHash !== null || status.intentId != null || status.paymentIntentId != null || status.intent != null || status.attempt != null) {
    throw new Error("funding_already_started_reconcile_first");
  }
  const amount = fundingAmount(status.amountAtomic);
  if (amount > cap) throw new Error("funding_cap_exceeded");
  const challenge = input.challenge;
  if (!record(challenge) || challenge.x402Version !== 2 || !record(challenge.resource) ||
    challenge.resource.url !== resource.href || !Array.isArray(challenge.accepts) || challenge.accepts.length < 1 || challenge.accepts.length > 16 ||
    !challenge.accepts.every(quote => record(quote) && typeof quote.network === "string")) throw new Error("invalid_funding_challenge");
  const quotes = challenge.accepts.filter(quote => quote.network === PAYMENT_NETWORK);
  // Wallet MCP is Base-only. Preserve Skarl's Base-first dual-rail quote, but never offer a competing EVM rail.
  if (quotes.length !== 1 || challenge.accepts[0] !== quotes[0] ||
    challenge.accepts.some(quote => quote.network !== PAYMENT_NETWORK && quote.network !== SOLANA_PAYMENT_NETWORK)) throw new Error("ambiguous_funding_challenge");
  const quote = quotes[0], extra = quote.extra;
  if (quote.scheme !== "exact" || typeof quote.asset !== "string" || quote.asset.toLowerCase() !== USDC_ADDRESS.toLowerCase() ||
    fundingAddress(quote.payTo) !== payTo || fundingAmount(quote.amount) !== amount ||
    typeof quote.maxTimeoutSeconds !== "number" || !Number.isSafeInteger(quote.maxTimeoutSeconds) || quote.maxTimeoutSeconds < 1 || quote.maxTimeoutSeconds > paymentConfig.fundingMaxTimeoutSeconds ||
    !record(extra) || extra.name !== "USDC" || extra.version !== "2" || extra.assetTransferMethod !== "eip3009" ||
    Object.keys(extra).some(key => !["name", "version", "assetTransferMethod"].includes(key))) throw new Error("funding_quote_binding_mismatch");
  // Tighten to the approved stored budget even when the human's cap has spare room.
  return walletMcpFundingRequest(resource.href, amount.toString());
}
