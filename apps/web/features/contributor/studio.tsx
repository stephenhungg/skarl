"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/glaze/ui/alert";
import { Button } from "@/components/glaze/ui/button";
import { Checkbox } from "@/components/glaze/ui/checkbox";
import { Progress } from "@/components/glaze/ui/progress";
import { Status } from "@/components/glaze/ui/status";
import { LogoMark } from "@/components/logo-mark";
import { GlazePortalProvider } from "@/lib/glaze/portal";
import { cn } from "@/lib/glaze/utils";
import { formatUsdc, isDuplicate, type OrderSummary, type Payable, type Submission } from "./api";
import { CONSENT_ITEMS, type ConsentId } from "./consent";
import { MAX_SECONDS, MEDIA_ERROR_COPY, MIN_SECONDS, formatBytes, formatClock } from "./media";
import type { Clip, useRecorder } from "./use-recorder";
import type { SubmitState } from "./use-submit";
import type { useLiveness } from "./use-liveness";

type StatusValue = "idle" | "queued" | "running" | "ok" | "warn" | "fail" | "waiting";
type Recorder = ReturnType<typeof useRecorder>;

export type StudioProps = {
  live: boolean;
  unavailable?: { title: string; body: ReactNode };
  summary: OrderSummary | null | undefined;
  history?: Submission[];
  payables?: Payable[];
  recorder: Recorder;
  consent: Record<ConsentId, boolean>;
  onConsent: (next: Record<ConsentId, boolean>) => void;
  submitState: SubmitState;
  onSubmit: ((clip: Clip) => void) | null;
  onRetake: () => void;
  onStart: () => void;
  onRecord: () => void;
  liveness: ReturnType<typeof useLiveness>;
  canRetake: boolean;
  current: Submission | null;
};

const SUBMIT_ERROR: Record<Extract<SubmitState, { phase: "error" }>["kind"], string> = {
  hash_failed: "This browser could not fingerprint the clip.",
  upload_url_failed: "The server did not hand out an upload link.",
  upload_failed: "The upload failed partway.",
  upload_timeout: "The upload took over two minutes and was stopped.",
  offline: "You are offline. Reconnect, then try again.",
  create_failed: "The clip uploaded, but creation is unconfirmed. Retry reuses the same take and upload.",
  refused: "The server refused this submission.",
};

/** Plain-language status for a contributor: what happened and what it means for pay. */
export function clipStatus(submission: Submission, payable?: Payable): { status: StatusValue; label: string; note: string } {
  if (isDuplicate(submission)) return { status: "fail", label: "Copy found", note: "This clip matches one already submitted, so it cannot be paid twice." };
  const reason = submission.decision?.reason?.replace(/^[a-z_]+:\s*/, "");
  switch (submission.status) {
    case "uploading": return { status: "queued", label: "Uploading", note: "The upload is not confirmed yet." };
    case "queued": return { status: "queued", label: "Queued", note: "Waiting for the AI check to start." };
    case "analysing": return { status: "running", label: "Checking", note: "The AI is watching the video and listening to the narration separately." };
    case "needs_review": return { status: "waiting", label: "With a reviewer", note: "A person looks at every clip before anything is accepted." };
    case "needs_correction": return { status: "warn", label: "Retake requested", note: reason ?? "The reviewer asked for a new take." };
    case "rejected": return { status: "fail", label: "Not accepted", note: reason ?? "This clip was not accepted for the order." };
    case "accepted":
      if (payable?.status === "paid") return { status: "ok", label: "Paid", note: `${formatUsdc(payable.amountAtomic)} test USDC arrived in your wallet.` };
      return { status: "ok", label: "Accepted", note: payable ? `You earned ${formatUsdc(payable.amountAtomic)} test USDC. It is sent after a controller approves it.` : "Accepted. Your earnings appear here shortly." };
    default: return { status: "idle", label: String(submission.status), note: "" };
  }
}

