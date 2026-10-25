import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/chain";
import { createFulfillmentJournal, accountBalance } from "../packages/ledger/src/index";
import { loadLedger, recordJournal } from "./lib/finance";
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const refunds = { approve: makeFunctionReference<"mutation">("refunds:approve"), claim: makeFunctionReference<"mutation">("refunds:claim"),
  recordObservation: makeFunctionReference<"mutation">("refunds:recordObservation"), forOrder: makeFunctionReference<"query">("refunds:forOrder") };
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

const claimArgs = (commandId: import("./_generated/dataModel").Id<"paymentCommands">) => ({
  serviceSecret: secret, commandId, demoIdentity: "controller", senderAddress: treasury, treasuryAddress: treasury,
  claimId: "synthetic-refund-claim-123456",
});
const observedRefund = (amountAtomic = 90_000_000n) => ({ network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS,
  txHash: `0x${"d".repeat(64)}`, logIndex: 1, blockNumber: 2n, blockHash: `0x${"e".repeat(64)}`,
  fromAddress: treasury, toAddress: payer, amountAtomic, confirmations: 2, succeeded: true, observedAt: Date.now() });

describe("independent controller-approved refund execution (synthetic evidence)", () => {
  it("claims once, binds the exact original buyer/amount, and posts a balanced refund_paid journal only after observation", async () => {
    const f = await setup(true, true), proposal = await f.t.mutation(api.orders.cancelRemainder, cancel(f.orderId));
    const commandId = proposal.paymentCommandId;
    expect(await f.t.query(refunds.forOrder, { demoIdentity: "controller", orderId: f.orderId }))
      .toMatchObject({ commandId, status: "proposed", amountAtomic: "90000000", recipientAddress: payer, executionAvailable: false });
    await expect(f.t.mutation(refunds.claim, claimArgs(commandId))).rejects.toThrow("approval_invalidated");
    const approved = await f.t.mutation(refunds.approve, { demoIdentity: "controller", commandId, reason: "Refund the unused quota" });
    expect(approved.ok).toBe(true);
    expect(await f.t.query(refunds.forOrder, { demoIdentity: "buyer", orderId: f.orderId }))
      .toMatchObject({ status: "approved", executionAvailable: true });
    expect(await f.t.mutation(refunds.approve, { demoIdentity: "controller", commandId, reason: "Refund the unused quota" })).toMatchObject({ replayed: true });
    const claim = await f.t.mutation(refunds.claim, claimArgs(commandId));
    expect(claim).toMatchObject({ recipientAddress: payer, amountAtomic: "90000000", senderAddress: treasury, network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS });
    for (const claimId of [claim.claimId, "another-refund-claim-123456"]) {
      await expect(f.t.mutation(refunds.claim, { ...claimArgs(commandId), claimId })).rejects.toThrow("refund_already_claimed_reconcile_first");
    }
    expect((await f.t.run(ctx => ctx.db.query("journalEntries").collect())).filter(entry => entry.kind === "refund_paid")).toHaveLength(0);
    const record = { serviceSecret: secret, attemptId: claim.attemptId, observation: observedRefund() };
    const first = await f.t.mutation(refunds.recordObservation, record);
    expect(await f.t.mutation(refunds.recordObservation, record)).toEqual({ ...first, replayed: true });
    await f.t.run(async ctx => {
      expect((await ctx.db.get(f.orderId))!.status).toBe("refunded");
      expect((await ctx.db.get(commandId))!.status).toBe("confirmed");
      const funding = (await ctx.db.get(proposal.fundingIntentId))!;
      expect(funding.status).toBe("confirmed");
      const ledger = await loadLedger(ctx, f.organizationId);
      expect(accountBalance(ledger, "liability:customer_refunds", { orderId: f.orderId })).toBe(0n);
      expect(accountBalance(ledger, "asset:usdc", { orderId: f.orderId })).toBe(10_000_000n);
      expect(ledger.journals.filter(journal => journal.kind === "refund_paid")).toHaveLength(1);
    });
    expect(await f.t.query(refunds.forOrder, { demoIdentity: "controller", orderId: f.orderId }))
      .toMatchObject({ status: "confirmed", executionAvailable: false, txHash: observedRefund().txHash });
    const reconciliation = await f.t.query(api.payments.reconciliation, { demoIdentity: "controller", orderId: f.orderId });
    expect(reconciliation.matches.some(match => match.eventKey === `refund_paid:${commandId}`)).toBe(true);
  });

  it("records buyer self-approval and agent refusal, and rejects revoked authority or altered bindings before a claim", async () => {
    const f = await setup(), proposal = await f.t.mutation(api.orders.cancelRemainder, cancel(f.orderId)), commandId = proposal.paymentCommandId;
    for (const [demoIdentity, code] of [["buyer", "self_approval_forbidden"], ["finance-agent", "agent_cannot_approve"]]) {
      expect(await f.t.mutation(refunds.approve, { demoIdentity, commandId, reason: "Synthetic adversarial attempt" })).toEqual({ ok: false, code });
    }
    expect((await f.t.run(ctx => ctx.db.query("auditEvents").collect())).filter(event => event.action === "refund_approval_refused")).toHaveLength(2);
    const approval = await f.t.mutation(refunds.approve, { demoIdentity: "controller", commandId, reason: "Unused quota refund" });
    if (!approval.ok) throw new Error("approval expected");
    await f.t.run(ctx => ctx.db.patch(approval.approvalId, { status: "revoked" }));
    expect(await f.t.query(refunds.forOrder, { demoIdentity: "controller", orderId: f.orderId })).toMatchObject({ executionAvailable: false });
    await expect(f.t.mutation(refunds.claim, claimArgs(commandId))).rejects.toThrow("approval_invalidated");
    await f.t.run(ctx => ctx.db.patch(approval.approvalId, { status: "approved" }));
    await f.t.run(ctx => ctx.db.patch(commandId, { amountAtomic: 1n }));
    await expect(f.t.mutation(refunds.claim, claimArgs(commandId))).rejects.toThrow("refund_source_changed");
    expect(await f.t.run(ctx => ctx.db.query("paymentAttempts").withIndex("by_command", q => q.eq("paymentCommandId", commandId)).collect())).toHaveLength(0);
  });

  it("refuses cross-tenant attempt bindings and never exposes a foreign approval snapshot", async () => {
    const f = await setup(), proposal = await f.t.mutation(api.orders.cancelRemainder, cancel(f.orderId)), commandId = proposal.paymentCommandId;
    const approval = await f.t.mutation(refunds.approve, { demoIdentity: "controller", commandId, reason: "Unused quota refund" });
    if (!approval.ok) throw new Error("approval expected");
    const claim = await f.t.mutation(refunds.claim, claimArgs(commandId));
    const other = await f.t.run(ctx => ctx.db.insert("organizations", { name: "foreign", createdByTokenIdentifier: "other", status: "active" }));
    await f.t.run(ctx => ctx.db.patch(claim.attemptId, { organizationId: other }));
    await expect(f.t.query(refunds.forOrder, { demoIdentity: "controller", orderId: f.orderId })).rejects.toThrow("refund_attempt_binding_changed");
    await expect(f.t.mutation(refunds.recordObservation, { serviceSecret: secret, attemptId: claim.attemptId, observation: observedRefund(100_000_000n) }))
      .rejects.toThrow("refund_not_dispatched");
    await f.t.run(ctx => ctx.db.patch(claim.attemptId, { organizationId: f.organizationId }));
    await f.t.run(ctx => ctx.db.patch(approval.approvalId, { organizationId: other }));
    await expect(f.t.query(refunds.forOrder, { demoIdentity: "controller", orderId: f.orderId })).rejects.toThrow("approval_source_changed");
  });

  it("refuses wrong treasury, changed buyer, expired approval and forged or underconfirmed chain facts without posting", async () => {
    const f = await setup(true, true), proposal = await f.t.mutation(api.orders.cancelRemainder, cancel(f.orderId)), commandId = proposal.paymentCommandId;
    const approval = await f.t.mutation(refunds.approve, { demoIdentity: "controller", commandId, reason: "Unused quota refund" });
    if (!approval.ok) throw new Error("approval expected");
    await expect(f.t.mutation(refunds.claim, { ...claimArgs(commandId), senderAddress: payer })).rejects.toThrow("wrong_treasury_wallet");
    await f.t.run(ctx => ctx.db.patch(f.orderId, { buyerWalletAddress: treasury }));
    await expect(f.t.mutation(refunds.claim, claimArgs(commandId))).rejects.toThrow("refund_source_changed");
    await f.t.run(ctx => ctx.db.patch(f.orderId, { buyerWalletAddress: payer }));
    await f.t.run(ctx => ctx.db.patch(approval.approvalId, { expiresAt: Date.now() - 1 }));
    expect(await f.t.query(refunds.forOrder, { demoIdentity: "controller", orderId: f.orderId })).toMatchObject({ executionAvailable: false });
    await expect(f.t.mutation(refunds.claim, claimArgs(commandId))).rejects.toThrow("approval_invalidated");
    await f.t.run(ctx => ctx.db.patch(approval.approvalId, { expiresAt: Date.now() + 60_000 }));
    const claim = await f.t.mutation(refunds.claim, claimArgs(commandId));
    for (const alteration of [{ amountAtomic: 1n }, { toAddress: treasury }, { fromAddress: payer }, { confirmations: 1 }, { tokenAddress: payer }]) {
      await expect(f.t.mutation(refunds.recordObservation, { serviceSecret: secret, attemptId: claim.attemptId,
        observation: { ...observedRefund(), ...alteration } })).rejects.toThrow();
    }
    await expect(f.t.mutation(refunds.recordObservation, { serviceSecret: "wrong", attemptId: claim.attemptId, observation: observedRefund() })).rejects.toThrow("payment_service_unauthorized");
    expect((await f.t.run(ctx => ctx.db.query("journalEntries").collect())).filter(entry => entry.kind === "refund_paid")).toHaveLength(0);
    expect((await f.t.run(ctx => ctx.db.get(commandId)))!.status).toBe("reconciling");
  });
});
