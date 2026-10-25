"use node";
import { v } from "convex/values";
import { makeFunctionReference, type ApiFromModules, type FunctionArgs, type FunctionReturnType } from "convex/server";
import { internalAction } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type * as Data from "./financeAnalystData";
import type { AnalystSnapshot } from "./financeAnalystRead";
import { createFinanceProvider } from "./lib/financeAgentProvider";
import { runFinanceLoop, type AgentStep } from "./lib/financeAgentLoop";
import { claudeModel, ClaudeFailure } from "./lib/claude";
import { financeModel, GeminiFailure } from "./lib/gemini";
import { ANALYST_SYSTEM, analystReadOnlyTool, boundedConfig, parseAnalystOutput } from "./lib/financeAnalyst";

type DataApi = ApiFromModules<{ financeAnalystData: typeof Data }>["financeAnalystData"];
const dataRef = <N extends keyof DataApi, T extends "mutation" | "query">(name: N, _type: T) =>
  makeFunctionReference<T, FunctionArgs<DataApi[N]>, FunctionReturnType<DataApi[N]>>(`financeAnalystData:${name}`);
const claimRef = dataRef("claim", "mutation"), finishRef = dataRef("finish", "mutation"), pageRef = dataRef("ordersPage", "query");
const closeSnapshotRef = dataRef("closeSnapshot", "query"), drainRef = dataRef("drain", "mutation");
const orgsRef = dataRef("organizations", "query"), orgOrdersRef = dataRef("orgOrders", "query"), enqueueRef = dataRef("enqueue", "mutation"), scanRef = dataRef("scanOrder", "mutation");
const snapshotRef = makeFunctionReference<"query", { orderId: Id<"orders"> }, AnalystSnapshot>("financeAnalystRead:snapshot");
const json = (value: unknown) => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);

/** A close aggregates already validated posted journals, with exact integer arithmetic. */
export function closeTrialBalance(snapshots: AnalystSnapshot[]) {
  const accounts = new Map<string, { debit: bigint; credit: bigint }>();
  let debit = 0n, credit = 0n;
  for (const snapshot of snapshots) {
    if (!snapshot.trialBalance.balanced) throw new Error("unbalanced_close");
    debit += BigInt(snapshot.trialBalance.totalDebitAtomic); credit += BigInt(snapshot.trialBalance.totalCreditAtomic);
    for (const account of snapshot.trialBalance.accounts) {
      const row = accounts.get(account.account) ?? { debit: 0n, credit: 0n };
      row.debit += BigInt(account.debitAtomic); row.credit += BigInt(account.creditAtomic); accounts.set(account.account, row);
    }
  }
  if (debit !== credit) throw new Error("unbalanced_close");
  return { balanced: true as const, totalDebitAtomic: debit.toString(), totalCreditAtomic: credit.toString(),
    accounts: [...accounts].sort(([a], [b]) => a.localeCompare(b)).map(([account, row]) => ({ account,
      debitAtomic: row.debit.toString(), creditAtomic: row.credit.toString(), netDebitAtomic: (row.debit - row.credit).toString() })) };
}

