import test from "node:test";
import assert from "node:assert/strict";
import { walletMcpFundingRequest, walletMcpSendForClaim } from "./wallet-mcp.ts";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "@skarl/contracts/chain";
test("MCP funding is HTTPS-only and exactly caps decimal USDC without floats", () => {
  assert.equal(walletMcpFundingRequest("https://skarl.example/api/orders/order-1/fund", "1000001").arguments.maxPayment, "1.000001");
  assert.throws(() => walletMcpFundingRequest("http://skarl.example/api/orders/o/fund", "1"));
  assert.throws(() => walletMcpFundingRequest("https://skarl.example/api/arbitrary", "1"));
});
test("MCP send uses claimed token and amount, refusing mainnet or missing claim", () => {
  const claim = { claimId: "stored-claim", network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS,
    recipientAddress: `0x${"1".repeat(40)}`, amountAtomic: "7500000" };
  assert.deepEqual(walletMcpSendForClaim(claim).arguments, { recipient: claim.recipientAddress, amount: "7.500000",
    asset: USDC_ADDRESS, decimals: 6, chain: "base-sepolia" });
  assert.throws(() => walletMcpSendForClaim({ ...claim, network: "eip155:8453" }));
  assert.throws(() => walletMcpSendForClaim({ ...claim, claimId: "" }));
});
