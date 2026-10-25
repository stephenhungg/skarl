"use client";
import { useAction, useQuery } from "convex/react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { ThinkingOrb } from "thinking-orbs";
import { VoiceBeam, useMicrophone } from "voice-glow";
import { Button } from "@/components/glaze/ui/button";
import { Status, StatusMark } from "@/components/glaze/ui/status";
import { toast } from "@/components/glaze/ui/toast";
import { api, CONTROLLER, useOrderId, useRuns, type AgentRun, type Id } from "./data";
import { formatMs, formatUsdc, humanize } from "./format";
import { Amount, Loading, PageHeader, QueryBoundary, Section, Unavailable } from "./ui";

const RUN_STATUS = { running: "running", completed: "ok", failed: "fail", capped: "warn" } as const;
const SUGGESTIONS = [
  { label: "What do we owe?", prompt: "Summarize what we owe contributors and what has been paid." },
  { label: "Propose payouts", prompt: "Propose payouts for every eligible payable and request independent approval." },
  { label: "Explain the books", prompt: "Explain the trial balance and any reconciliation exceptions." },
];
// The landing palette: lime accent through sage, so the glow reads as Skarl, not a generic rainbow.
const BRAND_GLOW = ["#c7f18e", "#b4e47c", "#9fcf6c", "#86b35d", "#c7f18e"];

/** While the agent works, gather the glow into one beam that sweeps the edge. */
const workingMotion = () => {
  const t = performance.now() / 1000;
  return { gather: 1, offset: Math.sin(t * 1.6) * 0.85, stretch: Math.abs(Math.cos(t * 1.6)) * 0.4, heldLevel: 0.65, cornerFollow: 0.6 };
};

const ACCOUNT_NAMES: Record<string, string> = {
  "asset:usdc": "USDC cash", "liability:customer_prepayments": "Customer prepayments", "liability:contributor_payables": "Contributor payables",
  "liability:customer_refunds": "Refunds payable", "revenue:dataset_sales": "Dataset sales", "expense:contributor_acquisition": "Contributor cost",
};

type Step = { call: { id?: string; name: string; arguments?: unknown }; result?: unknown; error?: string };
type Fact = { status: "ok" | "warn" | "fail" | "idle"; text: ReactNode };

/** The deterministic part of a run: what each tool actually returned, in a sentence. */
function factFor(step: Step): Fact | null {
  if (step.error) return { status: "fail", text: `Refused: ${humanize(step.error)}` };
  const r = (step.result ?? {}) as Record<string, unknown>;
  const list = (key: string) => (Array.isArray(r[key]) ? (r[key] as unknown[]) : null);
  switch (step.call.name) {
    case "listOutstandingPayables": {
      const rows = list("payables") ?? [];
      if (!rows.length) return { status: "ok", text: "Nothing owed to contributors" };
      const total = rows.reduce<bigint>((sum, row) => sum + BigInt(String((row as { amountAtomic?: string }).amountAtomic ?? "0")), 0n);
      return { status: "warn", text: <>{rows.length} {rows.length === 1 ? "payable" : "payables"} open, <Amount value={total} /> in total</> };
    }
    case "getTrialBalance":
      return r.balanced
        ? { status: "ok", text: <>Books balance, <Amount value={String(r.totalDebitAtomic ?? "0")} /> on each side</> }
        : { status: "fail", text: "Books do not balance" };
    case "listReconciliationExceptions": {
      const rows = list("exceptions") ?? [];
      return rows.length ? { status: "fail", text: `${rows.length} reconciliation ${rows.length === 1 ? "exception" : "exceptions"}` } : { status: "ok", text: "No reconciliation exceptions" };
    }
    default: {
      if (typeof r.ok === "boolean") return { status: r.ok ? "ok" : "fail", text: `${humanize(step.call.name.replace(/([a-z])([A-Z])/g, "$1_$2"))}: ${r.ok ? "done" : humanize(String(r.code ?? "refused"))}` };
      const firstList = Object.entries(r).find(([, v]) => Array.isArray(v));
      return firstList ? { status: "idle", text: `${(firstList[1] as unknown[]).length} ${humanize(firstList[0]).toLowerCase()}` } : null;
    }
  }
}

