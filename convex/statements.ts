import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireRole } from "./lib/demoAuth";
import { requireTenant } from "./lib/finance";
import { trialBalance } from "./lib/financeAgentLoop";

/** Principal-model statements from posted journals; stored payables are not an accounting source. */
export const forOrder = query({
  args: { demoIdentity: v.string(), orderId: v.id("orders") },
  handler: async (ctx, args) => {
    const principal = await requireRole(ctx, args.demoIdentity, ["controller", "finance-agent"]);
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("order_not_found");
    requireTenant(principal, order);
    const entries = await ctx.db.query("journalEntries").withIndex("by_order", q => q.eq("orderId", order._id)).collect();
    const contributorBalances = new Map<string, bigint>();
    const journals = [];
    for (const entry of entries) {
      if (entry.organizationId !== order.organizationId || entry.orderId !== order._id || entry.status !== "posted" ||
        entry.network !== order.network || entry.tokenAddress !== order.tokenAddress) throw new Error("statement_entry_binding_mismatch");
      const lines = await ctx.db.query("journalLines").withIndex("by_entry", q => q.eq("journalEntryId", entry._id)).collect();
      for (const line of lines) {
        if (line.organizationId !== order.organizationId || line.journalEntryId !== entry._id) throw new Error("statement_line_binding_mismatch");
        if (line.account === "liability:contributor_payables") {
          const contributor = entry.contributorTokenIdentifier;
          if (!contributor?.trim()) throw new Error("payables_contributor_required");
          contributorBalances.set(contributor, (contributorBalances.get(contributor) ?? 0n) +
            (line.side === "credit" ? line.amountAtomic : -line.amountAtomic));
        }
      }
      journals.push({ lines: lines.map(line => ({ account: line.account, side: line.side, amountAtomic: line.amountAtomic.toString() })) });
    }
    // This rejects each unbalanced entry, even if two corrupt entries cancel in aggregate.
    const balance = trialBalance(journals);
    const netDebit = (account: string) => BigInt(balance.accounts.find(row => row.account === account)?.netDebitAtomic ?? "0");
    const evidenceRevenue = -netDebit("revenue:evidence_sales");
    const revenue = -netDebit("revenue:dataset_sales") + evidenceRevenue, contributorExpense = netDebit("expense:contributor_acquisition");
    return {
      orderId: order._id, currency: "USDC" as const, network: order.network, tokenAddress: order.tokenAddress,
      trialBalance: balance,
      // cashAtomic remains treasury cash: evidence receipts cannot fund order payouts.
      cashAtomic: netDebit("asset:usdc").toString(),
      evidenceCashAtomic: netDebit("asset:evidence_usdc").toString(),
      evidenceRevenueAtomic: evidenceRevenue.toString(),
      evidenceDeferredAtomic: (-netDebit("liability:evidence_receipts")).toString(),
      deferredRevenueAtomic: (-netDebit("liability:customer_prepayments")).toString(),
      revenueAtomic: revenue.toString(), contributorExpenseAtomic: contributorExpense.toString(),
      // This prototype has only contributor expense postings; inference, fees and tax are excluded.
      netIncomeAtomic: (revenue - contributorExpense).toString(),
      payablesByContributor: [...contributorBalances].sort(([a], [b]) => a.localeCompare(b))
        .map(([contributorTokenIdentifier, amount]) => ({ contributorTokenIdentifier, amountAtomic: amount.toString() })),
    };
  },
});
