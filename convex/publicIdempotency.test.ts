import { randomUUID } from "node:crypto";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/chain";

// Synthetic durable state and receipts only; no wallet, RPC or settlement.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const serviceSecret = "synthetic-public-idempotency-service-secret";
const nonce = `0x${"aa".repeat(32)}`, payer = `0x${"11".repeat(20)}`, treasury = `0x${"22".repeat(20)}`;
const input = () => ({ serviceSecret, ipDigest: "1".repeat(64), requestId: randomUUID(), idempotencyKey: "public-order-request-1" });
async function setup() {
  const t = convexTest(schema, modules), seeded = await t.mutation(internal.seed.demo, {});
  return { t, ...seeded };
}
beforeEach(() => {
  vi.stubEnv("SKARL_PAYMENTS_SERVICE_SECRET", serviceSecret);
  vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("public request idempotency preserves business intent", () => {
  it("returns the original creation result across fresh transport IDs and changed IPs without consuming another quota slot", async () => {
    const { t } = await setup(), first = await t.mutation(api.payments.createDemoOrder, input());
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("creation refused");
    // A buyer may update policy after creation; retries still return the original
    // receipt rather than silently describing a different original agreement.
    await t.run(ctx => ctx.db.patch(first.orderId, { autoPay: { enabled: false, maxPerClipAtomic: 500_000n,
      requireAllChecks: true, setBy: "demo:skarl:buyer", setAt: Date.now() + 1 } }));
    vi.mocked(Date.now).mockReturnValue(Date.now() + 1_000);
    expect(await t.mutation(api.payments.createDemoOrder, { ...input(), ipDigest: "2".repeat(64) })).toEqual(first);
    await t.run(async ctx => {
      expect(await ctx.db.query("orders").collect()).toHaveLength(3); // two seed orders + exactly one creation
      expect((await ctx.db.query("demoOrderLimits").collect()).map(row => row.count)).toEqual([1, 1]);
      expect(await ctx.db.query("approvals").collect()).toHaveLength(0);
    });
  });

  it("refuses changed policy under the same creation key because a retry cannot rewrite the buyer's original intent", async () => {
    const { t } = await setup();
    await t.mutation(api.payments.createDemoOrder, input());
    await expect(t.mutation(api.payments.createDemoOrder, { ...input(),
      autoPay: { enabled: false, maxPerClipAtomic: "500000", requireAllChecks: true } })).rejects.toThrow("idempotency_key_conflict");
    expect(await t.run(ctx => ctx.db.query("orders").collect())).toHaveLength(3);
  });

  it("also deduplicates legacy requestId retries so callers without the new header remain safe", async () => {
    const { t } = await setup(), { idempotencyKey: _, ...legacy } = input();
    const first = await t.mutation(api.payments.createDemoOrder, legacy);
    expect(await t.mutation(api.payments.createDemoOrder, legacy)).toEqual(first);
  });

  it("binds a funding key before settlement and returns the same attempt with an explicit do-not-settle replay flag", async () => {
    const { t, orderId } = await setup();
    const funding = { serviceSecret, orderId, demoIdentity: "buyer", payerAddress: payer, recipientAddress: treasury,
      authorizationNonce: nonce, amountAtomic: 100_000_000n, validBefore: Date.now() + 60_000, idempotencyKey: "funding-request-1" };
    const first = await t.mutation(api.payments.recordFundingAttempt, funding);
    expect(await t.mutation(api.payments.recordFundingAttempt, funding)).toEqual({ ...first, replayed: true });
    await expect(t.mutation(api.payments.recordFundingAttempt, { ...funding, authorizationNonce: `0x${"cc".repeat(32)}` }))
      .rejects.toThrow("idempotency_key_conflict");
    expect(await t.run(ctx => ctx.db.query("paymentAttempts").collect())).toHaveLength(1);
    expect(await t.run(ctx => ctx.db.query("journalEntries").collect())).toHaveLength(0);
  });

  it("replays the original confirmation result once while refusing key reuse for another receipt", async () => {
    const { t, orderId } = await setup();
    const { attemptId } = await t.mutation(api.payments.recordFundingAttempt, { serviceSecret, orderId, demoIdentity: "buyer",
      payerAddress: payer, recipientAddress: treasury, authorizationNonce: nonce, amountAtomic: 100_000_000n, validBefore: Date.now() + 60_000 });
    const args = { serviceSecret, attemptId, authorizationNonce: nonce, idempotencyKey: "funding-confirmation-1", observation: {
      network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, txHash: `0x${"bb".repeat(32)}`, logIndex: 1, blockNumber: 123n,
      blockHash: `0x${"dd".repeat(32)}`, fromAddress: payer, toAddress: treasury, amountAtomic: 100_000_000n,
      confirmations: 2, succeeded: true, observedAt: Date.now() } };
    const first = await t.mutation(api.payments.confirmFunding, args);
    // More confirmations and a later read time are the same immutable receipt.
    expect(await t.mutation(api.payments.confirmFunding, { ...args, observation: { ...args.observation,
      confirmations: 3, observedAt: Date.now() + 1_000 } })).toEqual(first);
    await expect(t.mutation(api.payments.confirmFunding, { ...args, observation: { ...args.observation,
      amountAtomic: 200_000_000n } })).rejects.toThrow("idempotency_key_conflict");
    await t.run(async ctx => {
      expect(await ctx.db.query("chainObservations").collect()).toHaveLength(1);
      expect(await ctx.db.query("journalEntries").collect()).toHaveLength(1);
      expect(await ctx.db.query("journalLines").collect()).toHaveLength(2);
    });
  });
});