/** Make the model's prose readable: display units, account names, no database IDs. */
function clean(text: string) {
  return text
    .replace(/([\d,]+) micro-USDC/g, (_, n: string) => `${formatUsdc(n.replace(/,/g, ""))} USDC`)
    .replace(/\b(\d{1,3}(?:,\d{3}){2,})\b/g, n => `${formatUsdc(n.replace(/,/g, ""))} USDC`)
    .replace(/\b(asset|liability|revenue|expense):[a-z_]+/g, code => ACCOUNT_NAMES[code] ?? humanize(code.split(":")[1]!))
    .replace(/\bOrder [a-z0-9]{25,}\b/g, "This order")
    .replace(/\b[a-z0-9]{30,}\b/g, "this order")
    .replace(/USDC of USDC/g, "USDC");
}

/** Paragraphs, **bold** and "- " bullets, the subset the agent writes. */
function Prose({ text }: { text: string }) {
  const inline = (s: string): ReactNode => s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") ? <strong key={i} className="font-medium text-text-1">{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>);
  return (
    <div className="flex max-w-(--measure) flex-col gap-2 type-body-sm text-text-2">
      {clean(text).replace(/^#+\s*/gm, "").split(/\n{2,}/).map((block, i) => {
        const lines = block.split("\n");
        const bullets = lines.filter(l => /^\s*[-*]\s+/.test(l));
        if (bullets.length) {
          const lead = lines.find(l => !/^\s*[-*]\s+/.test(l));
          return <div key={i}>{lead && <p>{inline(lead)}</p>}<ul className="mt-1 flex list-disc flex-col gap-0.5 ps-5">{bullets.map((b, j) => <li key={j}>{inline(b.replace(/^\s*[-*]\s+/, ""))}</li>)}</ul></div>;
        }
        return <p key={i}>{inline(block)}</p>;
      })}
    </div>
  );
}

function Question({ text }: { text: string }) {
  return <div className="ms-auto max-w-[80%] rounded-shell bg-field px-4 py-2.5 type-body-sm text-text-1">{text}</div>;
}

