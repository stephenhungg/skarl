import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { PAYMENT_NETWORK, SOLANA_PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/chain";
import { fundingTermsHash } from "../packages/payments/src/funding-terms";

// Synthetic operator provisioning/settlement only; no live wallet, RPC or env mutation.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const SECRET = "synthetic-agent-treasury-service-secret-not-real";
const AGENT = `0x${"aB".repeat(20)}`, TREASURY = `0x${"22".repeat(20)}`, PAYER = `0x${"33".repeat(20)}`;
const NOW = 1_800_000_000_000;
beforeEach(() => {
  vi.stubEnv("SKARL_PAYMENTS_SERVICE_SECRET", SECRET);
  vi.stubEnv("CDP_AGENT_ADDRESS", AGENT);
  vi.stubEnv("SKARL_TREASURY_ADDRESS", TREASURY);
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
async function setup() {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.demo, {});
  return t;
}
function creation() {
  return { serviceSecret: SECRET, ipDigest: "1".repeat(64), requestId: "00000000-0000-4000-8000-000000000002",
    idempotencyKey: "agent-treasury-test-create" };
}
async function rows(t: Awaited<ReturnType<typeof setup>>) {
  return t.run(async ctx => ({ orders: await ctx.db.query("orders").collect(),
    limits: await ctx.db.query("demoOrderLimits").collect(), requests: await ctx.db.query("requestIdempotency").collect(),
    intents: await ctx.db.query("paymentIntents").collect(), attempts: await ctx.db.query("paymentAttempts").collect(),
    journals: await ctx.db.query("journalEntries").collect(), lines: await ctx.db.query("journalLines").collect() }));
}

describe("per-order operator-selected agent funding treasury", () => {
  it("creates one fixed, disabled-auto-pay order without changing the global receiving address or other orders", async () => {
    const t = await setup();
    const initial = await rows(t);
    const created = await t.mutation(internal.payments.createWalletMcpDemo, {});
    if (!created.ok) throw new Error("operator provisioning refused");
    expect(created).toMatchObject({ fundingPayTo: AGENT.toLowerCase(),
      autoPay: { enabled: false, requireAllChecks: true, maxPerClipAtomic: "1000000" } });
    expect(await t.run(ctx => ctx.db.get(created.orderId))).toMatchObject({ fundingPayTo: AGENT.toLowerCase(),
      status: "awaiting_funding", budgetAtomic: 1_000_000n, autoPay: { enabled: false } });
    const after = await rows(t);
    expect(after.orders).toHaveLength(initial.orders.length + 1);
    for (const original of initial.orders) expect(after.orders.find(order => order._id === original._id)).toEqual(original);
    expect(after.intents).toHaveLength(0);
    expect(after.attempts).toHaveLength(0);
    expect(after.journals).toHaveLength(0);
    expect(process.env.SKARL_TREASURY_ADDRESS).toBe(TREASURY);
  });

  it("replays exactly the same operator order and recipient after CDP configuration changes or disappears", async () => {
    const t = await setup(), first = await t.mutation(internal.payments.createWalletMcpDemo, {});
    const before = await rows(t);
    vi.stubEnv("CDP_AGENT_ADDRESS", `0x${"cd".repeat(20)}`);
    expect(await t.mutation(internal.payments.createWalletMcpDemo, {})).toEqual(first);
    vi.stubEnv("CDP_AGENT_ADDRESS", undefined);
    expect(await t.mutation(internal.payments.createWalletMcpDemo, {})).toEqual(first);
    expect(await rows(t)).toEqual(before);
  });

  it.each([undefined, "not-an-address", `0x${"0".repeat(40)}`, " 0x" + "aa".repeat(20)])(
    "refuses invalid configured agent recipient %s before creating or consuming quotas", async configured => {
      const t = await setup(), before = await rows(t);
      vi.stubEnv("CDP_AGENT_ADDRESS", configured);
      await expect(t.mutation(internal.payments.createWalletMcpDemo, {})).rejects.toThrow("cdp_agent_not_configured");
      expect(await rows(t)).toEqual(before);
    });

  it("requires trusted service authorization and only accepts the allowlisted profile, never an arbitrary address", async () => {
    const t = await setup(), before = await rows(t);
    await expect(t.mutation(api.payments.createDemoOrder, { ...creation(), serviceSecret: "wrong", fundingProfile: "agent" }))
      .rejects.toThrow("payment_service_unauthorized");
    await expect(t.mutation(api.payments.createDemoOrder, { ...creation(), fundingProfile: "custom" } as never)).rejects.toThrow();
    await expect(t.mutation(api.payments.createDemoOrder, { ...creation(), fundingPayTo: PAYER } as never)).rejects.toThrow();
    await expect(t.mutation(internal.payments.createWalletMcpDemo, { fundingPayTo: PAYER } as never)).rejects.toThrow();
    expect(await rows(t)).toEqual(before);
  });

  it.each([false, true])("binds the profile to creation idempotency (agent initially %s)", async agent => {
    const t = await setup();
    const first = await t.mutation(api.payments.createDemoOrder, { ...creation(), ...(agent ? { fundingProfile: "agent" as const } : {}) });
    const before = await rows(t);
    await expect(t.mutation(api.payments.createDemoOrder, { ...creation(), ...(!agent ? { fundingProfile: "agent" as const } : {}) }))
      .rejects.toThrow("idempotency_key_conflict");
    expect(await rows(t)).toEqual(before);
    expect(first.ok).toBe(true);
  });

  it("atomically refuses another receiving address and Solana, then funds only the frozen agent address", async () => {
    const t = await setup(), created = await t.mutation(internal.payments.createWalletMcpDemo, {});
    if (!created.ok || !created.fundingPayTo) throw new Error("operator provisioning refused");
    const funding = { serviceSecret: SECRET, orderId: created.orderId, demoIdentity: "buyer", payerAddress: PAYER,
      recipientAddress: created.fundingPayTo, authorizationNonce: `0x${"aa".repeat(32)}`, amountAtomic: 1_000_000n,
      validBefore: NOW + 60_000, expectedFundingTermsHash: fundingTermsHash({ orderId: created.orderId,
        amountAtomic: "1000000", payTo: created.fundingPayTo, autoPay: created.autoPay }) };
    const before = await rows(t);
    await expect(t.mutation(api.payments.recordFundingAttempt, { ...funding, recipientAddress: TREASURY }))
      .rejects.toThrow("funding_recipient_changed");
    await expect(t.mutation(api.payments.recordFundingAttempt, { ...funding, network: SOLANA_PAYMENT_NETWORK,
      payerAddress: "11111111111111111111111111111111", recipientAddress: "22222222222222222222222222222222" }))
      .rejects.toThrow("funding_recipient_changed");
    expect(await rows(t)).toEqual(before);
    // Changing global or CDP configuration after creation cannot redirect it.
    vi.stubEnv("CDP_AGENT_ADDRESS", `0x${"cd".repeat(20)}`);
    vi.stubEnv("SKARL_TREASURY_ADDRESS", `0x${"ef".repeat(20)}`);
    const claim = await t.mutation(api.payments.recordFundingAttempt, funding);
    expect(claim.replayed).toBe(false);
    const observation = { network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, txHash: `0x${"bb".repeat(32)}`,
      logIndex: 1, blockNumber: 10n, blockHash: `0x${"cc".repeat(32)}`, fromAddress: PAYER,
      toAddress: created.fundingPayTo, amountAtomic: 1_000_000n, confirmations: 2, succeeded: true, observedAt: NOW };
    expect(await t.mutation(api.payments.confirmFunding, { serviceSecret: SECRET, attemptId: claim.attemptId,
      authorizationNonce: funding.authorizationNonce, observation })).toMatchObject({ ok: true });
    const final = await rows(t);
    expect(final.intents).toHaveLength(1);
    expect(final.intents[0]).toMatchObject({ recipientAddress: created.fundingPayTo, amountAtomic: 1_000_000n, status: "confirmed" });
    expect(final.journals).toHaveLength(1);
    expect(final.orders.find(order => order._id === created.orderId)).toMatchObject({ status: "funded", autoPay: { enabled: false } });
  });

  it("leaves default order shape and recipient behavior unchanged even with no CDP configuration", async () => {
    const t = await setup();
    vi.stubEnv("CDP_AGENT_ADDRESS", undefined);
    const created = await t.mutation(api.payments.createDemoOrder, creation());
    if (!created.ok) throw new Error("creation refused");
    expect(created).not.toHaveProperty("fundingPayTo");
    expect(await t.run(ctx => ctx.db.get(created.orderId))).not.toHaveProperty("fundingPayTo");
    expect((await t.mutation(api.payments.recordFundingAttempt, { serviceSecret: SECRET, orderId: created.orderId,
      demoIdentity: "buyer", payerAddress: PAYER, recipientAddress: TREASURY, authorizationNonce: `0x${"dd".repeat(32)}`,
      amountAtomic: 1_000_000n, validBefore: NOW + 60_000 })).replayed).toBe(false);
  });
});
