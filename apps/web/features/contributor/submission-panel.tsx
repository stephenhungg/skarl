"use client";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { formatUsdc, isDuplicate, type Payable, type Submission } from "./api";
import type { SubmitState } from "./use-submit";
import { ActionButton, Card, CardTitle, Pill, shortHash, type PillTone } from "./ui";

const SETTLE = [0.43, 0.42, 0.37, 0.97] as const;

type StatusView = { label: string; tone: PillTone; note: string };

export function statusView(submission: Submission, payable?: Payable): StatusView {
  const reason = submission.decision?.reason;
  if (isDuplicate(submission)) {
    return { label: "DUPLICATE", tone: "strong", note: "This clip matches one that was already accepted, so no second payment is created." };
  }
  switch (submission.status) {
    case "uploading": return { label: "UPLOADING", tone: "muted", note: "The upload hasn't been confirmed yet." };
    case "queued": return { label: "QUEUED", tone: "neutral", note: "Waiting for analysis, and nothing has looked at the clip yet." };
    case "analysing": return { label: "ANALYZING", tone: "neutral", note: "Analysis is running on the backend." };
    case "needs_review": return { label: "REVIEW", tone: "strong", note: "A person will look at this clip before anything is accepted." };
    case "needs_correction": return { label: "NEEDS CORRECTION", tone: "strong", note: reason ?? "The reviewer asked for a new take." };
    case "accepted": return {
      label: "ACCEPTED", tone: "accent",
      note: payable ? (payable.status === "paid" ? `Paid ${formatUsdc(payable.amountAtomic)} test USDC. The transfer was observed onchain.` : `Earned ${formatUsdc(payable.amountAtomic)} test USDC. It is a pending payable (${payable.status.replace(/_/g, " ")}) until a controller approves and the transfer is observed.`) : "Accepted. The payable hasn't appeared yet.",
    };
    case "rejected": return { label: "REJECTED", tone: "strong", note: reason ?? "Not accepted for this order." };
    default: return { label: String(submission.status).toUpperCase(), tone: "muted", note: "" };
  }
}

const SUBMIT_ERROR: Record<Extract<SubmitState, { phase: "error" }>["kind"], string> = {
  hash_failed: "Couldn't compute the SHA-256 in this browser.",
  upload_url_failed: "The backend didn't hand out an upload URL.",
  upload_failed: "The upload to Convex storage failed.",
  upload_timeout: "The upload took longer than two minutes and was stopped.",
  offline: "You're offline, so reconnect and then retry.",
  create_failed: "The clip uploaded but creating the submission failed, and retrying reuses the same upload.",
  refused: "The backend refused this submission.",
};

function Step({ done, active, label, value }: { done: boolean; active: boolean; label: string; value?: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-4 py-2.5">
      <span className="flex items-center gap-3">
        <span aria-hidden className={`size-1.5 rounded-full transition-colors duration-300 ${done ? "bg-slate-700" : active ? "bg-slate-300" : "bg-haze"}`} />
        <span className={`text-[14px] leading-[1.2] ${done || active ? "text-ink" : "text-slate-300"}`}>{label}</span>
      </span>
      {value && <span className="mono min-w-0 truncate text-[12px] leading-none text-slate-500">{value}</span>}
    </li>
  );
}

type Props = {
  submitState: SubmitState;
  onRetry: () => void;
  /** The submission for the current take, matched by id or clientRequestId. */
  current: Submission | null;
  history: Submission[] | undefined;
  payables: Payable[] | undefined;
  unavailable?: { title: string; body: ReactNode };
};

