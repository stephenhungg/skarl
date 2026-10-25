"use client";
import { useQuery } from "convex/react";
import { useState } from "react";
import { Status } from "@/components/glaze/ui/status";
import { cn } from "@/lib/glaze/utils";
import { api, CONTROLLER, type Id } from "./data";

type StatusValue = "idle" | "queued" | "running" | "ok" | "warn" | "fail" | "waiting";
const STATUS: Record<string, { status: StatusValue; label: string }> = {
  agree: { status: "ok", label: "Agrees" },
  disagree: { status: "fail", label: "Disagrees" },
  pending: { status: "waiting", label: "Pending" },
  missing: { status: "idle", label: "Missing" },
  not_applicable: { status: "idle", label: "Not applicable" },
};
const GROUPS = [
  { kind: "work", title: "Work" },
  { kind: "judgment", title: "Judgment" },
  { kind: "money", title: "Money" },
] as const;

/** Every independent source behind a clip's outcome, grouped, with the disagreements first. */
export function WitnessReceipt({ submissionId }: { submissionId: Id<"submissions"> }) {
  const receipt = useQuery(api.witnessReceipt.forSubmission, { demoIdentity: CONTROLLER, submissionId });
  const [open, setOpen] = useState<string | null>(null);
  if (!receipt) return null;
  const counts = receipt.witnesses.reduce<Record<string, number>>((acc, w) => ({ ...acc, [w.status]: (acc[w.status] ?? 0) + 1 }), {});
  return (
    <section className="rounded-panel border border-line-faint" aria-label="Witnesses">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line-faint px-3 py-2.5">
        <h2 className="me-auto type-label">Witnesses</h2>
        {(["agree", "disagree", "pending", "missing"] as const).filter(k => counts[k]).map(k => (
          <Status key={k} status={STATUS[k]!.status} size="sm">{`${counts[k]} ${STATUS[k]!.label.toLowerCase()}`}</Status>
        ))}
      </div>
      {GROUPS.map(group => {
        const rows = receipt.witnesses.filter(w => w.kind === group.kind)
          .sort((a, b) => (a.status === "disagree" ? -1 : 0) - (b.status === "disagree" ? -1 : 0));
        if (!rows.length) return null;
        return (
          <div key={group.kind} className="border-b border-line-faint px-3 py-2 last:border-b-0">
            <p className="mb-1 type-label-sm text-text-3">{group.title}</p>
            <ul className="flex flex-col">
              {rows.map(w => {
                const s = STATUS[w.status] ?? STATUS.missing!;
                const expanded = open === w.key;
                return (
                  <li key={w.key}>
                    <button type="button" onClick={() => setOpen(expanded ? null : w.key)} aria-expanded={expanded}
                      className={cn("flex w-full items-baseline gap-2 rounded-tag py-1 text-start hover:bg-hover-row", w.status === "missing" && "text-text-2")}>
                      <Status status={s.status} size="sm" className="w-28 shrink-0">{s.label}</Status>
                      <span className="min-w-0 flex-1 truncate type-body-sm">{w.label}</span>
                    </button>
                    {expanded && (
                      <p className="mb-1.5 ms-30 type-body-sm text-text-2">
                        {w.detail}
                        {w.evidenceUrl && <> <a href={w.evidenceUrl} target="_blank" rel="noreferrer" className="text-text-1 underline underline-offset-4">Open evidence</a></>}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
