import assert from "node:assert/strict";
import test from "node:test";
import {
  SOLANA_DEVNET_NETWORK, SOLANA_DEVNET_USDC_MINT, USDC_DECIMALS,
  PaymentIntegrationNotConfiguredError, assertDevnetNetwork, getPaymentRuntimeStatus, requirePaymentRuntime,
} from "./index.ts";

test("payment scaffold explicitly reports every payment capability unavailable", () => {
  const status = getPaymentRuntimeStatus();
  assert.equal(status.implemented, false);
  assert.equal(status.fundingAvailable, false);
  assert.equal(status.payoutsAvailable, false);
  assert.equal(status.refundsAvailable, false);
  assert.equal(status.network, SOLANA_DEVNET_NETWORK);
  assert.equal(status.usdcMint, SOLANA_DEVNET_USDC_MINT);
  assert.equal(status.decimals, USDC_DECIMALS);
  assert.throws(() => requirePaymentRuntime(), PaymentIntegrationNotConfiguredError);
});

test("reject an unexpected chain before a payment adapter can be selected", () => {
  assert.doesNotThrow(() => assertDevnetNetwork(SOLANA_DEVNET_NETWORK));
  for (const network of ["solana", "solana-devnet", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", "eip155:84532", ""]) {
    assert.throws(() => assertDevnetNetwork(network));
  }
});
