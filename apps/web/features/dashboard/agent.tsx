"use client";
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { ThinkingOrb } from "thinking-orbs";
import { VoiceBeam, useMicrophone } from "voice-glow";
import { StatusMark } from "@/components/glaze/ui/status";
import { toast } from "@/components/glaze/ui/toast";
import { SendButton } from "@/components/glaze/ai/send-button";
import { api, BUYER, useExceptions, useOrderData, useOrderId, useRuns, useStatements, type AgentRun, type Id, type PayableRow } from "./data";
import { formatMs, formatUsdc, humanize } from "./format";
import { Amount, Loading, Unavailable } from "./ui";
import { cn } from "@/lib/glaze/utils";

const SUGGESTIONS = [
  { label: "What do we owe?", prompt: "Summarize what we owe contributors and what has been paid." },
  { label: "Propose payouts", prompt: "Propose payouts for every eligible payable and request approval." },
  { label: "Explain the books", prompt: "Explain the trial balance and any reconciliation exceptions." },
];
const PROPOSE = SUGGESTIONS[1]!.prompt;
// Earlier turns ride along in the prompt so follow-ups make sense; the server caps a prompt at 2000 characters.
const NOW = "\n\nNow: ";
function withHistory(text: string, runs: AgentRun[]) {
  let history = "";
  for (const run of runs.slice(0, 3)) {
    const turn = `Q: ${shown(run.prompt)}\nA: ${(run.explanation ?? "").slice(0, 400)}\n`;
    if (history.length + turn.length + text.length > 1800) break;
    history = turn + history;
  }
  return history ? `Earlier in this conversation:\n${history}${NOW}${text}` : text;
}
const shown = (prompt: string) => (prompt.includes(NOW) ? prompt.slice(prompt.lastIndexOf(NOW) + NOW.length) : prompt);
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

function UserMessage({ text }: { text: string }) {
  return <div className="ms-auto max-w-[85%] whitespace-pre-wrap rounded-[20px] bg-field px-4 py-2.5 type-body text-text-1">{text}</div>;
}

