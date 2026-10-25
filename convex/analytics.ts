import { configNumber } from "./lib/config";
import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id, Doc } from "./_generated/dataModel";
import { financeScope, ledgerRows, orderRows } from "./lib/dashboardRead";

const args = { demoIdentity: v.string(), orderId: v.optional(v.id("orders")) };
const BUCKET_MS = configNumber("SKARL_BUCKET_MS");
const isRefusal = (event: Doc<"auditEvents">) => event.action.endsWith("_refused");
const isDuplicate = (event: Doc<"auditEvents">) => event.action === "acceptance_refused" && event.reason === "duplicate_submission";
function percentiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return { sampleCount: sorted.length.toString(), p50: sorted.length ? sorted[Math.ceil(sorted.length * .5) - 1] : null,
    p95: sorted.length ? sorted[Math.ceil(sorted.length * .95) - 1] : null };
}
function modelLatency(analysis: Doc<"analysisResults">): number | null {
  if (analysis.implementation !== "inference" || !analysis.reportJson) return null;
  try {
    const report = JSON.parse(analysis.reportJson);
    const runs: unknown = report?.pipeline?.modelRuns;
    if (!Array.isArray(runs) || !runs.length) return null;
    const durations = runs.map(run => run?.elapsedMs);
    if (!durations.every(value => Number.isSafeInteger(value) && value >= 0)) return null;
    const total = durations.reduce((sum, value) => sum + value, 0);
    return Number.isSafeInteger(total) ? total : null;
  } catch { return null; }
}
async function dataset(ctx: QueryCtx, input: { demoIdentity: string; orderId?: Id<"orders"> }) {
  const scope = await financeScope(ctx, input.demoIdentity, input.orderId), data = await orderRows(ctx, scope.orders);
  const entities = new Set<string>([...scope.orderIds, ...data.submissions.map(row => row._id), ...data.payables.map(row => row._id),
    ...data.intents.map(row => row._id), ...data.runs.map(row => row._id)]);
  const audits = (await ctx.db.query("auditEvents").withIndex("by_org_time", q => q.eq("organizationId", scope.principal.organizationId)).collect())
    .filter(row => (!input.orderId && !scope.principal.roles.includes("buyer")) || entities.has(row.entityId));
  const analyses = (await Promise.all(data.submissions.map(async submission => {
    const rows = await ctx.db.query("analysisResults").withIndex("by_submission", q => q.eq("submissionId", submission._id)).collect();
    if (rows.some(row => row.organizationId !== scope.principal.organizationId)) throw new Error("cross_organization_reference");
    return rows;
  }))).flat();
  return { ...scope, ...data, audits, analyses, ...await ledgerRows(ctx, scope.principal.organizationId, scope.orderIds) };
}
const cashIn = (row: Awaited<ReturnType<typeof ledgerRows>>["rows"][number]) => row.lines.filter(line => line.account === "asset:usdc")
  .reduce((sum, line) => sum + (line.side === "debit" ? BigInt(line.amountAtomic) : -BigInt(line.amountAtomic)), 0n);

