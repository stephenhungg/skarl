import { seedWithTaskSpecs } from "./fixtures/seedWithTaskSpecs";
import { randomUUID } from "node:crypto";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { digest } from "./lib/finance";
import schema from "./schema";
import { DEMO_ORDER_GLOBAL_LIMIT, DEMO_ORDER_WINDOW_MS } from "../packages/payments/src/demo-order";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const secret = "public-demo-synthetic-secret-for-tests";
const input = (ip = 1) => ({ serviceSecret: secret, ipDigest: ip.toString(16).padStart(64, "0"), requestId: randomUUID() });
async function setup() { const t = convexTest(schema, modules); await seedWithTaskSpecs(t); return t; }
beforeEach(() => { vi.stubEnv("SKARL_PAYMENTS_SERVICE_SECRET", secret); vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("public demo orders (synthetic database, no chain payment)", () => {
  it("copies the selected stored task and prices without inventing payment or an extracted spec", async () => {
    const t = await setup(), result = await t.mutation(api.payments.createDemoOrder, input());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("creation failed");
    await t.run(async ctx => {
      const order = (await ctx.db.get(result.orderId))!;
      const rubric = (await ctx.db.get(order.taskVersionId!))!;
      const source = (await ctx.db.query("orders").withIndex("by_public_id", q => q.eq("publicId", "skarl-red-cup-demo-v2")).unique())!;
      const sourceRubric = (await ctx.db.get(source.taskVersionId!))!;
      expect(order).toMatchObject({ buyerTokenIdentifier: "demo:skarl:buyer", status: "awaiting_funding", network: "eip155:84532",
        autoPay: { enabled: true, maxPerClipAtomic: source.pricePerSampleAtomic, requireAllChecks: true, setBy: "demo:skarl:buyer", setAt: expect.any(Number) },
        budgetAtomic: source.budgetAtomic, pricePerSampleAtomic: source.pricePerSampleAtomic, quantityRequested: source.quantityRequested, contributorRateAtomic: source.contributorRateAtomic });
      expect(order.title).toBe(source.title);
      expect(rubric.taskPrompt).toBe(sourceRubric.taskPrompt);
      expect(rubric.criteria).toEqual(sourceRubric.criteria);
      expect(rubric.taskSpec).toBeUndefined();
      expect(rubric.taskSpecStatus).toBe("pending");
      expect(rubric.frozenAt).toBe(order.autoPay?.setAt);
      expect(await ctx.db.query("paymentIntents").collect()).toHaveLength(0);
      expect(await ctx.db.query("journalEntries").collect()).toHaveLength(0);
    });
  });
  it("copies another selected template's rubric and exact prices instead of seeded task defaults", async () => {
    const t = await setup();
    const taskPrompt = "Pick up the can and move it closer to the hat beside the lamp. Narrate each action.";
    const criteria = [
      { criterionId: "can-pickup", description: "Pick up the can", modality: "visual" as const },
      { criterionId: "relative-placement", description: "Place the can closer to the hat beside the lamp", modality: "temporal" as const },
    ];
    // Explicit trusted fixture data: this is a synthetic stored buyer template.
    const templateOrderId = await t.run(async ctx => {
      const source = (await ctx.db.query("orders").withIndex("by_public_id", q => q.eq("publicId", "skarl-red-cup-demo-v2")).unique())!;
      const templateOrderId = await ctx.db.insert("orders", {
        organizationId: source.organizationId, network: source.network, tokenAddress: source.tokenAddress,
        publicId: "skarl-outsider-demo-selected-template", buyerTokenIdentifier: source.buyerTokenIdentifier,
        buyerWalletAddress: source.buyerWalletAddress, title: "Can movement dataset", status: "awaiting_funding",
        quantityRequested: 2n, pricePerSampleAtomic: 3_000_000n, contributorRateAtomic: 2_000_000n,
        budgetAtomic: 6_000_000n, acceptedCount: 0n, deadlineAt: source.deadlineAt,
        termsHash: digest({ taskPrompt, quantity: "2", price: "3000000", rate: "2000000" }), updatedAt: Date.now(),
      });
      const taskVersionId = await ctx.db.insert("rubricVersions", {
        organizationId: source.organizationId, orderId: templateOrderId, version: 1,
        taskPrompt, criteria, contentHash: digest({ version: 1, taskPrompt, criteria }),
        createdByTokenIdentifier: source.buyerTokenIdentifier, frozenAt: Date.now(),
      });
      await ctx.db.patch(templateOrderId, { taskVersionId });
      return templateOrderId;
    });
    const result = await t.mutation(api.payments.createDemoOrder, { ...input(), templateOrderId });
    expect(result).toMatchObject({ ok: true, title: "Can movement dataset", amountAtomic: "6000000",
      pricePerSampleAtomic: "3000000", contributorRateAtomic: "2000000", quantityRequested: "2", taskPrompt, criteria });
    if (!result.ok) throw new Error("creation failed");
    const saved = await t.run(async ctx => {
      const order = (await ctx.db.get(result.orderId))!;
      return { order, rubric: await ctx.db.get(order.taskVersionId!) };
    });
    expect(saved.order.autoPay?.maxPerClipAtomic).toBe(3_000_000n);
    expect(saved.rubric).toMatchObject({ taskPrompt, criteria, taskSpecStatus: "pending" });
    expect(saved.rubric?.taskSpec).toBeUndefined();
  });
  it("records a changed buyer cap and disable switch without granting caller-selected authority", async () => {
    const t = await setup();
    const result = await t.mutation(api.payments.createDemoOrder, { ...input(),
      autoPay: { enabled: false, maxPerClipAtomic: "500000", requireAllChecks: true } });
    if (!result.ok) throw new Error("creation failed");
    await t.run(async ctx => {
      expect((await ctx.db.get(result.orderId))?.autoPay).toEqual({ enabled: false, maxPerClipAtomic: 500_000n,
        requireAllChecks: true, setBy: "demo:skarl:buyer", setAt: result.autoPay.setAt });
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
