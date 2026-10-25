"use client";
import { useQueries, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useMemo } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export { api };
export type { Id };

/** Demo selector from docs/dashboard-api.md. Impersonable on purpose; this is not authentication. */
export { DEMO_CONTRIBUTOR as CONTRIBUTOR } from "../../lib/auth/identities";
import { DEMO_CONTRIBUTOR as CONTRIBUTOR } from "../../lib/auth/identities";

export type EarningRow = FunctionReturnType<typeof api.datasets.contributorEarnings>[number];
export type SubmissionRow = FunctionReturnType<typeof api.dashboard.submissions>[number];
export type Clip = EarningRow & { detail: SubmissionRow | null; createdAt: number | null };

/**
 * Every clip this contributor uploaded, across all orders, with its review detail joined in when the order's
 * submissions query has loaded. Newest first; clips with no known upload time sort last.
 */
export function useClips(): { clips: Clip[] | undefined } {
  const earnings = useQuery(api.datasets.contributorEarnings, { demoIdentity: CONTRIBUTOR });
  const orderIds = useMemo(() => [...new Set((earnings ?? []).map(row => row.orderId))], [earnings]);
  const requests = useMemo(() => Object.fromEntries(orderIds.map(orderId =>
    [orderId, { query: api.dashboard.submissions, args: { demoIdentity: CONTRIBUTOR, orderId } }])), [orderIds]);
  const perOrder = useQueries(requests) as Record<string, SubmissionRow[] | undefined | Error>;
  const clips = useMemo(() => {
    if (!earnings) return undefined;
    const details = new Map<string, SubmissionRow>();
    for (const rows of Object.values(perOrder)) if (Array.isArray(rows)) for (const row of rows) details.set(row._id, row);
    return earnings.map(row => {
      const detail = details.get(row.submissionId) ?? null;
      return { ...row, detail, createdAt: detail?._creationTime ?? null };
    }).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }, [earnings, perOrder]);
  return { clips };
}

/** Earned counts recorded, non-reversed obligations; paid counts only confirmed on-chain payouts. */
export function totals(rows: EarningRow[]) {
  let earned = 0n, paid = 0n;
  for (const row of rows) {
    if (row.payableStatus === null || row.payableStatus === "reversed") continue;
    earned += BigInt(row.amountAtomic);
    if (row.payout.status === "paid") paid += BigInt(row.amountAtomic);
  }
  return { earned, paid, waiting: earned - paid };
}

type StepState = "done" | "current" | "todo";
type Tone = "idle" | "queued" | "running" | "ok" | "warn" | "fail" | "waiting";
export type Step = { label: string; state: StepState; tone: Tone; note?: string };

const STEP_LABELS = ["Uploaded", "AI checked", "Reviewed", "Accepted", "Paid"] as const;

/** Where a clip stands on the path from upload to payout, as five steps with the current one marked. */
export function clipSteps(clip: Pick<EarningRow, "status" | "payableStatus" | "payout">): { steps: Step[]; current: number; summary: string; tone: Tone } {
  const at = (index: number, tone: Tone, summary: string) => ({
    current: index, tone, summary,
    steps: STEP_LABELS.map((label, i) => ({ label, state: (i < index ? "done" : i === index ? "current" : "todo") as StepState,
      tone: i < index ? "ok" as Tone : i === index ? tone : "idle" as Tone, note: i === index ? summary : undefined })),
  });
  switch (clip.status) {
    case "uploading": return at(0, "running", "Uploading");
    case "queued": return at(1, "queued", "Queued for the AI check");
    case "analysing": return at(1, "running", "AI is checking the clip");
    case "needs_review": return at(2, "waiting", "Waiting for a reviewer");
    case "needs_correction": return at(2, "warn", "Retake requested");
    case "rejected": return at(2, "fail", "Rejected");
    case "accepted": {
      if (clip.payableStatus === "reversed") return at(4, "fail", "Payout reversed");
      if (clip.payout.status === "paid") {
        const done = at(4, "ok", "Paid");
        done.steps[4]!.state = "done";
        return done;
      }
      if (clip.payableStatus === null) return at(3, "ok", "Accepted, no payout recorded yet");
      return at(4, "running", clip.payableStatus === "payout_in_progress" ? "Payout in progress" : "Waiting for payout");
    }
    default: return at(0, "idle", clip.status);
  }
}
