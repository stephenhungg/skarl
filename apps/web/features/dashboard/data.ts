"use client";
import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export { api };
export type { Id };

/** Demo selector from docs/dashboard-api.md. Impersonable on purpose; this is not authentication. */
// Keep the old symbol for route compatibility; the happy-path persona is the buyer.
export const CONTROLLER = "buyer" as const;
export const FINANCE_AGENT = "finance-agent" as const;

export type OrderSummary = FunctionReturnType<typeof api.dashboard.orderSummary>;
export type SubmissionRow = FunctionReturnType<typeof api.dashboard.submissions>[number];
export type PayableRow = FunctionReturnType<typeof api.dashboard.payables>[number];
export type JournalEntry = FunctionReturnType<typeof api.dashboard.journal>[number];
export type AuditEvent = FunctionReturnType<typeof api.dashboard.auditEvents>[number];
export type AgentRun = FunctionReturnType<typeof api.financeAgentData.runs>[number];
export type ExceptionItem = FunctionReturnType<typeof api.exceptions.list>[number];

/** The staged demo order. `undefined` while loading, `null` when the deployment has no seeded order. */
export function useOrderId(): Id<"orders"> | null | undefined {
  const context = useQuery(api.dashboard.demoContext, { demoIdentity: CONTROLLER });
  const [selected, setSelected] = useState<Id<"orders"> | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const queryOrderId = new URL(window.location.href).searchParams.get("orderId");
    let orderId = queryOrderId;
    try {
      orderId ??= sessionStorage.getItem("skarl:review:order");
      if (queryOrderId && /^[a-zA-Z0-9_-]+$/.test(queryOrderId)) sessionStorage.setItem("skarl:review:order", queryOrderId);
    } catch { /* private browser storage may be disabled */ }
    if (orderId && /^[a-zA-Z0-9_-]+$/.test(orderId)) setSelected(orderId as Id<"orders">);
    setReady(true);
  }, []);
  return !ready ? undefined : selected ?? (context === undefined ? undefined : context?.orderId ?? null);
}

const scoped = (orderId: Id<"orders"> | null | undefined) => (orderId ? { demoIdentity: CONTROLLER, orderId } : "skip" as const);

export function useOrderData(orderId: Id<"orders"> | null | undefined) {
  const args = scoped(orderId);
  return {
    summary: useQuery(api.dashboard.orderSummary, args),
    submissions: useQuery(api.dashboard.submissions, args),
    payables: useQuery(api.dashboard.payables, args),
  };
}

export const useJournal = (orderId: Id<"orders"> | null | undefined) => useQuery(api.dashboard.journal, scoped(orderId));
export const useAudit = (orderId: Id<"orders"> | null | undefined) => useQuery(api.dashboard.auditEvents, scoped(orderId));
export const useRuns = (orderId: Id<"orders"> | null | undefined) => useQuery(api.financeAgentData.runs, scoped(orderId));
export const useStatements = (orderId: Id<"orders"> | null | undefined) => useQuery(api.statements.forOrder, scoped(orderId));
export const useReconciliation = (orderId: Id<"orders"> | null | undefined) => useQuery(api.payments.reconciliation, scoped(orderId));
export const useExceptions = (orderId: Id<"orders"> | null | undefined) => useQuery(api.exceptions.list, scoped(orderId));

/** What a buyer has to act on. Counts drive the only loud badges in the nav. */
export function needsYou(submissions: SubmissionRow[] | undefined, payables: PayableRow[] | undefined) {
  // Test uploads can be reviewed but never accepted or paid, so they do not drive the loud count.
  const review = (submissions ?? []).filter(s => s.status === "needs_review" && !s.verificationOnly);
  const testUploads = (submissions ?? []).filter(s => s.status === "needs_review" && s.verificationOnly);
  const approve = (payables ?? []).filter(p => p.intent?.status === "proposed" && !p.approval);
  const sign: PayableRow[] = []; // Approved payouts are dispatched by the configured executor.
  return { review, approve, sign, testUploads, total: review.length + approve.length + sign.length };
}
