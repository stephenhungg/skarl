"use client";
import { useConvexConnectionState, useQuery } from "convex/react";
import { motion } from "motion/react";
import { Component, useEffect, useState, type ReactNode } from "react";
import { useConvexConfig } from "@/components/convex-provider";
import { DEMO_IDENTITY, refs, type OrderSummary, type Payable, type Submission } from "./api";
import { CONSENT_ITEMS, Consent, type ConsentId } from "./consent";
import { RecorderStage } from "./recorder-stage";
import { SubmissionPanel } from "./submission-panel";
import { TaskBrief } from "./task-brief";
import { Eyebrow, Pill } from "./ui";
import { useRecorder, type Clip } from "./use-recorder";
import { useSubmit, type SubmitState } from "./use-submit";

const SETTLE = [0.43, 0.42, 0.37, 0.97] as const;
const UNREACHABLE_AFTER_MS = 8000;

type Backend =
  | { kind: "ready"; url: string }
  | { kind: "connecting"; url: string }
  | { kind: "missing" }
  | { kind: "invalid"; url: string; reason: string }
  | { kind: "unreachable"; url: string }
  | { kind: "not_seeded"; url: string }
  | { kind: "error"; url: string; detail: string };

const host = (url: string) => { try { return new URL(url).host; } catch { return url; } };

function unavailableCopy(backend: Backend): { title: string; body: ReactNode } | undefined {
  switch (backend.kind) {
    case "missing": return {
      title: "Submissions are off in this build",
      body: <>NEXT_PUBLIC_CONVEX_URL isn&apos;t set, so there&apos;s nowhere to upload to. Add it to apps/web/.env.local and restart the dev server. The camera and playback still work, and nothing leaves this browser.</>,
    };
    case "invalid": return { title: "The Convex URL is invalid", body: <>NEXT_PUBLIC_CONVEX_URL is <span className="mono text-[12px]">{backend.url}</span>, which the client rejected: {backend.reason}</> };
    case "unreachable": return { title: "Can't reach the backend", body: <>No connection to <span className="mono text-[12px]">{host(backend.url)}</span> after {UNREACHABLE_AFTER_MS / 1000} seconds. Check your network. Nothing has been uploaded.</> };
    case "not_seeded": return { title: "The demo order doesn't exist yet", body: <>The deployment answered, but the red-cup order isn&apos;t seeded. Run <span className="mono text-[12px]">pnpm seed</span> against it.</> };
    case "error": return { title: "The backend returned an error", body: <span className="mono break-words text-[12px]">{backend.detail}</span> };
    case "connecting": return { title: "Connecting to the backend", body: "Hold on while the live order loads." };
    default: return undefined;
  }
}

function unavailableReason(backend: Backend) {
  return backend.kind === "ready" ? undefined : unavailableCopy(backend)?.title.concat(".");
}

function BackendBadge({ backend }: { backend: Backend }) {
  if (backend.kind === "ready") return <span className="flex items-center gap-2"><Pill tone="accent">LIVE</Pill><span className="mono text-[12px] text-slate-500">{host(backend.url)}</span></span>;
  if (backend.kind === "connecting") return <Pill tone="muted">CONNECTING</Pill>;
  return <Pill tone="strong">BACKEND UNAVAILABLE</Pill>;
}

const NO_CONSENT = Object.fromEntries(CONSENT_ITEMS.map(item => [item.id, false])) as Record<ConsentId, boolean>;

type ShellProps = {
  backend: Backend;
  summary: OrderSummary | null | undefined;
  history?: Submission[];
  payables?: Payable[];
  submitter?: { state: SubmitState; submit: (clip: Clip) => void; reset: () => void };
};

function clipOf(recorder: ReturnType<typeof useRecorder>) {
  return recorder.state.phase === "recorded" ? recorder.state.clip : null;
}

