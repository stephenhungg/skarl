import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
async function setup() { const t = convexTest(schema, modules); await t.mutation(internal.seed.demo, {}); return t; }
const input = () => ({ demoIdentity: "buyer", requestId: "new-order", title: "Record a cup", buyerWalletAddress: `0x${"1".repeat(40)}`,
  quantityRequested: "3", pricePerSampleAtomic: "9007199254740993", contributorRateAtomic: "1000000", deadlineAt: Date.now() + 3600000,
  taskPrompt: "Place the cup upright", criteria: [{ criterionId: "cup", description: "Cup is upright", modality: "visual" as const }] });
describe("buyer orders", () => {
  it("discovers orders owned by the buyer organization regardless of the creating buyer", async () => {
    const t = await setup();
    await t.run(async ctx => {
      for (const order of await ctx.db.query("orders").collect()) await ctx.db.patch(order._id, { buyerTokenIdentifier: "another-buyer" });
    });
    expect(await t.query(api.dashboard.demoContext, { demoIdentity: "buyer" })).not.toBeNull();
    const created = await t.mutation(api.orders.createOrder, input());
    expect(await t.query(api.orders.listOrders, { demoIdentity: "buyer", paginationOpts: { numItems: 100, cursor: null } })).toMatchObject({ page: expect.arrayContaining([expect.objectContaining({ _id: created.orderId })]) });
  });

  it("freezes optional diversity terms in the replay binding so funding cannot buy silently changed coverage", async () => {
    const t = await setup(), args = { ...input(), diversity: { maxPerContributor: 1, maxPerEnvironment: 2,
      requiredVariants: [" low-light ", "left-hand"] } };
    const created = await t.mutation(api.orders.createOrder, args);
    expect(await t.run(ctx => ctx.db.get(created.orderId))).toMatchObject({ diversity: { maxPerContributor: 1,
      maxPerEnvironment: 2, requiredVariants: ["left-hand", "low-light"] } });
    expect(await t.mutation(api.orders.createOrder, { ...args, diversity: { ...args.diversity, requiredVariants: ["left-hand", "low-light"] } }))
      .toMatchObject({ orderId: created.orderId, replayed: true });
    await expect(t.mutation(api.orders.createOrder, { ...args, diversity: { maxPerContributor: 2 } })).rejects.toThrow("order_request_conflict");
    const coverage = await t.query(api.orders.diversityCoverage, { demoIdentity: "buyer", orderId: created.orderId });
    expect(coverage).toMatchObject({ acceptedCount: "0", missingVariants: ["left-hand", "low-light"], environments: [] });
    await expect(t.query(api.orders.diversityCoverage, { demoIdentity: "contributor", orderId: created.orderId })).rejects.toThrow("forbidden");
    await t.run(ctx => ctx.db.patch(created.orderId, { buyerTokenIdentifier: "another-buyer" }));
    expect(await t.query(api.orders.diversityCoverage, { demoIdentity: "buyer", orderId: created.orderId })).toEqual(coverage);
    await t.run(async ctx => {
      const organizationId = await ctx.db.insert("organizations", { name: "Other tenant", createdByTokenIdentifier: "other", status: "active" });
      await ctx.db.patch(created.orderId, { organizationId });
    });
    await expect(t.query(api.orders.diversityCoverage, { demoIdentity: "buyer", orderId: created.orderId })).rejects.toThrow("cross_organization_access");
  });

  it("rejects impossible or ambiguous quotas before freezing terms", async () => {
    const t = await setup();
    for (const diversity of [{ maxPerContributor: 0 }, { maxPerEnvironment: 1.5 }, { maxPerEnvironment: Number.MAX_SAFE_INTEGER + 1 },
      { requiredVariants: ["same", " same "] }, { requiredVariants: ["a", "b", "c", "d"] }, { requiredVariants: [""] }]) {
      await expect(t.mutation(api.orders.createOrder, { ...input(), diversity })).rejects.toThrow(/invalid_diversity/);
    }
  });

  it("freezes a rubric, computes exact money beyond Number precision, and replays once", async () => {
    const t = await setup(), args = input(), first = await t.mutation(api.orders.createOrder, args);
    expect(first).toMatchObject({ status: "awaiting_funding", budgetAtomic: "27021597764222979", replayed: false });
    expect(await t.mutation(api.orders.createOrder, args)).toEqual({ ...first, replayed: true });
    await expect(t.mutation(api.orders.createOrder, { ...args, title: "Changed" })).rejects.toThrow("order_request_conflict");
    await t.run(async ctx => {
      const order = await ctx.db.get(first.orderId), rubric = await ctx.db.get(first.taskVersionId);
      expect(order!.budgetAtomic).toBe(3n * 9007199254740993n);
      expect(rubric!.frozenAt).toBeDefined();
      expect(rubric!.orderId).toBe(first.orderId);
      expect(await ctx.db.query("paymentIntents").collect()).toHaveLength(0);
      expect(await ctx.db.query("journalEntries").collect()).toHaveLength(0);
      expect((await ctx.db.query("auditEvents").collect()).filter(e => e.entityId === first.orderId)).toHaveLength(2);
    });
  });
  it.each(["contributor", "controller", "finance-agent"])("refuses %s", async demoIdentity => {
    const t = await setup();
    await expect(t.mutation(api.orders.createOrder, { ...input(), demoIdentity })).rejects.toThrow();
  });
  it("refuses float/overflow budgets, overpaid contributor rates and malformed rubrics", async () => {
    const t = await setup(), args = input();
    for (const change of [{ quantityRequested: "1.5" }, { pricePerSampleAtomic: "9223372036854775807" },
      { pricePerSampleAtomic: "1", contributorRateAtomic: "2" }, { criteria: [args.criteria[0]!, args.criteria[0]!] },
      { deadlineAt: 1 }, { buyerWalletAddress: `0x${"0".repeat(40)}` }]) {
      await expect(t.mutation(api.orders.createOrder, { ...args, ...change })).rejects.toThrow();
    }
  });
  it("paginates only the buyer organization's orders and refuses contributors", async () => {
    const t = await setup(), created = await t.mutation(api.orders.createOrder, input());
    await t.run(async ctx => {
      const order = (await ctx.db.get(created.orderId))!;
      const { _id, _creationTime, ...copy } = order;
      await ctx.db.insert("orders", { ...copy, publicId: "another-buyer", buyerTokenIdentifier: "other" });
      const org = await ctx.db.insert("organizations", { name: "other", status: "active", createdByTokenIdentifier: "other" });
      await ctx.db.insert("orders", { ...copy, organizationId: org, publicId: "another-tenant" });
    });
    const page = await t.query(api.orders.listOrders, { demoIdentity: "buyer", paginationOpts: { numItems: 100, cursor: null } });
    expect(page.page.some(o => o._id === created.orderId)).toBe(true);
    expect(page.page.find(o => o._id === created.orderId)?.autoPay?.maxPerClipAtomic).toBe("9007199254740993");
    expect(() => JSON.stringify(page)).not.toThrow();
    expect(page.page.some(o => o.publicId === "another-buyer")).toBe(true);
    expect(page.page.some(o => o.publicId === "another-tenant")).toBe(false);
    expect(page.page.every(o => typeof o.budgetAtomic === "string")).toBe(true);
    await expect(t.query(api.orders.listOrders, { demoIdentity: "contributor", paginationOpts: { numItems: 10, cursor: null } })).rejects.toThrow();
  });
});