export function Studio(props: StudioProps) {
  const { summary, history, payables } = props;
  const earned = (payables ?? []).reduce((sum, p) => sum + BigInt(p.amountAtomic), 0n);
  const paid = (payables ?? []).filter(p => p.status === "paid").reduce((sum, p) => sum + BigInt(p.amountAtomic), 0n);
  return (
    <div className="glaze skarl-theme min-h-dvh bg-page font-sans text-text-1">
      <GlazePortalProvider>
        <header className="sticky top-0 z-(--z-sticky) border-b border-line-faint bg-page">
          <div className="mx-auto flex h-12 max-w-6xl items-center gap-3 px-4 md:px-6">
            <Link href="/" className="flex items-center gap-2 text-text-1" aria-label="Skarl home"><LogoMark size={12} /><span className="type-label">Skarl</span></Link>
            <span className="type-label-sm text-text-3">Contributor</span>
            <Link href="/contribute/earnings" className="ms-auto type-label-sm text-text-2 underline underline-offset-4">Submissions &amp; earnings</Link>
            <span className="hidden type-label-sm text-text-2 sm:inline">Base Sepolia &middot; test USDC</span>
            {payables && payables.length > 0 && (
              <span className="type-label tabular-nums" title="Earned across accepted clips; paid once a transfer confirms">
                {formatUsdc(earned.toString())} earned{paid > 0n ? `, ${formatUsdc(paid.toString())} paid` : ""}
              </span>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-10">
          <div className="mb-6 max-w-2xl">
            <h1 className="type-title">{summary?.order.title ?? "Record a task"}</h1>
            <p className="mt-1 type-body text-text-2">{summary?.rubric?.taskPrompt ?? "Film one short take of the task while you say what you are doing."}</p>
          </div>
          {props.unavailable && (
            <Alert status={props.live ? "neutral" : "warn"} className="mb-6">
              <AlertTitle>{props.unavailable.title}</AlertTitle>
              <AlertDescription>{props.unavailable.body}</AlertDescription>
            </Alert>
          )}
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="flex min-w-0 flex-col gap-6">
              <RecorderCard {...props} />
              <YourClips history={history} payables={payables} current={props.current} />
            </div>
            <TaskRail summary={summary} />
          </div>
        </main>
      </GlazePortalProvider>
    </div>
  );
}

function TaskRail({ summary }: { summary: OrderSummary | null | undefined }) {
  const order = summary?.order;
  const open = order ? Math.max(0, Number(order.quantityRequested) - Number(order.acceptedCount)) : null;
  return (
    <aside className="flex flex-col gap-4 lg:sticky lg:top-18 lg:self-start">
      <div className="shell">
        <div className="panel flex flex-col gap-4 p-4">
          <div>
            <p className="type-label-sm text-text-2">You earn per accepted clip</p>
            <p className="mt-0.5 type-title tabular-nums">{order ? formatUsdc(order.contributorRateAtomic) : "—"} <span className="type-label text-text-3">test USDC</span></p>
            {open !== null && <p className="mt-1 type-body-sm text-text-2">{open} of {order!.quantityRequested} spots open</p>}
          </div>
          <div>
            <p className="mb-2 type-label">What the reviewer checks</p>
            <ul className="flex flex-col gap-2">
              {(summary?.rubric?.criteria ?? []).map(criterion => (
                <li key={criterion.criterionId} className="flex gap-2 type-body-sm"><span aria-hidden className="text-text-3">&ndash;</span>{criterion.description}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="shell-foot type-label-sm text-text-2">Pay is sent only after a person approves an accepted clip.</div>
      </div>
      <div className="px-1">
        <p className="mb-2 type-label">Tips for a take that passes</p>
        <ul className="flex flex-col gap-1.5 type-body-sm text-text-2">
          <li>Keep both cups and the coaster in frame the whole time.</li>
          <li>Say what you are doing as you do it, not before or after.</li>
          <li>Move steadily. Quick grabs are hard to see.</li>
          <li>Record somewhere quiet, with only you in the shot.</li>
        </ul>
      </div>
    </aside>
  );
}

function RecorderCard({ recorder, consent, onConsent, submitState, onSubmit, onRetake, onStart, onRecord, liveness, canRetake, live }: StudioProps) {
  const { state, stream, elapsedMs, stop } = recorder;
  const preview = useRef<HTMLVideoElement>(null);
  const consented = CONSENT_ITEMS.every(item => consent[item.id]);
  const busy = ["hashing", "uploading", "finalizing"].includes(submitState.phase);
  const done = submitState.phase === "queued";
  const recording = state.phase === "recording";
  const liveView = state.phase === "ready" || recording;
  const canStop = recording && elapsedMs >= MIN_SECONDS * 1000;
  const clip = state.phase === "recorded" ? state.clip : null;
  const retryable = submitState.phase !== "error" || submitState.retryable;

  useEffect(() => {
    const video = preview.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) video.play().catch(() => {});
  }, [stream, state.phase]);

  const step = done ? 4 : clip ? 3 : liveView ? 2 : consented ? 1 : 0;
  const steps = ["Agree", "Camera on", "Record", "Submit"];

  return (
    <section className="shell" aria-label="Recorder">
      <div className="panel flex flex-col gap-4 p-4">
        <ol className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Progress">
          {steps.map((label, index) => (
            <li key={label} className={cn("flex items-center gap-1.5 type-label-sm", index < step ? "text-text-1" : index === step ? "text-text-1" : "text-text-3")}>
              <span className={cn("grid size-4 place-items-center rounded-pill type-label-sm tabular-nums", index < step ? "bg-ink text-text-inverse" : index === step ? "border border-line-strong" : "border border-line")}>{index + 1}</span>
              {label}
            </li>
          ))}
        </ol>

        <div className="relative aspect-video w-full overflow-hidden rounded-panel bg-ink">
          {/* Not mirrored: left and right are evidence. */}
          <video ref={preview} muted playsInline autoPlay aria-label="Camera preview"
            className="absolute inset-0 size-full object-cover" style={{ opacity: liveView ? 1 : 0 }} />
          {clip && <video key={clip.url} src={clip.url} controls playsInline aria-label="Your take" className="absolute inset-0 size-full bg-ink object-contain" />}
          {!liveView && !clip && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-6 text-center">
              {state.phase === "error" ? <>
                <p className="type-label-lg text-text-inverse">{MEDIA_ERROR_COPY[state.failure.kind].title}</p>
                <p className="max-w-md type-body-sm text-text-inverse/70">{MEDIA_ERROR_COPY[state.failure.kind].body}</p>
              </> : state.phase === "requesting" ? <>
                <p className="type-label-lg text-text-inverse">Allow camera and microphone</p>
                <p className="type-body-sm text-text-inverse/70">Your browser is asking for both.</p>
              </> : <>
                <p className="type-label-lg text-text-inverse">{consented ? "Ready when you are" : "Agree below to turn on the camera"}</p>
                <p className="type-body-sm text-text-inverse/70">{MIN_SECONDS} to {MAX_SECONDS} seconds, one take, narrated.</p>
              </>}
            </div>
          )}
          {liveView && (
            <div className="pointer-events-none absolute inset-x-3 top-3 rounded-panel bg-paper px-3 py-2 text-text-1">
              <p className="type-body-sm text-text-2">Say these words while recording</p>
              <p className="mt-1 type-title" aria-live="polite">
                {liveness.challenge?.words.join(" · ") ?? (liveness.phase === "loading" ? "Getting fresh words…" : "Words unavailable")}
              </p>
              <p className="mt-1 type-label-sm text-text-2">
                {liveness.challenge ? "Say all three in order, then narrate. Submit promptly." : liveness.phase === "loading" ? "Getting a new code for this take." : "You can still record and submit for human review."}
              </p>
            </div>
          )}
          {recording && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between p-3 type-label-sm text-text-inverse">
              <span className="rounded-tag bg-ink/70 px-2 py-1">Recording</span>
              <span className="rounded-tag bg-ink/70 px-2 py-1 tabular-nums">{formatClock(elapsedMs)} / {formatClock(MAX_SECONDS * 1000, false)}</span>
            </div>
          )}
        </div>

        {(recording || clip) && (
          <div className="flex flex-col gap-1">
            <div className="relative h-1 overflow-hidden rounded-pill bg-field">
              <div className="absolute inset-y-0 start-0 rounded-pill bg-ink" style={{ width: `${Math.min(1, (clip ? clip.durationMs : elapsedMs) / (MAX_SECONDS * 1000)) * 100}%` }} />
              <div className="absolute inset-y-0 w-px bg-paper" style={{ left: `${(MIN_SECONDS / MAX_SECONDS) * 100}%` }} />
            </div>
            <p className="type-label-sm text-text-3 tabular-nums">{clip ? `${formatClock(clip.durationMs)} · ${formatBytes(clip.sizeBytes)}` : canStop ? "You can stop any time" : `Keep going, stop unlocks at 0:${String(MIN_SECONDS).padStart(2, "0")}`}</p>
          </div>
        )}

        {!liveView && !clip && (
          <fieldset className="flex flex-col gap-2.5" disabled={busy || done}>
            <legend className="mb-1 type-label">Before you record</legend>
            {CONSENT_ITEMS.map(item => (
              <label key={item.id} className="flex cursor-pointer items-start gap-2.5 type-body-sm">
                <Checkbox checked={consent[item.id]} onCheckedChange={checked => onConsent({ ...consent, [item.id]: checked === true })} className="mt-0.5" />
                <span>{item.text}</span>
              </label>
            ))}
          </fieldset>
        )}

        {busy && submitState.phase === "uploading" && <Progress value={Math.round(submitState.progress * 100)} aria-label="Upload progress" />}
        {submitState.phase === "error" && (
          <Alert status="fail"><AlertTitle>{canRetake ? "Not submitted" : "Submission unconfirmed"}</AlertTitle><AlertDescription>{SUBMIT_ERROR[submitState.kind]}{submitState.detail ? ` ${submitState.detail}` : ""}</AlertDescription></Alert>
        )}
        {clip && (clip.livenessChallengeId || !canRetake) && !done && (
          <p className="type-body-sm text-text-2">
            {!canRetake ? "Retry this same take to resolve creation before recording another."
              : "These words expire two minutes after issue, including review and upload time. If they expire, retake with fresh words."}
          </p>
        )}
        {done && <Alert status="ok"><AlertTitle>Submitted</AlertTitle><AlertDescription>Your clip is in the queue. Follow it below; this page updates on its own.</AlertDescription></Alert>}
      </div>

      <div className="shell-foot flex flex-wrap items-center gap-2">
        {(state.phase === "idle" || state.phase === "requesting") && <>
          <span className="me-auto type-label-sm text-text-3">{consented ? "Check framing and sound before you record." : "All three are required."}</span>
          <Button size="sm" disabled={!consented || state.phase === "requesting"} onClick={onStart}>{state.phase === "requesting" ? "Waiting for permission" : "Turn on camera"}</Button>
        </>}
        {state.phase === "error" && state.retryable && <Button size="sm" className="ms-auto" onClick={onStart}>Try again</Button>}
        {state.phase === "ready" && <>
          <span className="me-auto type-label-sm text-text-3">Both cups and the coaster in frame?</span>
          <Button size="sm" onClick={onRecord} disabled={liveness.phase === "loading"}>{liveness.phase === "loading" ? "Getting fresh words" : "Start recording"}</Button>
        </>}
        {recording && <>
          <Button variant="secondary" size="sm" className="me-auto" onClick={onRetake}>Discard</Button>
          <Button size="sm" disabled={!canStop} onClick={() => stop()}>{canStop ? "Stop" : `Stop in ${Math.ceil(MIN_SECONDS - elapsedMs / 1000)}s`}</Button>
        </>}
        {clip && <>
          <Button variant="secondary" size="sm" className="me-auto" disabled={busy || !canRetake} onClick={onRetake}>{done ? "Record another" : "Retake"}</Button>
          {onSubmit && live
            ? <Button size="sm" disabled={busy || done || !retryable} onClick={() => onSubmit(clip)}>
                {submitState.phase === "hashing" ? "Preparing" : submitState.phase === "uploading" ? "Uploading" : submitState.phase === "finalizing" ? "Submitting" : done ? "Submitted" : submitState.phase === "error" ? (retryable ? "Try again" : "Retake required") : "Submit clip"}
              </Button>
            : <span className="type-label-sm text-text-3">Uploads are off right now. The take stays in this browser.</span>}
        </>}
      </div>
    </section>
  );
}

function YourClips({ history, payables, current }: { history?: Submission[]; payables?: Payable[]; current: Submission | null }) {
  if (!history) return null;
  const rows = [...history].sort((a, b) => b._creationTime - a._creationTime).slice(0, 8);
  return (
    <section aria-label="Your clips">
      <h2 className="mb-3 type-heading-sm">Your clips</h2>
      {rows.length === 0 ? <p className="type-body-sm text-text-2">Nothing yet. Your first clip shows up here the moment it uploads.</p> : (
        <ul className="divide-y divide-line-faint rounded-panel border border-line-faint">
          {rows.map(submission => {
            const view = clipStatus(submission, payables?.find(p => p.submissionId === submission._id));
            return (
              <li key={submission._id} className={cn("flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3", current?._id === submission._id && "bg-hover-row")}>
                <Status status={view.status} className="shrink-0 sm:w-36">{view.label}</Status>
                <span className="order-last min-w-0 basis-full type-body-sm text-text-2 sm:order-none sm:basis-auto sm:flex-1">{view.note}</span>
                <span className="ms-auto type-label-sm text-text-3 tabular-nums sm:ms-0">{new Date(submission._creationTime).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
