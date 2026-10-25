import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fundingTermsHash, type FundingTerms } from "./funding-terms.ts";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "@skarl/contracts/chain";

const terms: FundingTerms = { orderId: "stored-order-1", amountAtomic: "1000000", payTo: `0x${"ab".repeat(20)}`,
  autoPay: { enabled: true, maxPerClipAtomic: "750000", requireAllChecks: true } };

test("funding commitment matches the independently encoded versioned canonical tuple", () => {
  const tuple = ["skarl-funding-terms-v1", PAYMENT_NETWORK, USDC_ADDRESS.toLowerCase(),
    "stored-order-1", "1000000", terms.payTo.toLowerCase(), [true, "750000", true]];
  const expected = createHash("sha256").update(JSON.stringify(tuple)).digest("hex");
  assert.equal(fundingTermsHash(terms), expected);
  assert.match(expected, /^[a-f0-9]{64}$/);
});

test("address casing, object key order and rule bookkeeping do not change reviewed terms", () => {
  const reordered = { autoPay: { requireAllChecks: true as const, maxPerClipAtomic: "750000", enabled: true,
    setBy: "buyer", setAt: 123 }, payTo: `0x${"AB".repeat(20)}`, amountAtomic: "1000000", orderId: "stored-order-1" };
  assert.equal(fundingTermsHash(reordered), fundingTermsHash(terms));
});

test("each reviewed order, budget, payee and policy field changes the commitment", () => {
  const original = fundingTermsHash(terms);
  for (const changed of [
    { ...terms, orderId: "stored-order-2" }, { ...terms, amountAtomic: "1000001" },
    { ...terms, payTo: `0x${"cd".repeat(20)}` }, { ...terms, autoPay: null },
    { ...terms, autoPay: { ...terms.autoPay!, enabled: false } },
    { ...terms, autoPay: { ...terms.autoPay!, maxPerClipAtomic: "750001" } },
  ]) assert.notEqual(fundingTermsHash(changed), original);
  assert.notEqual(fundingTermsHash({ ...terms, autoPay: null }),
    fundingTermsHash({ ...terms, autoPay: { ...terms.autoPay!, enabled: false } }));
});

test("micro-USDC above Number precision remains exact", () => {
  const large = { ...terms, amountAtomic: "9007199254740993", autoPay: { ...terms.autoPay!, maxPerClipAtomic: "9223372036854775807" } };
  assert.notEqual(fundingTermsHash(large), fundingTermsHash({ ...large, amountAtomic: "9007199254740992" }));
  assert.notEqual(fundingTermsHash(large), fundingTermsHash({ ...large, autoPay: { ...large.autoPay, maxPerClipAtomic: "9223372036854775806" } }));
});

test("untrusted numeric encodings and amounts outside positive int64 are refused", () => {
  for (const value of [0, 1, 9007199254740992, "0", "01", "1.0", "1e6", "-1", " 1", "9223372036854775808", null, undefined]) {
    assert.throws(() => fundingTermsHash({ ...terms, amountAtomic: value } as unknown as FundingTerms));
    assert.throws(() => fundingTermsHash({ ...terms, autoPay: { ...terms.autoPay!, maxPerClipAtomic: value } } as unknown as FundingTerms));
  }
});

test("malformed recipients, IDs and policy types cannot acquire a commitment", () => {
  for (const payTo of ["", `0x${"0".repeat(40)}`, `0x${"ab".repeat(19)}`, "not-an-address"]) {
    assert.throws(() => fundingTermsHash({ ...terms, payTo }));
  }
  for (const orderId of ["", "wrong/order", "x".repeat(129)]) assert.throws(() => fundingTermsHash({ ...terms, orderId }));
  for (const autoPay of [undefined, [], false, { enabled: "true", maxPerClipAtomic: "1", requireAllChecks: true },
    { enabled: true, maxPerClipAtomic: "1", requireAllChecks: false }]) {
    assert.throws(() => fundingTermsHash({ ...terms, autoPay } as unknown as FundingTerms));
  }
});
