import assert from "node:assert/strict";
import test from "node:test";
import { MAX_ATOMIC_USDC, fundingStatuses, parseAtomicUsdc, payoutStatuses, toAtomicUsdcString } from "./index.ts";

test("atomic JSON amounts are read as micro-units, never rescaled as dollars", () => {
  // A dollar parser would turn this payable of 7.5 USDC into 7,500,000 USDC.
  assert.equal(parseAtomicUsdc("7500000"), 7_500_000n);
  assert.equal(parseAtomicUsdc("0"), 0n);
  assert.equal(parseAtomicUsdc(MAX_ATOMIC_USDC.toString()), MAX_ATOMIC_USDC);
  assert.equal(toAtomicUsdcString(7_500_000n), "7500000");
  for (const value of ["7.5", "07500000", "+1", "-1", "1e6", " 1", "1\n", "", "１", (MAX_ATOMIC_USDC + 1n).toString()]) {
    assert.throws(() => parseAtomicUsdc(value), `${JSON.stringify(value)} must be rejected`);
  }
  assert.throws(() => toAtomicUsdcString(-1n));
});

test("lifecycles keep a lost response distinguishable from a failed payment", () => {
  for (const state of ["settlement_pending", "reconciliation_required"]) assert.ok((fundingStatuses as readonly string[]).includes(state));
  // An expired blockhash is not proof the transfer did not land, so it is not a terminal payout state.
  assert.ok(!(payoutStatuses as readonly string[]).includes("expired"));
});
