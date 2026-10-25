import assert from "node:assert/strict";
import test from "node:test";
import { PAYMENT_NETWORK, SOLANA_PAYMENT_NETWORK, SOLANA_USDC_MINT, USDC_ADDRESS } from "@skarl/contracts/chain";
import { chainIdentity, reconcilePayments, validateTransfer } from "./reconciliation.ts";
import type { PaymentJournal, PaymentObligation, ReconciliationObservation } from "./reconciliation.ts";

const transfer = { network: PAYMENT_NETWORK, txHash: `0x${"ab".repeat(32)}`, logIndex: 2 };
const obligation: PaymentObligation = {
  eventKey: "funding:order1", orderId: "order1", kind: "funding",
  fromAddress: `0x${"11".repeat(20)}`, toAddress: `0x${"22".repeat(20)}`,
  amountAtomic: 5_000_000n, deadlineAt: 1000, transfer,
};
const observation: ReconciliationObservation = {
  ...obligation, ...transfer, tokenAddress: USDC_ADDRESS, blockNumber: 200n,
  blockHash: `0x${"cd".repeat(32)}`, confirmations: 2, succeeded: true, observedAt: 900,
};
const journal: PaymentJournal = {
  eventKey: obligation.eventKey, orderId: obligation.orderId, kind: "funding", network: PAYMENT_NETWORK,
  tokenAddress: USDC_ADDRESS, transfer,
  lines: [{ account: "asset:usdc", side: "debit", amountAtomic: obligation.amountAtomic },
    { account: "liability:customer_prepayments", side: "credit", amountAtomic: obligation.amountAtomic }],
};
const input = { obligations: [obligation], observations: [observation], journals: [journal], now: 950 };

test("canonical transfer evidence passes with case-insensitive addresses and hash identity", () => {
  validateTransfer({ ...observation, tokenAddress: USDC_ADDRESS.toLowerCase() }, obligation);
  assert.equal(chainIdentity({ ...transfer, txHash: transfer.txHash.toUpperCase().replace("0X", "0x") }), chainIdentity(transfer));
});

test("wrong network, token, payer, recipient and amount cannot confirm funding", () => {
  for (const [change, code] of [
    [{ network: "eip155:8453" }, "wrong_network"],
    [{ tokenAddress: obligation.fromAddress }, "wrong_token"],
    [{ fromAddress: obligation.toAddress }, "wrong_sender"],
    [{ toAddress: obligation.fromAddress }, "wrong_recipient"],
    [{ amountAtomic: 4_999_999n }, "wrong_amount"],
  ] as const) assert.throws(() => validateTransfer({ ...observation, ...change }, obligation), new RegExp(code));
});

test("only successful, sufficiently confirmed, structurally valid chain evidence passes", () => {
  for (const [change, code] of [
    [{ succeeded: false }, "receipt_failed"], [{ confirmations: 1 }, "insufficient_confirmations"],
    [{ confirmations: NaN }, "insufficient_confirmations"], [{ confirmations: 2.5 }, "insufficient_confirmations"],
    [{ logIndex: -1 }, "invalid_transfer_identity"], [{ logIndex: 1.5 }, "invalid_transfer_identity"],
    [{ txHash: "0x123" }, "invalid_transfer_identity"], [{ blockNumber: -1n }, "invalid_block_identity"],
    [{ blockHash: "0x123" }, "invalid_block_identity"], [{ observedAt: NaN }, "invalid_observation_time"],
  ] as const) assert.throws(() => validateTransfer({ ...observation, ...change }, obligation), new RegExp(code));
  assert.throws(() => validateTransfer({ ...observation, amountAtomic: 0n }, { ...obligation, amountAtomic: 0n }), /wrong_amount/);
  assert.throws(() => validateTransfer({ ...observation, amountAtomic: 1n << 63n }, { ...obligation, amountAtomic: 1n << 63n }), /wrong_amount/);
});

test("three-way match requires agreement across obligation, journal and identified chain log", () => {
  const result = reconcilePayments(input);
  assert.deepEqual(result.exceptions, []);
  assert.deepEqual(result.matches, [{ eventKey: obligation.eventKey, orderId: obligation.orderId,
    chainIdentity: chainIdentity(transfer), amountAtomic: obligation.amountAtomic }]);
  assert.deepEqual(reconcilePayments(input), result, "replay is deterministic and does not mutate input");
});

