"use client";
import { useAction, useQuery } from "convex/react";
import { Fragment, useState, type ReactNode } from "react";
import { Button } from "@/components/glaze/ui/button";
import { Status } from "@/components/glaze/ui/status";
import { Textarea } from "@/components/glaze/ui/textarea";
import { toast } from "@/components/glaze/ui/toast";
import { cn } from "@/lib/glaze/utils";
import { api, BUYER, useOrderId, useRuns, type AgentRun, type Id } from "./data";
import { formatMs, formatUsdc, humanize } from "./format";
import { Loading, PageHeader, QueryBoundary, Section, Unavailable } from "./ui";

const RUN_STATUS = { running: "running", completed: "ok", failed: "fail", capped: "warn" } as const;
const SUGGESTIONS = [
  "Summarize what we owe contributors and what has been paid.",
  "Propose payouts for every eligible payable and request independent approval.",
  "Explain the trial balance and any reconciliation exceptions.",
];

type Step = { call: { id?: string; name: string; arguments?: unknown }; result?: unknown; error?: string };

const toolName = (name: string) => humanize(name.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase());

/** What a tool found, in a few words, instead of "Returned". */
function toolSummary(step: Step): string {
  if (step.error) return `Refused: ${humanize(step.error)}`;
  const result = step.result;
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    if (typeof record.balanced === "boolean") return record.balanced ? "Books balance" : "Books do not balance";
    const list = Object.entries(record).find(([, value]) => Array.isArray(value));
    if (list) { const n = (list[1] as unknown[]).length; return `${n} ${humanize(list[0]).toLowerCase()}`; }
    if (typeof record.ok === "boolean") return record.ok ? "Done" : `Refused: ${humanize(String(record.code ?? "refused"))}`;
  }
  return "Done";
}

/** Small markdown subset the agent writes: paragraphs, **bold** and "- " bullets. Micro-USDC figures become USDC. */
function Answer({ text }: { text: string }) {
  const usdc = (s: string) => s.replace(/([\d,]+) micro-USDC/g, (_, n: string) => `${formatUsdc(n.replace(/,/g, ""))} USDC`);
  const inline = (s: string): ReactNode => usdc(s).split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") ? <strong key={i} className="font-medium text-text-1">{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>);
  const blocks = text.replace(/^#+\s*/gm, "**").split(/\n{2,}/);
  return (
    <div className="flex max-w-(--measure) flex-col gap-3 type-body text-text-1">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        const bullets = lines.filter(l => /^\s*[-*]\s+/.test(l));
        if (bullets.length && bullets.length === lines.length - (/^\s*[-*]\s+/.test(lines[0]!) ? 0 : 1)) {
          const lead = /^\s*[-*]\s+/.test(lines[0]!) ? null : lines[0]!;
          return <div key={i}>{lead && <p>{inline(lead)}</p>}<ul className="mt-1 flex list-disc flex-col gap-1 ps-5 text-text-2">{bullets.map((b, j) => <li key={j}>{inline(b.replace(/^\s*[-*]\s+/, ""))}</li>)}</ul></div>;
        }
        return <p key={i} className="text-text-2">{inline(block)}</p>;
      })}
    </div>
  );
}