function Exchange({ run, live }: { run: AgentRun; live?: boolean }) {
  const steps = (run.transcript ?? []) as Step[];
  const facts = steps.map(factFor).filter((f): f is Fact => !!f);
  const [showProse, setShowProse] = useState(false);
  const running = run.status === "running";
  const took = run.completedAt && run.startedAt ? formatMs(run.completedAt - run.startedAt) : null;
  const proposed = BigInt(run.proposedAtomic);
  return (
    <div className="flex flex-col gap-3">
      {run.prompt && <Question text={run.prompt} />}
      <div className="flex gap-3">
        <div className="shrink-0 pt-0.5"><ThinkingOrb state={running ? "solving" : "breathing"} size={20} paused={!running && !live} /></div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <p className="type-label-sm text-text-3">
            Finance agent{run.provider ? ` · ${humanize(run.provider)}` : ""}{took ? ` · ${took}` : ""}
            {proposed > 0n ? <> &middot; proposed <Amount value={run.proposedAtomic} /></> : null}
          </p>
          {running ? <p className="type-body text-text-2">Reading the books</p>
            : run.status === "failed" ? <p className="type-body text-fail-text">Stopped: {humanize(run.failureCode ?? "run failed")}. Nothing was proposed.</p>
            : (
              <>
                {facts.length > 0 && (
                  <ul className="flex flex-col gap-1.5">
                    {facts.map((fact, i) => (
                      <li key={i} className="flex items-center gap-2 type-body">
                        <StatusMark status={fact.status} />
                        <span>{fact.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {run.explanation && (facts.length > 0
                  ? <div>
                      <button type="button" onClick={() => setShowProse(v => !v)} aria-expanded={showProse} className="type-label-sm text-text-2 underline underline-offset-4">
                        {showProse ? "Hide the agent's explanation" : "Read the agent's explanation"}
                      </button>
                      {showProse && <div className="mt-2"><Prose text={run.explanation} /></div>}
                    </div>
                  : <Prose text={run.explanation} />)}
              </>
            )}
        </div>
      </div>
    </div>
  );
}

function EarlierRun({ run }: { run: AgentRun }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
        className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-start hover:bg-hover-row">
        <Status status={RUN_STATUS[run.status as keyof typeof RUN_STATUS] ?? "idle"} className="w-28 shrink-0">{humanize(run.status)}</Status>
        <span className="min-w-0 flex-1 truncate type-body-sm">{run.prompt ?? "Agent run"}</span>
        <span className="type-label-sm text-text-3">{new Date(run._creationTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
      </button>
      {open && <div className="px-4 pb-4 pt-1"><Exchange run={run} /></div>}
    </li>
  );
}

type Recognition = { start(): void; stop(): void; continuous: boolean; interimResults: boolean; lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null };

/** Browser dictation into the prompt. `supported` is false where the browser has no speech recognition. */
function useDictation(onText: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    setSupported(!!Ctor);
    if (!Ctor) return;
    const r = new Ctor();
    r.continuous = true; r.interimResults = true; r.lang = "en-US";
    r.onresult = event => onText(Array.from(event.results).map(result => result[0]!.transcript).join(" ").trim());
    recognition.current = r;
  }, [onText]);
  return { supported, recognition };
}

export function Agent() {
  const orderId = useOrderId();
  const runs = useRuns(orderId);
  const run = useAction(api.financeAgent.run);
  const mic = useMicrophone();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const onVoice = useRef((text: string) => setPrompt(text)).current;
  const dictation = useDictation(onVoice);
  const listening = mic.state === "live";
  if (orderId === null) return <Unavailable title="No staged order" description="Run pnpm seed to stage the demo order." />;

  function stopListening() {
    try { dictation.recognition.current?.stop(); } catch { /* not started */ }
    mic.stop();
  }
  async function startListening() {
    await mic.start();
    try { dictation.recognition.current?.start(); } catch { /* already started */ }
  }
  async function start(text = prompt) {
    if (!orderId || !text.trim() || busy) return;
    if (listening) stopListening();
    setPending(text.trim()); setPrompt(""); setBusy(true);
    try {
      // One stable id per deliberate request, so a retry replays instead of running twice.
      await run({ demoIdentity: CONTROLLER, orderId, requestId: `ui-${crypto.randomUUID()}`, prompt: text.trim() });
    } catch (error) {
      toast.fail("The agent could not start", { description: error instanceof Error ? error.message : undefined });
      setPrompt(text);
    } finally { setBusy(false); setPending(null); }
  }

  const [latest, ...earlier] = runs ?? [];
  return (
    <>
      <PageHeader title="Finance agent" />
      <VoiceBeam stream={mic.stream} motion={busy ? workingMotion : null} colors={BRAND_GLOW} theme="light" active={listening || busy} className="rounded-[20px]">
        <div className="rounded-[20px] border border-line-control bg-paper p-3 focus-within:border-line-focus">
          <textarea value={prompt} onChange={event => setPrompt(event.target.value)} rows={2} maxLength={2000}
            placeholder={listening ? "Listening" : "Ask about payouts, the books or reconciliation"} aria-label="Ask the finance agent"
            onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void start(); } }}
            className="w-full resize-none bg-transparent px-1 type-body text-text-1 outline-none placeholder:text-text-3" />
          <div className="mt-2 flex items-center gap-2">
            {dictation.supported && mic.supported && (
              <Button variant="secondary" size="sm" onClick={() => (listening ? stopListening() : void startListening())}>{listening ? "Stop" : "Dictate"}</Button>
            )}
            <span className="me-auto type-label-sm text-text-3">{mic.state === "denied" ? "Microphone blocked in this browser" : "Enter to send"}</span>
            <Button size="sm" disabled={busy || !prompt.trim()} onClick={() => void start()}>{busy ? "Working" : "Ask"}</Button>
          </div>
        </div>
      </VoiceBeam>
      <div className="mt-3 flex flex-wrap gap-2">
        {SUGGESTIONS.map(s => (
          <button key={s.label} type="button" disabled={busy} onClick={() => void start(s.prompt)} title={s.prompt}
            className="rounded-pill border border-line-control px-3 py-1 type-label-sm text-text-2 hover:bg-hover hover:text-text-1 disabled:opacity-50">{s.label}</button>
        ))}
      </div>

      <section className="mt-8" aria-label="Latest answer">
        {pending ? (
          <div className="flex flex-col gap-3">
            <Question text={pending} />
            <div className="flex items-center gap-3"><ThinkingOrb state="solving" size={64} /><span className="type-body text-text-2">Reading the books</span></div>
          </div>
        ) : runs === undefined ? <Loading rows={3} /> : latest ? <Exchange run={latest} live /> : null}
      </section>

      {orderId && <QueryBoundary><BackgroundJobs orderId={orderId} /></QueryBoundary>}

      {earlier.length > 0 && (
        <Section title="Earlier questions">
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
  const rows = useQuery(api.scheduledData.snapshots, { demoIdentity: CONTROLLER, orderId });
  if (!rows || rows.length === 0) return null;
  const ago = (ms: number) => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? "just now" : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`; };
  return (
    <Section title="Running on its own">
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
