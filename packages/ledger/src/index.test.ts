import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_LEDGER, MAX_MICRO_USDC, accountBalance, assertBalanced, createFulfillmentJournal,
  createFundingJournal, createPayoutJournal, createRefundPaidJournal, createRefundReservedJournal,
  formatUsdc, parseUsdc, postJournal, reverseJournal,
} from "./index.ts";

const orderId = "order-1";
const funded = () => postJournal(EMPTY_LEDGER, createFundingJournal({ eventId: "fund-1", orderId, amountMicroUsdc: parseUsdc("100") }));
const fulfilled = () => postJournal(funded(), createFulfillmentJournal({
  eventId: "fulfill-1", orderId, sampleId: "sample-1", contributorId: "contributor-1",
  priceMicroUsdc: parseUsdc("10"), contributorMicroUsdc: parseUsdc("7.50"),
}));

test("decimal parsing is exact, round-trips micro-units, and rejects ambiguous or overflowing inputs", () => {
  assert.equal(parseUsdc("0.000001"), 1n);
  assert.equal(parseUsdc("100"), 100_000_000n);
  assert.equal(parseUsdc("7.50"), 7_500_000n);
  assert.equal(formatUsdc(-1n), "-0.000001");
  for (const amount of [0n, 1n, 7_500_001n, MAX_MICRO_USDC]) assert.equal(parseUsdc(formatUsdc(amount)), amount);
  for (const value of ["-1", "1e3", "0.0000001", " 1", "1 ", ".5", "1.", "01", "", "9223372036854.775808"]) {
    assert.throws(() => parseUsdc(value));
  }
  assert.throws(() => parseUsdc(0.1 as unknown as string));
});

test("a prepayment is a liability until the accepted sample is delivered", () => {
  assert.equal(accountBalance(funded(), "asset:usdc"), parseUsdc("100"));
  assert.equal(accountBalance(funded(), "liability:customer_prepayments"), parseUsdc("100"));
  assert.equal(accountBalance(funded(), "revenue:dataset_sales"), 0n);
  const state = fulfilled();
  assert.equal(accountBalance(state, "liability:customer_prepayments"), parseUsdc("90"));
  assert.equal(accountBalance(state, "revenue:dataset_sales"), parseUsdc("10"));
  assert.equal(accountBalance(state, "liability:contributor_payables"), parseUsdc("7.5"));
});

test("one fulfilled sample, payout, cancellation, and refund close the $100 example to $2.50 before other costs", () => {
  let state = fulfilled();
  state = postJournal(state, createPayoutJournal({ eventId: "payout-1", orderId, contributorId: "contributor-1", payableId: "payable-1", amountMicroUsdc: parseUsdc("7.5") }));
  state = postJournal(state, createRefundReservedJournal({ eventId: "cancel-1", orderId, amountMicroUsdc: parseUsdc("90") }));
  assert.equal(accountBalance(state, "liability:customer_refunds"), parseUsdc("90"));
  state = postJournal(state, createRefundPaidJournal({ eventId: "refund-1", orderId, amountMicroUsdc: parseUsdc("90") }));
  assert.equal(accountBalance(state, "asset:usdc"), parseUsdc("2.5"));
  for (const account of ["liability:customer_prepayments", "liability:contributor_payables", "liability:customer_refunds"] as const) assert.equal(accountBalance(state, account), 0n);
  assert.equal(accountBalance(state, "revenue:dataset_sales") - accountBalance(state, "expense:contributor_acquisition"), parseUsdc("2.5"));
  for (const journal of state.journals) assert.doesNotThrow(() => assertBalanced(journal));
});

test("retrying a business event is idempotent; changing the amount under the same event ID fails", () => {
  const state = funded();
  assert.equal(postJournal(state, createFundingJournal({ eventId: "fund-1", orderId, amountMicroUsdc: parseUsdc("100") })), state);
  assert.throws(() => postJournal(state, createFundingJournal({ eventId: "fund-1", orderId, amountMicroUsdc: parseUsdc("101") })), /conflict/);
  assert.equal(state.journals.length, 1);
});

test("an earned contributor cost can exceed revenue; accounting records the loss instead of hiding the obligation", () => {
  const state = postJournal(funded(), createFulfillmentJournal({
    eventId: "loss-making-sample", orderId, sampleId: "sample-loss", contributorId: "contributor-1",
    priceMicroUsdc: parseUsdc("10"), contributorMicroUsdc: parseUsdc("12"),
  }));
  assert.equal(accountBalance(state, "liability:contributor_payables"), parseUsdc("12"));
  assert.equal(accountBalance(state, "revenue:dataset_sales") - accountBalance(state, "expense:contributor_acquisition"), -parseUsdc("2"));
});

test("balanced journals cannot spend another order's funding or another contributor's payable", () => {
  assert.throws(() => postJournal(fulfilled(), createRefundReservedJournal({ eventId: "cancel-too-much", orderId, amountMicroUsdc: parseUsdc("91") })), /Insufficient/);
  assert.throws(() => postJournal(fulfilled(), createPayoutJournal({ eventId: "wrong-person", orderId, contributorId: "contributor-2", payableId: "payable-1", amountMicroUsdc: parseUsdc("7.5") })), /contributor payable/);
  assert.throws(() => postJournal(funded(), createFulfillmentJournal({ eventId: "other-order", orderId: "order-2", sampleId: "sample-2", contributorId: "contributor-1", priceMicroUsdc: parseUsdc("10"), contributorMicroUsdc: parseUsdc("7.5") })), /Insufficient/);
  assert.throws(() => postJournal(fulfilled(), createRefundPaidJournal({ eventId: "unreserved-refund", orderId, amountMicroUsdc: parseUsdc("1") })), /Insufficient/);
});

test("reject unbalanced, negative, empty-sided, zero-value, and unknown-account postings", () => {
  const journal = createFundingJournal({ eventId: "bad", orderId, amountMicroUsdc: 10n });
  assert.throws(() => assertBalanced({ ...journal, lines: [journal.lines[0]!, { account: "liability:customer_prepayments", debit: 0n, credit: 9n }] }), /equal/);
  assert.throws(() => assertBalanced({ ...journal, lines: [{ account: "asset:usdc", debit: -1n, credit: 0n }, journal.lines[1]!] }), /non-negative/);
  assert.throws(() => assertBalanced({ ...journal, lines: [{ account: "asset:usdc", debit: 1n, credit: 1n }, journal.lines[1]!] }), /one positive/);
  assert.throws(() => createFundingJournal({ eventId: "zero", orderId, amountMicroUsdc: 0n }));
  assert.throws(() => assertBalanced({ ...journal, lines: [{ account: "invented" as "asset:usdc", debit: 10n, credit: 0n }, journal.lines[1]!] }), /Unknown/);
});

test("corrections append a reversal instead of rewriting history; a second reversal is rejected", () => {
  const state = funded();
  const original = state.journals[0]!;
  const corrected = postJournal(state, reverseJournal(original, "reverse-1", "Confirmed payment was rolled back"));
  assert.equal(corrected.journals.length, 2);
  assert.equal(accountBalance(corrected, "asset:usdc"), 0n);
  assert.equal(accountBalance(corrected, "liability:customer_prepayments"), 0n);
  assert.equal(state.journals.length, 1);
  assert.throws(() => postJournal(corrected, reverseJournal(original, "reverse-2", "Duplicate correction")), /already reversed/);
  assert.throws(() => reverseJournal(original, "reverse-3", " "));
});
