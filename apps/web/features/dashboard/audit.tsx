"use client";
import { Badge } from "@/components/glaze/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/glaze/ui/table";
import { useAudit, useOrderId } from "./data";
import { useState } from "react";
import { formatTime, humanize, readableReason } from "./format";
import { TableToolbar } from "./table-tools";
import { Loading, PageHeader, Unavailable } from "./ui";

type View = "all" | "refusals" | "human" | "service";

export function Audit() {
  const orderId = useOrderId();
  const audit = useAudit(orderId);
  const [view, setView] = useState<View>("all");
  const [query, setQuery] = useState("");
  if (orderId === null) return <Unavailable title="No staged order" description="Run pnpm seed to stage the demo order." />;
  const all = audit ?? [];
  const match = (event: (typeof all)[number], v: View) => v === "all" || (v === "refusals" ? event.action.endsWith("_refused") : event.actor.kind === v);
  const q = query.trim().toLowerCase();
  const rows = all.filter(event => match(event, view) && (!q || `${event.action} ${event.reason} ${event.actor.identity} ${event.entityId}`.toLowerCase().includes(q)));
  return (
    <>
      <PageHeader title="Audit log" description="Append-only. Who did what, to which record, and why. Refusals are recorded the same as successes." />
      {audit === undefined ? <Loading rows={8} /> : audit.length === 0 ? <Unavailable title="No events yet" description="Events appear as people, the verifier and the agent act on this order." /> : (
        <>
        <TableToolbar views={(["all", "refusals", "human", "service"] as View[]).map(v => ({ value: v, label: { all: "All", refusals: "Refusals", human: "People", service: "Services" }[v], count: all.filter(e => match(e, v)).length }))}
          value={view} onChange={setView} query={query} onQuery={setQuery} placeholder="Search actions, reasons, IDs" />
        <Table>
          <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Actor</TableHead><TableHead>Action</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={4} className="py-6 text-center text-text-2">No events match.</TableCell></TableRow>}
            {rows.map(event => (
              <TableRow key={event._id}>
                <TableCell className="whitespace-nowrap text-text-2 tabular-nums">{formatTime(event.occurredAt)}</TableCell>
                <TableCell className="whitespace-nowrap">
                  <span className="flex items-center gap-2">{event.actor.identity}{event.actor.kind === "service" && <Badge size="sm">Service</Badge>}</span>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {event.action.endsWith("_refused") ? <Badge variant="fail">{humanize(event.action)}</Badge> : humanize(event.action)}
                </TableCell>
                <TableCell className="min-w-64 text-text-2">{readableReason(event.reason)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </>
      )}
    </>
  );
}