test("reconciliation reports wrong amount, missing transfer, unknown transfer and late settlement", () => {
  const wrongAmount = reconcilePayments({ ...input, observations: [{ ...observation, amountAtomic: 1n }] });
  assert.equal(wrongAmount.matches.length, 0);
  assert.ok(wrongAmount.exceptions.some(exception => exception.code === "wrong_amount"));
  const missing = reconcilePayments({ ...input, observations: [], now: 1001 });
  assert.deepEqual(missing.exceptions.map(exception => exception.code), ["missing_transfer", "ledger_mismatch", "late_settlement"]);
  const unknown = reconcilePayments({ ...input, observations: [{ ...observation, eventKey: "unknown" }] });
  assert.ok(unknown.exceptions.some(exception => exception.code === "unknown_transfer"));
  const late = reconcilePayments({ ...input, observations: [{ ...observation, observedAt: 1001 }] });
  assert.deepEqual(late.exceptions.map(exception => exception.code), ["late_settlement"]);
});

test("equal totals do not hide wrong journal accounts, business event, order or chain linkage", () => {
  for (const badJournal of [
    { ...journal, orderId: "other" }, { ...journal, eventKey: "other" }, { ...journal, transfer: undefined },
    { ...journal, transfer: { ...transfer, logIndex: 3 } },
    { ...journal, lines: journal.lines.map(line => ({ ...line, amountAtomic: 1n })) },
    { ...journal, lines: journal.lines.map(line => line.side === "credit" ? { ...line, account: "revenue:dataset_sales" } : line) },
  ]) {
    const result = reconcilePayments({ ...input, journals: [badJournal] });
    assert.equal(result.matches.length, 0);
    assert.ok(result.exceptions.some(exception => exception.code === "ledger_mismatch"));
  }
  const wrongOrder = reconcilePayments({ ...input, observations: [{ ...observation, orderId: "other" }] });
  assert.ok(wrongOrder.exceptions.some(exception => exception.code === "unknown_transfer"));
});

test("one log cannot satisfy two obligations and duplicate imports are never matched", () => {
  const duplicate = reconcilePayments({ ...input, observations: [observation, observation] });
  assert.equal(duplicate.matches.length, 0);
  assert.ok(duplicate.exceptions.some(exception => exception.code === "duplicate_transfer"));
  const other = { ...obligation, eventKey: "funding:order2", orderId: "order2" };
  const stolen = reconcilePayments({ ...input, obligations: [obligation, other],
    observations: [observation, { ...observation, eventKey: other.eventKey, orderId: other.orderId }],
    journals: [journal, { ...journal, eventKey: other.eventKey, orderId: other.orderId }] });
  assert.equal(stolen.matches.length, 0);
  assert.equal(stolen.exceptions.filter(exception => exception.code === "duplicate_transfer").length, 2);
});

test("payout journals require payable debit and cash credit", () => {
  const payout: PaymentObligation = { ...obligation, kind: "payout" };
  const payoutJournal: PaymentJournal = { ...journal, kind: "payout", lines: [
    { account: "liability:contributor_payables", side: "debit", amountAtomic: obligation.amountAtomic },
    { account: "asset:usdc", side: "credit", amountAtomic: obligation.amountAtomic },
  ] };
  assert.equal(reconcilePayments({ ...input, obligations: [payout], journals: [payoutJournal] }).matches.length, 1);
});


test("Solana evidence requires its stored rail and preserves base58 case in identities", () => {
  const solanaExpected = { network: SOLANA_PAYMENT_NETWORK, fromAddress: "35pgsKg8sUYQRbLuWSmgYnham9rWhqNuG1JJhGKN6TWy",
    toAddress: "5vrHh4EG9dChLEEAkgedPUEq2gjYj95822kSjsCXPshh", amountAtomic: 1_000_000n };
  const solana = { ...observation, ...solanaExpected, tokenAddress: SOLANA_USDC_MINT, txHash: "2".repeat(86),
    blockHash: "11111111111111111111111111111111" };
  validateTransfer(solana, solanaExpected);
  assert.throws(() => validateTransfer(solana, { ...solanaExpected, network: PAYMENT_NETWORK }), /wrong_network/);
  assert.throws(() => validateTransfer({ ...solana, toAddress: solana.toAddress.toLowerCase() }, solanaExpected), /wrong_recipient/);
  assert.throws(() => validateTransfer({ ...solana, tokenAddress: SOLANA_USDC_MINT.toLowerCase() }, solanaExpected), /wrong_token/);
  const identity = { network: SOLANA_PAYMENT_NETWORK, txHash: "Ab".repeat(44), logIndex: 2 };
  assert.notEqual(chainIdentity(identity), chainIdentity({ ...identity, txHash: identity.txHash.toLowerCase() }));
});
