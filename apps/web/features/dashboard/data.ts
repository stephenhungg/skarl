"use client";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export { api };
export type { Id };

/** Demo selector from docs/dashboard-api.md. Impersonable on purpose; this is not authentication. */
export const CONTROLLER = "controller" as const;
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
  return context === undefined ? undefined : context?.orderId ?? null;
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

/** What a controller has to act on. Counts drive the only loud badges in the nav. */
export function needsYou(submissions: SubmissionRow[] | undefined, payables: PayableRow[] | undefined) {
  // Test uploads can be reviewed but never accepted or paid, so they do not drive the loud count.
  const review = (submissions ?? []).filter(s => s.status === "needs_review" && !s.verificationOnly);
  const testUploads = (submissions ?? []).filter(s => s.status === "needs_review" && s.verificationOnly);
  const approve = (payables ?? []).filter(p => p.intent?.status === "proposed" && !p.approval);
  const sign = (payables ?? []).filter(p => p.dispatchReady);
  return { review, approve, sign, testUploads, total: review.length + approve.length + sign.length };
}
