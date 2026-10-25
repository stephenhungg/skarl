import { PAYMENT_NETWORK, USDC_ADDRESS, USDC_DECIMALS } from "@skarl/contracts/chain";
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
    maxPayment: decimal(amountAtomic), body: { demoIdentity: "buyer" }, headers: { "x-skarl-demo-identity": "buyer" } } };
}