/** Recorded facts only: unconfirmed payment intents never count as funded cash or paid. */
export const overview = query({
  args,
  handler: async (ctx, input) => {
    const data = await dataset(ctx, input);
    const net = (account: string) => BigInt(data.balance.accounts.find(row => row.account === account)?.netDebitAtomic ?? "0");
    const accepted = data.submissions.filter(row => row.status === "accepted").length;
    const submitted = data.submissions.filter(row => row.status !== "uploading" && !row.verificationOnly).length;
    const latencies = data.analyses.map(modelLatency).filter((value): value is number => value !== null);
    const cycles: number[] = [];
    for (const intent of data.intents) {
      if (intent.kind !== "contributor_payout" || !["confirmed", "finalized"].includes(intent.status)) continue;
      const payable = data.payables.find(row => row._id === intent.payableId);
      const posting = data.rows.find(row => row.kind === "payout" && row.eventKey === intent.intentId);
      if (payable && posting && posting.effectiveAt >= payable.createdAt) cycles.push(posting.effectiveAt - payable.createdAt);
    }
    const obligations = -(net("liability:customer_prepayments") + net("liability:contributor_payables") + net("liability:customer_refunds"));
    return { orderCount: data.orders.length.toString(), submitted: submitted.toString(), accepted: accepted.toString(), delivered: data.deliveries.length.toString(),
      funded: new Set(data.rows.filter(row => row.kind === "funding").map(row => row.orderId)).size.toString(),
      fundedAtomic: data.rows.filter(row => row.kind === "funding").reduce((sum, row) => sum + cashIn(row), 0n).toString(),
      duplicatesBlocked: new Set(data.audits.filter(isDuplicate).map(row => row.entityId)).size.toString(), refusals: data.audits.filter(isRefusal).length.toString(),
      acceptanceRate: { accepted: accepted.toString(), submitted: submitted.toString(), basisPoints: submitted ? (BigInt(accepted) * 10_000n / BigInt(submitted)).toString() : null },
      verificationLatencyMs: { ...percentiles(latencies), source: "sum_of_recorded_model_runs" as const },
      payoutCycleTimeMs: { ...percentiles(cycles), source: "payable_accrual_to_posted_payout" as const },
      cashAtomic: net("asset:usdc").toString(), obligationsAtomic: obligations.toString(), cashLessObligationsAtomic: (net("asset:usdc") - obligations).toString(),
      customerPrepaymentsAtomic: (-net("liability:customer_prepayments")).toString(), contributorPayablesAtomic: (-net("liability:contributor_payables")).toString(),
      customerRefundsAtomic: (-net("liability:customer_refunds")).toString(), demoOnly: true };
  },
});

/** Half-open [from,to) range, at most seven days; empty five-minute buckets are retained. */
export const timeSeries = query({
  args: { ...args, from: v.number(), to: v.number() },
  handler: async (ctx, input) => {
    if (!Number.isSafeInteger(input.from) || !Number.isSafeInteger(input.to) || input.from < 0 || input.to <= input.from || input.to - input.from > 7 * 24 * 60 * 60_000) throw new Error("invalid_time_range");
    const data = await dataset(ctx, input);
    const buckets = new Map<number, { startedAt: number; submitted: bigint; accepted: bigint; delivered: bigint; duplicatesBlocked: bigint; refusals: bigint; fundedAtomic: bigint; paidAtomic: bigint; cashDeltaAtomic: bigint }>();
    for (let time = Math.floor(input.from / BUCKET_MS) * BUCKET_MS; time < input.to; time += BUCKET_MS) buckets.set(time,
      { startedAt: time, submitted: 0n, accepted: 0n, delivered: 0n, duplicatesBlocked: 0n, refusals: 0n, fundedAtomic: 0n, paidAtomic: 0n, cashDeltaAtomic: 0n });
    const bucket = (time: number) => time >= input.from && time < input.to ? buckets.get(Math.floor(time / BUCKET_MS) * BUCKET_MS) : undefined;
    for (const row of data.submissions) { const target = bucket(row._creationTime); if (target && row.status !== "uploading" && !row.verificationOnly) target.submitted++; }
    for (const row of data.deliveries) { const target = bucket(row.publishedAt); if (target) { target.delivered++; target.accepted++; } }
    const blocked = new Set<string>();
    for (const row of [...data.audits].sort((a, b) => a.occurredAt - b.occurredAt)) {
      const target = bucket(row.occurredAt); if (target && isRefusal(row)) target.refusals++;
      if (isDuplicate(row) && !blocked.has(row.entityId)) { blocked.add(row.entityId); if (target) target.duplicatesBlocked++; }
    }
    for (const row of data.rows) {
      const target = bucket(row.effectiveAt); if (!target) continue;
      const cash = cashIn(row); target.cashDeltaAtomic += cash;
      if (row.kind === "funding") target.fundedAtomic += cash;
      if (row.kind === "payout" || row.kind === "refund_paid") target.paidAtomic -= cash;
    }
    return { bucketMs: BUCKET_MS, from: input.from, to: input.to, buckets: [...buckets.values()].map(row => ({ startedAt: row.startedAt,
      submitted: row.submitted.toString(), accepted: row.accepted.toString(), delivered: row.delivered.toString(), duplicatesBlocked: row.duplicatesBlocked.toString(),
      refusals: row.refusals.toString(), fundedAtomic: row.fundedAtomic.toString(), paidAtomic: row.paidAtomic.toString(), cashDeltaAtomic: row.cashDeltaAtomic.toString() })) };
  },
});
