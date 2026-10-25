"use client";
import { AnimatePresence, motion } from "motion/react";
import { Camera, RotateCcw, Square, Upload } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { MAX_SECONDS, MEDIA_ERROR_COPY, MIN_SECONDS, formatBytes, formatClock } from "./media";
import type { useRecorder } from "./use-recorder";
import { ActionButton, Card, CardTitle, Pill } from "./ui";

const SETTLE = [0.43, 0.42, 0.37, 0.97] as const;

type Recorder = ReturnType<typeof useRecorder>;

type Props = {
  recorder: Recorder;
  consented: boolean;
  /** Null when the backend can't take uploads; the reason is shown instead of a submit button. */
  submit: { onSubmit: () => void; busy: boolean; done: boolean; label: string } | null;
  unavailableReason?: string;
  onRetake: () => void;
};

function Overlay({ children }: { children: ReactNode }) {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35, ease: SETTLE }}
    >
      {children}
    </motion.div>
  );
}

export function RecorderStage({ recorder, consented, submit, unavailableReason, onRetake }: Props) {
  const { state, stream, elapsedMs, start, record, stop } = recorder;
  const previewRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = previewRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) video.play().catch(() => {});
  }, [stream, state.phase]);

  const live = state.phase === "ready" || state.phase === "recording";
  const recording = state.phase === "recording";
  const elapsedSeconds = elapsedMs / 1000;
  const canStop = recording && elapsedSeconds >= MIN_SECONDS;
  const progress = Math.min(elapsedMs / (MAX_SECONDS * 1000), 1);
  const showTimer = recording || state.phase === "recorded";

  return (
    <Card label="Recorder" className="flex flex-col">
      <CardTitle step="03" aside={recording ? <Pill tone="strong">REC</Pill> : state.phase === "recorded" ? <Pill tone="neutral">TAKE READY</Pill> : null}>
        Record
      </CardTitle>
      <p className="mt-2 text-[14px] leading-[1.35] text-slate-500">
        Set the camera where it can see both cups and the coaster, then narrate as you go. Takes run {MIN_SECONDS} to {MAX_SECONDS} seconds and stop on their own at {MAX_SECONDS}.
      </p>

      <div className="relative mt-5 aspect-video w-full overflow-hidden rounded-[12px] bg-ink">
        {/* Live preview stays mounted so srcObject survives phase changes. Not mirrored: left and right are evidence. */}
        <video
          ref={previewRef}
          muted playsInline autoPlay
          aria-label="Camera preview"
          className="absolute inset-0 size-full object-cover transition-opacity duration-500"
          style={{ opacity: live ? 1 : 0 }}
        />
        {state.phase === "recorded" && (
          <video key={state.clip.url} src={state.clip.url} controls playsInline aria-label="Your recorded take" className="absolute inset-0 size-full bg-ink object-contain" />
        )}

        <AnimatePresence>
          {state.phase === "idle" && (
            <Overlay key="idle">
              <Camera aria-hidden className="size-6 text-slate-300" strokeWidth={1.5} />
              <p className="cut-regular text-[16px] leading-[1.2] text-paper">Camera is off</p>
              <p className="max-w-[360px] text-[14px] leading-[1.35] text-fog">
                {consented ? "Turn it on to check framing and sound before you record." : "Check the three consent boxes to turn it on."}
              </p>
            </Overlay>
          )}
          {state.phase === "requesting" && (
            <Overlay key="requesting">
              <p className="cut-regular text-[16px] leading-[1.2] text-paper">Waiting for camera and microphone</p>
              <p className="max-w-[360px] text-[14px] leading-[1.35] text-fog">Allow both in the browser prompt.</p>
            </Overlay>
          )}
          {state.phase === "error" && (
            <Overlay key="error">
              <p className="cut-regular text-[16px] leading-[1.2] text-paper">{MEDIA_ERROR_COPY[state.failure.kind].title}</p>
              <p className="max-w-[420px] text-[14px] leading-[1.35] text-fog">{MEDIA_ERROR_COPY[state.failure.kind].body}</p>
              {state.failure.kind === "insecure_context" && (
                <code className="mono mt-1 rounded-[6px] bg-deep px-2 py-1 text-[12px] text-haze">pnpm --filter @skarl/web dev:https</code>
              )}
              {state.failure.detail && state.failure.kind !== "insecure_context" && (
                <p className="mono mt-1 max-w-[420px] truncate text-[12px] text-slate-300">{state.failure.detail}</p>
              )}
            </Overlay>
          )}
        </AnimatePresence>

        {recording && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-3">
            <span className="mono inline-flex items-center gap-2 rounded-[6px] bg-ink/60 px-2 py-1 text-[12px] leading-none text-paper backdrop-blur-[5px]">
              <motion.span aria-hidden className="size-2 rounded-full bg-accent" animate={{ opacity: [1, 0.35, 1] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }} />
              REC
            </span>
            <span className="mono rounded-[6px] bg-ink/60 px-2 py-1 text-[12px] leading-none text-paper tabular-nums backdrop-blur-[5px]">
              {formatClock(elapsedMs)} / {formatClock(MAX_SECONDS * 1000, false)}
            </span>
          </div>
        )}
      </div>

      {/* Timer track: the notch marks the 10 second minimum. */}
      <div className="mt-4" aria-hidden={!showTimer}>
        <div className="relative h-[3px] w-full overflow-hidden rounded-full bg-haze">
          <div className="absolute inset-y-0 left-0 rounded-full bg-slate-700" style={{ width: `${(showTimer ? progress : 0) * 100}%` }} />
          <div className="absolute inset-y-0 w-px bg-paper" style={{ left: `${(MIN_SECONDS / MAX_SECONDS) * 100}%` }} />
        </div>
        <div
          className="mono mt-2 flex justify-between text-[12px] leading-none text-slate-500 tabular-nums"
          role="timer" aria-live="off" aria-label={`Recorded ${Math.floor(elapsedSeconds)} of ${MAX_SECONDS} seconds`}
        >
          <span>{showTimer ? formatClock(elapsedMs) : "0:00.0"}</span>
          <span>min 0:{String(MIN_SECONDS).padStart(2, "0")} · max 0:{MAX_SECONDS}</span>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {(state.phase === "idle" || state.phase === "requesting") && (
          <ActionButton onClick={start} disabled={!consented || state.phase === "requesting"}>
            {state.phase === "requesting" ? "Waiting for permission" : "Turn on camera"}
          </ActionButton>
        )}
        {state.phase === "error" && state.retryable && <ActionButton onClick={start}>Try again</ActionButton>}
        {state.phase === "ready" && (
          <ActionButton onClick={record}>Start recording</ActionButton>
        )}
        {recording && (
          <>
            <ActionButton onClick={stop} disabled={!canStop}>
              <Square aria-hidden className="size-3.5" fill="currentColor" strokeWidth={0} />
              {canStop ? "Stop" : `Stop unlocks in ${Math.ceil(MIN_SECONDS - elapsedSeconds)}s`}
            </ActionButton>
            <ActionButton variant="secondary" onClick={onRetake}>Discard</ActionButton>
          </>
        )}
        {state.phase === "recorded" && (
          <>
            {submit && (
              <ActionButton onClick={submit.onSubmit} disabled={submit.busy || submit.done}>
                <Upload aria-hidden className="size-4" strokeWidth={1.75} />
                {submit.label}
              </ActionButton>
            )}
            <ActionButton variant="secondary" onClick={onRetake} disabled={submit?.busy}>
              <RotateCcw aria-hidden className="size-4" strokeWidth={1.75} />
              {submit?.done ? "Record another" : "Retake"}
            </ActionButton>
          </>
        )}
      </div>

      {state.phase === "recorded" && (
        <dl className="mono mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] leading-none text-slate-500">
          <div className="flex gap-1.5"><dt className="text-slate-300">Length</dt><dd>{formatClock(state.clip.durationMs)}</dd></div>
          <div className="flex gap-1.5"><dt className="text-slate-300">Size</dt><dd>{formatBytes(state.clip.sizeBytes)}</dd></div>
          <div className="flex min-w-0 gap-1.5"><dt className="text-slate-300">Format</dt><dd className="truncate">{state.clip.mimeType}</dd></div>
        </dl>
      )}
      {state.phase === "recorded" && !submit && unavailableReason && (
        <p className="mt-4 rounded-[10px] bg-haze/60 px-3 py-2.5 text-[13px] leading-[1.35] text-slate-700">
          {unavailableReason} The take stays in this browser and is not uploaded.
        </p>
      )}
    </Card>
  );
}
