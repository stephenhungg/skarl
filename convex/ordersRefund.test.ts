import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/chain";
import { createFulfillmentJournal, accountBalance } from "../packages/ledger/src/index";
import { loadLedger, recordJournal } from "./lib/finance";
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const secret = "synthetic-refund-test-service-secret-no-live-value";
const payer = `0x${"1".repeat(40)}`, treasury = `0x${"2".repeat(40)}`, nonce = `0x${"a".repeat(64)}`;
beforeEach(() => vi.stubEnv("SKARL_PAYMENTS_SERVICE_SECRET", secret));
afterEach(() => vi.unstubAllEnvs());
async function setup(funded = true, fulfilled = false) {
  const t = convexTest(schema, modules), seed = await t.mutation(internal.seed.demo, {});
  if (funded) {
    const { attemptId } = await t.mutation(api.payments.recordFundingAttempt, { serviceSecret: secret, orderId: seed.orderId,
      demoIdentity: "buyer", payerAddress: payer, recipientAddress: treasury, authorizationNonce: nonce,
      amountAtomic: 100_000_000n, validBefore: Date.now() + 60_000 });
    await t.mutation(api.payments.confirmFunding, { serviceSecret: secret, attemptId, authorizationNonce: nonce,
      observation: { network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, txHash: `0x${"b".repeat(64)}`, logIndex: 0,
        blockNumber: 1n, blockHash: `0x${"c".repeat(64)}`, fromAddress: payer, toAddress: treasury,
        amountAtomic: 100_000_000n, confirmations: 2, succeeded: true, observedAt: Date.now() } });
  }
  if (fulfilled) await t.run(async ctx => {
    await recordJournal(ctx, seed.organizationId, createFulfillmentJournal({ eventId: "synthetic-fulfilled",
      orderId: seed.orderId, sampleId: "synthetic", contributorId: "demo:skarl:contributor", priceMicroUsdc: 10_000_000n, contributorMicroUsdc: 7_500_000n }));
    await ctx.db.patch(seed.orderId, { acceptedCount: 1n, status: "collecting" });
  });
  return { t, ...seed };
}
const cancel = (orderId: Awaited<ReturnType<typeof setup>>["orderId"]) => ({ demoIdentity: "buyer", orderId, reason: "Cancel unused collection quota" });
describe("buyer refund proposals with synthetic confirmed funding", () => {
  it("reserves only unused funds once, derives the payer, closes quota and never approves or dispatches", async () => {
    const f = await setup(true, true), result = await f.t.mutation(api.orders.cancelRemainder, cancel(f.orderId));
    expect(result).toMatchObject({ ok: true, amountAtomic: "90000000", controllerApprovalRequired: true, executionAvailable: false, replayed: false });
    expect(await f.t.mutation(api.orders.cancelRemainder, cancel(f.orderId))).toEqual({ ...result, replayed: true });
    await f.t.run(async ctx => {
      const order = (await ctx.db.get(f.orderId))!, intent = (await ctx.db.get(result.fundingIntentId))!;
      const command = (await ctx.db.get(result.paymentCommandId))!;
      expect(order.status).toBe("cancelling"); expect(order.acceptedCount).toBe(1n);
      expect(intent).toMatchObject({ kind: "funding", status: "confirmed", refundPaymentCommandId: command._id });
      expect(command).toMatchObject({ kind: "buyer_refund", status: "proposed", recipientAddress: payer, amountAtomic: 90_000_000n, attemptCount: 0 });
      expect(await ctx.db.query("approvals").collect()).toHaveLength(0);
      expect(await ctx.db.query("outboxEvents").collect()).toHaveLength(0);
      expect(await ctx.db.query("paymentCommands").collect()).toHaveLength(1);
      const ledger = await loadLedger(ctx, f.organizationId);
      expect(accountBalance(ledger, "asset:usdc", { orderId: order._id })).toBe(100_000_000n);
      expect(accountBalance(ledger, "liability:customer_prepayments", { orderId: order._id })).toBe(0n);
      expect(accountBalance(ledger, "liability:customer_refunds", { orderId: order._id })).toBe(90_000_000n);
      expect(accountBalance(ledger, "liability:contributor_payables", { orderId: order._id })).toBe(7_500_000n);
    });
    await expect(f.t.mutation(api.orders.cancelRemainder, { ...cancel(f.orderId), reason: "Changed reason" })).rejects.toThrow("refund_proposal_changed");
    // The existing funding endpoint must still select the original confirmed funding row.
    const status = await f.t.query(api.payments.fundingStatus, { serviceSecret: secret, orderId: f.orderId, demoIdentity: "buyer" });
    expect(status.intent?._id).toBe(result.fundingIntentId);
  });
  it.each(["controller", "contributor", "finance-agent"])("rejects %s without changing money", async demoIdentity => {
    const f = await setup();
    await expect(f.t.mutation(api.orders.cancelRemainder, { ...cancel(f.orderId), demoIdentity })).rejects.toThrow();
    expect(await f.t.run(ctx => ctx.db.query("paymentCommands").collect())).toHaveLength(0);
  });
  it("rejects a different buyer and a foreign organization", async () => {
    const f = await setup();
    await f.t.run(ctx => ctx.db.patch(f.orderId, { buyerTokenIdentifier: "other" }));
    await expect(f.t.mutation(api.orders.cancelRemainder, cancel(f.orderId))).rejects.toThrow("order_not_found");
    await f.t.run(async ctx => {
      const organizationId = await ctx.db.insert("organizations", { name: "other", createdByTokenIdentifier: "other", status: "active" });
      await ctx.db.patch(f.orderId, { buyerTokenIdentifier: "demo:skarl:buyer", organizationId });
    });
    await expect(f.t.mutation(api.orders.cancelRemainder, cancel(f.orderId))).rejects.toThrow("cross_organization_access");
  });
  it("refuses unfunded orders, quota/ledger disagreements and unreconciled funding", async () => {
    const unfunded = await setup(false);
    await expect(unfunded.t.mutation(api.orders.cancelRemainder, cancel(unfunded.orderId))).rejects.toThrow("confirmed_funding_required");
    const f = await setup();
    await f.t.run(ctx => ctx.db.patch(f.orderId, { acceptedCount: 1n }));
    await expect(f.t.mutation(api.orders.cancelRemainder, cancel(f.orderId))).rejects.toThrow("refund_balance_mismatch");
    await f.t.run(async ctx => {
      await ctx.db.patch(f.orderId, { acceptedCount: 0n });
      const observation = (await ctx.db.query("chainObservations").collect())[0]!;
      await ctx.db.patch(observation._id, { amountAtomic: 1n });
    });
    await expect(f.t.mutation(api.orders.cancelRemainder, cancel(f.orderId))).rejects.toThrow("funding_requires_reconciliation");
    expect(await f.t.run(ctx => ctx.db.query("paymentCommands").collect())).toHaveLength(0);
  });
  it("refuses replay if the stored command is altered", async () => {
    const f = await setup(), first = await f.t.mutation(api.orders.cancelRemainder, cancel(f.orderId));
    await f.t.run(ctx => ctx.db.patch(first.paymentCommandId, { recipientAddress: treasury }));
    await expect(f.t.mutation(api.orders.cancelRemainder, cancel(f.orderId))).rejects.toThrow("refund_proposal_changed");
  });
});
