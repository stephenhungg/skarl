import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { analystKind, analystProvider } from "./financeAnalystSchema";
import { boundedConfig, FINANCE_ANALYST_PROMPT_VERSION, parseAnalystOutput } from "./lib/financeAnalyst";
import { readSnapshot, type AnalystSnapshot } from "./financeAnalystRead";

const runRef = makeFunctionReference<"action", { noteId: Id<"analystNotes"> }>("financeAnalystJobs:run");
const snapshotRef = makeFunctionReference<"query", { orderId: Id<"orders"> }, AnalystSnapshot>("financeAnalystRead:snapshot");
const enqueueArgs = { orderId: v.id("orders"), kind: analystKind, itemKey: v.string(), exceptionKey: v.optional(v.string()), intentId: v.optional(v.id("paymentIntents")) };
type Enqueue = { orderId: Id<"orders">; kind: "exception" | "payout" | "close"; itemKey: string; exceptionKey?: string; intentId?: Id<"paymentIntents"> };
export async function enqueueFor(ctx: MutationCtx, args: Enqueue): Promise<Id<"analystNotes"> | null> {
  const order = await ctx.db.get(args.orderId);
  if (!order || (await ctx.db.get(order.organizationId))?.status !== "active") return null;
  if (!args.itemKey || args.itemKey.length > 300) throw new Error("invalid_analyst_item");
  const prior = await ctx.db.query("analystNotes").withIndex("by_item", q => q.eq("organizationId", order.organizationId)
    .eq("kind", args.kind).eq("itemKey", args.itemKey).eq("promptVersion", FINANCE_ANALYST_PROMPT_VERSION)).unique();
  if (prior) return prior._id;
  const noteId = await ctx.db.insert("analystNotes", { ...args, organizationId: order.organizationId,
    promptVersion: FINANCE_ANALYST_PROMPT_VERSION, status: "queued", summary: "Advisory analysis queued; no action was taken.",
    recommendation: "needs_info", confidence: 0, evidenceCited: [], provider: "claude",
    model: process.env.ANTHROPIC_FINANCE_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
    transcriptJson: "[]", attempts: 0, createdAt: Date.now() });
  await ctx.scheduler.runAfter(0, runRef, { noteId });
  return noteId;
}
export const enqueue = internalMutation({ args: enqueueArgs, handler: enqueueFor });

/** Global spend/concurrency gate is claimed transactionally; queued work consumes no budget. */
export const claim = internalMutation({ args: { noteId: v.id("analystNotes") }, handler: async (ctx, args) => {
  const note = await ctx.db.get(args.noteId);
  if (!note || note.status !== "queued") return null;
  const now = Date.now(), maxRuns = boundedConfig(process.env.FINANCE_ANALYST_MAX_RUNS_PER_HOUR, 30, 1000);
  const maxConcurrency = boundedConfig(process.env.FINANCE_ANALYST_MAX_CONCURRENCY, 2, 10);
  if (!maxRuns || !maxConcurrency || process.env.FINANCE_AGENT_BACKGROUND_ENABLED === "false" || process.env.SKARL_SCHEDULED_JOBS_DISABLED === "true") return null;
  const active = await ctx.db.query("analystNotes").withIndex("by_status", q => q.eq("status", "running")).take(100);
  // A crashed action is terminal, never silently repeated. One provider retry occurs inside its single claim only.
  for (const stale of active.filter(row => (row.startedAt ?? 0) + 180_000 <= now)) {
    await ctx.db.patch(stale._id, { status: "provider_error", failureCode: "analyst_interrupted", completedAt: now,
      summary: "Analysis was interrupted. No action was taken; buyer review is still required.", recommendation: "needs_info", confidence: 0 });
  }
  if (active.filter(row => (row.startedAt ?? now) + 180_000 > now).length >= maxConcurrency) {
    return null; // The minute sweep drains queued work without multiplying scheduled retries.
  }
  const gate = await ctx.db.query("financeAnalystGate").withIndex("by_key", q => q.eq("key", "global")).unique();
  const windowStart = Math.floor(now / 3_600_000) * 3_600_000;
  const runs = gate?.windowStart === windowStart ? gate.runs : 0;
  if (runs >= maxRuns) return null;
  if (gate) await ctx.db.patch(gate._id, { windowStart, runs: runs + 1 });
  else await ctx.db.insert("financeAnalystGate", { key: "global", windowStart, runs: 1 });
  await ctx.db.patch(note._id, { status: "running", startedAt: now });
  await ctx.scheduler.runAfter(181_000, makeFunctionReference<"mutation", { noteId: Id<"analystNotes"> }>("financeAnalystData:watchdog"), args);
  return { ...note, status: "running" as const, startedAt: now };
} });
export const watchdog = internalMutation({ args: { noteId: v.id("analystNotes") }, handler: async (ctx, args) => {
  const note = await ctx.db.get(args.noteId);
  if (note?.status === "running" && (note.startedAt ?? 0) + 180_000 <= Date.now()) await ctx.db.patch(note._id, {
    status: "provider_error", failureCode: "analyst_interrupted", completedAt: Date.now(), recommendation: "needs_info", confidence: 0,
    summary: "Analysis was interrupted. No action was taken; buyer review is still required." });
} });
export const finish = internalMutation({ args: { noteId: v.id("analystNotes"), provider: analystProvider, model: v.string(),
  attempts: v.number(), transcriptJson: v.string(), factsJson: v.string(), outputJson: v.optional(v.string()), failureCode: v.optional(v.string()) },
handler: async (ctx, args) => {
  const note = await ctx.db.get(args.noteId);
  if (!note || note.status !== "running") return;
  if (args.transcriptJson.length > 100_000 || args.factsJson.length > 200_000) throw new Error("analyst_output_limit");
  const facts = JSON.parse(args.factsJson) as { evidenceCited: string[]; blocked: boolean; kind: string; settlement?: "chain_observed" | "policy_approved"; payoutSummary?: string; payout?: { evidenceCited: string[]; txUrl?: string; checksPassed: string[] } };
  const output = args.outputJson && !args.failureCode ? parseAnalystOutput(args.outputJson, facts) : {
    summary: "The finance analysis provider could not complete. No action was taken; buyer review is still required.",
    recommendation: "needs_info" as const, confidence: 0, evidenceCited: [] };
  if (note.kind === "payout" && !args.failureCode && facts.payoutSummary) {
    output.summary = facts.payoutSummary;
    output.evidenceCited = facts.payout?.evidenceCited ?? output.evidenceCited;
  }
  await ctx.db.patch(note._id, { ...output, status: args.failureCode ? "provider_error" : "completed", provider: args.provider,
    settlement: note.kind === "payout" ? facts.settlement : undefined, txUrl: facts.payout?.txUrl, checksPassed: facts.payout?.checksPassed,
    model: args.model, attempts: args.attempts, transcriptJson: args.transcriptJson, factsJson: args.factsJson,
    failureCode: args.failureCode, completedAt: Date.now() });
} });

