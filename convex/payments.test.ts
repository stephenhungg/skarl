import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { runScheduledUntil } from "../test/workflow";
import { PAYMENT_NETWORK, SOLANA_PAYMENT_NETWORK, SOLANA_USDC_MINT, USDC_ADDRESS } from "../packages/contracts/src/chain";
import type { TransferObservation } from "../packages/payments/src/reconciliation";
import { createFulfillmentJournal } from "../packages/ledger/src/index";
import { recordJournal } from "./lib/finance";

// Isolated transactional tests with synthetic receipts. No RPC, wallet signature,
// inference or actual chain transfer is performed by these fixtures.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const SERVICE_SECRET = "test-only-payments-service-secret-not-a-real-credential";
const PAYER = `0x${"11".repeat(20)}`;
const TREASURY = `0x${"22".repeat(20)}`;
const RECIPIENT = `0x${"33".repeat(20)}`;
const NONCE = `0x${"aa".repeat(32)}`;
const TX_HASH = `0x${"bb".repeat(32)}`;
const OTHER_HASH = `0x${"cc".repeat(32)}`;

beforeEach(() => { vi.useFakeTimers(); vi.stubEnv("SKARL_PAYMENTS_SERVICE_SECRET", SERVICE_SECRET); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });

async function setup() {
  const t = convexTest(schema, modules);
  workflowTest.register(t);
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
    [{ fromAddress: RECIPIENT }, "wrong_sender"],
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

  it("retains a wrong amount as an idempotent reconciliation exception without posting cash", async () => {
    const fixture = await setup();
    const attempt = await fixture.t.mutation(api.payments.recordFundingAttempt, fixture.funding);
    const args = { serviceSecret: SERVICE_SECRET, attemptId: attempt.attemptId, authorizationNonce: NONCE,
      observation: { ...fixture.observation, amountAtomic: fixture.observation.amountAtomic - 1n } };
    const refusal = await fixture.t.mutation(api.payments.confirmFunding, args);
    expect(refusal).toMatchObject({ ok: false, code: "wrong_amount", replayed: false });
    expect(await fixture.t.mutation(api.payments.confirmFunding, args)).toEqual({ ...refusal, replayed: true });
    const state = await snapshot(fixture);
    expect(state.observations).toHaveLength(1);
    expect(state.observations[0]?.amountAtomic).toBe(99_999_999n);
    expect(state.attempts[0]?.status).toBe("reconciling");
    expect(state.intents[0]?.status).toBe("settlement_pending");
    expect(state.order?.status).toBe("awaiting_funding");
    expect(state.journals).toHaveLength(0);
    expect(state.lines).toHaveLength(0);
    const reconciliation = await fixture.t.query(api.payments.reconciliation, { demoIdentity: "controller", orderId: fixture.orderId });
    expect(reconciliation.matches).toHaveLength(0);
    expect(reconciliation.exceptions.some(row => row.code === "wrong_amount")).toBe(true);
    const audit = await fixture.t.run(ctx => ctx.db.query("auditEvents").collect());
    expect(audit.filter(row => row.action === "funding_reconciliation_refused")).toHaveLength(1);
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
  it("requires independent approval, Workflow dispatch and correct treasury before reserving exactly one attempt", async () => {
    const fixture = await payoutFixture();
    await expect(fixture.t.mutation(api.payments.claimPayout, fixture.claim)).rejects.toThrow("payout_not_executable");
    await fixture.t.mutation(api.finance.approve, { demoIdentity: "controller", intentId: fixture.proposal.intentId });
    const beforeDispatch = await snapshot(fixture);
    await expect(fixture.t.mutation(api.payments.claimPayout, fixture.claim)).rejects.toThrow("dispatch_not_ready");
    expect(await snapshot(fixture)).toEqual(beforeDispatch);
    expect(beforeDispatch.attempts).toHaveLength(1); // Only the confirmed funding attempt exists.
    await runScheduledUntil(async () => {
      const dispatch = await fixture.t.run(ctx => ctx.db.query("outboxEvents").withIndex("by_event_key", q =>
        q.eq("organizationId", fixture.organizationId).eq("eventKey", `dispatch:${fixture.proposal.paymentCommandId}`)).unique());
      return dispatch?.status === "pending";
    });
    await expect(fixture.t.mutation(api.payments.claimPayout, { ...fixture.claim, senderAddress: PAYER })).rejects.toThrow("wrong_treasury_wallet");
    const claim = await fixture.t.mutation(api.payments.claimPayout, fixture.claim);
    expect(claim).toMatchObject({ recipientAddress: RECIPIENT, amountAtomic: "7500000", network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS });
    await expect(fixture.t.mutation(api.payments.claimPayout, fixture.claim)).rejects.toThrow("payout_not_executable");
    expect((await snapshot(fixture)).attempts).toHaveLength(2); // Funding plus one payout, never two payouts.
    const dispatch = await fixture.t.run(ctx => ctx.db.query("outboxEvents").withIndex("by_event_key", q =>
      q.eq("organizationId", fixture.organizationId).eq("eventKey", `dispatch:${fixture.proposal.paymentCommandId}`)).unique());
    expect(dispatch).toMatchObject({ status: "delivered", attempt: 1, paymentIntentId: fixture.proposal.intentId });
  });

  it("refuses dispatch when the payable source changes after independent approval", async () => {
    const fixture = await payoutFixture();
    await fixture.t.mutation(api.finance.approve, { demoIdentity: "controller", intentId: fixture.proposal.intentId });
    await runScheduledUntil(async () => {
      const dispatch = await fixture.t.run(ctx => ctx.db.query("outboxEvents").withIndex("by_event_key", q =>
        q.eq("organizationId", fixture.organizationId).eq("eventKey", `dispatch:${fixture.proposal.paymentCommandId}`)).unique());
      return dispatch?.status === "pending";
    });
    await fixture.t.run(ctx => ctx.db.patch(fixture.payableId, { contributorTokenIdentifier: "demo:skarl:changed-contributor" }));
    const before = await snapshot(fixture);
    await expect(fixture.t.mutation(api.payments.claimPayout, fixture.claim)).rejects.toThrow("approved_source_changed");
    expect(await snapshot(fixture)).toEqual(before);
  });

  it.each(["expired", "approval-binding", "command-binding"] as const)("refuses %s approval evidence at dispatch", async kind => {
    const fixture = await payoutFixture();
    const approved = await fixture.t.mutation(api.finance.approve, { demoIdentity: "controller", intentId: fixture.proposal.intentId });
    if (!approved.ok) throw new Error(approved.code);
    await runScheduledUntil(async () => {
      const dispatch = await fixture.t.run(ctx => ctx.db.query("outboxEvents").withIndex("by_event_key", q =>
        q.eq("organizationId", fixture.organizationId).eq("eventKey", `dispatch:${fixture.proposal.paymentCommandId}`)).unique());
      return dispatch?.status === "pending";
    });
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
    await runScheduledUntil(async () => {
      const dispatch = await fixture.t.run(ctx => ctx.db.query("outboxEvents").withIndex("by_event_key", q =>
        q.eq("organizationId", fixture.organizationId).eq("eventKey", `dispatch:${fixture.proposal.paymentCommandId}`)).unique());
      return dispatch?.status === "pending";
    });
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
    await runScheduledUntil(async () => {
      const dispatch = await fixture.t.run(ctx => ctx.db.query("outboxEvents").withIndex("by_event_key", q =>
        q.eq("organizationId", fixture.organizationId).eq("eventKey", `dispatch:${fixture.proposal.paymentCommandId}`)).unique());
      return dispatch?.status === "pending";
    });
    const claim = await fixture.t.mutation(api.payments.claimPayout, fixture.claim);
    const evidence = { ...fixture.observation, txHash: OTHER_HASH, fromAddress: TREASURY, toAddress: RECIPIENT,
      amountAtomic: 7_500_000n, observedAt: Date.now() };
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


// Synthetic Solana observations exercise persistence and authority boundaries;
// RPC instruction, ATA and memo validation is tested in the payments package.
const SOL_PAYER = "So11111111111111111111111111111111111111112";
const SOL_TREASURY = SOLANA_USDC_MINT;
const SOL_SIGNATURE = "3".repeat(42) + "Ab" + "3".repeat(44);
async function solanaFixture() {
  const fixture = await setup();
  const seeded = await fixture.t.mutation(internal.seed.solanaDemo, {});
  vi.stubEnv("SKARL_SOLANA_TREASURY_ADDRESS", SOL_TREASURY);
  const funding = { ...fixture.funding, orderId: seeded.orderId, network: SOLANA_PAYMENT_NETWORK,
    payerAddress: SOL_PAYER, recipientAddress: SOL_TREASURY, amountAtomic: 1_000_000n };
  const observation: TransferObservation = { ...fixture.observation, network: SOLANA_PAYMENT_NETWORK,
    tokenAddress: SOLANA_USDC_MINT, txHash: SOL_SIGNATURE, blockHash: "4".repeat(44),
    fromAddress: SOL_PAYER, toAddress: SOL_TREASURY, amountAtomic: 1_000_000n };
  return { ...fixture, ...seeded, funding, observation };
}

describe("Solana funding persistence boundaries", () => {
  it("claims the message hash once and refuses replay for another order or replacement rail", async () => {
    const fixture = await solanaFixture();
    const first = await fixture.t.mutation(api.payments.recordFundingAttempt, fixture.funding);
    expect(await fixture.t.mutation(api.payments.recordFundingAttempt, fixture.funding)).toEqual({ ...first, replayed: true });
    const secondOrder = await otherOrder(fixture);
    await expect(fixture.t.mutation(api.payments.recordFundingAttempt, { ...fixture.funding, orderId: secondOrder }))
      .rejects.toThrow("authorization_already_claimed");
    await expect(fixture.t.mutation(api.payments.recordFundingAttempt, { ...fixture.funding, network: PAYMENT_NETWORK,
      payerAddress: PAYER, recipientAddress: TREASURY })).rejects.toThrow("funding_already_pending_reconcile_first");
    await expect(fixture.t.mutation(api.payments.recordFundingAttempt, { ...fixture.funding,
      orderId: secondOrder, payerAddress: SOL_PAYER.replace("S", "s") })).rejects.toThrow("authorization_already_claimed");
    const state = await snapshot(fixture);
    expect(state.attempts).toHaveLength(1);
    expect(state.attempts[0]).toMatchObject({ network: SOLANA_PAYMENT_NETWORK, tokenAddress: SOLANA_USDC_MINT, payerAddress: SOL_PAYER });
    expect(state.order?.status).toBe("awaiting_funding");
    expect(state.journals).toHaveLength(0);
  });

  it("requires the configured Solana recipient and keeps its address case-sensitive", async () => {
    const fixture = await solanaFixture();
    await expect(fixture.t.mutation(api.payments.recordFundingAttempt, { ...fixture.funding,
      recipientAddress: SOL_TREASURY.replace("M", "m") })).rejects.toThrow("wrong_solana_treasury");
    vi.stubEnv("SKARL_SOLANA_TREASURY_ADDRESS", undefined);
    await expect(fixture.t.mutation(api.payments.recordFundingAttempt, fixture.funding)).rejects.toThrow("wrong_solana_treasury");
    expect((await snapshot(fixture)).attempts).toHaveLength(0);
  });

  it("preserves signature case and refuses a case-mutated transaction during reconciliation", async () => {
    const fixture = await solanaFixture();
    const attempt = await fixture.t.mutation(api.payments.recordFundingAttempt, fixture.funding);
    await fixture.t.mutation(api.payments.recordTransaction, { serviceSecret: SERVICE_SECRET,
      attemptId: attempt.attemptId, txHash: SOL_SIGNATURE });
    await expect(fixture.t.mutation(api.payments.recordTransaction, { serviceSecret: SERVICE_SECRET,
      attemptId: attempt.attemptId, txHash: SOL_SIGNATURE.replace("A", "a") })).rejects.toThrow("transaction_already_bound");
    await expect(fixture.t.mutation(api.payments.confirmFunding, { serviceSecret: SERVICE_SECRET,
      attemptId: attempt.attemptId, authorizationNonce: NONCE,
      observation: { ...fixture.observation, txHash: SOL_SIGNATURE.replace("A", "a") } })).rejects.toThrow("transaction_already_bound");
    expect((await snapshot(fixture)).attempts[0]?.txHash).toBe(SOL_SIGNATURE);
  });

  it("funds only from matching rail evidence and posts one balanced journal without changing Base payout terms", async () => {
    const fixture = await solanaFixture();
    const attempt = await fixture.t.mutation(api.payments.recordFundingAttempt, fixture.funding);
    await expect(fixture.t.mutation(api.payments.confirmFunding, { serviceSecret: SERVICE_SECRET,
      attemptId: attempt.attemptId, authorizationNonce: NONCE,
      observation: { ...fixture.observation, network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS } })).rejects.toThrow("wrong_network");
    await expect(fixture.t.mutation(api.payments.confirmFunding, { serviceSecret: SERVICE_SECRET,
      attemptId: attempt.attemptId, authorizationNonce: NONCE,
      observation: { ...fixture.observation, fromAddress: SOL_PAYER.replace("S", "s") } })).rejects.toThrow("wrong_sender");
    const args = { serviceSecret: SERVICE_SECRET, attemptId: attempt.attemptId, authorizationNonce: NONCE,
      observation: fixture.observation };
    await fixture.t.mutation(api.payments.confirmFunding, args);
    expect((await fixture.t.mutation(api.payments.confirmFunding, args)).replayed).toBe(true);
    const state = await snapshot(fixture);
    expect(state.order).toMatchObject({ status: "funded", network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS,
      buyerWalletAddress: "0x0000000000000000000000000000000000000001" });
    expect(state.observations).toHaveLength(1);
    expect(state.observations[0]).toMatchObject({ network: SOLANA_PAYMENT_NETWORK, txHash: SOL_SIGNATURE,
      fromAddress: SOL_PAYER, toAddress: SOL_TREASURY });
    expect(state.journals).toHaveLength(1);
    expect(state.journals[0]).toMatchObject({ network: SOLANA_PAYMENT_NETWORK, tokenAddress: SOLANA_USDC_MINT });
    expect(state.lines.map(line => [line.account, line.side, line.amountAtomic])).toEqual([
      ["asset:usdc", "debit", 1_000_000n], ["liability:customer_prepayments", "credit", 1_000_000n],
    ]);
    expect(await fixture.t.query(api.payments.fundingStatus, { serviceSecret: SERVICE_SECRET,
      orderId: fixture.orderId, demoIdentity: "buyer" })).toMatchObject({ network: SOLANA_PAYMENT_NETWORK,
      explorerUrl: `https://explorer.solana.com/tx/${SOL_SIGNATURE}?cluster=devnet` });
    const reconciliation = await fixture.t.query(api.payments.reconciliation, { demoIdentity: "controller", orderId: fixture.orderId });
    expect(reconciliation.matches).toHaveLength(1);
    expect(reconciliation.exceptions).toHaveLength(0);
  });

  it("refuses a Solana observation for an approved Base payout", async () => {
    const fixture = await payoutFixture();
    await fixture.t.mutation(api.finance.approve, { demoIdentity: "controller", intentId: fixture.proposal.intentId });
    await runScheduledUntil(async () => {
      const dispatch = await fixture.t.run(ctx => ctx.db.query("outboxEvents").withIndex("by_event_key", q =>
        q.eq("organizationId", fixture.organizationId).eq("eventKey", `dispatch:${fixture.proposal.paymentCommandId}`)).unique());
      return dispatch?.status === "pending";
    });
    const claim = await fixture.t.mutation(api.payments.claimPayout, fixture.claim);
    await expect(fixture.t.mutation(api.payments.recordPayoutObservation, { serviceSecret: SERVICE_SECRET,
      attemptId: claim.attemptId, observation: { ...fixture.observation, network: SOLANA_PAYMENT_NETWORK,
        tokenAddress: SOLANA_USDC_MINT, txHash: SOL_SIGNATURE, fromAddress: SOL_PAYER, toAddress: SOL_TREASURY,
        amountAtomic: 7_500_000n } })).rejects.toThrow("wrong_network");
    expect((await fixture.t.run(ctx => ctx.db.get(fixture.payableId)))?.status).toBe("payout_in_progress");
  });
});