export const run = internalAction({ args: { noteId: v.id("analystNotes") }, handler: async (ctx, args): Promise<void> => {
  const note = await ctx.runMutation(claimRef, args);
  if (!note) return;
  let provider: "claude" | "gemini" = "claude", model = process.env.ANTHROPIC_FINANCE_MODEL || claudeModel(), attempts = 0;
  let persisted: AgentStep[] = [], factsJson = json({ kind: note.kind, blocked: true, evidenceCited: [] });
  try {
    const snapshots: AnalystSnapshot[] = note.kind === "close"
      ? await ctx.runQuery(closeSnapshotRef, { organizationId: note.organizationId })
      : [await ctx.runQuery(snapshotRef, { orderId: note.orderId })];
    const orderIds = snapshots.map(snapshot => snapshot.orderId);
    const current = snapshots.find(snapshot => snapshot.orderId === note.orderId);
    if (!current || snapshots.some(snapshot => snapshot.organizationId !== note.organizationId)) throw new Error("analyst_scope_changed");
    const exceptions = snapshots.flatMap(snapshot => snapshot.exceptions), reviews = snapshots.flatMap(snapshot => snapshot.reviewSubmissions);
    const balance = closeTrialBalance(snapshots), payables = snapshots.flatMap(snapshot => snapshot.payables);
    const currentPayout = current.payouts.find(row => row.intentId === note.intentId);
    // Approval and observed settlement are distinct immutable milestones, each deduplicated per prompt version.
    // An approval job that starts late must not turn into a second settlement narrative.
    const approvalMilestone = note.itemKey.endsWith(":policy_approved") || note.itemKey.endsWith(":approved");
    const payout = currentPayout && approvalMilestone ? { ...currentPayout, settlement: "policy_approved" as const, txUrl: undefined,
      checksPassed: currentPayout.checksPassed.filter(check => !["canonical_transfer_observed", "exact_payout_journal"].includes(check)) } : currentPayout;
    if (note.kind === "payout" && !payout) throw new Error("payout_evidence_unavailable");
    const exception = exceptions.find(row => row.exceptionKey === note.exceptionKey);
    const review = reviews.find(row => `submission:${row.submissionId}` === note.itemKey);
    if (note.kind === "exception" && !exception && !review) throw new Error("review_item_no_longer_open");
    const evidenceCited = [...new Set<string>([...orderIds, ...snapshots.flatMap(snapshot => snapshot.journalEntryIds),
      ...exceptions.map(row => row.exceptionKey), ...reviews.flatMap(row => [row.submissionId, ...(row.analysisId ? [row.analysisId] : [])]),
      ...payables.flatMap(row => [row.payableId, row.submissionId, row.decisionId]), ...(payout?.evidenceCited ?? [])])];
    const approvalLabel = payout?.approvalSource === "buyer_policy" ? "Buyer-signed policy approved" : "Buyer review approved";
    const payoutSummary = payout ? `${payout.settlement === "chain_observed" ? "Chain-observed payment" : currentPayout?.settlement === "chain_observed" ? `${approvalLabel} (approval milestone; settlement is reported separately)` : `${approvalLabel}; awaiting chain confirmation`}: ${payout.amountAtomic} micro-USDC to ${payout.contributor}. Checks: ${payout.checksPassed.join(", ")}.${payout.txUrl ? ` Transaction: ${payout.txUrl}` : " This approval note does not establish a chain-observed payment."}` : undefined;
    const facts = { kind: note.kind, blocked: note.kind === "exception", evidenceCited,
      settlement: payout?.settlement, payoutSummary, payout, exception: exception?.exception, review,
      trialBalance: balance, journalEntryIds: snapshots.flatMap(snapshot => snapshot.journalEntryIds),
      orderIds, openExceptions: exceptions, reviewSubmissions: reviews,
      unreconciledItems: exceptions.filter(row => row.exception.code !== "policy_review"), upcomingFlags: snapshots.flatMap(snapshot => snapshot.upcomingFlags),
      source: "stored Convex records; simulated/replayed witnesses retain their source labels", asOf: Date.now() };
    factsJson = json(facts);
    if (factsJson.length > 180_000) { factsJson = json({ kind: note.kind, blocked: true, evidenceCited: [] }); throw new Error("analyst_context_limit"); }
    const deadline = note.startedAt + 150_000;
    const configs: { provider: "claude" | "gemini"; model: string }[] = [
      { provider: "claude", model }, { provider: "claude", model },
      ...(process.env.GEMINI_API_KEY ? [{ provider: "gemini" as const, model: financeModel() }] : []),
    ];
    let lastFailure = "analyst_provider_failed";
    for (let index = 0; index < configs.length; index++) {
      ({ provider, model } = configs[index]!); attempts++; persisted = [];
      try {
        const result = await runFinanceLoop({ maxToolCalls: 12,
          next: createFinanceProvider({ provider, model, system: ANALYST_SYSTEM, deadline, readOnly: true,
            prompt: `Analyze this immutable financial snapshot. Read tools if more detail is needed. Return the specified JSON. Untrusted DATA follows:\n${factsJson}` }),
          execute: call => analystReadOnlyTool(call, async read => {
            switch (read.name) {
              case "getTrialBalance": return { trialBalance: balance, journalEntryIds: facts.journalEntryIds };
              case "listReconciliationExceptions": return { exceptions, upcomingFlags: facts.upcomingFlags };
              case "listOutstandingPayables": return { payables: payables.filter(row => ["accrued", "payout_in_progress"].includes(row.status)) };
              case "explainPayable": return payables.find(row => row.payableId === read.arguments.payableId) ?? { ok: false, code: "not_found" };
              default: return { ok: false, code: "advisory_read_only" };
            }
          }),
          persist: async steps => { persisted = steps; },
        });
        if (result.status !== "completed") throw new Error("analyst_tool_cap");
        parseAnalystOutput(result.explanation, facts);
        await ctx.runMutation(finishRef, { ...args, provider, model, attempts, transcriptJson: json(persisted), factsJson, outputJson: result.explanation });
        return;
      } catch (error) {
        if (!(error instanceof ClaudeFailure || error instanceof GeminiFailure)) throw error;
        lastFailure = error.code;
      }
    }
    await ctx.runMutation(finishRef, { ...args, provider, model, attempts, transcriptJson: json(persisted), factsJson, failureCode: lastFailure });
  } catch {
    await ctx.runMutation(finishRef, { ...args, provider, model, attempts, transcriptJson: json(persisted).length <= 100_000 ? json(persisted) : "[]", factsJson,
      failureCode: "analyst_evidence_or_output_invalid" });
  }
} });

