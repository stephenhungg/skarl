"use client";
import { useAction, useQuery } from "convex/react";
import { useState } from "react";
import { Button } from "@/components/glaze/ui/button";
import { Status } from "@/components/glaze/ui/status";
import { Textarea } from "@/components/glaze/ui/textarea";
import { api, CONTROLLER, useOrderId, useRuns, type AgentRun, type Id } from "./data";
import { formatTime, humanize } from "./format";
import { Amount, Loading, PageHeader, QueryBoundary, Section, Unavailable } from "./ui";

const RUN_STATUS = { running: "running", completed: "ok", failed: "fail", capped: "warn" } as const;
const DEFAULT_PROMPT = "Inspect this order and propose eligible payables; request independent approval.";

export function Agent() {
  const orderId = useOrderId();
  const runs = useRuns(orderId);
  const run = useAction(api.financeAgent.run);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (orderId === null) return <Unavailable title="No staged order" description="Run pnpm seed to stage the demo order." />;

  async function start() {
    if (!orderId || !prompt.trim()) return;
    setBusy(true); setError(null);
    try {
      // One stable id per deliberate request, so a retry replays instead of running twice.
      await run({ demoIdentity: CONTROLLER, orderId, requestId: `ui-${crypto.randomUUID()}`, prompt: prompt.trim() });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The agent could not start.");
    } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Finance agent" description="Settlement accountant and AP clerk. It reads the books through typed tools and may propose payouts. It cannot approve or sign." />
      <div className="shell">
        <div className="panel p-3">
          <label htmlFor="agent-prompt" className="mb-2 block type-label">Ask the agent</label>
          <Textarea id="agent-prompt" rows={2} value={prompt} maxLength={2000} onChange={event => setPrompt(event.target.value)} />
          {error && <p role="alert" className="mt-2 type-label-sm text-fail-text">{error}</p>}
        </div>
        <div className="shell-foot flex items-center gap-2">
          <span className="me-auto type-label-sm text-text-3">Gemini, six read and propose tools, capped batch size</span>
          <Button size="sm" disabled={busy || !prompt.trim()} onClick={start}>{busy ? "Running" : "Run agent"}</Button>
        </div>
      </div>
      {orderId && <QueryBoundary><BackgroundJobs orderId={orderId} /></QueryBoundary>}
      <Section title="Runs" meta="Newest first, last 20">
        {runs === undefined ? <Loading rows={3} /> : runs.length === 0 ? <p className="type-body-sm text-text-2">The agent has not run on this order.</p> : (
          <div className="flex flex-col gap-3">{runs.map(item => <RunCard key={item._id} run={item} />)}</div>
        )}
      </Section>
    </>
  );
}

function RunCard({ run }: { run: AgentRun }) {
  const [open, setOpen] = useState(false);
  const calls = (run.transcript ?? []) as { call: { id: string; name: string; arguments: unknown }; result?: unknown; error?: string }[];
  return (
    <article className="rounded-panel border border-line-faint">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
        <Status status={RUN_STATUS[run.status as keyof typeof RUN_STATUS] ?? "idle"}>{humanize(run.status)}</Status>
        <span className="type-label">{run.model}</span>
        {run.failureCode && <span className="type-label-sm text-fail-text">{humanize(run.failureCode)}</span>}
        <span className="type-label-sm text-text-2">Proposed <Amount value={run.proposedAtomic} /> of <Amount value={run.maxBatchAtomic} /> cap</span>
        <span className="ms-auto type-label-sm text-text-3">{formatTime(run._creationTime)}</span>
      </div>
      {calls.length > 0 && (
        <ol className="border-t border-line-faint">
          {calls.map((entry, i) => (
            <li key={entry.call.id ?? i} className="flex items-baseline gap-3 border-b border-line-faint px-4 py-2 last:border-b-0">
              <span className="w-5 shrink-0 type-label-sm text-text-3 tabular-nums">{i + 1}</span>
              <span className="type-label">{humanize(entry.call.name.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase())}</span>
              <span className="min-w-0 flex-1 truncate type-body-sm text-text-2">{entry.error ? `Refused: ${humanize(entry.error)}` : "Returned"}</span>
            </li>
          ))}
        </ol>
      )}
      {run.explanation && (
        <div className="border-t border-line-faint px-4 py-3">
          <button type="button" className="type-label-sm text-text-2 underline underline-offset-4" onClick={() => setOpen(value => !value)}>{open ? "Hide explanation" : "Show explanation"}</button>
          {open && <p className="mt-2 whitespace-pre-wrap type-body-sm text-text-1">{run.explanation}</p>}
          <p className="mt-1 type-label-sm text-text-3">Advisory text. The ledger, not this explanation, is the record.</p>
        </div>
      )}
    </article>
  );
}

const JOB_LABEL: Record<string, string> = { reconciliation: "Reconciliation", finance: "Finance agent", observation: "Chain observation", job: "Job" };

/** Stephen's hosted jobs: reconcile every 2 minutes, run the bounded agent every 10. Advisory operating records. */
function BackgroundJobs({ orderId }: { orderId: Id<"orders"> }) {
  const rows = useQuery(api.scheduledData.snapshots, { demoIdentity: CONTROLLER, orderId });
  if (!rows || rows.length === 0) return null;
  return (
    <Section title="Running on its own" meta="Hosted jobs. They observe and propose; they never approve or sign.">
      <ul className="divide-y divide-line-faint rounded-panel border border-line-faint">
        {rows.map(row => (
          <li key={row._id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
            <Status status={row.status === "failed" ? "fail" : row.status === "running" ? "running" : "ok"} className="w-28 shrink-0">{humanize(row.status)}</Status>
            <span className="type-label">{JOB_LABEL[row.kind] ?? humanize(row.kind)}</span>
            {row.lastErrorCode && <span className="type-label-sm text-fail-text">{humanize(row.lastErrorCode)}</span>}
            <span className="ms-auto type-label-sm text-text-3 tabular-nums">Updated {formatTime(row.updatedAt)} &middot; next {formatTime(row.nextAt)}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
