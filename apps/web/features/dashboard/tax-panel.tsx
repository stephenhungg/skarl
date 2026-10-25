"use client";
import { useState } from "react";
import { useQuery } from "convex/react";
import { Button } from "@/components/glaze/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/glaze/ui/table";
import { api, BUYER, type Id } from "./data";
import { formatUsdc, humanize } from "./format";
import { Loading, Section } from "./ui";

export function TaxPanel({ orderId }: { orderId: Id<"orders"> | null | undefined }) {
  const [year, setYear] = useState(new Date().getUTCFullYear());
  const report = useQuery(api.tax.summary, orderId ? { demoIdentity: BUYER, orderId, year } : "skip");
  function exportCsv() {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([report.csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = `tax-ready-ledger-${year}-demo.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <Section className="mt-2" title="Tax-ready ledger" meta="Not tax advice — demo data">
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <span className="rounded-tag border border-line-faint px-2 py-1 type-label-sm">Not tax advice — demo data</span>
      <label className="ms-auto flex flex-col gap-1 type-label-sm">Tax year (UTC)
        <select value={year} onChange={event => setYear(Number(event.target.value))} className="rounded-tag border border-line-control bg-field px-3 py-2">
          {[new Date().getUTCFullYear(), new Date().getUTCFullYear() - 1, new Date().getUTCFullYear() - 2].map(value => <option key={value}>{value}</option>)}
        </select></label>
      <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!report}>Export advisory CSV</Button>
    </div>
    <p className="mb-3 type-body-sm text-text-2">YTD includes organization-wide posted payouts for contributors on this order. Form status is contributor-attested. No tax is computed, withheld or filed.</p>
    {report === undefined ? <Loading rows={3} /> : <>
      <p className="mb-3 type-caption text-text-3">{report.assumption} Reporting flag threshold: ${formatUsdc(report.thresholdMicroUsd)}; configurable by year and jurisdiction. A threshold flag alone does not block payment.</p>
      {report.rows.length === 0 ? <p className="type-body-sm text-text-2">No contributors or payouts for this order yet.</p> : <div className="overflow-x-auto"><Table>
        <TableHeader><TableRow><TableHead>Contributor</TableHead><TableHead>Country</TableHead><TableHead>Form status</TableHead><TableHead numeric>YTD USD</TableHead><TableHead numeric>Payouts</TableHead><TableHead>Flags & advisory notes</TableHead></TableRow></TableHeader>
        <TableBody>{report.rows.map(row => <TableRow key={row.contributorId}>
          <TableCell><span className="mono">{row.contributorId}</span></TableCell><TableCell>{row.country ?? "Not set"}</TableCell>
          <TableCell>{humanize(row.taxForm)}</TableCell><TableCell numeric>${formatUsdc(row.ytdMicroUsd)}</TableCell><TableCell numeric>{row.payoutCount}</TableCell>
          <TableCell><div className="space-y-1">{row.flags.map(flag => <p key={flag} className="type-label-sm">{humanize(flag)}</p>)}{row.notes.map(note => <p key={note} className="type-caption text-text-2">{note}</p>)}{row.flags.length === 0 && row.notes.length === 0 ? "—" : null}</div></TableCell>
        </TableRow>)}</TableBody>
      </Table></div>}
    </>}
  </Section>;
}