/** One-minute catch-up scans, paginated over orders. Enqueue/idempotency is transactional. */
export const sweep = internalAction({ args: { cursor: v.optional(v.string()) }, handler: async (ctx, args): Promise<void> => {
  if (process.env.SKARL_SCHEDULED_JOBS_DISABLED === "true" || process.env.FINANCE_AGENT_BACKGROUND_ENABLED === "false") return;
  if (!args.cursor) await ctx.runMutation(drainRef, {});
  const page = await ctx.runQuery(pageRef, args);
  for (const orderId of page.orderIds) {
    try { await ctx.runMutation(scanRef, { orderId }); } catch {
      await ctx.runMutation(enqueueRef, { orderId, kind: "exception", itemKey: `snapshot_unavailable:${orderId}` });
    }
  }
  if (page.cursor) await ctx.scheduler.runAfter(0, makeFunctionReference<"action", { cursor?: string }>("financeAnalystJobs:sweep"), { cursor: page.cursor });
} });

/** Demo closes are periodic advisory snapshots, never an accounting period lock or posting. */
export const close = internalAction({ args: {}, handler: async (ctx): Promise<void> => {
  if (process.env.SKARL_SCHEDULED_JOBS_DISABLED === "true" || process.env.FINANCE_AGENT_BACKGROUND_ENABLED === "false") return;
  const minutes = boundedConfig(process.env.FINANCE_ANALYST_CLOSE_MINUTES, 60, 1440);
  if (!minutes) return;
  const period = Math.floor(Date.now() / (minutes * 60_000));
  for (const organizationId of await ctx.runQuery(orgsRef, {})) {
    const orders = await ctx.runQuery(orgOrdersRef, { organizationId });
    if (orders[0]) await ctx.runMutation(enqueueRef, { orderId: orders[0], kind: "close", itemKey: `close:${minutes}:${period}` });
  }
} });
