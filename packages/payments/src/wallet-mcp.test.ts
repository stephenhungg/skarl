import test from "node:test";
import assert from "node:assert/strict";
import { walletMcpFundingRequest, walletMcpSendForClaim, prepareWalletMcpFunding } from "./wallet-mcp.ts";
import { PAYMENT_NETWORK, SOLANA_PAYMENT_NETWORK, USDC_ADDRESS } from "@skarl/contracts/chain";
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

const RESOURCE = "https://skarl.example/api/orders/order-1/fund";
const TREASURY = `0x${"2".repeat(40)}`, PAYER = `0x${"1".repeat(40)}`;
function preparation(amountAtomic = "1000000") {
  return {
    resource: RESOURCE, maxPaymentAtomic: "10000000", expectedPayTo: TREASURY, payerAddress: PAYER,
    status: { orderId: "order-1", status: "awaiting_funding", fundingStatus: "awaiting_payment", amountAtomic,
      recipientAddress: TREASURY, network: PAYMENT_NETWORK, attemptId: null, txHash: null },
    challenge: { x402Version: 2, resource: { url: RESOURCE }, accepts: [{ scheme: "exact", network: PAYMENT_NETWORK,
      asset: USDC_ADDRESS, amount: amountAtomic, payTo: TREASURY, maxTimeoutSeconds: 300,
      extra: { name: "USDC", version: "2", assetTransferMethod: "eip3009" } }] },
  };
}

test("funding arguments match the public Wallet MCP shape without obsolete identity body or headers", () => {
  assert.deepEqual(walletMcpFundingRequest(RESOURCE, "1000001"), { tool: "initiate_x402_request",
    arguments: { url: RESOURCE, method: "POST", scheme: "exact", maxPayment: "1.000001" } });
});

test("preflight binds the exact order/quote and tightens a larger human cap to the stored budget", () => {
  const input = preparation();
  assert.deepEqual(prepareWalletMcpFunding(input), { tool: "initiate_x402_request",
    arguments: { url: RESOURCE, method: "POST", scheme: "exact", maxPayment: "1.000000" } });
  assert.deepEqual(prepareWalletMcpFunding({ ...input, payerAddress: undefined }), prepareWalletMcpFunding(input));
  assert.equal(input.status.attemptId, null, "preparation never creates an attempt");
});

test("preflight preserves micro-units above Number safe-integer range", () => {
  const input = preparation("9007199254740993");
  input.maxPaymentAtomic = "9223372036854775807";
  assert.equal(prepareWalletMcpFunding(input).arguments.maxPayment, "9007199254.740993");
});

test("existing or ambiguous funding state is a reconciliation operation, never another MCP initiation", () => {
  for (const change of [
    { fundingStatus: "confirmed" }, { fundingStatus: "settlement_pending" }, { status: "funded" }, { status: "refunded" },
    { attemptId: "existing-attempt" }, { txHash: `0x${"a".repeat(64)}` }, { attemptId: undefined }, { txHash: undefined },
    { status: ["draft"] }, { intentId: "existing-intent" }, { paymentIntentId: "existing-intent" }, { intent: {} }, { attempt: {} },
  ]) {
    const input = preparation();
    assert.throws(() => prepareWalletMcpFunding({ ...input, status: { ...input.status, ...change } }), /reconcile_first/);
  }
});

test("preflight refuses mismatched status order, network, treasury and self-payment", () => {
  const input = preparation();
  for (const change of [{ orderId: "another-order" }, { network: "eip155:8453" }, { recipientAddress: PAYER }, { recipientAddress: "not-an-address" }]) {
    assert.throws(() => prepareWalletMcpFunding({ ...input, status: { ...input.status, ...change } }));
  }
  assert.throws(() => prepareWalletMcpFunding({ ...input, expectedPayTo: PAYER }));
  assert.throws(() => prepareWalletMcpFunding({ ...input, payerAddress: TREASURY.toUpperCase().replace("0X", "0x") }), /payer_is_funding_recipient/);
  for (const payerAddress of ["", "invalid", `0x${"0".repeat(40)}`]) assert.throws(() => prepareWalletMcpFunding({ ...input, payerAddress }));
});

