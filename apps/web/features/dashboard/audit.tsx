"use client";
import { Badge } from "@/components/glaze/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/glaze/ui/table";
import { useAudit, useOrderId } from "./data";
import { formatTime, humanize } from "./format";
import { Loading, PageHeader, Unavailable } from "./ui";

export function Audit() {
  const orderId = useOrderId();
  const audit = useAudit(orderId);
  if (orderId === null) return <Unavailable title="No staged order" description="Run pnpm seed to stage the demo order." />;
  return (
    <>
      <PageHeader title="Audit log" description="Append-only. Who did what, to which record, and why. Refusals are recorded the same as successes." />
      {audit === undefined ? <Loading rows={8} /> : audit.length === 0 ? <Unavailable title="No events yet" description="Events appear as people, the verifier and the agent act on this order." /> : (
        <Table>
          <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Actor</TableHead><TableHead>Action</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader>
          <TableBody>
            {audit.map(event => (
              <TableRow key={event._id}>
                <TableCell className="whitespace-nowrap text-text-2 tabular-nums">{formatTime(event.occurredAt)}</TableCell>
                <TableCell className="whitespace-nowrap">
                  <span className="flex items-center gap-2">{event.actor.identity}{event.actor.kind === "service" && <Badge size="sm">Service</Badge>}</span>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {event.action.endsWith("_refused") ? <Badge variant="fail">{humanize(event.action)}</Badge> : humanize(event.action)}
                </TableCell>
                <TableCell className="min-w-64 text-text-2">{event.reason}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
