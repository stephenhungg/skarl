/** Money remains in exact micro-USDC; an approved or broadcast transfer is not paid. */
export type Earning = {
  submissionId: string; orderId: string; status: string; amountAtomic: string; payableStatus: string | null;
  submittedAt?: number; acceptedAt?: number;
  payout: { status: "pending" | "paid" | "not_payable"; amountAtomic: string | null;
    txHash: string | null; explorerUrl: string | null; confirmedAt?: number | null };
};

export function earningsTotals(rows: Earning[]) {
  return rows.reduce((totals, row) => ({
    earned: totals.earned + BigInt(row.amountAtomic),
    paid: totals.paid + (row.payout.status === "paid" ? BigInt(row.payout.amountAtomic ?? "0") : 0n),
  }), { earned: 0n, paid: 0n });
}

/** Observed reconciliation time is not the block timestamp or a payout-speed promise. */
export function payoutDuration(row: Earning): number | null {
  const start = row.acceptedAt, end = row.payout.confirmedAt;
  if (row.payout.status !== "paid" || typeof start !== "number" || typeof end !== "number" ||
    !Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

export function durationLabel(ms: number) {
  if (ms < 60_000) return "under 1 minute";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60), remaining = minutes % 60;
  return `${hours} hour${hours === 1 ? "" : "s"}${remaining ? ` ${remaining} min` : ""}`;
}

export function evidenceTime(ms: number) {
  return `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(Math.floor(ms % 1000)).padStart(3, "0")}`;
}
