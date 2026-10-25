import test from "node:test";
import assert from "node:assert/strict";
import { fundingRouteConfig, parseFundingAuthorization } from "./funding.ts";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "@skarl/contracts/chain";
const treasury = `0x${"1".repeat(40)}`;
test("funding exact route uses integer stored budget, canonical chain and token", () => {
  const config = fundingRouteConfig(9_007_199_254_740_993n, treasury);
  assert.deepEqual(config.accepts, { scheme: "exact", network: PAYMENT_NETWORK, payTo: treasury,
    price: { asset: USDC_ADDRESS, amount: "9007199254740993", extra: { name: "USDC", version: "2" } },
    maxTimeoutSeconds: 300, extra: { assetTransferMethod: "eip3009" } });
  assert.throws(() => fundingRouteConfig(0n, treasury));
  assert.throws(() => fundingRouteConfig(1n << 63n, treasury));
  assert.throws(() => fundingRouteConfig(1n, `0x${"0".repeat(40)}`));
});
test("only exact EIP-3009 authorization with integer amount and bounded expiry is accepted", () => {
  const authorization = { from: treasury, to: `0x${"2".repeat(40)}`, nonce: `0x${"a".repeat(64)}`, value: "1000001", validBefore: "1793000000" };
  assert.deepEqual(parseFundingAuthorization({ authorization }), { payerAddress: authorization.from, recipientAddress: authorization.to,
    authorizationNonce: authorization.nonce, amountAtomic: 1000001n, validBefore: 1793000000000 });
  for (const value of ["1.0", "-1", "01", 1000000, "9223372036854775808"]) assert.throws(() => parseFundingAuthorization({ authorization: { ...authorization, value } }));
  assert.throws(() => parseFundingAuthorization({ authorization: { ...authorization, validBefore: "9999999999999999999999" } }));
  assert.throws(() => parseFundingAuthorization({ permit2: {} }));
});
