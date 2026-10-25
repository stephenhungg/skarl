import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { digest, paymentBinding, sourceVersion } from "./lib/finance";
import { POLICY_TOKEN } from "./lib/demoAuth";
import { trialBalance } from "./lib/financeAgentLoop";
import { chainIdentity, validateTransfer } from "../packages/payments/src/reconciliation";
import { PAYMENT_NETWORK, USDC_ADDRESS, paymentRail } from "../packages/contracts/src/chain";

export type AnalystException = { exceptionKey: string; exception: Record<string, unknown> };
type UntrustedEvidence = { reportSummary: string; narration: string };
export type AnalystSnapshot = {
  orderId: Id<"orders">; organizationId: Id<"organizations">;
  trialBalance: ReturnType<typeof trialBalance>; journalEntryIds: string[];
  payables: { payableId: string; amountAtomic: string; status: string; contributor: string;
    submissionId: string; decisionId: string; untrustedEvidence: UntrustedEvidence }[];
  exceptions: AnalystException[];
  reviewSubmissions: { submissionId: string; analysisId?: string; untrustedEvidence: UntrustedEvidence; failureCodes: string[] }[];
  payouts: { intentId: Id<"paymentIntents">; amountAtomic: string; contributor: string; settlement: "chain_observed" | "policy_approved";
    approvalSource: "buyer_policy" | "buyer_review"; txUrl?: string; evidenceCited: string[]; checksPassed: string[] }[];
  upcomingFlags: string[];
};

