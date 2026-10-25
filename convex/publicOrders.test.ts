import { randomUUID } from "node:crypto";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { DEMO_ORDER_GLOBAL_LIMIT, DEMO_ORDER_WINDOW_MS } from "../packages/payments/src/demo-order";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const secret = "public-demo-synthetic-secret-for-tests";
const input = (ip = 1) => ({ serviceSecret: secret, ipDigest: ip.toString(16).padStart(64, "0"), requestId: randomUUID() });
async function setup() { const t = convexTest(schema, modules); await t.mutation(internal.seed.demo, {}); return t; }
beforeEach(() => { vi.stubEnv("SKARL_PAYMENTS_SERVICE_SECRET", secret); vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("public demo orders (synthetic database, no chain payment)", () => {
  it("creates only fixed 1 USDC testnet orders with a frozen red-cup rubric and no invented payment", async () => {
    const t = await setup(), result = await t.mutation(api.payments.createDemoOrder, input());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("creation failed");
    await t.run(async ctx => {
      const order = (await ctx.db.get(result.orderId))!;
      const rubric = (await ctx.db.get(order.taskVersionId!))!;
      expect(order).toMatchObject({ buyerTokenIdentifier: "demo:skarl:buyer", status: "awaiting_funding", network: "eip155:84532",
        autoPay: { enabled: true, maxPerClipAtomic: 1_000_000n, requireAllChecks: true, setBy: "demo:skarl:buyer", setAt: 1_800_000_000_000 },
        budgetAtomic: 1_000_000n, pricePerSampleAtomic: 1_000_000n, quantityRequested: 1n, contributorRateAtomic: 750_000n });
      expect(order.title).toContain("DEMO / TESTNET");
      expect(rubric.taskPrompt).toContain("Pick up the red cup");
      expect(rubric.frozenAt).toBe(order.updatedAt);
      expect(await ctx.db.query("paymentIntents").collect()).toHaveLength(0);
      expect(await ctx.db.query("journalEntries").collect()).toHaveLength(0);
    });
  });
  it("records a changed buyer cap and disable switch without granting caller-selected authority", async () => {
    const t = await setup();
    const result = await t.mutation(api.payments.createDemoOrder, { ...input(),
      autoPay: { enabled: false, maxPerClipAtomic: "500000", requireAllChecks: true } });
    if (!result.ok) throw new Error("creation failed");
    await t.run(async ctx => {
      expect((await ctx.db.get(result.orderId))?.autoPay).toEqual({ enabled: false, maxPerClipAtomic: 500_000n,
        requireAllChecks: true, setBy: "demo:skarl:buyer", setAt: 1_800_000_000_000 });
      expect(await ctx.db.query("auditEvents").collect()).toContainEqual(expect.objectContaining({
        entityId: result.orderId, action: "auto_pay_policy_set", actor: { kind: "human", identity: "demo:skarl:buyer" } }));
      expect(await ctx.db.query("approvals").collect()).toHaveLength(0);
    });
  });
  it("enforces per-IP limits without inserting orders or consuming global capacity on refusals, then resets next hour", async () => {
    const t = await setup();
    for (let i = 0; i < 3; i++) expect((await t.mutation(api.payments.createDemoOrder, input())).ok).toBe(true);
    expect(await t.mutation(api.payments.createDemoOrder, input())).toMatchObject({ ok: false, code: "demo_order_rate_limited", retryAfterSeconds: 3600 });
    await t.run(async ctx => {
      expect(await ctx.db.query("orders").collect()).toHaveLength(5); // two seeded + three public
      expect((await ctx.db.query("demoOrderLimits").withIndex("by_key", q => q.eq("key", "global")).unique())!.count).toBe(3);
    });
    vi.mocked(Date.now).mockReturnValue(Date.now() + DEMO_ORDER_WINDOW_MS);
    expect((await t.mutation(api.payments.createDemoOrder, input())).ok).toBe(true);
  });
  it("enforces the global hourly cap across distinct IPs", async () => {
    const t = await setup();
    for (let i = 0; i < DEMO_ORDER_GLOBAL_LIMIT; i++) expect((await t.mutation(api.payments.createDemoOrder, input(i))).ok).toBe(true);
    expect((await t.mutation(api.payments.createDemoOrder, input(999))).ok).toBe(false);
    await t.run(async ctx => { expect(await ctx.db.query("orders").collect()).toHaveLength(DEMO_ORDER_GLOBAL_LIMIT + 2); });
  });
  it("requires trusted ingress and refuses arbitrary order terms", async () => {
    const t = await setup();
    await expect(t.mutation(api.payments.createDemoOrder, { ...input(), serviceSecret: "not-authorized" })).rejects.toThrow("payment_service_unauthorized");
    for (const override of [{ budgetAtomic: "2000000" }, { taskPrompt: "Arbitrary task" }, { demoIdentity: "controller" }]) {
      await expect(t.mutation(api.payments.createDemoOrder, { ...input(), ...override })).rejects.toThrow();
    }
    await t.run(async ctx => { expect(await ctx.db.query("demoOrderLimits").collect()).toHaveLength(0); });
  });
});
