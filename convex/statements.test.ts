import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { recordJournal } from "./lib/finance";
import { createFundingJournal, createFulfillmentJournal, createPayoutJournal, type Journal } from "../packages/ledger/src/index";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/chain";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const ALICE = "fixture:contributor:alice", BOB = "fixture:contributor:bob";
async function setup() {
  const t = convexTest(schema, modules);
  return { t, ...await t.mutation(internal.seed.demo, {}) };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
const statements = (f: Fixture, demoIdentity = "controller", orderId = f.orderId) => f.t.query(api.statements.forOrder, { demoIdentity, orderId });
const post = (f: Fixture, journal: Journal) => f.t.run(ctx => recordJournal(ctx, f.organizationId, journal));
const funding = (f: Fixture, amountMicroUsdc = 100_000_000n, eventId = "funding", orderId = f.orderId) =>
  post(f, createFundingJournal({ eventId, orderId, amountMicroUsdc }));
const fulfillment = (f: Fixture, sampleId: string, contributorId = ALICE, priceMicroUsdc = 10_000_000n,
  contributorMicroUsdc = 7_500_000n, orderId = f.orderId) =>
  post(f, createFulfillmentJournal({ eventId: `fulfillment:${sampleId}`, orderId, sampleId, contributorId, priceMicroUsdc, contributorMicroUsdc }));
async function foreignOrganization(f: Fixture) {
  return f.t.run(ctx => ctx.db.insert("organizations", { name: "Foreign synthetic tenant", status: "active", createdByTokenIdentifier: "fixture:foreign:controller" }));
}

// Journal fixtures exercise posting/projection only. No funding, acceptance or
// onchain payout is performed, and there are intentionally no payable rows.
describe("ledger-derived order statements", () => {
  it("returns an exact, serializable empty trial balance for each finance role", async () => {
    const f = await setup();
    for (const identity of ["controller", "finance-agent"]) {
      const result = await statements(f, identity);
      expect(result).toMatchObject({ orderId: f.orderId, currency: "USDC", network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS,
        trialBalance: { balanced: true, totalDebitAtomic: "0", totalCreditAtomic: "0", accounts: [] },
        cashAtomic: "0", deferredRevenueAtomic: "0", revenueAtomic: "0", contributorExpenseAtomic: "0", netIncomeAtomic: "0", payablesByContributor: [] });
      expect(() => JSON.stringify(result)).not.toThrow();
    }
  });

  it("projects funding, fulfillment and payout from journals without estimating from payable rows", async () => {
    const f = await setup();
    await funding(f);
    expect(await statements(f)).toMatchObject({ cashAtomic: "100000000", deferredRevenueAtomic: "100000000", revenueAtomic: "0", netIncomeAtomic: "0" });
    await fulfillment(f, "sample-one");
    const accrued = await statements(f);
    expect(accrued).toMatchObject({ cashAtomic: "100000000", deferredRevenueAtomic: "90000000", revenueAtomic: "10000000",
      contributorExpenseAtomic: "7500000", netIncomeAtomic: "2500000", payablesByContributor: [{ contributorTokenIdentifier: ALICE, amountAtomic: "7500000" }] });
    expect(accrued.trialBalance.totalDebitAtomic).toBe("117500000");
    expect(accrued.trialBalance.totalCreditAtomic).toBe("117500000");
    expect(await f.t.run(ctx => ctx.db.query("payables").collect())).toHaveLength(0);
    await post(f, createPayoutJournal({ eventId: "payout-one", orderId: f.orderId, amountMicroUsdc: 7_500_000n, contributorId: ALICE, payableId: "sample-one" }));
    const paid = await statements(f);
    expect(paid).toMatchObject({ cashAtomic: "92500000", deferredRevenueAtomic: "90000000", revenueAtomic: "10000000",
      contributorExpenseAtomic: "7500000", netIncomeAtomic: "2500000", payablesByContributor: [{ contributorTokenIdentifier: ALICE, amountAtomic: "0" }] });
    expect(paid.trialBalance.totalDebitAtomic).toBe("125000000");
    expect(paid.trialBalance.totalCreditAtomic).toBe("125000000");
    expect(() => JSON.stringify(paid)).not.toThrow();
  });

  it("groups contributor credits less payouts exactly and excludes other orders in the same tenant", async () => {
    const f = await setup();
    await funding(f);
    await fulfillment(f, "alice-one", ALICE);
    await fulfillment(f, "bob-one", BOB, 20_000_000n, 15_000_000n);
    await post(f, createPayoutJournal({ eventId: "alice-partial", orderId: f.orderId, amountMicroUsdc: 2_500_000n, contributorId: ALICE, payableId: "alice-one" }));
    await funding(f, 999_000_000n, "other-order-funding", f.defaultOrderId);
    await fulfillment(f, "other-order-sample", "fixture:contributor:outsider", 900_000_000n, 700_000_000n, f.defaultOrderId);
    const result = await statements(f);
    expect(result).toMatchObject({ cashAtomic: "97500000", deferredRevenueAtomic: "70000000", revenueAtomic: "30000000",
      contributorExpenseAtomic: "22500000", netIncomeAtomic: "7500000", payablesByContributor: [
        { contributorTokenIdentifier: ALICE, amountAtomic: "5000000" }, { contributorTokenIdentifier: BOB, amountAtomic: "15000000" },
      ] });
    const liability = result.trialBalance.accounts.find(row => row.account === "liability:contributor_payables");
    expect(liability?.netDebitAtomic).toBe("-20000000");
    expect((await statements(f, "controller", f.defaultOrderId)).payablesByContributor).toEqual([{ contributorTokenIdentifier: "fixture:contributor:outsider", amountAtomic: "700000000" }]);
  });

  it("preserves valid Int64 amounts above Number.MAX_SAFE_INTEGER throughout the lifecycle", async () => {
    const f = await setup(), amount = 9_007_199_254_740_993n;
    await funding(f, amount);
    await fulfillment(f, "large-sample", ALICE, amount, amount - 1n);
    expect(await statements(f)).toMatchObject({ cashAtomic: amount.toString(), deferredRevenueAtomic: "0", revenueAtomic: amount.toString(),
      contributorExpenseAtomic: (amount - 1n).toString(), netIncomeAtomic: "1", payablesByContributor: [{ contributorTokenIdentifier: ALICE, amountAtomic: (amount - 1n).toString() }] });
    await post(f, createPayoutJournal({ eventId: "large-payout", orderId: f.orderId, amountMicroUsdc: amount - 1n, contributorId: ALICE, payableId: "large-sample" }));
    const result = await statements(f);
    expect(result.cashAtomic).toBe("1"); expect(result.netIncomeAtomic).toBe("1");
    expect(result.trialBalance.totalDebitAtomic).toBe((4n * amount - 2n).toString());
    expect(result.trialBalance.totalCreditAtomic).toBe(result.trialBalance.totalDebitAtomic);
  });

  it("rejects two individually unbalanced entries even when their aggregate debits equal credits", async () => {
    const f = await setup();
    const first = await funding(f, 100n, "first"), second = await funding(f, 100n, "second");
    await f.t.run(async ctx => {
      const firstLines = await ctx.db.query("journalLines").withIndex("by_entry", q => q.eq("journalEntryId", first)).collect();
      const secondLines = await ctx.db.query("journalLines").withIndex("by_entry", q => q.eq("journalEntryId", second)).collect();
      await ctx.db.patch(firstLines.find(line => line.side === "credit")!._id, { amountAtomic: 99n });
      await ctx.db.patch(secondLines.find(line => line.side === "debit")!._id, { amountAtomic: 99n });
    });
    await expect(statements(f)).rejects.toThrow("unbalanced_journal");
  });

  it("refuses non-finance roles and cross-tenant order access", async () => {
    const f = await setup();
    for (const identity of ["contributor", "buyer"]) await expect(statements(f, identity)).rejects.toThrow("forbidden");
    const organizationId = await foreignOrganization(f);
    await f.t.run(ctx => ctx.db.patch(f.orderId, { organizationId }));
    for (const identity of ["controller", "finance-agent"]) await expect(statements(f, identity)).rejects.toThrow("cross_organization_access");
  });

  it("fails closed when an order journal or nested line belongs to another tenant", async () => {
    const f = await setup(), entryId = await funding(f), foreignId = await foreignOrganization(f);
    await f.t.run(ctx => ctx.db.patch(entryId, { organizationId: foreignId }));
    await expect(statements(f)).rejects.toThrow("statement_entry_binding_mismatch");
    await f.t.run(async ctx => {
      await ctx.db.patch(entryId, { organizationId: f.organizationId });
      const line = await ctx.db.query("journalLines").withIndex("by_entry", q => q.eq("journalEntryId", entryId)).first();
      await ctx.db.patch(line!._id, { organizationId: foreignId });
    });
    await expect(statements(f)).rejects.toThrow("statement_line_binding_mismatch");
  });

  it("rejects a corrupted line-entry binding and nonpositive stored amounts", async () => {
    const f = await setup(), first = await funding(f, 100n, "first"), second = await funding(f, 100n, "second");
    const lineId = await f.t.run(async ctx => {
      const line = (await ctx.db.query("journalLines").withIndex("by_entry", q => q.eq("journalEntryId", first)).first())!;
      await ctx.db.patch(line._id, { journalEntryId: second });
      return line._id;
    });
    await expect(statements(f)).rejects.toThrow("unbalanced_journal");
    await f.t.run(ctx => ctx.db.patch(lineId, { journalEntryId: first, amountAtomic: 0n }));
    await expect(statements(f)).rejects.toThrow("invalid_agent_amount_limit");
  });

  it("requires contributor attribution on every payable-account entry, including payout debits", async () => {
    const f = await setup();
    await funding(f);
    const fulfillmentId = await fulfillment(f, "tagged-sample");
    await f.t.run(ctx => ctx.db.patch(fulfillmentId, { contributorTokenIdentifier: undefined }));
    await expect(statements(f)).rejects.toThrow("payables_contributor_required");
    await f.t.run(ctx => ctx.db.patch(fulfillmentId, { contributorTokenIdentifier: ALICE }));
    const payoutId = await post(f, createPayoutJournal({ eventId: "untagged-payout", orderId: f.orderId, amountMicroUsdc: 7_500_000n, contributorId: ALICE, payableId: "tagged-sample" }));
    await f.t.run(ctx => ctx.db.patch(payoutId, { contributorTokenIdentifier: "" }));
    await expect(statements(f)).rejects.toThrow("payables_contributor_required");
  });
});
