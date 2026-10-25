"use client";
import { useQuery } from "convex/react";
import { useSyncExternalStore } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export { api };
export type { Id };

/** Demo selector from docs/dashboard-api.md. Impersonable on purpose; this is not authentication. */
export { DEMO_BUYER as BUYER, DEMO_FINANCE_AGENT as FINANCE_AGENT } from "../../lib/auth/identities";
import { DEMO_BUYER as BUYER } from "../../lib/auth/identities";

export type OrderSummary = FunctionReturnType<typeof api.dashboard.orderSummary>;
export type SubmissionRow = FunctionReturnType<typeof api.dashboard.submissions>[number];
export type PayableRow = FunctionReturnType<typeof api.dashboard.payables>[number];
export type JournalEntry = FunctionReturnType<typeof api.dashboard.journal>[number];
export type AuditEvent = FunctionReturnType<typeof api.dashboard.auditEvents>[number];
export type AgentRun = FunctionReturnType<typeof api.financeAgentData.runs>[number];
export type ExceptionItem = FunctionReturnType<typeof api.exceptions.list>[number];

// The controller's chosen order, shared by every page and remembered per browser.
const ORDER_KEY = "skarl:dashboard:order";
const listeners = new Set<() => void>();
let chosen: string | null = null;
let loaded = false;
function readChosen() {
  if (!loaded) {
    loaded = true;
    // A shared link with ?orderId= wins, so evidence links open the right order.
    const fromUrl = new URL(window.location.href).searchParams.get("orderId");
    try { chosen = fromUrl && /^[a-zA-Z0-9_-]+$/.test(fromUrl) ? fromUrl : localStorage.getItem(ORDER_KEY); } catch { chosen = null; }
  }
  return chosen;
}
export function chooseOrder(orderId: Id<"orders">) {
  chosen = orderId;
  try { localStorage.setItem(ORDER_KEY, orderId); } catch { /* storage unavailable */ }
  listeners.forEach(listener => listener());
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };

/** The order in view: the one the controller picked, else the staged demo order. `undefined` while loading. */
export function useOrderId(): Id<"orders"> | null | undefined {
  const picked = useSyncExternalStore(subscribe, readChosen, () => null);
  const context = useQuery(api.dashboard.demoContext, { demoIdentity: BUYER });
  if (picked) return picked as Id<"orders">;
  return context === undefined ? undefined : context?.orderId ?? null;
}

export type OrderRow = FunctionReturnType<typeof api.orders.listOrders>["page"][number];
/** Real orders only; scenario-lab orders are simulated artifacts and live on the lab page. */
export function useOrders() {
  const result = useQuery(api.orders.listOrders, { demoIdentity: BUYER, paginationOpts: { numItems: 50, cursor: null } });
  return result?.page.filter(order => !order.publicId.startsWith("scenario:"));
}

const scoped = (orderId: Id<"orders"> | null | undefined) => (orderId ? { demoIdentity: BUYER, orderId } : "skip" as const);

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
