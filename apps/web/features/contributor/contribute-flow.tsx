"use client";
import { useConvexConnectionState, useMutation, useQuery } from "convex/react";
import { Component, useCallback, useEffect, useState, type ReactNode } from "react";
import { useConvexConfig } from "@/components/convex-provider";
import { DEMO_IDENTITY, refs, type LivenessChallenge, type OrderSummary, type Payable, type Submission } from "./api";
import { CONSENT_ITEMS, type ConsentId } from "./consent";
import { Studio } from "./studio";
import { useRecorder, type Clip } from "./use-recorder";
import { useSubmit, type SubmitState } from "./use-submit";
import { useLiveness } from "./use-liveness";

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
    case "not_seeded": return { title: "The demo order doesn't exist yet", body: <>The deployment answered, but the demo order isn&apos;t seeded. Run <span className="mono text-[12px]">pnpm seed</span> against it.</> };
    case "error": return { title: "The backend returned an error", body: <span className="mono break-words text-[12px]">{backend.detail}</span> };
    case "connecting": return { title: "Connecting to the backend", body: "Hold on while the live order loads." };
    default: return undefined;
  }
}

const NO_CONSENT = Object.fromEntries(CONSENT_ITEMS.map(item => [item.id, false])) as Record<ConsentId, boolean>;

type ShellProps = {
  backend: Backend;
  summary: OrderSummary | null | undefined;
  history?: Submission[];
  payables?: Payable[];
  submitter?: { state: SubmitState; submit: (clip: Clip) => void; reset: () => void; canRetake: boolean };
  issueChallenge?: () => Promise<LivenessChallenge>;
};

/** Local recording works without a backend; uploading needs `submitter`. */
function Shell({ backend, summary, history, payables, submitter, issueChallenge }: ShellProps) {
  const recorder = useRecorder();
  const liveness = useLiveness(recorder.state.phase === "ready", issueChallenge);
  const [consent, setConsent] = useState(NO_CONSENT);
  const clip = recorder.state.phase === "recorded" ? recorder.state.clip : null;
  const submitState: SubmitState = submitter?.state ?? { phase: "idle" };
  const current = clip && history
    ? history.find(item => item.clientRequestId === clip.clientRequestId || (submitState.phase === "queued" && item._id === submitState.submissionId)) ?? null
    : null;
  const busy = ["hashing", "uploading", "finalizing"].includes(submitState.phase);
  const retake = () => {
    if (busy || submitter?.canRetake === false) return;
    submitter?.reset(); liveness.clear(); void recorder.retake();
  };
  const start = () => { liveness.clear(); void recorder.start(); };
  const record = () => {
    if (liveness.phase === "loading") return;
    if (liveness.challenge && liveness.challenge.expiresAt - Date.now() < 60_000) {
      void liveness.refresh();
      return; // Require a second tap so the contributor sees the fresh words.
    }
    recorder.record(liveness.challenge);
  };
  return (
    <Studio live={backend.kind === "ready"} unavailable={backend.kind === "ready" ? undefined : unavailableCopy(backend)}
      summary={summary} history={history} payables={payables} recorder={recorder} consent={consent} onConsent={setConsent}
      submitState={submitState} onSubmit={submitter ? clip => submitter.submit(clip) : null} onRetake={retake} current={current}
      onStart={start} onRecord={record} liveness={liveness} canRetake={submitter?.canRetake ?? true} />
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
  const issue = useMutation(refs.issueChallenge);
  const issueChallenge = useCallback(() => issue({ demoIdentity: DEMO_IDENTITY }), [issue]);

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

  return <Shell backend={backend} summary={context === null ? null : backend.kind === "unreachable" ? null : summary} history={history} payables={payables} submitter={submitter} issueChallenge={issueChallenge} />;
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
