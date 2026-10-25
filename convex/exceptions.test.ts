import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/chain";
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
async function setup() {
  const t = convexTest(schema, modules), seed = await t.mutation(internal.seed.demo, {});
  await t.run(ctx => ctx.db.insert("paymentIntents", { organizationId: seed.organizationId, orderId: seed.orderId,
    network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, kind: "funding", intentId: `synthetic:${seed.orderId}`,
    buyerWalletAddress: `0x${"1".repeat(40)}`, recipientAddress: `0x${"2".repeat(40)}`, amountAtomic: 100_000_000n,
    termsHash: "synthetic", resourcePath: "/synthetic", x402Version: 2, paymentIdentifier: "synthetic", expiresAt: Date.now() + 60_000,
    status: "settlement_pending", updatedAt: Date.now() }));
  return { t, ...seed };
}

describe("reconciliation queue annotations", () => {
  it("acknowledges and resolves idempotently without changing evidence or concealing a live exception", async () => {
    const f = await setup(), scope = { demoIdentity: "buyer", orderId: f.orderId };
    const list = await f.t.query(api.exceptions.list, scope);
    expect(list).toHaveLength(1); expect(list[0].exception.code).toBe("missing_transfer");
    const before = await f.t.run(async ctx => ({ journals: await ctx.db.query("journalEntries").collect(),
      lines: await ctx.db.query("journalLines").collect(), intents: await ctx.db.query("paymentIntents").collect() }));
    const args = { ...scope, exceptionKey: list[0].exceptionKey, reason: "Inspect original transaction before any retry" };
    const ack = await f.t.mutation(api.exceptions.acknowledge, args);
    expect(await f.t.mutation(api.exceptions.acknowledge, args)).toEqual({ ...ack, replayed: true });
    const resolved = await f.t.mutation(api.exceptions.resolve, { ...args, reason: "Investigation assigned; manual disposition only" });
    expect(await f.t.mutation(api.exceptions.resolve, { ...args, reason: "Investigation assigned; manual disposition only" })).toEqual({ ...resolved, replayed: true });
    const visible = await f.t.query(api.exceptions.list, scope);
    expect(visible[0]).toMatchObject({ stillDetected: true, disposition: { status: "resolved" } });
    expect(await f.t.run(async ctx => ({ journals: await ctx.db.query("journalEntries").collect(),
      lines: await ctx.db.query("journalLines").collect(), intents: await ctx.db.query("paymentIntents").collect() }))).toEqual(before);
    const events = await f.t.run(ctx => ctx.db.query("auditEvents").collect());
    expect(events.filter(event => event.action.startsWith("reconciliation_exception_"))).toHaveLength(2);
    await expect(f.t.mutation(api.exceptions.acknowledge, args)).rejects.toThrow("exception_already_resolved");
    await expect(f.t.mutation(api.exceptions.resolve, { ...args, reason: "Replace recorded reason" })).rejects.toThrow("exception_disposition_conflict");
  });

  it.each(["acknowledge", "resolve"] as const)("%s checks role, tenant, real exception and reason", async name => {
    const f = await setup(), scope = { demoIdentity: "controller", orderId: f.orderId };
    const exceptionKey = (await f.t.query(api.exceptions.list, scope))[0].exceptionKey;
    const args = { ...scope, exceptionKey, reason: "Investigated" };
    for (const demoIdentity of ["contributor", "finance-agent"]) {
      await expect(f.t.mutation(api.exceptions[name], { ...args, demoIdentity })).rejects.toThrow();
    }
    await f.t.run(ctx => ctx.db.patch(f.orderId, {buyerTokenIdentifier: "fixture:other-buyer"}));
    await expect(f.t.query(api.exceptions.list, {...scope, demoIdentity: "buyer"})).rejects.toThrow("order_not_owned");
    await expect(f.t.mutation(api.exceptions[name], {...args, demoIdentity: "buyer"})).rejects.toThrow("order_not_owned");
    await expect(f.t.mutation(api.exceptions[name], { ...args, reason: "  " })).rejects.toThrow("invalid_exception_disposition");
    await expect(f.t.mutation(api.exceptions[name], { ...args, exceptionKey: "0".repeat(64) })).rejects.toThrow("exception_not_found");
    await f.t.run(async ctx => {
      const foreign = await ctx.db.insert("organizations", { name: "Synthetic foreign tenant", status: "active", createdByTokenIdentifier: "fixture:foreign" });
      await ctx.db.patch(f.orderId, { organizationId: foreign });
    });
    await expect(f.t.mutation(api.exceptions[name], args)).rejects.toThrow("cross_organization_access");
    expect(await f.t.run(ctx => ctx.db.query("reconciliationDispositions").collect())).toHaveLength(0);
  });

  it("retains the disposition when its original discrepancy is no longer detected", async () => {
    const f = await setup(), scope = { demoIdentity: "controller", orderId: f.orderId };
    const exceptionKey = (await f.t.query(api.exceptions.list, scope))[0].exceptionKey;
    await f.t.mutation(api.exceptions.acknowledge, { ...scope, exceptionKey, reason: "Recorded investigation" });
    // Synthetic fixture change only; production dispositions never delete payment records.
    await f.t.run(async ctx => { for (const row of await ctx.db.query("paymentIntents").collect()) await ctx.db.delete(row._id); });
    expect(await f.t.query(api.exceptions.list, scope)).toMatchObject([{ exceptionKey, stillDetected: false }]);
    await f.t.mutation(api.exceptions.resolve, { ...scope, exceptionKey, reason: "No longer detected by reconciliation" });
    await expect(f.t.query(api.exceptions.list, { ...scope, demoIdentity: "contributor" })).rejects.toThrow("forbidden");
  });
});