function AgentMessage({ run, live, payables }: { run: AgentRun; live?: boolean; payables: PayableRow[] | undefined }) {
  const steps = (run.transcript ?? []) as Step[];
  const facts = steps.map(factFor).filter((f): f is Fact => !!f);
  const [showProse, setShowProse] = useState(false);
  const running = run.status === "running";
  const took = run.completedAt && run.startedAt ? formatMs(run.completedAt - run.startedAt) : null;
  const proposed = BigInt(run.proposedAtomic);
  return (
    <div className="flex gap-3">
      <div className="shrink-0 pt-1"><ThinkingOrb state={running ? "solving" : "breathing"} size={20} paused={!running && !live} /></div>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        {running ? <p className="type-body text-text-2">Reading the books</p>
          : run.status === "failed" ? <p className="type-body text-fail-text">Stopped: {humanize(run.failureCode ?? "run failed")}. Nothing was proposed.</p>
          : (
            <>
              {facts.length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {facts.map((fact, i) => (
                    <li key={i} className="flex items-center gap-2 type-body"><StatusMark status={fact.status} /><span>{fact.text}</span></li>
                  ))}
                </ul>
              )}
              <Proposals steps={steps} payables={payables} />
              {run.explanation && (facts.length > 0
                ? <div>
                    <button type="button" onClick={() => setShowProse(v => !v)} aria-expanded={showProse} className="type-label-sm text-text-2 underline underline-offset-4">
                      {showProse ? "Hide explanation" : "Show explanation"}
                    </button>
                    {showProse && <div className="mt-2"><Prose text={run.explanation} /></div>}
                  </div>
                : <Prose text={run.explanation} />)}
            </>
          )}
        <p className="type-label-sm text-text-3">
          {run.provider ? humanize(run.provider) : "Agent"}{took ? ` \u00b7 ${took}` : ""}
          {proposed > 0n ? <> &middot; proposed <Amount value={run.proposedAtomic} /></> : null}
          {" \u00b7 "}{new Date(run._creationTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
        </p>
      </div>
    </div>
  );
}


type Gate = { status: "ok" | "warn" | "fail" | "idle" | "running"; label: ReactNode };
const SENT = new Set(["submitted", "pending", "reconciling"]), SETTLED = new Set(["confirmed", "finalized"]);

/** Where one proposed payout stands, read live: the agent proposes, your rule or you approve, the executor sends. */
function gates(row: PayableRow | undefined): Gate[] {
  const intent = row?.intent, approval = row?.approval;
  const byPolicy = approval?.approverTokenIdentifier.includes("policy-engine");
  const stopped = intent?.status === "failed" || intent?.status === "cancelled" || row?.status === "reversed";
  return [
    { status: "ok", label: "Agent proposed" },
    approval ? { status: "ok", label: byPolicy ? "Your auto-pay rule approved" : "You approved" }
      : stopped ? { status: "fail", label: `Stopped: ${humanize(intent?.status ?? row?.status ?? "refused")}` }
      : { status: "warn", label: <>Waiting on your rule or <Link href="/dashboard/inbox" className="underline underline-offset-4">your review</Link></> },
    row?.status === "paid" || (intent && SETTLED.has(intent.status)) ? { status: "ok", label: "Paid on Base Sepolia" }
      : intent && SENT.has(intent.status) ? { status: "running", label: "Sending on Base Sepolia" }
      : { status: "idle", label: "Not sent" },
  ];
}

function Proposals({ steps, payables }: { steps: Step[]; payables: PayableRow[] | undefined }) {
  const proposed = steps.flatMap(step => {
    const r = step.result as { ok?: boolean; results?: { payableId: string; amountAtomic: string }[] } | undefined;
    return step.call.name === "proposePaymentBatch" && r?.ok ? r.results ?? [] : [];
  });
  if (!proposed.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {proposed.map(item => {
        const row = payables?.find(p => p._id === item.payableId);
        return (
          <Link key={item.payableId} href="/dashboard/payables" className="rounded-panel border border-line-faint bg-paper p-3 hover:bg-hover-row">
            <div className="mb-2.5 flex items-baseline justify-between gap-3">
              <span className="type-label">Payout proposal</span>
              <span className="type-heading-sm"><Amount value={item.amountAtomic} /></span>
            </div>
            <ol className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-0">
              {gates(row).map((gate, i) => (
                <li key={i} className="flex items-center gap-2 type-body-sm sm:flex-1">
                  <StatusMark status={gate.status} />
                  <span className={cn(gate.status === "idle" ? "text-text-3" : "text-text-1")}>{gate.label}</span>
                  {i < 2 && <span aria-hidden className="ms-auto me-3 hidden h-px w-6 bg-line sm:block" />}
                </li>
              ))}
            </ol>
          </Link>
        );
      })}
    </div>
  );
}

/** Live facts, no model: what is owed, whether the books balance, what is broken. Every row goes where you act. */
function Brief({ orderId }: { orderId: Id<"orders"> }) {
  const { payables } = useOrderData(orderId);
  const statements = useStatements(orderId);
  const exceptions = useExceptions(orderId);
  if (!payables || !statements || !exceptions) return null;
  const open = payables.filter(p => p.status === "accrued" || p.status === "payout_in_progress");
  const owed = open.reduce((sum, p) => sum + BigInt(p.amountAtomic), 0n);
  const waiting = payables.filter(p => p.intent?.status === "proposed" && !p.approval).length;
  const broken = exceptions.filter(e => e.stillDetected && e.disposition?.status !== "resolved").length;
  const rows: { href: string; status: Gate["status"]; text: ReactNode }[] = [
    { href: "/dashboard/payables", status: open.length ? "warn" : "ok",
      text: open.length ? <>{open.length} {open.length === 1 ? "payout" : "payouts"} owed, <Amount value={owed} /></> : "Nothing owed to contributors" },
    ...(waiting ? [{ href: "/dashboard/inbox", status: "warn" as const, text: `${waiting} ${waiting === 1 ? "proposal waits" : "proposals wait"} on approval` }] : []),
    { href: "/dashboard/ledger", status: "ok", text: <>Books balance at <Amount value={statements.trialBalance.totalDebitAtomic} /></> },
    { href: "/dashboard/reconciliation", status: broken ? "fail" : "ok", text: broken ? `${broken} reconciliation ${broken === 1 ? "exception" : "exceptions"}` : "Chain, bank and ledger agree" },
  ];
  return (
    <ul className="flex flex-col divide-y divide-line-faint overflow-hidden rounded-panel border border-line-faint bg-paper sm:flex-row sm:divide-x sm:divide-y-0">
      {rows.map(row => (
        <li key={row.href} className="min-w-0 sm:flex-1">
          <Link href={row.href} className="flex items-center gap-2 px-3 py-2.5 type-body-sm hover:bg-hover-row"><StatusMark status={row.status} />{row.text}</Link>
        </li>
      ))}
    </ul>
  );
}

type ScenarioResult = FunctionReturnType<typeof api.scenarios.run>;

/** The real refusal path, run on a disposable lab copy of this order: the agent tries to approve its own proposal. */
function SelfApproval({ result, onPropose }: { result: ScenarioResult | "running"; onPropose: () => void }) {
  if (result === "running") return (
    <div className="flex items-center gap-3"><ThinkingOrb state="solving" size={20} /><span className="type-body text-text-2">Agent is trying to approve its own payout</span></div>
  );
  const missing = !result.passed && result.observedOutcome.startsWith("requires ");
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className={cn("rounded-panel border p-4", missing ? "border-line-faint" : result.passed ? "border-fail-text/40 bg-fail-text/5" : "border-warn-text/40")}>
      {missing ? <>
        <p className="type-label">The agent needs a payout proposal to try this on.</p>
        <button type="button" onClick={onPropose} className="mt-2 type-label-sm underline underline-offset-4">Ask it to propose payouts</button>
      </> : result.passed ? <>
        <p className="flex items-center gap-2 type-heading-sm"><StatusMark status="fail" />Refused: the agent cannot approve its own payout</p>
        <p className="mt-1.5 type-body-sm text-text-2">Nothing was approved or sent. The refusal is in the audit log.</p>
        <Link href="/dashboard/audit" className="mt-2 inline-block type-label-sm underline underline-offset-4">Open audit log</Link>
      </> : <>
        <p className="flex items-center gap-2 type-heading-sm"><StatusMark status="warn" />The control did not hold</p>
        <p className="mt-1.5 type-body-sm text-text-2">{readable(result.observedOutcome)}</p>
        <Link href="/dashboard/scenarios" className="mt-2 inline-block type-label-sm underline underline-offset-4">Open scenario lab</Link>
      </>}
    </motion.div>
  );
}
const readable = (text: string) => text.charAt(0).toUpperCase() + text.slice(1).replace(/_/g, " ");

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
  const runScenario = useAction(api.scenarios.run);
  const { payables } = useOrderData(orderId);
  const [selfTest, setSelfTest] = useState<ScenarioResult | "running" | null>(null);
  const mic = useMicrophone();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const onVoice = useRef((text: string) => setPrompt(text)).current;
  const dictation = useDictation(onVoice);
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const listening = mic.state === "live";
  // Oldest first, like any chat; runs arrive newest first.
  const thread = [...(runs ?? [])].reverse();

  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [thread.length, pending, selfTest]);
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [prompt]);

  if (orderId === null) return <Unavailable title="No staged order" description="Run pnpm seed to stage the demo order." />;

  function stopListening() {
    try { dictation.recognition.current?.stop(); } catch { /* not started */ }
    mic.stop();
  }
  async function startListening() {
    await mic.start();
    try { dictation.recognition.current?.start(); } catch { /* already started */ }
  }
  async function send(text = prompt) {
    if (!orderId || !text.trim() || busy) return;
    if (listening) stopListening();
    setPending(text.trim()); setPrompt(""); setBusy(true);
    try {
      // One stable id per deliberate request, so a retry replays instead of running twice.
      await run({ demoIdentity: BUYER, orderId, requestId: `ui-${crypto.randomUUID()}`, prompt: withHistory(text.trim(), runs ?? []) });
    } catch (error) {
      toast.fail("The agent could not answer", { description: error instanceof Error ? error.message : undefined });
      setPrompt(text);
    } finally { setBusy(false); setPending(null); }
  }

  async function trySelfApproval() {
    if (!orderId || selfTest === "running") return;
    setSelfTest("running");
    try { setSelfTest(await runScenario({ demoIdentity: BUYER, scenario: "agent_self_approval", orderId })); }
    catch (error) {
      setSelfTest(null);
      toast.fail("Could not run the test", { description: error instanceof Error ? error.message : undefined });
    }
  }

  const chips = (
    <div className="flex flex-wrap justify-center gap-2">
      {SUGGESTIONS.map(s => (
        <button key={s.label} type="button" disabled={busy} onClick={() => void send(s.prompt)} title={s.prompt}
          className="rounded-pill border border-line-control px-3.5 py-1.5 type-label-sm text-text-2 hover:bg-hover hover:text-text-1 disabled:opacity-50">{s.label}</button>
      ))}
      <button type="button" disabled={selfTest === "running"} onClick={() => void trySelfApproval()}
        className="rounded-pill border border-fail-text/40 px-3.5 py-1.5 type-label-sm text-fail-text hover:bg-fail-text/5 disabled:opacity-50">Make it approve itself</button>
    </div>
  );
  const empty = runs !== undefined && thread.length === 0 && !pending && !selfTest;
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-9rem)] w-full max-w-3xl flex-col">
      {orderId && <div className="pb-6 pt-2"><Brief orderId={orderId} /></div>}
      <div className="flex-1">
        {runs === undefined ? <Loading rows={3} /> : empty ? (
          <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-5 text-center">
            <ThinkingOrb state="breathing" size={64} />
            <h1 className="type-title">What should we check in the books?</h1>
            {chips}
          </div>
        ) : (
          <div className="flex flex-col gap-8 pb-6 pt-2">
            {thread.map((item, index) => (
              <div key={item._id} className="flex flex-col gap-4">
                {item.prompt && <UserMessage text={shown(item.prompt)} />}
                <AgentMessage run={item} live={index === thread.length - 1} payables={payables} />
              </div>
            ))}
            {pending && (
              <div className="flex flex-col gap-4">
                <UserMessage text={pending} />
                <div className="flex items-center gap-3"><ThinkingOrb state="solving" size={20} /><span className="type-body text-text-2">Reading the books</span></div>
              </div>
            )}
            <AnimatePresence>{selfTest && <SelfApproval result={selfTest} onPropose={() => void send(PROPOSE)} />}</AnimatePresence>
            <div ref={end} />
          </div>
        )}
      </div>

      <div className="sticky bottom-0 flex flex-col gap-3 bg-page pb-4 pt-2">
        {!empty && chips}
        <VoiceBeam stream={mic.stream} motion={busy ? workingMotion : null} colors={BRAND_GLOW} theme="light" active={listening || busy} className="rounded-[24px]">
          <div className="flex items-end gap-2 rounded-[24px] border border-line-control bg-paper py-2 pe-2 ps-4 focus-within:border-line-focus">
            <textarea ref={input} value={prompt} onChange={event => setPrompt(event.target.value)} rows={1} maxLength={2000}
              placeholder={listening ? "Listening" : "Ask the finance agent"} aria-label="Ask the finance agent"
              onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }}
              className="max-h-[200px] min-h-6 flex-1 resize-none self-center bg-transparent py-1.5 type-body text-text-1 shadow-none outline-none placeholder:text-text-3 focus-visible:outline-none focus-visible:shadow-none [&:focus-visible]:[outline:none]" />
            {dictation.supported && mic.supported && (
              <button type="button" onClick={() => (listening ? stopListening() : void startListening())} aria-pressed={listening}
                className={cn("h-9 shrink-0 rounded-pill px-3 type-label-sm", listening ? "bg-ink text-text-inverse" : "text-text-2 hover:bg-hover")}>
                {listening ? "Stop" : "Dictate"}
              </button>
            )}
            <SendButton empty={!prompt.trim()} disabled={busy} onClick={() => void send()} className="shrink-0" />
          </div>
        </VoiceBeam>
      </div>
    </div>
  );
}