const INVENTORY_LIMIT = 200;
function inventory<T>(rows: T[], limit = INVENTORY_LIMIT): T[] {
  if (rows.length > limit) throw new Error("analyst_snapshot_inventory_limit");
  return rows;
}
const contributorName = (token: string) => `contributor-${digest(token).slice(0, 12)}`;
function untrustedEvidence(analysis: Doc<"analysisResults"> | null): UntrustedEvidence {
  return { reportSummary: analysis?.summary.slice(0, 1000) ?? "No stored analysis.",
    narration: analysis?.observationsJson?.slice(0, 1000) ?? "No stored narration." };
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Internal scheduled read, scoped by stored order/tenant. No demo selector or money mutation. */
export async function readSnapshot(ctx: QueryCtx, orderId: Id<"orders">): Promise<AnalystSnapshot> {
  const order = await ctx.db.get(orderId);
  if (!order) throw new Error("order_not_found");
  const organization = await ctx.db.get(order.organizationId);
  if (!organization || organization.status !== "active") throw new Error("inactive_organization");
  const tenant = (row: { organizationId: Id<"organizations"> }) => {
    if (row.organizationId !== order.organizationId) throw new Error("analyst_snapshot_tenant_mismatch");
  };
  const entries = inventory(await ctx.db.query("journalEntries").withIndex("by_order", q => q.eq("orderId", orderId)).take(1001), 1000);
  const linesByEntry = new Map<string, Doc<"journalLines">[]>();
  const journals = [];
  for (const entry of entries) {
    tenant(entry);
    // Funding may originate on Solana while the order is denominated on Base.
    const rail = paymentRail(entry.network);
    if (entry.orderId !== orderId || entry.status !== "posted" || entry.tokenAddress !== rail.token) throw new Error("analyst_statement_entry_binding_mismatch");
    const lines = inventory(await ctx.db.query("journalLines").withIndex("by_entry", q => q.eq("journalEntryId", entry._id)).take(21), 20);
    for (const line of lines) {
      tenant(line);
      if (line.journalEntryId !== entry._id) throw new Error("analyst_statement_line_binding_mismatch");
      if (line.account === "liability:contributor_payables" && !entry.contributorTokenIdentifier?.trim()) throw new Error("payables_contributor_required");
    }
    linesByEntry.set(entry._id, lines);
    journals.push({ lines: lines.map(line => ({ account: line.account, side: line.side, amountAtomic: line.amountAtomic.toString() })) });
  }
  const balance = trialBalance(journals); // Each journal must balance; aggregate cancellation cannot hide corruption.
  const submissions = inventory(await ctx.db.query("submissions").withIndex("by_order_status", q => q.eq("orderId", orderId)).take(INVENTORY_LIMIT + 1));
  const analyses = new Map<string, Doc<"analysisResults"> | null>();
  for (const submission of submissions) {
    tenant(submission);
    const analysis = submission.currentAnalysisId ? await ctx.db.get(submission.currentAnalysisId) : null;
    if (analysis) {
      tenant(analysis);
      if (analysis.submissionId !== submission._id || analysis.taskVersionId !== submission.taskVersionId || analysis.sourceHash !== submission.sourceHash) throw new Error("analyst_analysis_binding_mismatch");
    }
    analyses.set(submission._id, analysis);
  }
  const payables = inventory(await ctx.db.query("payables").withIndex("by_order", q => q.eq("orderId", orderId)).take(INVENTORY_LIMIT + 1));
  const payableRows: AnalystSnapshot["payables"] = [];
  for (const payable of payables) {
    tenant(payable);
    const submission = submissions.find(row => row._id === payable.submissionId);
    const decision = await ctx.db.get(payable.decisionId);
    if (!submission || !decision || decision.organizationId !== order.organizationId || decision.submissionId !== payable.submissionId ||
      payable.contributorTokenIdentifier !== submission.contributorTokenIdentifier || payable.network !== PAYMENT_NETWORK || payable.tokenAddress !== USDC_ADDRESS) throw new Error("analyst_payable_binding_mismatch");
    payableRows.push({ payableId: payable._id, amountAtomic: payable.amountAtomic.toString(), status: payable.status,
      contributor: contributorName(payable.contributorTokenIdentifier), submissionId: payable.submissionId, decisionId: payable.decisionId,
      untrustedEvidence: untrustedEvidence(analyses.get(payable.submissionId) ?? null) });
  }
  const dispositions = inventory(await ctx.db.query("reconciliationDispositions").withIndex("by_order", q => q.eq("orderId", orderId)).take(INVENTORY_LIMIT + 1));
  const exceptions = new Map<string, AnalystException>();
  for (const row of dispositions) {
    tenant(row);
    if (row.status === "resolved") continue;
    const exception: unknown = JSON.parse(row.snapshotJson);
    if (!object(exception)) throw new Error("analyst_exception_snapshot_invalid");
    exceptions.set(row.exceptionKey, { exceptionKey: row.exceptionKey, exception });
  }
  const flagException = (code: string, intentId: string, detail: string) => {
    const exception = { code, intentId, orderId, detail };
    const exceptionKey = digest(exception);
    exceptions.set(exceptionKey, { exceptionKey, exception });
  };
  const upcomingFlags: string[] = order.publicId.startsWith("scenario:") ? [`includes_simulated_scenario_order:${order._id}`] : [];
  const checkpoint = await ctx.db.query("scheduledCheckpoints").withIndex("by_key", q =>
    q.eq("organizationId", order.organizationId).eq("key", `reconciliation:${orderId}`)).unique();
  if (!checkpoint?.payloadJson) upcomingFlags.push("reconciliation_snapshot_unavailable: bank/chain exceptions may be incomplete");
  else {
    tenant(checkpoint);
    const rows: unknown = JSON.parse(checkpoint.payloadJson);
    if (!Array.isArray(rows)) throw new Error("analyst_reconciliation_snapshot_invalid");
    inventory(rows);
    for (const row of rows) {
      if (!object(row) || typeof row.exceptionKey !== "string" || !object(row.exception)) throw new Error("analyst_reconciliation_snapshot_invalid");
      exceptions.set(row.exceptionKey, { exceptionKey: row.exceptionKey, exception: row.exception });
    }
    // Existing reconciler only updates changed snapshots; age is disclosed, never interpreted as freshness proof.
    if (Date.now() - checkpoint.updatedAt > 5 * 60_000) upcomingFlags.push("reconciliation_snapshot_old: unchanged snapshots are not refreshed; verify current witnesses");
  }
  const reviewSubmissions: AnalystSnapshot["reviewSubmissions"] = submissions.filter(row => row.status === "needs_review").map(submission => {
    const analysis = analyses.get(submission._id) ?? null;
    const failures = [...exceptions.values()].filter(row => row.exception.submissionId === submission._id)
      .flatMap(row => Array.isArray(row.exception.failures) ? row.exception.failures.filter((code): code is string => typeof code === "string") : []);
    if (!failures.length) failures.push(!analysis ? "analysis_unavailable" : analysis.implementation !== "inference" || analysis.pipelineStatus !== "completed" ? "completed_inference_required" : "buyer_review_required");
    return { submissionId: submission._id, ...(analysis ? { analysisId: analysis._id } : {}), untrustedEvidence: untrustedEvidence(analysis), failureCodes: [...new Set(failures)] };
  });
  const intents = inventory(await ctx.db.query("paymentIntents").withIndex("by_order", q => q.eq("orderId", orderId)).take(INVENTORY_LIMIT + 1));
  const payouts: AnalystSnapshot["payouts"] = [];
  for (const intent of intents) {
    tenant(intent);
    if (intent.kind !== "contributor_payout") continue;
    const payable = payables.find(row => row._id === intent.payableId), command = await ctx.db.get(intent.paymentCommandId);
    if (!payable || !command || command.organizationId !== order.organizationId || command.orderId !== orderId || command.kind !== "contributor_payout" ||
      command.payableId !== payable._id || command.amountAtomic !== intent.amountAtomic || payable.amountAtomic !== intent.amountAtomic ||
      command.recipientAddress !== intent.recipientAddress || payable.recipientAddress !== intent.recipientAddress || command.network !== PAYMENT_NETWORK ||
      command.tokenAddress !== USDC_ADDRESS || intent.network !== PAYMENT_NETWORK || intent.tokenAddress !== USDC_ADDRESS ||
      paymentBinding(command) !== intent.bindingHash || command.bindingHash !== intent.bindingHash || command.sourceVersion !== intent.sourceVersion ||
      sourceVersion(payable) !== intent.sourceVersion || command.requesterTokenIdentifier !== intent.requesterTokenIdentifier) {
      flagException("payout_binding_mismatch", intent._id, "Stored payout, payable and command bindings disagree; buyer review required.");
      continue;
    }
    const approval = command.approvalId ? await ctx.db.get(command.approvalId) : null;
    if (!approval || approval.organizationId !== order.organizationId || approval.paymentCommandId !== command._id || approval.status !== "approved" ||
      approval.bindingHash !== intent.bindingHash || approval.approverTokenIdentifier === command.requesterTokenIdentifier) continue;
    const decision = await ctx.db.get(payable.decisionId);
    if (!decision || decision.decision !== "accepted") continue;
    const cited: string[] = [intent._id, payable._id, payable.decisionId, approval._id, ...entries.map(row => row._id)];
    const analysis = analyses.get(payable.submissionId);
    if (analysis) cited.push(analysis._id);
    const checksPassed = ["stored_accepted_decision", "bound_independent_approval", "posted_journals_balanced"];
    const attempts = inventory(await ctx.db.query("paymentAttempts").withIndex("by_intent", q => q.eq("paymentIntentId", intent._id)).take(3), 2);
    const confirmed: { observation: Doc<"chainObservations">; attemptId: string }[] = [];
    for (const attempt of attempts) {
      if (attempt.organizationId !== order.organizationId) {
        flagException("attempt_binding_mismatch", intent._id, "Stored payout attempt tenant differs from its approved intent; no settlement inferred.");
        continue;
      }
      if (attempt.paymentCommandId !== command._id || attempt.network !== intent.network || attempt.tokenAddress !== intent.tokenAddress || attempt.amountAtomic !== intent.amountAtomic) {
        flagException("attempt_binding_mismatch", intent._id, "Stored payout attempt differs from its approved intent; no settlement inferred.");
        continue;
      }
      const seen = inventory(await ctx.db.query("chainObservations").withIndex("by_attempt", q => q.eq("paymentAttemptId", attempt._id)).take(3), 2);
      for (const observation of seen) {
        tenant(observation);
        try {
          if (!attempt.txHash || !attempt.payerAddress || observation.txHash.toLowerCase() !== attempt.txHash.toLowerCase() ||
            observation.observedAt < attempt.createdAt - 1000 || approval.decidedAt > attempt.createdAt) continue;
          validateTransfer(observation, { network: PAYMENT_NETWORK, fromAddress: attempt.payerAddress, toAddress: intent.recipientAddress, amountAtomic: intent.amountAtomic });
          const journal = entries.filter(entry => entry.kind === "payout" && entry.eventKey === intent.intentId &&
            entry.sourceReference === chainIdentity(observation) && entry.network === intent.network && entry.tokenAddress === intent.tokenAddress && entry.contributorTokenIdentifier === payable.contributorTokenIdentifier);
          if (journal.length !== 1) continue;
          const lines = linesByEntry.get(journal[0]!._id)!;
          if (lines.length !== 2 || !lines.some(line => line.account === "liability:contributor_payables" && line.side === "debit" && line.amountAtomic === intent.amountAtomic) ||
            !lines.some(line => line.account === "asset:usdc" && line.side === "credit" && line.amountAtomic === intent.amountAtomic)) continue;
          confirmed.push({ observation, attemptId: attempt._id });
        } catch { /* Invalid chain facts never establish settlement. */ }
      }
    }
    const settled = confirmed.length === 1 ? confirmed[0] : undefined;
    if (!settled && !["approved", "submitted", "pending", "reconciling", "confirmed", "finalized"].includes(intent.status)) continue;
    if (settled) { cited.push(settled.observation._id, settled.attemptId); checksPassed.push("canonical_transfer_observed", "exact_payout_journal"); }
    payouts.push({ intentId: intent._id, amountAtomic: intent.amountAtomic.toString(), contributor: contributorName(payable.contributorTokenIdentifier),
      approvalSource: approval.approverTokenIdentifier === POLICY_TOKEN ? "buyer_policy" : "buyer_review",
      settlement: settled ? "chain_observed" : "policy_approved", ...(settled ? { txUrl: paymentRail(PAYMENT_NETWORK).explorerTx(settled.observation.txHash) } : {}),
      evidenceCited: [...new Set(cited)], checksPassed });
    if (!settled && intent.expiresAt < Date.now()) upcomingFlags.push(`payout_approval_expired_or_settlement_unobserved:${intent._id}`);
  }
  if (Date.now() > order.deadlineAt && !["fulfilled", "refunded", "cancelled", "closed"].includes(order.status)) upcomingFlags.push("order_deadline_passed");
  return { orderId, organizationId: order.organizationId, trialBalance: balance, journalEntryIds: entries.map(entry => entry._id),
    payables: payableRows, exceptions: [...exceptions.values()], reviewSubmissions, payouts, upcomingFlags };
}

export const snapshot = internalQuery({ args: { orderId: v.id("orders") }, handler: (ctx, args): Promise<AnalystSnapshot> => readSnapshot(ctx, args.orderId) });
