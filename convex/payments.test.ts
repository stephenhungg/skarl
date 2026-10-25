import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/chain";
import type { TransferObservation } from "../packages/payments/src/reconciliation";
import { createFulfillmentJournal } from "../packages/ledger/src/index";
import { recordJournal } from "./lib/finance";

// Isolated transactional tests with synthetic receipts. No RPC, wallet signature,
// inference or actual Base Sepolia transfer is performed by these fixtures.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const SERVICE_SECRET = "test-only-payments-service-secret-not-a-real-credential";
const PAYER = `0x${"11".repeat(20)}`;
const TREASURY = `0x${"22".repeat(20)}`;
const RECIPIENT = `0x${"33".repeat(20)}`;
const NONCE = `0x${"aa".repeat(32)}`;
const TX_HASH = `0x${"bb".repeat(32)}`;
const OTHER_HASH = `0x${"cc".repeat(32)}`;

beforeEach(() => { vi.stubEnv("SKARL_PAYMENTS_SERVICE_SECRET", SERVICE_SECRET); });
afterEach(() => { vi.unstubAllEnvs(); });

async function setup() {
  const t = convexTest(schema, modules);
  const seeded = await t.mutation(internal.seed.demo, {});
  const funding = { serviceSecret: SERVICE_SECRET, orderId: seeded.orderId, demoIdentity: "buyer",
    payerAddress: PAYER, recipientAddress: TREASURY, authorizationNonce: NONCE,
    amountAtomic: 100_000_000n, validBefore: Date.now() + 60_000 };
  const observation: TransferObservation = {
    network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, txHash: TX_HASH, logIndex: 3,
    blockNumber: 123n, blockHash: `0x${"dd".repeat(32)}`, fromAddress: PAYER, toAddress: TREASURY,
    amountAtomic: funding.amountAtomic, confirmations: 2, succeeded: true, observedAt: Date.now(),
  };
  return { t, ...seeded, funding, observation };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function snapshot(fixture: Fixture) {
  return fixture.t.run(async ctx => ({
    order: await ctx.db.get(fixture.orderId),
    intents: await ctx.db.query("paymentIntents").collect(),
    attempts: await ctx.db.query("paymentAttempts").collect(),
    observations: await ctx.db.query("chainObservations").collect(),
    journals: await ctx.db.query("journalEntries").collect(),
    lines: await ctx.db.query("journalLines").collect(),
    payables: await ctx.db.query("payables").collect(),
  }));
}
async function otherOrder(fixture: Fixture) {
  return fixture.t.run(async ctx => {
    const order = await ctx.db.get(fixture.orderId);
    if (!order) throw new Error("missing fixture order");
    const { _id, _creationTime, ...fields } = order;
    return ctx.db.insert("orders", { ...fields, publicId: "synthetic-second-order", status: "awaiting_funding" });
  });
}
async function fund(fixture: Fixture) {
  const attempt = await fixture.t.mutation(api.payments.recordFundingAttempt, fixture.funding);
  const confirmation = { serviceSecret: SERVICE_SECRET, attemptId: attempt.attemptId,
    authorizationNonce: NONCE, observation: fixture.observation };
  await fixture.t.mutation(api.payments.confirmFunding, confirmation);
  return { attempt, confirmation };
}

async function payoutFixture() {
  const fixture = await setup();
  await fund(fixture);
  // Synthetic pre-existing accepted work. Approval and payout execution below use
  // real policy mutations; acceptance/media verification is covered separately.
  const payableId = await fixture.t.run(async ctx => {
    const now = Date.now();
    const submissionId = await ctx.db.insert("submissions", { organizationId: fixture.organizationId,
      orderId: fixture.orderId, taskVersionId: fixture.taskVersionId,
      contributorTokenIdentifier: "demo:skarl:contributor", status: "accepted", clientRequestId: "synthetic-payments-test", updatedAt: now });
    const decisionId = await ctx.db.insert("reviewDecisions", { organizationId: fixture.organizationId,
      submissionId, taskVersionId: fixture.taskVersionId, decisionKey: "synthetic-decision", decision: "accepted",
      reviewerTokenIdentifier: "demo:skarl:controller", reason: "Synthetic acceptance fixture", evidenceHash: "f".repeat(64), decidedAt: now });
    await recordJournal(ctx, fixture.organizationId, createFulfillmentJournal({ eventId: `fulfillment:${submissionId}`,
      orderId: fixture.orderId, sampleId: submissionId, contributorId: "demo:skarl:contributor",
      priceMicroUsdc: 10_000_000n, contributorMicroUsdc: 7_500_000n }));
    return ctx.db.insert("payables", { organizationId: fixture.organizationId, orderId: fixture.orderId,
      submissionId, decisionId, network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS,
      contributorTokenIdentifier: "demo:skarl:contributor", recipientAddress: RECIPIENT, amountAtomic: 7_500_000n,
      sourceEventKey: `fulfillment:${submissionId}`, status: "accrued", createdAt: now });
  });
  const proposal = await fixture.t.mutation(api.finance.proposePayment, { demoIdentity: "finance-agent", payableId });
  if (!proposal.ok) throw new Error(proposal.code);
  const claim = { serviceSecret: SERVICE_SECRET, intentId: proposal.intentId, demoIdentity: "controller",
    senderAddress: TREASURY, treasuryAddress: TREASURY, claimId: "synthetic-payout-claim-0001" };
  return { ...fixture, payableId, proposal, claim };
}

describe("payment service and funding invariants", () => {
  it("rejects missing, short and incorrect service secrets before returning or changing order state", async () => {
    const fixture = await setup();
    for (const secret of ["", "bad", "x".repeat(SERVICE_SECRET.length)]) {
      await expect(fixture.t.mutation(api.payments.recordFundingAttempt, { ...fixture.funding, serviceSecret: secret }))
        .rejects.toThrow("payment_service_unauthorized");
      await expect(fixture.t.query(api.payments.fundingStatus, { serviceSecret: secret, orderId: fixture.orderId, demoIdentity: "buyer" }))
        .rejects.toThrow("payment_service_unauthorized");
    }
    vi.stubEnv("SKARL_PAYMENTS_SERVICE_SECRET", undefined);
    await expect(fixture.t.mutation(api.payments.recordFundingAttempt, fixture.funding)).rejects.toThrow("payment_service_unauthorized");
    expect((await snapshot(fixture)).attempts).toHaveLength(0);
  });

  it("durably claims one funding nonce, replays it and refuses allocation to another order", async () => {
    const fixture = await setup();
    const first = await fixture.t.mutation(api.payments.recordFundingAttempt, fixture.funding);
    const replay = await fixture.t.mutation(api.payments.recordFundingAttempt, fixture.funding);
    expect(replay).toEqual({ ...first, replayed: true });
    const secondOrder = await otherOrder(fixture);
    await expect(fixture.t.mutation(api.payments.recordFundingAttempt, { ...fixture.funding, orderId: secondOrder }))
      .rejects.toThrow("authorization_already_claimed");
    await expect(fixture.t.mutation(api.payments.recordFundingAttempt, { ...fixture.funding, recipientAddress: RECIPIENT }))
      .rejects.toThrow("authorization_already_claimed");
    await expect(fixture.t.mutation(api.payments.recordFundingAttempt, { ...fixture.funding, authorizationNonce: OTHER_HASH }))
      .rejects.toThrow("funding_already_pending_reconcile_first");
    const state = await snapshot(fixture);
    expect(state.attempts).toHaveLength(1);
    expect(state.intents).toHaveLength(1);
    expect(state.order?.status).toBe("awaiting_funding");
    expect(state.journals).toHaveLength(0);
  });

  it("confirms one observation, one balanced journal and one funded order across replays", async () => {
    const fixture = await setup();
    const { confirmation } = await fund(fixture);
    const beforeReplay = await snapshot(fixture);
    const replay = await fixture.t.mutation(api.payments.confirmFunding, confirmation);
    expect(replay.replayed).toBe(true);
    const state = await snapshot(fixture);
    expect(state).toEqual(beforeReplay);
    expect(state.order).toMatchObject({ status: "funded", buyerWalletAddress: PAYER });
    expect(state.observations).toHaveLength(1);
    expect(state.journals).toHaveLength(1);
    expect(state.lines).toHaveLength(2);
    expect(state.lines.map(line => [line.account, line.side, line.amountAtomic])).toEqual([
      ["asset:usdc", "debit", 100_000_000n], ["liability:customer_prepayments", "credit", 100_000_000n],
    ]);
    const reconciliation = await fixture.t.query(api.payments.reconciliation, { demoIdentity: "controller", orderId: fixture.orderId });
    expect(reconciliation.matches).toHaveLength(1);
    expect(reconciliation.exceptions).toHaveLength(0);
  });

  it.each([
    [{ tokenAddress: RECIPIENT }, "wrong_token"], [{ toAddress: RECIPIENT }, "wrong_recipient"],
    [{ fromAddress: RECIPIENT }, "wrong_sender"], [{ amountAtomic: 1n }, "wrong_amount"],
    [{ succeeded: false }, "receipt_failed"], [{ confirmations: 1 }, "insufficient_confirmations"],
    [{ network: "eip155:8453" }, "wrong_network"],
  ] as const)("rolls back invalid funding evidence %#", async (change, code) => {
    const fixture = await setup();
    const attempt = await fixture.t.mutation(api.payments.recordFundingAttempt, fixture.funding);
    const before = await snapshot(fixture);
    await expect(fixture.t.mutation(api.payments.confirmFunding, { serviceSecret: SERVICE_SECRET, attemptId: attempt.attemptId,
      authorizationNonce: NONCE, observation: { ...fixture.observation, ...change } })).rejects.toThrow(code);
    expect(await snapshot(fixture)).toEqual(before);
  });

  it("refuses a mismatched authorization and rolls back inserts if order state changed after signing", async () => {
    const fixture = await setup();
    const attempt = await fixture.t.mutation(api.payments.recordFundingAttempt, fixture.funding);
    const args = { serviceSecret: SERVICE_SECRET, attemptId: attempt.attemptId, authorizationNonce: NONCE, observation: fixture.observation };
    await expect(fixture.t.mutation(api.payments.confirmFunding, { ...args, authorizationNonce: OTHER_HASH }))
      .rejects.toThrow("authorization_mismatch");
    await fixture.t.run(ctx => ctx.db.patch(fixture.orderId, { status: "closed" }));
    const before = await snapshot(fixture);
    await expect(fixture.t.mutation(api.payments.confirmFunding, args)).rejects.toThrow("order_not_fundable");
    expect(await snapshot(fixture)).toEqual(before);
  });

  it("allocates a chain log only once even when another valid order has its own nonce", async () => {
    const fixture = await setup();
    const secondOrder = await otherOrder(fixture);
    await fund(fixture);
    const second = await fixture.t.mutation(api.payments.recordFundingAttempt, { ...fixture.funding,
      orderId: secondOrder, authorizationNonce: OTHER_HASH });
    const before = await snapshot(fixture);
    await expect(fixture.t.mutation(api.payments.confirmFunding, { serviceSecret: SERVICE_SECRET, attemptId: second.attemptId,
      authorizationNonce: OTHER_HASH, observation: fixture.observation })).rejects.toThrow("transfer_already_claimed_or_changed");
    expect(await snapshot(fixture)).toEqual(before);
    expect((await fixture.t.run(ctx => ctx.db.get(secondOrder)))?.status).toBe("awaiting_funding");
  });

  it("binds a submitted transaction hash and rejects a different hash during retries or confirmation", async () => {
    const fixture = await setup();
    const attempt = await fixture.t.mutation(api.payments.recordFundingAttempt, fixture.funding);
    const args = { serviceSecret: SERVICE_SECRET, attemptId: attempt.attemptId, txHash: TX_HASH };
    await fixture.t.mutation(api.payments.recordTransaction, args);
    await fixture.t.mutation(api.payments.recordTransaction, args);
    await expect(fixture.t.mutation(api.payments.recordTransaction, { ...args, txHash: OTHER_HASH })).rejects.toThrow("transaction_already_bound");
    await expect(fixture.t.mutation(api.payments.confirmFunding, { serviceSecret: SERVICE_SECRET, attemptId: attempt.attemptId,
      authorizationNonce: NONCE, observation: { ...fixture.observation, txHash: OTHER_HASH } })).rejects.toThrow("transaction_already_bound");
    const state = await snapshot(fixture);
    expect(state.attempts[0]).toMatchObject({ txHash: TX_HASH, status: "reconciling" });
    expect(state.journals).toHaveLength(0);
  });
});

describe("approved payout execution", () => {
  it("requires independent approval and correct treasury, then reserves exactly one attempt", async () => {
    const fixture = await payoutFixture();
    await expect(fixture.t.mutation(api.payments.claimPayout, fixture.claim)).rejects.toThrow("payout_not_executable");
    await fixture.t.mutation(api.finance.approve, { demoIdentity: "controller", intentId: fixture.proposal.intentId });
    await expect(fixture.t.mutation(api.payments.claimPayout, { ...fixture.claim, senderAddress: PAYER })).rejects.toThrow("wrong_treasury_wallet");
    const claim = await fixture.t.mutation(api.payments.claimPayout, fixture.claim);
    expect(claim).toMatchObject({ recipientAddress: RECIPIENT, amountAtomic: "7500000", network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS });
    await expect(fixture.t.mutation(api.payments.claimPayout, fixture.claim)).rejects.toThrow("payout_not_executable");
    expect((await snapshot(fixture)).attempts).toHaveLength(2); // Funding plus one payout, never two payouts.
  });

  it("refuses dispatch when the payable source changes after independent approval", async () => {
    const fixture = await payoutFixture();
    await fixture.t.mutation(api.finance.approve, { demoIdentity: "controller", intentId: fixture.proposal.intentId });
    await fixture.t.run(ctx => ctx.db.patch(fixture.payableId, { contributorTokenIdentifier: "demo:skarl:changed-contributor" }));
    const before = await snapshot(fixture);
    await expect(fixture.t.mutation(api.payments.claimPayout, fixture.claim)).rejects.toThrow("approved_source_changed");
    expect(await snapshot(fixture)).toEqual(before);
  });

  it.each(["expired", "approval-binding", "command-binding"] as const)("refuses %s approval evidence at dispatch", async kind => {
    const fixture = await payoutFixture();
    const approved = await fixture.t.mutation(api.finance.approve, { demoIdentity: "controller", intentId: fixture.proposal.intentId });
    if (!approved.ok) throw new Error(approved.code);
    await fixture.t.run(async ctx => {
      if (kind === "expired") await ctx.db.patch(approved.approvalId, { expiresAt: Date.now() - 1 });
      else if (kind === "approval-binding") await ctx.db.patch(approved.approvalId, { bindingHash: "changed-binding" });
      else await ctx.db.patch(fixture.proposal.paymentCommandId, { recipientAddress: PAYER });
    });
    const before = await snapshot(fixture);
    await expect(fixture.t.mutation(api.payments.claimPayout, fixture.claim)).rejects.toThrow("payout_not_executable");
    expect(await snapshot(fixture)).toEqual(before);
  });

  it("rejects a transfer mined before this payout was approved and claimed", async () => {
    const fixture = await payoutFixture();
    await fixture.t.mutation(api.finance.approve, { demoIdentity: "controller", intentId: fixture.proposal.intentId });
    const claim = await fixture.t.mutation(api.payments.claimPayout, fixture.claim);
    const attempt = await fixture.t.run(ctx => ctx.db.get(claim.attemptId));
    const before = await snapshot(fixture);
    await expect(fixture.t.mutation(api.payments.recordPayoutObservation, {
      serviceSecret: SERVICE_SECRET, attemptId: claim.attemptId,
      observation: { ...fixture.observation, txHash: OTHER_HASH, fromAddress: TREASURY, toAddress: RECIPIENT,
        amountAtomic: 7_500_000n, observedAt: attempt!.createdAt - 2000 },
    })).rejects.toThrow("transfer_predates_approval_claim");
    expect(await snapshot(fixture)).toEqual(before);
  });

  it("pays the payable only after exact chain confirmation and reconciles an idempotent payout", async () => {
    const fixture = await payoutFixture();
    await fixture.t.mutation(api.finance.approve, { demoIdentity: "controller", intentId: fixture.proposal.intentId });
    const claim = await fixture.t.mutation(api.payments.claimPayout, fixture.claim);
    const evidence = { ...fixture.observation, txHash: OTHER_HASH, fromAddress: TREASURY, toAddress: RECIPIENT, amountAtomic: 7_500_000n };
    const args = { serviceSecret: SERVICE_SECRET, attemptId: claim.attemptId, observation: evidence };
    await expect(fixture.t.mutation(api.payments.recordPayoutObservation, { ...args,
      observation: { ...evidence, amountAtomic: 7_500_001n } })).rejects.toThrow("wrong_amount");
    expect((await fixture.t.run(ctx => ctx.db.get(fixture.payableId)))?.status).toBe("payout_in_progress");
    const confirmed = await fixture.t.mutation(api.payments.recordPayoutObservation, args);
    const replay = await fixture.t.mutation(api.payments.recordPayoutObservation, args);
    expect(replay).toEqual({ ...confirmed, replayed: true });
    const state = await snapshot(fixture);
    expect(state.payables[0]?.status).toBe("paid");
    expect(state.journals.filter(journal => journal.kind === "payout")).toHaveLength(1);
    expect(state.observations).toHaveLength(2);
    const reconciliation = await fixture.t.query(api.payments.reconciliation, { demoIdentity: "controller", orderId: fixture.orderId });
    expect(reconciliation.matches).toHaveLength(2);
    expect(reconciliation.exceptions).toHaveLength(0);
  });
});
