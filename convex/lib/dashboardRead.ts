import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { requireRole } from "./demoAuth";
import { requireTenant } from "./finance";
import { trialBalance } from "./financeAgentLoop";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "../../packages/contracts/src/chain";

export async function financeScope(ctx: QueryCtx, demoIdentity: string, orderId?: Id<"orders">) {
  const principal = await requireRole(ctx, demoIdentity, ["buyer", "controller", "finance-agent"]);
  const order = orderId ? await ctx.db.get(orderId) : null;
  if (orderId && !order) throw new Error("order_not_found");
  if (order) {
    requireTenant(principal, order);
    if (principal.roles.includes("buyer") && !principal.roles.includes("controller") && order.buyerTokenIdentifier !== principal.tokenIdentifier) throw new Error("order_not_owned");
  }
  const visible = order ? [order] : await ctx.db.query("orders").withIndex("by_org_status", q => q.eq("organizationId", principal.organizationId)).collect();
  const orders = visible.filter(row => (order || !row.publicId.startsWith("scenario:")) &&
    (!principal.roles.includes("buyer") || principal.roles.includes("controller") || row.buyerTokenIdentifier === principal.tokenIdentifier));
  return { principal, orders, orderIds: new Set(orders.map(row => row._id)) };
}

export async function ledgerRows(ctx: QueryCtx, organizationId: Id<"organizations">, orderIds: Set<Id<"orders">>) {
  const entries = (await Promise.all([...orderIds].map(orderId => ctx.db.query("journalEntries")
    .withIndex("by_order", q => q.eq("orderId", orderId)).collect()))).flat();
  const rows = await Promise.all(entries.map(async entry => {
    if (entry.organizationId !== organizationId || entry.status !== "posted" || entry.network !== PAYMENT_NETWORK || entry.tokenAddress !== USDC_ADDRESS) throw new Error("statement_entry_binding_mismatch");
    const lines = await ctx.db.query("journalLines").withIndex("by_entry", q => q.eq("journalEntryId", entry._id)).collect();
    if (lines.some(line => line.organizationId !== organizationId)) throw new Error("statement_line_binding_mismatch");
    return { ...entry, lines: lines.map(line => ({ account: line.account, side: line.side, amountAtomic: line.amountAtomic.toString() })) };
  }));
  return { rows, balance: trialBalance(rows) };
}

export async function orderRows(ctx: QueryCtx, orders: Doc<"orders">[]) {
  const results = await Promise.all(orders.map(async order => {
    const [submissions, deliveries, payables, intents, runs] = await Promise.all([
      ctx.db.query("submissions").withIndex("by_order_status", q => q.eq("orderId", order._id)).collect(),
      ctx.db.query("deliveries").withIndex("by_order", q => q.eq("orderId", order._id)).collect(),
      ctx.db.query("payables").withIndex("by_order", q => q.eq("orderId", order._id)).collect(),
      ctx.db.query("paymentIntents").withIndex("by_order", q => q.eq("orderId", order._id)).collect(),
      ctx.db.query("financeAgentRuns").withIndex("by_order", q => q.eq("orderId", order._id)).collect(),
    ]);
    if ([...submissions, ...deliveries, ...payables, ...intents, ...runs].some(row => row.organizationId !== order.organizationId)) throw new Error("cross_organization_reference");
    return { submissions, deliveries, payables, intents, runs };
  }));
  return { submissions: results.flatMap(row => row.submissions), deliveries: results.flatMap(row => row.deliveries),
    payables: results.flatMap(row => row.payables), intents: results.flatMap(row => row.intents), runs: results.flatMap(row => row.runs) };
}

/** Keyset pagination over the bounded demo dataset. New rows cannot shift offsets. */
export function pageRows<T extends { id: string; occurredAt: number }>(rows: T[], scope: string, cursor?: string, limit = 50) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("invalid_page_size");
  let after: { scope: string; time: number; id: string } | undefined;
  if (cursor) {
    try { after = JSON.parse(cursor); } catch { throw new Error("invalid_cursor"); }
    if (!after || after.scope !== scope || typeof after.id !== "string" || !Number.isFinite(after.time)) throw new Error("invalid_cursor");
  }
  const sorted = rows.filter(row => !after || row.occurredAt < after.time || (row.occurredAt === after.time && row.id < after.id))
    .sort((a, b) => b.occurredAt - a.occurredAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const page = sorted.slice(0, limit), last = page.at(-1), isDone = sorted.length <= limit;
  return { page, isDone, continueCursor: !isDone && last ? JSON.stringify({ scope, time: last.occurredAt, id: last.id }) : null };
}
