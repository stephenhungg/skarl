import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/chain";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);

describe("versioned demo seeds in isolated Convex state", () => {
  it("adds a 10 USDC v2 with exact amounts and the legacy rubric without funding either order", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.mutation(internal.seed.demo, {});
    const state = await t.run(async (ctx) => ({
      orders: await ctx.db.query("orders").collect(),
      legacy: await ctx.db.get(seeded.orderId),
      current: await ctx.db.get(seeded.defaultOrderId),
      legacyRubric: await ctx.db.get(seeded.taskVersionId),
      currentRubric: await ctx.db.get(seeded.defaultTaskVersionId),
      journals: await ctx.db.query("journalEntries").collect(),
      observations: await ctx.db.query("chainObservations").collect(),
    }));
    expect(state.orders).toHaveLength(2);
    expect(state.legacy).toMatchObject({ publicId: "skarl-red-cup-demo-v1", quantityRequested: 10n,
      pricePerSampleAtomic: 10_000_000n, contributorRateAtomic: 7_500_000n, budgetAtomic: 100_000_000n,
      status: "awaiting_funding", acceptedCount: 0n });
    expect(state.current).toMatchObject({ publicId: "skarl-red-cup-demo-v2", quantityRequested: 4n,
      pricePerSampleAtomic: 2_500_000n, contributorRateAtomic: 1_875_000n, budgetAtomic: 10_000_000n,
      network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, status: "awaiting_funding", acceptedCount: 0n,
      taskVersionId: seeded.defaultTaskVersionId });
    expect(state.current!.budgetAtomic).toBe(state.current!.quantityRequested * state.current!.pricePerSampleAtomic);
    expect(state.currentRubric).toMatchObject({
      orderId: seeded.defaultOrderId, taskPrompt: state.legacyRubric!.taskPrompt,
      criteria: state.legacyRubric!.criteria, contentHash: state.legacyRubric!.contentHash,
    });
    expect(state.current!.termsHash).not.toBe(state.legacy!.termsHash);
    expect(state.journals).toHaveLength(0);
    expect(state.observations).toHaveLength(0);
  });

  it("replays without duplicating identities, orders, rubrics or audit events or changing deadlines", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.mutation(internal.seed.demo, {});
    const snapshot = () => t.run(async (ctx) => ({
      organizations: await ctx.db.query("organizations").collect(),
      memberships: await ctx.db.query("memberships").collect(),
      orders: await ctx.db.query("orders").collect(),
      rubrics: await ctx.db.query("rubricVersions").collect(),
      audits: await ctx.db.query("auditEvents").collect(),
    }));
    const before = await snapshot();
    expect(before.memberships).toHaveLength(4);
    expect(before.orders).toHaveLength(2);
    expect(before.rubrics).toHaveLength(2);
    expect(before.audits).toHaveLength(2);
    expect(await t.mutation(internal.seed.demo, {})).toEqual(seeded);
    expect(await snapshot()).toEqual(before);
  });

  it("upgrades an existing v1 deployment without changing its order, rubric or audit history", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.mutation(internal.seed.demo, {});
    // Remove v2 to model a pre-upgrade deployment; mutate legacy operational
    // fields to ensure reseeding cannot reset existing funding or progress.
    const legacyBefore = await t.run(async (ctx) => {
      await ctx.db.delete(seeded.defaultOrderId);
      await ctx.db.delete(seeded.defaultTaskVersionId);
      const audit = await ctx.db.query("auditEvents")
        .filter(q => q.eq(q.field("entityId"), seeded.defaultOrderId)).unique();
      if (!audit) throw new Error("missing v2 seed audit");
      await ctx.db.delete(audit._id);
      await ctx.db.patch(seeded.orderId, { status: "collecting", acceptedCount: 1n,
        buyerWalletAddress: "0x1111111111111111111111111111111111111111", deadlineAt: 1, updatedAt: 2 });
      return { order: await ctx.db.get(seeded.orderId), rubric: await ctx.db.get(seeded.taskVersionId),
        audit: await ctx.db.query("auditEvents").unique() };
    });
    expect(await t.query(api.dashboard.demoContext, { demoIdentity: "buyer" }))
      .toMatchObject({ orderId: seeded.orderId, taskVersionId: seeded.taskVersionId });
    const upgraded = await t.mutation(internal.seed.demo, {});
    expect(upgraded).toMatchObject({ orderId: seeded.orderId, taskVersionId: seeded.taskVersionId });
    expect(await t.run(async (ctx) => ({
      order: await ctx.db.get(seeded.orderId), rubric: await ctx.db.get(seeded.taskVersionId),
      audit: await ctx.db.get(legacyBefore.audit!._id),
    }))).toEqual(legacyBefore);
    expect(await t.run((ctx) => ctx.db.query("orders").collect())).toHaveLength(2);
    expect(await t.query(api.dashboard.demoContext, { demoIdentity: "buyer" }))
      .toMatchObject({ orderId: upgraded.defaultOrderId, taskVersionId: upgraded.defaultTaskVersionId });
  });
});

describe("Solana funding demo seed", () => {
  it("creates one unfunded 1 USDC order idempotently without changing existing orders or Base payout denomination", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.demo, {});
    const originals = await t.run(ctx => ctx.db.query("orders").collect());
    const seeded = await t.mutation(internal.seed.solanaDemo, {});
    const order = await t.run(ctx => ctx.db.get(seeded.orderId));
    expect(order).toMatchObject({ publicId: "skarl-red-cup-demo-sol", status: "awaiting_funding", quantityRequested: 1n,
      budgetAtomic: 1_000_000n, pricePerSampleAtomic: 1_000_000n, contributorRateAtomic: 750_000n,
      network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS });
    expect(await t.mutation(internal.seed.solanaDemo, {})).toEqual(seeded);
    const state = await t.run(async ctx => ({ orders: await ctx.db.query("orders").collect(),
      journals: await ctx.db.query("journalEntries").collect(), observations: await ctx.db.query("chainObservations").collect() }));
    expect(state.orders).toHaveLength(3);
    expect(state.orders.filter(item => item._id !== seeded.orderId)).toEqual(originals);
    expect(state.orders.find(item => item._id === seeded.orderId)).toEqual(order);
    expect(state.journals).toHaveLength(0);
    expect(state.observations).toHaveLength(0);
  });
});

afterEach(() => vi.unstubAllEnvs());

it("keeps bootstrap internal and independent of demo selectors or a legacy controller membership", async () => {
  vi.stubEnv("SKARL_DEMO_IDENTITIES", "off");
  const t = convexTest(schema, modules);
  const seeded = await t.mutation(internal.seed.demo, {});
  await t.run(async ctx => {
    const legacy = await ctx.db.query("memberships").withIndex("by_token_identifier", q => q.eq("tokenIdentifier", "demo:skarl:controller")).unique();
    await ctx.db.patch(legacy!._id, { status: "revoked" });
  });
  expect(await t.mutation(internal.seed.demo, {})).toEqual(seeded);
  const solana = await t.mutation(internal.seed.solanaDemo, {});
  const order = await t.run(ctx => ctx.db.get(solana.orderId));
  expect(order).toMatchObject({ organizationId: seeded.organizationId, buyerTokenIdentifier: "demo:skarl:buyer", status: "awaiting_funding" });
  expect(await t.run(ctx => ctx.db.query("paymentAttempts").collect())).toEqual([]);
});
