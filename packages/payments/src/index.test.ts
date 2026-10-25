import assert from "node:assert/strict";
import test from "node:test";
import {
  PAYMENT_CHAIN_ID, PAYMENT_NETWORK, USDC_ADDRESS, USDC_DECIMALS,
  PaymentIntegrationNotConfiguredError, assertPaymentAsset, assertPaymentNetwork, getPaymentRuntimeStatus, requirePaymentRuntime,
} from "./index.ts";

test("unconfigured payment status reports implemented adapters but no enabled runtime", () => {
  const status = getPaymentRuntimeStatus();
  assert.equal(status.implemented, true);
  assert.equal(status.fundingAvailable, false);
  assert.equal(status.payoutsAvailable, false);
  assert.equal(status.refundsAvailable, false);
  assert.throws(() => requirePaymentRuntime(), PaymentIntegrationNotConfiguredError);
});

test("canonical constants are the real Base Sepolia USDC configuration, not just self-consistent", () => {
  // Literal values from Circle's address list: a wrong token or chain in chain.ts must fail here.
  assert.equal(PAYMENT_NETWORK, "eip155:84532");
  assert.equal(PAYMENT_CHAIN_ID, 84532);
  assert.equal(USDC_ADDRESS, "0x036CbD53842c5426634e7929541eC2318f3dCF7e");
  assert.equal(USDC_DECIMALS, 6);
  assert.equal(getPaymentRuntimeStatus().usdcAddress, "0x036CbD53842c5426634e7929541eC2318f3dCF7e");
});

test("reject an unexpected chain before a payment adapter can be selected", () => {
  assert.doesNotThrow(() => assertPaymentNetwork("eip155:84532"));
  // Base mainnet, Ethereum Sepolia, Solana Devnet, bare names.
  for (const network of ["eip155:8453", "eip155:11155111", "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", "base-sepolia", "84532", ""]) {
    assert.throws(() => assertPaymentNetwork(network));
  }
});

test("the right network with the wrong token or decimals is still rejected", () => {
  assert.doesNotThrow(() => assertPaymentAsset("eip155:84532", USDC_ADDRESS, 6));
  // Checksum casing is not identity: all-lowercase is the same contract.
  assert.doesNotThrow(() => assertPaymentAsset("eip155:84532", USDC_ADDRESS.toLowerCase(), 6));
  // Base mainnet USDC on the testnet chain, a malformed address, and a wrong decimal count.
  assert.throws(() => assertPaymentAsset("eip155:84532", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 6), /USDC/);
  assert.throws(() => assertPaymentAsset("eip155:84532", `${USDC_ADDRESS} `, 6), /USDC/);
  assert.throws(() => assertPaymentAsset("eip155:84532", USDC_ADDRESS, 18), /decimals/);
  assert.throws(() => assertPaymentAsset("eip155:8453", USDC_ADDRESS, 6));
});
