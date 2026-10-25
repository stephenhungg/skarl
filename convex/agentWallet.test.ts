import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, erc20Abi } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAYMENT_CHAIN_ID, PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/chain";
import { createFundingJournal, createFulfillmentJournal } from "../packages/ledger/src/index";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requirePolicyService } from "./lib/serviceAuth";
import { recordJournal } from "./lib/finance";
import schema from "./schema";

// Synthetic business records and mocked CDP/RPC only. These are not live payment evidence.
const mocks = vi.hoisted(() => ({
  getAccount: vi.fn(), sendTransaction: vi.fn(), getPolicyById: vi.fn(), listPolicies: vi.fn(), getChainId: vi.fn(),
  waitForTransactionReceipt: vi.fn(), getBlockNumber: vi.fn(), getBlock: vi.fn(),
}));
vi.mock("@coinbase/cdp-sdk", () => ({ CdpClient: class {
  evm = { getAccount: mocks.getAccount, sendTransaction: mocks.sendTransaction };
  policies = { getPolicyById: mocks.getPolicyById, listPolicies: mocks.listPolicies };
} }));
vi.mock("viem", async importOriginal => ({ ...await importOriginal<typeof import("viem")>(),
  createPublicClient: () => ({ getChainId: mocks.getChainId, waitForTransactionReceipt: mocks.waitForTransactionReceipt,
    getBlockNumber: mocks.getBlockNumber, getBlock: mocks.getBlock }),
}));
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const execute = makeFunctionReference<"action", {intentId: Id<"paymentIntents">}>("agentWallet:execute");
const reconcile = makeFunctionReference<"action", {intentId: Id<"paymentIntents">; txHash?: string}>("agentWallet:reconcile");
const allowlist = makeFunctionReference<"query", Record<string, never>, string[]>("lib/cdpWallet:allowlist");
const ADDRESS = `0x${"22".repeat(20)}` as const;
const RECIPIENT = `0x${"33".repeat(20)}` as const;
const TX_HASH = `0x${"ab".repeat(32)}` as const;
const BLOCK_HASH = `0x${"cd".repeat(32)}` as const;
const AMOUNT = 7_500_000n;
const SECRET = "synthetic-payments-service-secret-not-a-real-credential";

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  vi.stubEnv("PAYOUT_EXECUTOR", "controller_wallet");
  vi.stubEnv("SKARL_PAYMENTS_SERVICE_SECRET", SECRET);
  vi.stubEnv("CDP_AGENT_ADDRESS", ADDRESS);
  vi.stubEnv("CDP_AGENT_POLICY_ID", "synthetic-policy-id");
  vi.stubEnv("CDP_API_KEY_ID", "synthetic-api-id");
  vi.stubEnv("CDP_API_KEY_SECRET", "synthetic-api-secret");
  vi.stubEnv("CDP_WALLET_SECRET", "synthetic-wallet-secret");
  mocks.getAccount.mockResolvedValue({ address: ADDRESS, name: "skarl-finance-agent", policies: ["synthetic-policy-id"] });
  mocks.sendTransaction.mockResolvedValue({ transactionHash: TX_HASH });
  mocks.getPolicyById.mockResolvedValue({ scope: "account", status: "active" });
  mocks.listPolicies.mockResolvedValue({ policies: [] });
  mocks.getChainId.mockResolvedValue(PAYMENT_CHAIN_ID);
  mocks.getBlockNumber.mockResolvedValue(124n);
  mocks.getBlock.mockImplementation(async () => ({ hash: BLOCK_HASH, timestamp: BigInt(Math.floor(Date.now() / 1000)) }));
  mocks.waitForTransactionReceipt.mockRejectedValue(new Error("synthetic RPC unavailable"));
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });

async function fixture(approved = true) {
  const t = convexTest(schema, modules);
  workflowTest.register(t);
  const seeded = await t.mutation(internal.seed.demo, {});
  const fields = await t.run(async ctx => {
    const now = Date.now();
    const contributor = await ctx.db.query("memberships").withIndex("by_token_identifier", q => q.eq("tokenIdentifier", "demo:skarl:contributor")).unique();
    await ctx.db.patch(contributor!._id, { walletAddress: RECIPIENT,
      walletVerification: { chainId: PAYMENT_CHAIN_ID, nonce: "synthetic", signature: "synthetic", siweMessageHash: "synthetic", verifiedAt: now } });
    const submissionId = await ctx.db.insert("submissions", { organizationId: seeded.organizationId,
      orderId: seeded.orderId, taskVersionId: seeded.taskVersionId, contributorTokenIdentifier: "demo:skarl:contributor",
      status: "accepted", clientRequestId: "synthetic-agent-wallet", updatedAt: now });
    const decisionId = await ctx.db.insert("reviewDecisions", { organizationId: seeded.organizationId, submissionId,
      taskVersionId: seeded.taskVersionId, decisionKey: "synthetic-agent-wallet", decision: "accepted",
      reviewerTokenIdentifier: "demo:skarl:controller", reason: "Synthetic fixture, not inference", evidenceHash: "f".repeat(64), decidedAt: now });
    await recordJournal(ctx, seeded.organizationId, createFundingJournal({ eventId: `funding:${seeded.orderId}`,
      orderId: seeded.orderId, amountMicroUsdc: 100_000_000n }));
    await recordJournal(ctx, seeded.organizationId, createFulfillmentJournal({ eventId: `fulfillment:${submissionId}`,
      orderId: seeded.orderId, sampleId: submissionId, contributorId: "demo:skarl:contributor",
      priceMicroUsdc: 10_000_000n, contributorMicroUsdc: AMOUNT }));
    const payableId = await ctx.db.insert("payables", { organizationId: seeded.organizationId, orderId: seeded.orderId,
      submissionId, decisionId, network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS,
      contributorTokenIdentifier: "demo:skarl:contributor", recipientAddress: RECIPIENT, amountAtomic: AMOUNT,
      sourceEventKey: `fulfillment:${submissionId}`, status: "accrued", createdAt: now });
    return { payableId, contributorId: contributor!._id };
  });
  const proposal = await t.mutation(api.finance.proposePayment, { demoIdentity: "finance-agent", payableId: fields.payableId });
  if (!proposal.ok) throw new Error(proposal.code);
  if (approved) {
    const result = await t.mutation(api.finance.approve, { demoIdentity: "controller", intentId: proposal.intentId });
    if (!result.ok) throw new Error(result.code);
  }
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  vi.stubEnv("PAYOUT_EXECUTOR", "cdp_agent");
  const snapshot = () => t.run(async ctx => ({ attempt: await ctx.db.query("paymentAttempts").withIndex("by_intent", q => q.eq("paymentIntentId", proposal.intentId)).unique(),
    payable: await ctx.db.get(fields.payableId), intent: await ctx.db.get(proposal.intentId),
    observations: await ctx.db.query("chainObservations").collect(), journals: await ctx.db.query("journalEntries").collect() }));
  return { t, ...seeded, ...fields, ...proposal, snapshot, args: { intentId: proposal.intentId } };
}

function receipt(amount = AMOUNT) {
  return { transactionHash: TX_HASH, blockNumber: 123n, blockHash: BLOCK_HASH, status: "success",
    logs: [{ address: USDC_ADDRESS, logIndex: 3, blockNumber: 123n, blockHash: BLOCK_HASH,
      transactionHash: TX_HASH, transactionIndex: 0, removed: false,
      topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: ADDRESS, to: RECIPIENT } }),
      data: encodeAbiParameters([{ type: "uint256" }], [amount]) }] };
}

