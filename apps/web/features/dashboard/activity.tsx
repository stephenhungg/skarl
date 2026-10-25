"use client";
import Link from "next/link";
import { useState } from "react";
import { Status } from "@/components/glaze/ui/status";
import { cn } from "@/lib/glaze/utils";
import type { AuditEvent } from "./data";
import { humanize, readableReason } from "./format";

type StatusValue = "idle" | "queued" | "running" | "ok" | "warn" | "fail" | "waiting";

const ACTOR: Record<string, string> = {
  "demo:skarl:controller": "Controller", "demo:skarl:contributor": "Contributor", "demo:skarl:buyer": "Buyer",
  "demo:skarl:finance-agent": "Finance agent", "finance-agent": "Finance agent", "gemini-verifier": "Gemini verifier",
  "payments-gateway": "Payments", "verifier-01": "Verifier",
};
export const actorName = (identity: string) => ACTOR[identity] ?? humanize(identity.replace(/^demo:skarl:/, ""));

/** One event as a sentence and an outcome, the way an activity feed reads. */
function describe(event: AuditEvent): { verb: string; outcome?: string; status: StatusValue } {
  const reason = event.reason;
  if (event.action.endsWith("_refused")) return { verb: `was refused: ${humanize(event.action.replace(/_refused$/, "")).toLowerCase()}`, outcome: humanize(reason.split(":")[0]!), status: "fail" };
  switch (event.action) {
    case "submission_queued": return { verb: "uploaded a clip", outcome: "Queued for hashing and AI checks", status: "queued" };
    case "analysis_stored": {
      const [head, body = ""] = reason.split(": ");
      const pairs = body.split(/,\s*/).map(p => p.split("=")).filter(p => p.length === 2);
      const counts = pairs.reduce<Record<string, number>>((acc, [, v]) => ({ ...acc, [v!]: (acc[v!] ?? 0) + 1 }), {});
      const summary = Object.entries(counts).map(([v, n]) => `${n} of ${pairs.length} ${humanize(v).toLowerCase()}`).join(", ");
      return { verb: "analysed the clip", outcome: `${humanize(head!)}${summary ? ` · ${summary}` : ""}`, status: head === "accept" ? "ok" : "waiting" };
    }
    case "submission_human_reviewed": {
      const decision = reason.split(":")[0]!;
      return { verb: "reviewed the clip", outcome: humanize(decision), status: decision.startsWith("accept") ? "ok" : decision === "rejected" || decision === "reject" ? "fail" : "warn" };
    }
    case "finance_chat_requested": return { verb: "asked the finance agent a question", status: "idle" };
    case "demo_seeded": return { verb: "seeded the demo order", status: "idle" };
    default: return { verb: humanize(event.action).toLowerCase(), outcome: undefined, status: "idle" };
  }
}

function relative(ms: number) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
const exact = (ms: number) => new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
function dayLabel(ms: number) {
  const d = new Date(ms), today = new Date(), y = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

type Group = { key: string; title: React.ReactNode; href?: string; events: AuditEvent[]; latest: number };

/** Events about one clip become one story; everything else stands alone. Newest story first. */
function group(events: AuditEvent[]): Group[] {
  const map = new Map<string, Group>();
  for (const event of events) {
    const clip = event.entityType === "submissions";
    const key = clip ? `clip:${event.entityId}` : `event:${event._id}`;
    const existing: Group = map.get(key) ?? { key, events: [], latest: 0, href: clip ? `/dashboard/submissions/${event.entityId}` : undefined,
      title: clip ? <>Clip <span className="mono">{event.entityId.slice(0, 8)}</span></> : humanize(event.action) };
    existing.events.push(event);
    existing.latest = Math.max(existing.latest, event.occurredAt);
    map.set(key, existing);
  }
  return [...map.values()].map(g => ({ ...g, events: g.events.sort((a, b) => a.occurredAt - b.occurredAt) })).sort((a, b) => b.latest - a.latest);
}

export function ActivityFeed({ events, limit }: { events: AuditEvent[]; limit?: number }) {
  const groups = group(events).slice(0, limit);
  const days: { label: string; groups: Group[] }[] = [];
  for (const g of groups) {
    const label = dayLabel(g.latest);
    const last = days[days.length - 1];
    if (last?.label === label) last.groups.push(g); else days.push({ label, groups: [g] });
  }
  return (
    <div className="flex flex-col gap-6">
      {days.map(day => (
        <section key={day.label} aria-label={day.label}>
          <h3 className="mb-2 type-label-sm text-text-3">{day.label}</h3>
          <ol className="flex flex-col divide-y divide-line-faint rounded-panel border border-line-faint">
            {day.groups.map(g => <Story key={g.key} group={g} />)}
          </ol>
        </section>
      ))}
    </div>
  );
}

function Story({ group: g }: { group: Group }) {
  const [open, setOpen] = useState(false);
  const last = g.events[g.events.length - 1]!;
  const headline = describe(last);
  const clip = !!g.href;
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {headline.outcome && <Status status={headline.status} className="shrink-0">{headline.outcome}</Status>}
        {clip
          ? <Link href={g.href!} className="type-label underline-offset-4 hover:underline">{g.title}</Link>
          : <span className="type-label">{actorName(last.actor.identity)} {headline.verb}</span>}
        <span className="ms-auto type-label-sm text-text-3 tabular-nums" title={exact(g.latest)}>{relative(g.latest)}</span>
      </div>
      {clip && (
        <ol className="mt-2 flex flex-col gap-1 border-s border-line ps-3">
          {g.events.map(event => {
            const d = describe(event);
            return (
              <li key={event._id} className="flex items-baseline gap-2 type-body-sm">
                <span className="text-text-1">{actorName(event.actor.identity)}</span>
                <span className="text-text-2">{d.verb}</span>
                <span className="ms-auto shrink-0 type-label-sm text-text-3 tabular-nums" title={exact(event.occurredAt)}>
                  {new Date(event.occurredAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <button type="button" onClick={() => setOpen(v => !v)} className={cn("mt-1.5 type-label-sm text-text-3 underline-offset-4 hover:underline", open && "text-text-2")}>
        {open ? "Hide details" : "Details"}
      </button>
      {open && (
        <ul className="mt-1 flex flex-col gap-1 rounded-tag bg-field px-3 py-2 type-body-sm text-text-2">
          {g.events.map(event => <li key={event._id}><span className="text-text-1">{humanize(event.action)}.</span> {readableReason(event.reason)}</li>)}
        </ul>
      )}
    </li>
  );
}
