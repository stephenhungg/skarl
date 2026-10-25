"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/glaze/ui/button";
import { TableToolbar } from "./table-tools";
import { Status } from "@/components/glaze/ui/status";
import { Badge } from "@/components/glaze/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/glaze/ui/table";
import { useOrderData, useOrderId, type SubmissionRow } from "./data";
import { formatMs, formatTime, humanize } from "./format";
import { Loading, PageHeader, Unavailable } from "./ui";

type StatusValue = "idle" | "queued" | "running" | "ok" | "warn" | "fail" | "waiting";
export const SUBMISSION_STATUS: Record<string, { status: StatusValue; label: string }> = {
  uploading: { status: "queued", label: "Uploading" },
  queued: { status: "queued", label: "Queued" },
  analysing: { status: "running", label: "Analysing" },
  needs_review: { status: "waiting", label: "Needs review" },
  needs_correction: { status: "warn", label: "Correction requested" },
  accepted: { status: "ok", label: "Accepted" },
  rejected: { status: "fail", label: "Rejected" },
};

export function SubmissionStatus({ value }: { value: string }) {
  const entry = SUBMISSION_STATUS[value] ?? { status: "idle" as const, label: humanize(value) };
  return <Status status={entry.status}>{entry.label}</Status>;
}

type View = "all" | "needs_review" | "accepted" | "needs_correction" | "rejected" | "in_progress";
const VIEWS: { value: View; label: string; match: (status: string) => boolean }[] = [
  { value: "all", label: "All", match: () => true },
  { value: "needs_review", label: "Needs review", match: s => s === "needs_review" },
  { value: "in_progress", label: "In progress", match: s => ["uploading", "queued", "analysing"].includes(s) },
  { value: "accepted", label: "Accepted", match: s => s === "accepted" },
  { value: "needs_correction", label: "Retake asked", match: s => s === "needs_correction" },
  { value: "rejected", label: "Rejected", match: s => s === "rejected" },
];

export function Submissions() {
  const orderId = useOrderId();
  const { submissions } = useOrderData(orderId);
  const router = useRouter();
  const [view, setView] = useState<View>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"asc" | "desc">("desc");
  if (orderId === null) return <Unavailable title="No staged order" description="Run pnpm seed to stage the demo order." />;
  const all = submissions ?? [];
  const match = VIEWS.find(v => v.value === view)!.match;
  const q = query.trim().toLowerCase();
  const rows = all.filter(row => match(row.status) && (!q || row._id.toLowerCase().includes(q) || row.status.includes(q)))
    .sort((a, b) => (sort === "desc" ? -1 : 1) * (a._creationTime - b._creationTime));
  const next = all.find(row => row.status === "needs_review");
  return (
    <>
      <PageHeader title="Submissions"
        actions={next && <Button size="sm" onClick={() => router.push(`/dashboard/submissions/${next._id}`)}>Review next clip</Button>} />
      {submissions === undefined ? <Loading rows={4} /> : all.length === 0
        ? <Unavailable title="No submissions yet" description="Clips appear here as contributors upload them from the recorder." />
        : (
          <>
            <TableToolbar views={VIEWS.map(v => ({ value: v.value, label: v.label, count: all.filter(row => v.match(row.status)).length }))}
              value={view} onChange={setView} query={query} onQuery={setQuery} placeholder="Search clip ID" />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Clip</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>AI recommendation</TableHead>
                  <TableHead>Copy check</TableHead>
                  <TableHead numeric>Analysis time</TableHead>
                  <TableHead sort={sort} onSort={() => setSort(sort === "desc" ? "asc" : "desc")}>Uploaded</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0
                  ? <TableRow><TableCell colSpan={6} className="py-6 text-center text-text-2">No clips match. Clear the search or pick another view.</TableCell></TableRow>
                  : rows.map(row => <Row key={row._id} row={row} onOpen={() => router.push(`/dashboard/submissions/${row._id}`)} />)}
              </TableBody>
            </Table>
          </>
        )}
    </>
  );
}

function Row({ row, onOpen }: { row: SubmissionRow; onOpen: () => void }) {
  const analysis = row.analysis;
  return (
    <TableRow className="cursor-pointer" onClick={onOpen}>
      <TableCell>
        <Link href={`/dashboard/submissions/${row._id}`} onClick={event => event.stopPropagation()} className="flex items-center gap-2 underline-offset-4 hover:underline">
          <span className="mono">{row._id.slice(0, 8)}</span>
          {row.verificationOnly && <Badge variant="outline" size="sm">Test upload</Badge>}
        </Link>
      </TableCell>
      <TableCell><SubmissionStatus value={row.status} /></TableCell>
      <TableCell className="text-text-2">{analysis ? humanize(analysis.recommendation) : "Pending"}</TableCell>
      <TableCell className="text-text-2">{row.perceptualHashSource ? "Checked" : "Not checked"}</TableCell>
      <TableCell numeric className="text-text-2">{analysis?.processingElapsedMs ? formatMs(analysis.processingElapsedMs) : "\u2014"}</TableCell>
      <TableCell className="text-text-2">{formatTime(row._creationTime)}</TableCell>
    </TableRow>
  );
}