/** Sweep is a catch-up path for review routes without a direct hook, including future tax gates. */
export const scanOrder = internalMutation({ args: { orderId: v.id("orders") }, handler: async (ctx, args) => {
  const data = await ctx.runQuery(snapshotRef, args);
  for (const row of data.exceptions) await enqueueFor(ctx, { ...args, kind: "exception", itemKey: row.exceptionKey, exceptionKey: row.exceptionKey });
  for (const row of data.reviewSubmissions) {
    // Policy-held clips already have their exact queue item; avoid a second generic clip note.
    if (data.exceptions.some(item => item.exception?.submissionId === row.submissionId)) continue;
    await enqueueFor(ctx, { ...args, kind: "exception", itemKey: `submission:${row.submissionId}` });
  }
  for (const row of data.payouts) await enqueueFor(ctx, { ...args, kind: "payout", intentId: row.intentId,
    itemKey: `payout:${row.intentId}:${row.settlement}` });
} });
export const ordersPage = internalQuery({ args: { cursor: v.optional(v.string()) }, handler: async (ctx, args) => {
  const page = await ctx.db.query("orders").paginate({ cursor: args.cursor ?? null, numItems: 20 });
  return { orderIds: page.page.map(order => order._id), cursor: page.isDone ? undefined : page.continueCursor };
} });
export const orgOrders = internalQuery({ args: { organizationId: v.id("organizations") }, handler: async (ctx, args) => {
  const rows = await ctx.db.query("orders").withIndex("by_org_buyer", q => q.eq("organizationId", args.organizationId)).take(201);
  if (rows.length > 200) throw new Error("analyst_org_inventory_limit");
  return rows.map(row => row._id);
} });
export const organizations = internalQuery({ args: {}, handler: async ctx => {
  const rows = await ctx.db.query("organizations").take(101);
  if (rows.length > 100) throw new Error("analyst_org_inventory_limit");
  return rows.filter(org => org.status === "active").map(org => org._id);
} });

/** One transaction gives every order in an organization the same financial read snapshot. */
export const closeSnapshot = internalQuery({ args: { organizationId: v.id("organizations") }, handler: async (ctx, args) => {
  const orders = await ctx.db.query("orders").withIndex("by_org_buyer", q => q.eq("organizationId", args.organizationId)).take(201);
  if (orders.length > 200) throw new Error("analyst_org_inventory_limit");
  const snapshots: AnalystSnapshot[] = [];
  for (const order of orders) snapshots.push(await readSnapshot(ctx, order._id));
  return snapshots;
} });
export const drain = internalMutation({ args: {}, handler: async ctx => {
  const queued = await ctx.db.query("analystNotes").withIndex("by_status", q => q.eq("status", "queued")).take(20);
  for (const note of queued) await ctx.scheduler.runAfter(0, runRef, { noteId: note._id });
} });