test("unsafe or noncanonical amounts and quotes above the explicit cap are refused", () => {
  for (const amount of [0, 1_000_000, Number.MAX_SAFE_INTEGER + 1, -1, 1.5, "", "0", "01", "1e6", "1.0", " 1000000", "-1", "9223372036854775808"]) {
    const input = preparation();
    assert.throws(() => prepareWalletMcpFunding({ ...input, status: { ...input.status, amountAtomic: amount } }));
    assert.throws(() => prepareWalletMcpFunding({ ...input, challenge: { ...input.challenge, accepts: [{ ...input.challenge.accepts[0], amount }] } }));
    assert.throws(() => prepareWalletMcpFunding({ ...input, maxPaymentAtomic: amount as string }));
  }
  assert.throws(() => prepareWalletMcpFunding({ ...preparation(), maxPaymentAtomic: "999999" }), /funding_cap_exceeded/);
});

test("untrusted challenge must stay x402 V2 exact USDC Base Sepolia EIP-3009 with a safe bounded timeout", () => {
  const input = preparation(), original = input.challenge.accepts[0];
  for (const change of [
    { scheme: "upto" }, { scheme: "auth-capture" }, { network: "eip155:8453" }, { asset: PAYER },
    { payTo: PAYER }, { amount: "1000001" }, { extra: {} }, { extra: { ...original.extra, version: "1" } },
    { extra: { ...original.extra, assetTransferMethod: "permit2" } }, { extra: { ...original.extra, injected: "approve" } },
    { maxTimeoutSeconds: "300" }, { maxTimeoutSeconds: 0 }, { maxTimeoutSeconds: 301 }, { maxTimeoutSeconds: 1.5 },
    { maxTimeoutSeconds: Number.MAX_SAFE_INTEGER + 1 },
  ]) assert.throws(() => prepareWalletMcpFunding({ ...input, challenge: { ...input.challenge, accepts: [{ ...original, ...change }] } }));
  for (const x402Version of [1, "2", undefined]) assert.throws(() => prepareWalletMcpFunding({ ...input, challenge: { ...input.challenge, x402Version } }));
});

test("ambiguous Base quotes, unsupported competing rails, or a reordered primary rail cannot select another payment", () => {
  const input = preparation(), quote = input.challenge.accepts[0];
  for (const accepts of [[], [quote, { ...quote }], [{ ...quote, scheme: "upto" }, quote], [quote, { ...quote, network: "eip155:8453" }], [null, quote]]) {
    assert.throws(() => prepareWalletMcpFunding({ ...input, challenge: { ...input.challenge, accepts } }));
  }
  const solana = { network: SOLANA_PAYMENT_NETWORK, scheme: "exact", amount: "1000000" };
  assert.deepEqual(prepareWalletMcpFunding({ ...input, challenge: { ...input.challenge, accepts: [quote, solana] } }), prepareWalletMcpFunding(input));
  assert.throws(() => prepareWalletMcpFunding({ ...input, challenge: { ...input.challenge, accepts: [solana, quote] } }));
});

test("funding URL and challenge resource cannot redirect or conceal another origin/path/query/fragment", () => {
  const input = preparation();
  for (const resource of [
    "http://skarl.example/api/orders/order-1/fund", "https://user:pass@skarl.example/api/orders/order-1/fund",
    `${RESOURCE}?next=evil`, `${RESOURCE}#fragment`, `${RESOURCE}?`, `${RESOURCE}#`, ` ${RESOURCE}`,
    "https://skarl.example/api/orders/order-2/../order-1/fund", "https://skarl.example/api/orders/order%2D1/fund",
    "https://skarl.example/api/orders/order-1/fund/", "https://skarl.example/api/payments/payout",
  ]) assert.throws(() => prepareWalletMcpFunding({ ...input, resource }));
  for (const url of ["https://evil.example/api/orders/order-1/fund", "https://skarl.example/api/orders/order-2/fund", `${RESOURCE}?q=1`, `${RESOURCE}#f`, "/api/orders/order-1/fund"]) {
    assert.throws(() => prepareWalletMcpFunding({ ...input, challenge: { ...input.challenge, resource: { url } } }));
  }
});

test("malformed status and challenge envelopes fail closed", () => {
  for (const status of [null, undefined, [], "awaiting_payment", {}, { fundingStatus: "awaiting_payment" }]) assert.throws(() => prepareWalletMcpFunding({ ...preparation(), status }));
  for (const challenge of [null, undefined, [], {}, { x402Version: 2 }, { ...preparation().challenge, accepts: "exact" }]) assert.throws(() => prepareWalletMcpFunding({ ...preparation(), challenge }));
});
