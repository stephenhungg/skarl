import test from "node:test";
import assert from "node:assert/strict";
import { PAYMENT_NETWORK, PAYMENT_CHAIN_ID, USDC_ADDRESS, SOLANA_PAYMENT_NETWORK, SOLANA_USDC_MINT, PAYMENT_RAILS, paymentRail } from "./chain.ts";

test("Base remains the primary rail and Solana is testnet USDC with six decimals", () => {
  assert.equal(PAYMENT_NETWORK, "eip155:84532");
  assert.equal(PAYMENT_CHAIN_ID, 84532);
  assert.deepEqual(Object.keys(PAYMENT_RAILS), [PAYMENT_NETWORK, SOLANA_PAYMENT_NETWORK]);
  assert.equal(paymentRail(PAYMENT_NETWORK).token, USDC_ADDRESS);
  assert.equal(paymentRail(SOLANA_PAYMENT_NETWORK).token, SOLANA_USDC_MINT);
  assert.equal(paymentRail(SOLANA_PAYMENT_NETWORK).decimals, 6);
  assert.throws(() => paymentRail("solana:mainnet"), /unsupported_payment_network/);
});

test("explorer links preserve case-sensitive Solana signatures", () => {
  assert.equal(paymentRail(SOLANA_PAYMENT_NETWORK).explorerTx("AbCd123"), "https://explorer.solana.com/tx/AbCd123?cluster=devnet");
  assert.equal(paymentRail(PAYMENT_NETWORK).explorerTx("0xAbCd"), "https://sepolia.basescan.org/tx/0xAbCd");
});