/** Layout and local recording. Works without a backend; uploading needs `submitter`. */
function Shell({ backend, summary, history, payables, submitter }: ShellProps) {
  const recorder = useRecorder();
  const [consent, setConsent] = useState(NO_CONSENT);
  const consented = CONSENT_ITEMS.every(item => consent[item.id]);
  const clip = clipOf(recorder);
  const submitState: SubmitState = submitter?.state ?? { phase: "idle" };
  const busy = ["hashing", "uploading", "finalizing"].includes(submitState.phase);
  const done = submitState.phase === "queued";

  const current = clip && history
    ? history.find(item => item.clientRequestId === clip.clientRequestId || (submitState.phase === "queued" && item._id === submitState.submissionId)) ?? null
    : null;

  const retake = () => { submitter?.reset(); void recorder.retake(); };
  const canUpload = backend.kind === "ready" && submitter;

  return (
    <main className="pb-[108px] pt-[112px] max-md:pb-[72px] max-md:pt-[96px]">
      <div className="frame">
        <motion.header initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: SETTLE }} className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="max-w-[640px]">
            <Eyebrow>Contribute</Eyebrow>
            <h1 className="cut-regular mt-1.5 text-[32px] leading-[1.2] tracking-[-0.015em] text-ink md:text-[42px] xl:text-[48px]">Record the red-cup task</h1>
            <p className="mt-3 text-[14px] leading-[1.35] tracking-[0.01em] text-slate-500 md:text-[18px]">
              Read the brief, agree to the terms, then film one 10 to 30 second take while you narrate. You can follow the clip from upload to review on this page.
            </p>
          </div>
          <div className="flex flex-col items-start gap-1.5 md:items-end">
            <BackendBadge backend={backend} />
            <span className="text-[12px] leading-[1.2] text-fog">Signed in as the demo contributor. This is a labeled demo identity, not real sign-in.</span>
          </div>
        </motion.header>

        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.6, ease: SETTLE }}
          className="mt-8 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start"
        >
          <div className="flex flex-col gap-3 lg:col-start-1 lg:row-span-2 lg:row-start-1">
            <TaskBrief summary={summary} />
            <Consent value={consent} onChange={setConsent} locked={busy || done} />
          </div>
          <div className="lg:col-start-2 lg:row-start-1">
            <RecorderStage
              recorder={recorder}
              consented={consented}
              onRetake={retake}
              unavailableReason={unavailableReason(backend)}
              submit={canUpload && clip ? {
                onSubmit: () => submitter.submit(clip),
                busy, done,
                label: submitState.phase === "hashing" ? "Hashing" : submitState.phase === "uploading" ? "Uploading" : submitState.phase === "finalizing" ? "Creating submission" : done ? "Submitted" : submitState.phase === "error" ? "Submit again" : "Submit clip",
              } : null}
            />
          </div>
          <div className="lg:col-start-2 lg:row-start-2">
            <SubmissionPanel
              submitState={submitState}
              onRetry={() => clip && submitter?.submit(clip)}
              current={current}
              history={history}
              payables={payables}
              unavailable={backend.kind === "ready" ? undefined : unavailableCopy(backend)}
            />
          </div>
        </motion.div>
      </div>
    </main>
  );
}

function LiveFlow({ url }: { url: string }) {
  const connection = useConvexConnectionState();
  const [timedOut, setTimedOut] = useState(false);
  const context = useQuery(refs.demoContext, { demoIdentity: DEMO_IDENTITY });
  const orderArgs = context ? { demoIdentity: DEMO_IDENTITY, orderId: context.orderId } : "skip";
  const summary = useQuery(refs.orderSummary, orderArgs);
  const history = useQuery(refs.submissions, orderArgs);
  const payables = useQuery(refs.payables, orderArgs);
  const submitter = useSubmit(context?.orderId ?? null);

  useEffect(() => {
    if (connection.hasEverConnected) return;
    const id = window.setTimeout(() => setTimedOut(true), UNREACHABLE_AFTER_MS);
    return () => window.clearTimeout(id);
  }, [connection.hasEverConnected]);

  const backend: Backend =
    context === null ? { kind: "not_seeded", url }
      : context && summary ? { kind: "ready", url }
        : timedOut && !connection.hasEverConnected ? { kind: "unreachable", url }
          : { kind: "connecting", url };

  return <Shell backend={backend} summary={context === null ? null : backend.kind === "unreachable" ? null : summary} history={history} payables={payables} submitter={submitter} />;
}

class QueryBoundary extends Component<{ url: string; children: ReactNode }, { detail: string | null }> {
  state = { detail: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    const text = error instanceof Error ? error.message : String(error);
    return { detail: text.replace(/^\[Request ID: [^\]]+\]\s*/, "").replace(/^Server Error\s*/, "").split("\n").find(Boolean) ?? text };
  }
  render() {
    if (this.state.detail) return <Shell backend={{ kind: "error", url: this.props.url, detail: this.state.detail }} summary={null} />;
    return this.props.children;
  }
}

export function ContributeFlow() {
  const config = useConvexConfig();
  if (config.status === "missing") return <Shell backend={{ kind: "missing" }} summary={null} />;
  if (config.status === "invalid") return <Shell backend={{ kind: "invalid", url: config.url, reason: config.reason }} summary={null} />;
  return <QueryBoundary url={config.url}><LiveFlow url={config.url} /></QueryBoundary>;
}
