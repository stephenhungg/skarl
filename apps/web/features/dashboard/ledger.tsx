"use client";
import { useState } from "react";
import { Status } from "@/components/glaze/ui/status";
import { Tabs, TabsContent, TabsCount, TabsList, TabsTrigger } from "@/components/glaze/ui/tabs";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/glaze/ui/table";
import { useExceptions, useJournal, useOrderId, useStatements } from "./data";
import { formatTime, formatUsdc, humanize } from "./format";
import { JournalReceipt } from "./receipt";
import { FourWayReconciliation } from "./witnesses";
import { Amount, Loading, PageHeader, Section, Unavailable } from "./ui";

const ACCOUNT_LABEL: Record<string, string> = {
  "asset:usdc": "USDC cash",
  "liability:customer_prepayments": "Customer prepayments",
  "liability:contributor_payables": "Contributor payables",
  "liability:customer_refunds": "Customer refunds payable",
  "revenue:dataset_sales": "Dataset sales revenue",
  "expense:contributor_acquisition": "Contributor acquisition expense",
};
const account = (key: string) => ACCOUNT_LABEL[key] ?? humanize(key);

export function Ledger() {
  const orderId = useOrderId();
  const statements = useStatements(orderId);
  const journal = useJournal(orderId);
  const exceptions = useExceptions(orderId);
  const [tab, setTab] = useState<"books" | "journal" | "reconciliation" | "exceptions">("books");
  const openExceptions = (exceptions ?? []).filter(item => item.stillDetected && item.disposition?.status !== "resolved").length;
  if (orderId === null) return <Unavailable title="No staged order" description="Run pnpm seed to stage the demo order." />;
  return (
    <>
      <PageHeader title="Ledger" description="Double-entry books for this order, computed from posted journals. Corrections are new entries, never edits." />
      <Tabs value={tab} onValueChange={value => setTab(value as typeof tab)}>
        <TabsList size="sm">
          <TabsTrigger value="books">Books</TabsTrigger>
          <TabsTrigger value="journal">Journal<TabsCount>{journal?.length ?? 0}</TabsCount></TabsTrigger>
          <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
          <TabsTrigger value="exceptions">Exceptions<TabsCount>{openExceptions}</TabsCount></TabsTrigger>
        </TabsList>
        <TabsContent value="books">
      <Section title="Trial balance" meta={statements ? (statements.trialBalance.balanced ? "Debits equal credits" : "Out of balance") : undefined} className="mt-2">
        {statements === undefined ? <Loading rows={4} /> : (
          <>
            <div className="mb-3"><Status status={statements.trialBalance.balanced ? "ok" : "fail"}>{statements.trialBalance.balanced ? "Balanced" : "Not balanced"}</Status></div>
            <Table>
              <TableHeader><TableRow><TableHead>Account</TableHead><TableHead numeric>Debit</TableHead><TableHead numeric>Credit</TableHead></TableRow></TableHeader>
              <TableBody>
                {statements.trialBalance.accounts.map(row => (
                  <TableRow key={row.account}>
                    <TableCell>{account(row.account)}</TableCell>
                    <TableCell numeric>{row.debitAtomic !== "0" ? formatUsdc(row.debitAtomic) : ""}</TableCell>
                    <TableCell numeric>{row.creditAtomic !== "0" ? formatUsdc(row.creditAtomic) : ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter><TableRow><TableCell>Total</TableCell><TableCell numeric>{formatUsdc(statements.trialBalance.totalDebitAtomic)}</TableCell><TableCell numeric>{formatUsdc(statements.trialBalance.totalCreditAtomic)}</TableCell></TableRow></TableFooter>
            </Table>
            <dl className="mt-4 grid grid-cols-2 gap-y-3 md:grid-cols-4">
              {([["Cash", statements.cashAtomic], ["Deferred revenue", statements.deferredRevenueAtomic], ["Revenue", statements.revenueAtomic], ["Net income", statements.netIncomeAtomic]] as const).map(([label, value]) => (
                <div key={label}><dt className="type-label-sm text-text-2">{label}</dt><dd><Amount value={value} className="type-heading-sm" /></dd></div>
              ))}
            </dl>
            <p className="mt-2 type-label-sm text-text-3">Net income excludes inference, network fees and tax, which are not posted.</p>
          </>
        )}
      </Section>

        </TabsContent>
        <TabsContent value="journal">
      <Section className="mt-2" title="Journal" meta={journal ? `${journal.length} posted ${journal.length === 1 ? "entry" : "entries"}` : undefined}>
        {journal === undefined ? <Loading rows={3} /> : journal.length === 0 ? <p className="type-body-sm text-text-2">Nothing posted yet.</p> : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex flex-col gap-3">
            {[...journal].sort((a, b) => b.recordedAt - a.recordedAt).map(entry => (
              <div key={entry._id} className="rounded-panel border border-line-faint">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line-faint px-4 py-2">
                  <span className="type-label">{humanize(entry.kind)}</span>
                  <span className="min-w-0 flex-1 truncate type-body-sm text-text-2">{entry.memo}</span>
                  <span className="type-label-sm text-text-3">{formatTime(entry.recordedAt)}</span>
                </div>
                <table className="w-full type-body-sm">
                  <tbody>
                    {entry.lines.map(line => (
                      <tr key={line.lineNumber} className="border-b border-line-faint last:border-b-0">
                        <td className={line.side === "credit" ? "py-1.5 ps-10" : "py-1.5 ps-4"}>{account(line.account)}</td>
                        <td className="w-32 py-1.5 text-end tabular-nums">{line.side === "debit" ? formatUsdc(line.amountAtomic) : ""}</td>
                        <td className="w-32 py-1.5 pe-4 text-end tabular-nums">{line.side === "credit" ? formatUsdc(line.amountAtomic) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
          <div className="lg:sticky lg:top-16 lg:self-start">
            <JournalReceipt entry={[...journal].sort((a, b) => b.recordedAt - a.recordedAt)[0]!} />
          </div>
          </div>
        )}
      </Section>
        </TabsContent>
        <TabsContent value="reconciliation"><FourWayReconciliation orderId={orderId} /></TabsContent>
        <TabsContent value="exceptions">
      <Section className="mt-2" title="Reconciliation exceptions" meta="Order terms, ledger and chain compared">
        {exceptions === undefined ? <Loading rows={2} /> : exceptions.length === 0
          ? <p className="type-body-sm text-text-2">No exceptions. Every imported transfer matches an expected obligation.</p>
          : (
            <ul className="flex flex-col divide-y divide-line-faint rounded-panel border border-line-faint">
              {exceptions.map(item => (
                <li key={item.exceptionKey} className="flex flex-wrap items-baseline gap-3 px-4 py-3">
                  <Status status={item.disposition?.status === "resolved" ? "ok" : "fail"}>{humanize(item.exception.code)}</Status>
                  <span className="min-w-0 flex-1 type-body-sm text-text-2">{item.exception.detail}</span>
                  <span className="type-label-sm text-text-3">{item.stillDetected ? "Still detected" : "No longer detected"}{item.disposition ? ` · ${humanize(item.disposition.status)}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
      </Section>

        </TabsContent>
      </Tabs>
    </>
  );
}