export function SubmissionPanel({ submitState, onRetry, current, history, payables, unavailable }: Props) {
  const phase = submitState.phase;
  const order = ["hashing", "uploading", "finalizing", "queued"];
  const reached = (step: string) => phase !== "idle" && phase !== "error" && order.indexOf(phase) > order.indexOf(step);
  const sha = "sha256" in submitState ? submitState.sha256 : undefined;
  const payableFor = (id: string) => payables?.find(payable => payable.submissionId === id);
  const currentView = current ? statusView(current, payableFor(current._id)) : null;

  return (
    <Card label="Submission status">
      <CardTitle step="04" aside={currentView ? <Pill tone={currentView.tone}>{currentView.label}</Pill> : unavailable ? <Pill tone="strong">UNAVAILABLE</Pill> : null}>
        Submit
      </CardTitle>

      {unavailable ? (
        <div className="mt-4 rounded-[10px] bg-paper px-4 py-3.5">
          <p className="cut-regular text-[16px] leading-[1.2] text-ink">{unavailable.title}</p>
          <div className="mt-1.5 text-[14px] leading-[1.4] text-slate-500">{unavailable.body}</div>
        </div>
      ) : (
        <>
          <p className="mt-2 text-[14px] leading-[1.35] text-slate-500">
            The clip goes straight to Convex storage, not through this site. Status updates here live.
          </p>
          <ol className="mt-4 rounded-[10px] bg-paper px-4 py-1">
            <Step label="SHA-256 in your browser" done={Boolean(sha)} active={phase === "hashing"} value={sha ? shortHash(sha) : phase === "hashing" ? "hashing" : undefined} />
            <Step
              label="Upload to Convex storage" done={reached("uploading")} active={phase === "uploading"}
              value={phase === "uploading" ? `${Math.round(submitState.progress * 100)}%` : reached("uploading") ? "stored" : undefined}
            />
            <Step label="Create submission" done={phase === "queued"} active={phase === "finalizing"}
              value={phase === "queued" ? (submitState.submissionId ? shortHash(submitState.submissionId, 8) : "created") : undefined} />
            <Step label="Analysis and review" done={Boolean(current && !["uploading", "queued"].includes(current.status))} active={phase === "queued"}
              value={current ? currentView?.label.toLowerCase() : phase === "queued" ? "waiting" : undefined} />
          </ol>

          {phase === "uploading" && (
            <div className="mt-3 h-[3px] overflow-hidden rounded-full bg-haze" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(submitState.progress * 100)}>
              <motion.div className="h-full bg-slate-700" animate={{ width: `${submitState.progress * 100}%` }} transition={{ duration: 0.2 }} />
            </div>
          )}

          <AnimatePresence mode="wait">
            {phase === "error" && (
              <motion.div key="err" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease: SETTLE }}
                className="mt-4 rounded-[10px] bg-haze/70 px-4 py-3.5" role="alert">
                <p className="text-[14px] leading-[1.35] text-ink">{SUBMIT_ERROR[submitState.kind]}</p>
                {submitState.detail && <p className="mono mt-1.5 break-words text-[12px] leading-[1.4] text-slate-700">{submitState.detail}</p>}
                {submitState.retryable && <ActionButton variant="secondary" className="mt-3 h-9 text-[14px]" onClick={onRetry}>Retry</ActionButton>}
              </motion.div>
            )}
            {phase === "queued" && currentView && (
              <motion.p key={currentView.label} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease: SETTLE }}
                className="mt-4 text-[14px] leading-[1.4] text-slate-700" aria-live="polite">
                {currentView.note}
              </motion.p>
            )}
            {phase === "queued" && !current && (
              <motion.p key="wait" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 text-[14px] leading-[1.4] text-slate-500" aria-live="polite">
                Submission created{submitState.replayed ? " (already on file, replayed)" : ""}. Waiting for it to show up in the live query.
              </motion.p>
            )}
          </AnimatePresence>

          {current?.sourceHash && sha && (
            <p className="mono mt-3 text-[12px] leading-[1.4] text-slate-500">
              {current.sourceHash === sha ? "Server hash matches your browser's hash." : `Server hash ${shortHash(current.sourceHash)} differs from your browser's.`}
            </p>
          )}
          {current?.analysis?.implementation === "scaffold" && (
            <p className="mt-3 text-[13px] leading-[1.35] text-slate-500">This analysis came from a placeholder, so it goes to a person for review.</p>
          )}
          {current?.analysis?.summary && (
            <p className="mt-3 text-[13px] leading-[1.4] text-slate-700">{current.analysis.summary}</p>
          )}
        </>
      )}

      {history && history.length > 0 && (
        <div className="mt-6">
          <p className="text-[14px] leading-[1.2] text-slate-300">Your submissions</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {[...history].sort((a, b) => b._creationTime - a._creationTime).slice(0, 6).map(submission => {
              const view = statusView(submission, payableFor(submission._id));
              return (
                <li key={submission._id} className="flex items-center justify-between gap-3 rounded-[10px] bg-paper px-3 py-2.5">
                  <span className="min-w-0">
                    <span className="mono block truncate text-[12px] leading-none text-slate-700">{shortHash(submission._id, 8)}</span>
                    <span className="mt-1 block text-[12px] leading-none text-fog">{new Date(submission._creationTime).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                  </span>
                  <Pill tone={view.tone}>{view.label}</Pill>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {history && history.length === 0 && !unavailable && phase === "idle" && (
        <p className="mt-5 text-[13px] leading-[1.35] text-fog">No submissions from the demo contributor yet.</p>
      )}
    </Card>
  );
}
