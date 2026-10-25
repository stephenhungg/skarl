import { expect, test } from "vitest";
import { earningsTotals, payoutDuration, type Earning } from "./earnings";

const row = (overrides: Partial<Earning> = {}): Earning => ({
  submissionId: "submission", orderId: "order", status: "accepted", amountAtomic: "1875000", payableStatus: "payout_in_progress",
  acceptedAt: 1000, payout: { status: "pending", amountAtomic: "1875000", txHash: "broadcast-hash", explorerUrl: null, confirmedAt: 9000 }, ...overrides,
});

test("a broadcast hash and payout-in-progress liability must not tell a contributor they were paid", () => {
  expect(earningsTotals([row()])).toEqual({ earned: 1875000n, paid: 0n });
  expect(payoutDuration(row())).toBeNull();
});

test("earnings preserve every micro-unit above Number's safe integer range", () => {
  const amount = "9007199254740993";
  expect(earningsTotals([row({ amountAtomic: amount }), row({ amountAtomic: "1" })]).earned).toBe(9007199254740994n);
});

test("payout timing needs a reconciled payment and both ordered timestamps; missing history is not zero delay", () => {
  const paid = row({ payout: { status: "paid", amountAtomic: "1875000", txHash: "observed-hash", explorerUrl: null, confirmedAt: 9000 } });
  expect(payoutDuration(paid)).toBe(8000);
  expect(payoutDuration({ ...paid, acceptedAt: undefined })).toBeNull();
  expect(payoutDuration({ ...paid, acceptedAt: 10000 })).toBeNull();
  expect(earningsTotals([paid]).paid).toBe(1875000n);
});
