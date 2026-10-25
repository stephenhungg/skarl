"use client";
import Link from "next/link";
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

export function Submissions() {
  const orderId = useOrderId();
  const { submissions } = useOrderData(orderId);
  if (orderId === null) return <Unavailable title="No staged order" description="Run pnpm seed to stage the demo order." />;
  const rows = [...(submissions ?? [])].sort((a, b) => b._creationTime - a._creationTime);
  return (
    <>
      <PageHeader title="Submissions" description="Every clip for this order, newest first. Open one to review its evidence." />
      {submissions === undefined ? <Loading rows={4} /> : rows.length === 0
        ? <Unavailable title="No submissions yet" description="Clips appear here as contributors upload them from the recorder." />
        : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Clip</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>AI recommendation</TableHead>
                <TableHead>Copy check</TableHead>
                <TableHead numeric>Analysis time</TableHead>
                <TableHead>Uploaded</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(row => <Row key={row._id} row={row} />)}
            </TableBody>
          </Table>
        )}
    </>
  );
}

function Row({ row }: { row: SubmissionRow }) {
  const analysis = row.analysis;
  return (
    <TableRow>
      <TableCell>
        <Link href={`/dashboard/submissions/${row._id}`} className="flex items-center gap-2 underline-offset-4 hover:underline">
          <span className="mono">{row._id.slice(0, 8)}</span>
          {row.verificationOnly && <Badge variant="outline" size="sm">Test upload</Badge>}
        </Link>
      </TableCell>
      <TableCell><SubmissionStatus value={row.status} /></TableCell>
      <TableCell className="text-text-2">{analysis ? humanize(analysis.recommendation) : "Pending"}</TableCell>
      <TableCell className="text-text-2">{row.perceptualHashSource ? "Checked" : "Not checked"}</TableCell>
      <TableCell numeric className="text-text-2">{analysis?.processingElapsedMs ? formatMs(analysis.processingElapsedMs) : "—"}</TableCell>
      <TableCell className="text-text-2">{formatTime(row._creationTime)}</TableCell>
    </TableRow>
  );
}
