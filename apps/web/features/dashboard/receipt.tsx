"use client";
import type { ReactNode } from "react";
import { PaymentReceiptPrinter, ReceiptRule } from "@/components/ui/payment-receipt-printer";
import type { JournalEntry } from "./data";
import { formatTime, formatUsdc, humanize } from "./format";

const ACCOUNT_LABEL: Record<string, string> = {
  "asset:usdc": "USDC cash",
  "liability:customer_prepayments": "Customer prepayments",
  "liability:contributor_payables": "Contributor payables",
  "liability:customer_refunds": "Refunds payable",
  "revenue:dataset_sales": "Dataset sales",
  "expense:contributor_acquisition": "Contributor expense",
};

/** Silas's receipt printer, with its paper set in the dashboard sans instead of mono. */
export function Receipt({ printKey, label, children }: { printKey: string; label: string; children: ReactNode }) {
  return (
    <div className="[&_.mono]:[font-family:var(--font-sans)] [&_.mono]:[font-size:inherit]">
      <PaymentReceiptPrinter printKey={printKey} deviceLabel={label}>
        <div className="type-body-sm">{children}</div>
      </PaymentReceiptPrinter>
    </div>
  );
}

/** The newest posting, printed. A new journal entry changes the key and feeds a fresh sheet live. */
export function JournalReceipt({ entry }: { entry: JournalEntry }) {
  const debits = entry.lines.filter(l => l.side === "debit").reduce((sum, l) => sum + BigInt(l.amountAtomic), 0n);
  const credits = entry.lines.filter(l => l.side === "credit").reduce((sum, l) => sum + BigInt(l.amountAtomic), 0n);
  return (
    <Receipt printKey={entry._id} label="Latest posting">
      <div className="flex items-baseline justify-between gap-3">
        <span className="type-label">{humanize(entry.kind)}</span>
        <span className="type-label-sm text-text-3">{formatTime(entry.recordedAt)}</span>
      </div>
      <p className="mt-1 type-body-sm text-text-2">{entry.memo}</p>
      <ReceiptRule className="my-3" />
      <ul className="flex flex-col gap-1.5">
        {entry.lines.map(line => (
          <li key={line.lineNumber} className="flex items-baseline justify-between gap-3">
            <span className={line.side === "credit" ? "ps-4" : undefined}>{ACCOUNT_LABEL[line.account] ?? humanize(line.account)}</span>
            <span className="tabular-nums">{line.side === "debit" ? "Dr" : "Cr"} {formatUsdc(line.amountAtomic)}</span>
          </li>
        ))}
      </ul>
      <ReceiptRule className="my-3" />
      <div className="flex items-baseline justify-between type-label">
        <span>{debits === credits ? "Balanced" : "Out of balance"}</span>
        <span className="tabular-nums">{formatUsdc(debits)} = {formatUsdc(credits)}</span>
      </div>
    </Receipt>
  );
}
