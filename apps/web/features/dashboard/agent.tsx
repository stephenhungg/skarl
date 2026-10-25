"use client";
import { useAction } from "convex/react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { ThinkingOrb } from "thinking-orbs";
import { VoiceBeam, useMicrophone } from "voice-glow";
import { StatusMark } from "@/components/glaze/ui/status";
import { toast } from "@/components/glaze/ui/toast";
import { SendButton } from "@/components/glaze/ai/send-button";
import { api, BUYER, useOrderId, useRuns, type AgentRun } from "./data";
import { formatMs, formatUsdc, humanize } from "./format";
import { Amount, Loading, Unavailable } from "./ui";
import { cn } from "@/lib/glaze/utils";

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

function UserMessage({ text }: { text: string }) {
  return <div className="ms-auto max-w-[85%] whitespace-pre-wrap rounded-[20px] bg-field px-4 py-2.5 type-body text-text-1">{text}</div>;
}

function AgentMessage({ run, live }: { run: AgentRun; live?: boolean }) {
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
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const listening = mic.state === "live";
  // Oldest first, like any chat; runs arrive newest first.
  const thread = [...(runs ?? [])].reverse();

  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [thread.length, pending]);
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
      await run({ demoIdentity: BUYER, orderId, requestId: `ui-${crypto.randomUUID()}`, prompt: text.trim() });
    } catch (error) {
      toast.fail("The agent could not answer", { description: error instanceof Error ? error.message : undefined });
      setPrompt(text);
    } finally { setBusy(false); setPending(null); }
  }

  const empty = runs !== undefined && thread.length === 0 && !pending;
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-9rem)] w-full max-w-3xl flex-col">
      <div className="flex-1">
        {runs === undefined ? <Loading rows={3} /> : empty ? (
          <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-5 text-center">
            <ThinkingOrb state="breathing" size={64} />
            <h1 className="type-title">What should we check in the books?</h1>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map(s => (
                <button key={s.label} type="button" onClick={() => void send(s.prompt)} title={s.prompt}
                  className="rounded-pill border border-line-control px-3.5 py-1.5 type-label-sm text-text-2 hover:bg-hover hover:text-text-1">{s.label}</button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-8 pb-6 pt-2">
            {thread.map((item, index) => (
              <div key={item._id} className="flex flex-col gap-4">
                {item.prompt && <UserMessage text={item.prompt} />}
                <AgentMessage run={item} live={index === thread.length - 1} />
              </div>
            ))}
            {pending && (
              <div className="flex flex-col gap-4">
                <UserMessage text={pending} />
                <div className="flex items-center gap-3"><ThinkingOrb state="solving" size={20} /><span className="type-body text-text-2">Reading the books</span></div>
              </div>
            )}
            <div ref={end} />
          </div>
        )}
      </div>

      <div className="sticky bottom-0 bg-page pb-4 pt-2">
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
