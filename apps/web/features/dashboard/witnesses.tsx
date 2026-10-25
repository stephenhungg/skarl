"use client";

import { useQuery } from "convex/react";
import { Status } from "@/components/glaze/ui/status";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/glaze/ui/table";
import { api, CONTROLLER, type Id } from "./data";
import { formatTime, formatUsdc, humanize, shortHash } from "./format";
import { Loading, Section } from "./ui";
import { publicEvidenceUrl, witnessPresentation } from "./witness-presentation";

export function SubmissionWitnesses({ submissionId }: { submissionId: Id<"submissions"> }) {
  const receipt = useQuery(api.witnessReceipt.forSubmission, { demoIdentity: CONTROLLER, submissionId });
  return (
    <Section title="Work and settlement witnesses" meta="Stored evidence, not a new approval">
      <p className="mb-3 type-body-sm text-text-2">Each source keeps its own verdict. Missing evidence is not agreement; a public attestation proves a recorded commitment, not that the work passed.</p>
      {receipt === undefined ? <Loading rows={5} /> : (
        <div className="grid gap-4 lg:grid-cols-3">
          {(["work", "money", "judgment"] as const).map(kind => (
            <div key={kind} className="min-w-0 rounded-panel border border-line-faint">
              <h3 className="border-b border-line-faint px-4 py-3 type-label">{humanize(kind)}</h3>
              <ul className="divide-y divide-line-faint">
                {receipt.witnesses.filter(row => row.kind === kind).map(row => {
                  const presentation = witnessPresentation(row.status), url = publicEvidenceUrl(row.evidenceUrl);
                  return <li key={row.key} className="p-4">
                    <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                      <span className="min-w-0 flex-1 type-label-sm">{row.label}</span>
                      <Status status={presentation.status} size="sm">{presentation.label}</Status>
                    </div>
                    <p className="break-words type-body-sm text-text-2">{row.detail}</p>
                    {url && <a href={url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block type-label-sm underline underline-offset-4">Open public evidence</a>}
                  </li>;
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 type-label-sm text-text-3">Consent, source, duplicate, funded quota and independent approval checks remain authoritative. Bank, SQL, phone motion and EAS witnesses are advisory. This view does not establish live-versus-replayed provenance.</p>
    </Section>
  );
}

export function FourWayReconciliation({ orderId }: { orderId: Id<"orders"> | null | undefined }) {
  const result = useQuery(api.bankWitness.reconciliation4Way, orderId ? { demoIdentity: CONTROLLER, orderId } : "skip");
  return (
    <Section title="Four-way reconciliation" meta="Order · ledger · chain · mock bank" className="mt-2">
      <p className="mb-3 type-body-sm text-text-2">Compare the same obligation across independent records. Capital One Nessie is a hosted mock bank; its entries do not represent fiat movement or authorize a payout.</p>
      {result === undefined ? <Loading rows={4} /> : <>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Status status={result.bankAvailable ? "ok" : "idle"}>{result.bankAvailable ? "Mock bank snapshot available" : "Mock bank snapshot unavailable or stale"}</Status>
          <span className="type-label-sm text-text-3">Last snapshot: {formatTime(result.bankFetchedAt)}</span>
        </div>
        {result.rows.length === 0 ? <p className="type-body-sm text-text-2">No stored obligations to compare yet. An empty table does not prove settlement.</p> : (
          <div className="overflow-x-auto rounded-panel border border-line-faint">
            <Table>
              <TableHeader><TableRow><TableHead>Obligation</TableHead><TableHead>Order</TableHead><TableHead>Ledger</TableHead><TableHead>Chain</TableHead><TableHead>Nessie mock bank</TableHead></TableRow></TableHeader>
              <TableBody>{result.rows.map(row => <TableRow key={row.intentId}>
                <TableCell><div className="type-label-sm">{humanize(row.kind)}</div><span className="mono type-label-sm text-text-3" title={row.intentId}>{shortHash(row.intentId, 16, 6)}</span></TableCell>
                {(["order", "ledger", "chain", "bank"] as const).map(key => {
                  const column = row[key], presentation = witnessPresentation(column.status);
                  return <TableCell key={key}>
                    <Status status={presentation.status} size="sm">{presentation.label}</Status>
                    {column.amountAtomic !== undefined && <p className="mt-1 tabular-nums type-label-sm">{formatUsdc(column.amountAtomic)} USDC</p>}
                    {column.reason && <p className="mt-1 max-w-56 break-words type-label-sm text-text-3">{humanize(column.reason)}</p>}
                  </TableCell>;
                })}
              </TableRow>)}</TableBody>
            </Table>
          </div>
        )}
        {result.exceptions.length > 0 && <div className="mt-4 rounded-panel border border-line-faint p-4">
          <h3 className="mb-2 type-label">Current discrepancies</h3>
          <ul className="flex flex-col gap-2">{result.exceptions.map((exception, index) => <li key={`${exception.code}:${index}`} className="type-body-sm text-text-2"><span className="font-medium text-text-1">{humanize(exception.code)}:</span> {exception.detail}</li>)}</ul>
        </div>}
        <p className="mt-3 type-label-sm text-text-3">{result.bankScope}. Missing or stale bank evidence stays missing. Sub-cent bank amounts are refused rather than rounded. Refunds and separate evidence sales retain their uncovered bank leg.</p>
      </>}
    </Section>
  );
}