function RunMeta({ run }: { run: AgentRun }) {
  const took = run.completedAt && run.startedAt ? formatMs(run.completedAt - run.startedAt) : null;
  const proposed = BigInt(run.proposedAtomic);
  return (
    <span className="type-label-sm text-text-3">
      {run.model} &middot; {new Date(run._creationTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}{took ? ` · took ${took}` : ""}
      {" · "}{proposed > 0n ? `proposed ${formatUsdc(run.proposedAtomic)} of ${formatUsdc(run.maxBatchAtomic)} USDC cap` : "no payouts proposed"}
    </span>
  );
}

function Tools({ steps }: { steps: Step[] }) {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;
  return (
    <div>
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} className="type-label-sm text-text-2 underline-offset-4 hover:underline">
        {open ? "Hide tools" : `Used ${steps.length} ${steps.length === 1 ? "tool" : "tools"}: ${steps.map(s => toolName(s.call.name)).join(", ")}`}
      </button>
      {open && (
        <ol className="mt-2 flex flex-col gap-1 border-s border-line ps-3">
          {steps.map((step, i) => (
            <li key={step.call.id ?? i} className="flex items-baseline gap-3 type-body-sm">
              <span className="text-text-1">{toolName(step.call.name)}</span>
              <span className={cn("text-text-2", step.error && "text-fail-text")}>{toolSummary(step)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function LatestRun({ run }: { run: AgentRun }) {
  const steps = (run.transcript ?? []) as Step[];
  return (
    <article className="shell">
      <div className="panel flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Status status={RUN_STATUS[run.status as keyof typeof RUN_STATUS] ?? "idle"}>{humanize(run.status)}</Status>
          <RunMeta run={run} />
        </div>
        {run.prompt && <p className="type-body-sm text-text-3">You asked: <span className="text-text-2">{run.prompt}</span></p>}
        {run.status === "running" ? <p className="type-body text-text-2">Working through the books&hellip;</p>
          : run.explanation ? <Answer text={run.explanation} />
          : <p className="type-body text-fail-text">{run.failureCode ? `The run stopped: ${humanize(run.failureCode)}. Nothing was proposed.` : "No answer was recorded."}</p>}
        <Tools steps={steps} />
      </div>
      <div className="shell-foot type-label-sm text-text-2">Advisory. The ledger is the record; the agent can propose but never approve or sign.</div>
    </article>
  );
}

function EarlierRun({ run }: { run: AgentRun }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
        className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-start hover:bg-hover-row">
        <Status status={RUN_STATUS[run.status as keyof typeof RUN_STATUS] ?? "idle"} className="w-28 shrink-0">{humanize(run.status)}</Status>
        <span className="min-w-0 flex-1 truncate type-body-sm">{run.failureCode ? `Stopped: ${humanize(run.failureCode)}` : run.prompt ?? "Agent run"}</span>
        <span className="type-label-sm text-text-3 tabular-nums">{new Date(run._creationTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
      </button>
      {open && <div className="px-4 pb-4"><LatestRun run={run} /></div>}
    </li>
  );
}

export function Agent() {
  const orderId = useOrderId();
  const runs = useRuns(orderId);
  const run = useAction(api.financeAgent.run);
  const [prompt, setPrompt] = useState(SUGGESTIONS[0]!);
  const [busy, setBusy] = useState(false);
  if (orderId === null) return <Unavailable title="No staged order" description="Run pnpm seed to stage the demo order." />;

  async function start(text = prompt) {
    if (!orderId || !text.trim()) return;
    setPrompt(text); setBusy(true);
    try {
      // One stable id per deliberate request, so a retry replays instead of running twice.
      await toast.promise(run({ demoIdentity: BUYER, orderId, requestId: `ui-${crypto.randomUUID()}`, prompt: text.trim() }), {
        loading: "Finance agent working", success: "Answer ready", fail: "The agent could not start" });
    } catch { /* reported by the toast */ } finally { setBusy(false); }
  }

  const [latest, ...earlier] = runs ?? [];
  return (
    <>
      <PageHeader title="Finance agent" description="Settlement accountant and AP clerk. It reads the books through typed tools and may propose payouts. It cannot approve or sign." />
      <div className="shell">
        <div className="panel flex flex-col gap-3 p-3">
          <Textarea aria-label="Ask the finance agent" rows={2} value={prompt} maxLength={2000} onChange={event => setPrompt(event.target.value)}
            onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void start(); }} />
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map(s => (
              <button key={s} type="button" disabled={busy} onClick={() => void start(s)}
                className="rounded-pill border border-line-control px-3 py-1 type-label-sm text-text-2 hover:bg-hover hover:text-text-1 disabled:opacity-50">{s}</button>
            ))}
          </div>
        </div>
        <div className="shell-foot flex items-center gap-2">
          <span className="me-auto type-label-sm text-text-3">Cmd+Enter to send</span>
          <Button size="sm" disabled={busy || !prompt.trim()} onClick={() => void start()}>{busy ? "Working" : "Ask agent"}</Button>
        </div>
      </div>

      <Section title="Latest answer">
        {runs === undefined ? <Loading rows={4} /> : !latest ? <p className="type-body-sm text-text-2">Ask a question above. Answers and the tools used appear here.</p> : <LatestRun run={latest} />}
      </Section>

      {orderId && <QueryBoundary><BackgroundJobs orderId={orderId} /></QueryBoundary>}

      {earlier.length > 0 && (
        <Section title="Earlier runs" meta={`${earlier.length} more`}>
          <ul className="divide-y divide-line-faint rounded-panel border border-line-faint">{earlier.map(item => <EarlierRun key={item._id} run={item} />)}</ul>
        </Section>
      )}
    </>
  );
}

const JOB: Record<string, { label: string; every: string }> = {
  reconciliation: { label: "Reconciliation", every: "every 2 minutes" },
  finance: { label: "Finance agent", every: "every 10 minutes" },
  observation: { label: "Chain observation", every: "on new transfers" },
  job: { label: "Job", every: "scheduled" },
};

/** Stephen's hosted jobs. Advisory operating records: they observe and propose, never approve or sign. */
function BackgroundJobs({ orderId }: { orderId: Id<"orders"> }) {
  const rows = useQuery(api.scheduledData.snapshots, { demoIdentity: BUYER, orderId });
  if (!rows || rows.length === 0) return null;
  const ago = (ms: number) => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? "just now" : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`; };
  return (
    <Section title="Running on its own" meta="Observe and propose only">
      <ul className="divide-y divide-line-faint rounded-panel border border-line-faint">
        {rows.map(row => (
          <li key={row._id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
            <Status status={row.status === "failed" ? "fail" : row.status === "running" ? "running" : "ok"} className="w-28 shrink-0">{humanize(row.status)}</Status>
            <span className="type-label">{JOB[row.kind]?.label ?? humanize(row.kind)}</span>
            <span className="type-body-sm text-text-2">runs {JOB[row.kind]?.every ?? "on a schedule"}</span>
            {row.lastErrorCode && <span className="type-label-sm text-fail-text">{humanize(row.lastErrorCode)}</span>}
            <span className="ms-auto type-label-sm text-text-3">last ran {ago(row.updatedAt)}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
