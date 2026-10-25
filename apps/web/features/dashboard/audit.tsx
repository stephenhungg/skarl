"use client";
import { useAudit, useOrderId } from "./data";
import { useState } from "react";
import { ActivityFeed } from "./activity";
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
      <PageHeader title="Audit log" />
      {audit === undefined ? <Loading rows={8} /> : audit.length === 0 ? <Unavailable title="No events yet" description="Events appear as people, the verifier and the agent act on this order." /> : (
        <>
        <TableToolbar views={(["all", "refusals", "human", "service"] as View[]).map(v => ({ value: v, label: { all: "All", refusals: "Refusals", human: "People", service: "Services" }[v], count: all.filter(e => match(e, v)).length }))}
          value={view} onChange={setView} query={query} onQuery={setQuery} placeholder="Search actions, reasons, IDs" />
        {rows.length === 0 ? <p className="type-body-sm text-text-2">No events match.</p> : <ActivityFeed events={rows} />}
        </>
      )}
    </>
  );
}