describe("policy-bound CDP executor (simulated CDP and chain)", () => {
  it("consumes a policy-service approval with demo selectors disabled and still requires chain observation to mark paid", async () => {
    const f = await fixture();
    // Synthetic downstream approval fixture. policy.test.ts separately tests the buyer cap and evidence gates.
    await f.t.run(async ctx => {
      const policy = await requirePolicyService(ctx, f.organizationId);
      const command = (await ctx.db.get(f.paymentCommandId))!;
      await ctx.db.patch(command.approvalId!, { approverTokenIdentifier: policy.tokenIdentifier });
    });
    vi.stubEnv("SKARL_DEMO_IDENTITIES", "off");
    expect(await f.t.action(execute, f.args)).toMatchObject({ status: "submitted", txHash: TX_HASH });
    expect(mocks.sendTransaction).toHaveBeenCalledOnce();
    expect((await f.snapshot()).payable?.status).toBe("payout_in_progress");
    expect((await f.snapshot()).observations).toHaveLength(0);
  });

  it.each([undefined, "controller_wallet"])("stays disabled with flag %s and never claims", async flag => {
    const f = await fixture();
    vi.stubEnv("PAYOUT_EXECUTOR", flag);
    await expect(f.t.action(execute, f.args)).rejects.toThrow("cdp_executor_disabled");
    expect((await f.snapshot()).attempt).toBeNull();
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("sends precisely the approved transfer once and replays only reconciliation", async () => {
    const f = await fixture();
    expect(await f.t.action(execute, f.args)).toEqual({ status: "submitted", txHash: TX_HASH });
    const first = await f.snapshot();
    expect(first.attempt).toMatchObject({ payerAddress: ADDRESS, amountAtomic: AMOUNT, txHash: TX_HASH, status: "reconciling" });
    expect(first.payable?.status).toBe("payout_in_progress");
    const request = mocks.sendTransaction.mock.calls[0][0];
    expect(request).toMatchObject({ address: ADDRESS, network: "base-sepolia", idempotencyKey: first.attempt!.attemptId,
      transaction: { to: USDC_ADDRESS, value: 0n } });
    expect(decodeFunctionData({ abi: erc20Abi, data: request.transaction.data })).toEqual({ functionName: "transfer", args: [RECIPIENT, AMOUNT] });
    expect(await f.t.action(execute, f.args)).toEqual({ status: "requires_reconciliation", txHash: TX_HASH });
    expect(mocks.sendTransaction).toHaveBeenCalledTimes(1);
    expect((await f.snapshot()).observations).toHaveLength(0);
  });

  it("allows at most one send across concurrent action invocations", async () => {
    const f = await fixture();
    await Promise.allSettled([f.t.action(execute, f.args), f.t.action(execute, f.args)]);
    expect(mocks.sendTransaction).toHaveBeenCalledTimes(1);
    expect((await f.snapshot()).attempt?.attempt).toBe(1);
  });

  it("never sends an unapproved proposal and retains agent self-approval refusal", async () => {
    const f = await fixture(false);
    expect(await f.t.mutation(api.finance.approve, { ...f.args, demoIdentity: "finance-agent" }))
      .toMatchObject({ ok: false, code: "self_approval_refused" });
    await expect(f.t.action(execute, f.args)).rejects.toThrow("payout_not_executable");
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
    expect((await f.snapshot()).attempt).toBeNull();
  });

  it.each(["expiry", "amount", "recipient", "revoked-controller"])("refuses changed %s at claim", async kind => {
    const f = await fixture();
    await f.t.run(async ctx => {
      if (kind === "expiry") await ctx.db.patch(f.intentId, { expiresAt: Date.now() - 1 });
      else if (kind === "amount") await ctx.db.patch(f.payableId, { amountAtomic: AMOUNT + 1n });
      else if (kind === "recipient") await ctx.db.patch(f.payableId, { recipientAddress: ADDRESS });
      else {
        const controller = await ctx.db.query("memberships").withIndex("by_token_identifier", q => q.eq("tokenIdentifier", "demo:skarl:controller")).unique();
        await ctx.db.patch(controller!._id, { status: "revoked" });
      }
    });
    await expect(f.t.action(execute, f.args)).rejects.toThrow(kind === "revoked-controller" ? "approval_invalidated" : "payout_not_executable");
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
    expect((await f.snapshot()).attempt).toBeNull();
  });

  it("refuses a missing attached policy before consuming the claim", async () => {
    const f = await fixture();
    mocks.getAccount.mockResolvedValue({ address: ADDRESS, name: "skarl-finance-agent", policies: [] });
    await expect(f.t.action(execute, f.args)).rejects.toThrow("cdp_account_policy_mismatch");
    expect((await f.snapshot()).attempt).toBeNull();
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("refuses a paused policy before consuming the claim", async () => {
    const f = await fixture();
    mocks.getPolicyById.mockResolvedValue({ scope: "account", status: "paused" });
    await expect(f.t.action(execute, f.args)).rejects.toThrow("cdp_account_policy_inactive");
    expect((await f.snapshot()).attempt).toBeNull();
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("refuses project accept overrides found on a later policy page", async () => {
    const f = await fixture();
    mocks.listPolicies.mockResolvedValueOnce({ policies: [], nextPageToken: "synthetic-page-2" })
      .mockResolvedValueOnce({ policies: [{ status: "paused", rules: [{ action: "accept" }] }] });
    await expect(f.t.action(execute, f.args)).rejects.toThrow("cdp_project_policy_override");
    expect(mocks.listPolicies).toHaveBeenLastCalledWith({ scope: "project", pageSize: 100, pageToken: "synthetic-page-2" });
    expect((await f.snapshot()).attempt).toBeNull();
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("the enabled approval workflow schedules execution and reconciliation exactly once", async () => {
    const f = await fixture(false);
    mocks.waitForTransactionReceipt.mockResolvedValue(receipt());
    const approved = await f.t.mutation(api.finance.approve, { ...f.args, demoIdentity: "controller" });
    expect(approved.ok).toBe(true);
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(mocks.sendTransaction).toHaveBeenCalledTimes(1);
    expect((await f.snapshot()).payable?.status).toBe("paid");
    await f.t.mutation(api.finance.approve, { ...f.args, demoIdentity: "controller" });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(mocks.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("keeps a timeout durably claimed and never retries the send", async () => {
    const f = await fixture();
    mocks.sendTransaction.mockRejectedValue(new Error("synthetic timeout after possible broadcast"));
    expect(await f.t.action(execute, f.args)).toEqual({ status: "requires_reconciliation" });
    expect((await f.snapshot()).attempt).toMatchObject({ status: "reconciling", lastErrorCode: "cdp_execution_requires_reconciliation" });
    expect(await f.t.action(execute, f.args)).toEqual({ status: "requires_reconciliation" });
    expect(mocks.sendTransaction).toHaveBeenCalledTimes(1);
    expect((await f.snapshot()).payable?.status).toBe("payout_in_progress");
  });

  it("recovers a lost hash after expiry/disable and posts one observation and payout journal", async () => {
    const f = await fixture();
    mocks.sendTransaction.mockRejectedValue(new Error("synthetic lost response"));
    await f.t.action(execute, f.args);
    vi.stubEnv("PAYOUT_EXECUTOR", "controller_wallet");
    await f.t.run(ctx => ctx.db.patch(f.intentId, { expiresAt: Date.now() - 1 }));
    mocks.waitForTransactionReceipt.mockResolvedValue(receipt());
    expect(await f.t.action(reconcile, { ...f.args, txHash: TX_HASH })).toEqual({ status: "confirmed", txHash: TX_HASH });
    expect(await f.t.action(reconcile, { ...f.args, txHash: TX_HASH })).toEqual({ status: "confirmed", txHash: TX_HASH });
    const state = await f.snapshot();
    expect(state.payable?.status).toBe("paid");
    expect(state.observations).toHaveLength(1);
    expect(state.observations[0]).toMatchObject({ network: PAYMENT_NETWORK, txHash: TX_HASH, logIndex: 3, amountAtomic: AMOUNT });
    expect(state.journals.filter(j => j.kind === "payout")).toHaveLength(1);
    expect(mocks.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it.each(["wrong-amount", "wrong-chain", "failed-receipt", "reorg", "old-transfer"])("cannot post %s evidence", async kind => {
    const f = await fixture();
    await f.t.action(execute, f.args);
    mocks.waitForTransactionReceipt.mockResolvedValue(kind === "wrong-amount" ? receipt(AMOUNT + 1n) : receipt());
    if (kind === "wrong-chain") mocks.getChainId.mockResolvedValue(1);
    if (kind === "failed-receipt") mocks.waitForTransactionReceipt.mockResolvedValue({ ...receipt(), status: "reverted" });
    if (kind === "reorg") mocks.getBlock.mockResolvedValue({ hash: TX_HASH, timestamp: BigInt(Math.floor(Date.now() / 1000)) });
    if (kind === "old-transfer") mocks.getBlock.mockResolvedValue({ hash: BLOCK_HASH, timestamp: BigInt(Math.floor(Date.now() / 1000) - 60) });
    expect(await f.t.action(reconcile, f.args)).toEqual({ status: "requires_reconciliation", txHash: TX_HASH });
    const state = await f.snapshot();
    expect(state.observations).toHaveLength(0);
    expect(state.journals.filter(j => j.kind === "payout")).toHaveLength(0);
    expect(state.payable?.status).toBe("payout_in_progress");
  });

  it.each(["unverified", "revoked", "wrong-chain", "controller", "other-tenant"])("excludes %s recipients from policy inputs and execution", async kind => {
    const f = await fixture();
    await f.t.run(async ctx => {
      const contributor = (await ctx.db.get(f.contributorId))!;
      if (kind === "unverified") await ctx.db.patch(f.contributorId, { walletVerification: undefined });
      else if (kind === "revoked") await ctx.db.patch(f.contributorId, { status: "revoked" });
      else if (kind === "controller") await ctx.db.patch(f.contributorId, { roles: ["contributor", "controller"] });
      else if (kind === "wrong-chain") await ctx.db.patch(f.contributorId, { walletVerification: { ...contributor.walletVerification!, chainId: 1 } });
      else {
        const organizationId = await ctx.db.insert("organizations", { name: "Synthetic other tenant", createdByTokenIdentifier: "other", status: "active" });
        await ctx.db.patch(f.contributorId, { organizationId });
      }
    });
    expect(await f.t.query(allowlist, {})).toEqual([]);
    await expect(f.t.action(execute, f.args)).rejects.toThrow("verified_recipient_required");
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
    expect((await f.snapshot()).attempt).toBeNull();
  });
});
