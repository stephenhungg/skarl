"use node";
import { baseRpcUrl } from "./lib/config";
import { randomUUID } from "node:crypto";
import { CdpClient } from "@coinbase/cdp-sdk";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { createPublicClient, encodeFunctionData, erc20Abi, http, isAddress, parseEventLogs, type Hash } from "viem";
import { baseSepolia } from "viem/chains";
import { PAYMENT_CHAIN_ID, PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/chain";
import { validateTransfer } from "../packages/payments/src/reconciliation";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";

// Explicit references let this additive module ship without changing generated files.
const contextRef = makeFunctionReference<"query", { intentId: Id<"paymentIntents"> }, {
  intent: Extract<Doc<"paymentIntents">, { kind: "contributor_payout" }>; attempt: Doc<"paymentAttempts"> | null;
}>("lib/cdpWallet:context");
const allowlistRef = makeFunctionReference<"query", Record<string, never>, string[]>("lib/cdpWallet:allowlist");
const uncertainRef = makeFunctionReference<"mutation", { attemptId: Id<"paymentAttempts"> }, null>("lib/cdpWallet:uncertain");
const reconcileRef = makeFunctionReference<"action", { intentId: Id<"paymentIntents"> }, Result>("agentWallet:reconcile");
type Result = { status: "submitted" | "confirmed" | "requires_reconciliation"; txHash?: string };

function serviceSecret() {
  const secret = process.env.SKARL_PAYMENTS_SERVICE_SECRET;
  if (!secret || secret.length < 32) throw new Error("payment_service_not_configured");
  return secret;
}
function agentAddress() {
  const address = process.env.CDP_AGENT_ADDRESS;
  if (!address || !isAddress(address) || /^0x0{40}$/i.test(address)) throw new Error("cdp_agent_not_configured");
  return address;
}

/** Only the workflow/operator can invoke this. Arguments cannot change payment terms. */
export const execute = internalAction({
  args: { intentId: v.id("paymentIntents") },
  handler: async (ctx, args): Promise<Result> => {
    if (process.env.PAYOUT_EXECUTOR !== "cdp_agent") throw new Error("cdp_executor_disabled");
    const secret = serviceSecret(), address = agentAddress();
    const state = await ctx.runQuery(contextRef, args);
    if (state.attempt) {
      // Includes browser-wallet claims and lost send responses: never send again.
      if (state.attempt.status === "confirmed") return { status: "confirmed", txHash: state.attempt.txHash };
      if (state.attempt.txHash) return reconcileStored(ctx, args.intentId);
      return { status: "requires_reconciliation" };
    }
    const recipients = await ctx.runQuery(allowlistRef, {});
    if (!recipients.includes(state.intent.recipientAddress.toLowerCase())) throw new Error("verified_recipient_required");
    if (!process.env.CDP_API_KEY_ID || !process.env.CDP_API_KEY_SECRET || !process.env.CDP_WALLET_SECRET ||
      !process.env.CDP_AGENT_POLICY_ID) throw new Error("cdp_credentials_or_policy_missing");
    const cdp = new CdpClient();
    const account = await cdp.evm.getAccount({ address });
    if (account.address.toLowerCase() !== address.toLowerCase() || account.name !== "skarl-finance-agent" ||
      !account.policies?.includes(process.env.CDP_AGENT_POLICY_ID)) throw new Error("cdp_account_policy_mismatch");
    const policy = await cdp.policies.getPolicyById({ id: process.env.CDP_AGENT_POLICY_ID });
    if (policy.scope !== "account" || policy.status !== "active") throw new Error("cdp_account_policy_inactive");
    // CDP project-level accept rules take precedence over account restrictions.
    // Refuse that configuration even when an accept is temporarily paused.
    let pageToken: string | undefined;
    do {
      const page = await cdp.policies.listPolicies({ scope: "project", pageSize: 100, pageToken });
      if (page.policies.some(project => project.rules.some(rule => rule.action === "accept"))) {
        throw new Error("cdp_project_policy_override");
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    // The existing atomic claim validates approval, live roles, expiry, bound source,
    // dispatch readiness and attemptCount=0. Concurrent actions cannot both claim.
    const claimed = await ctx.runMutation(api.payments.claimPayout, { ...args, serviceSecret: secret,
      demoIdentity: "finance-agent", senderAddress: address, treasuryAddress: address, claimId: randomUUID() });
    try {
      const { transactionHash } = await cdp.evm.sendTransaction({ address, network: "base-sepolia",
        idempotencyKey: claimed.claimId,
        transaction: { to: USDC_ADDRESS, value: 0n, data: encodeFunctionData({ abi: erc20Abi,
          functionName: "transfer", args: [claimed.recipientAddress as `0x${string}`, BigInt(claimed.amountAtomic)] }) } });
      // Persist the hash before any RPC wait. Recording or scheduling failure does
      // not permit another send; CDP idempotency key is the durable claimId.
      await ctx.runMutation(api.payments.recordTransaction, { serviceSecret: secret, attemptId: claimed.attemptId, txHash: transactionHash });
      await ctx.scheduler.runAfter(0, reconcileRef, args);
      return { status: "submitted", txHash: transactionHash };
    } catch {
      await ctx.runMutation(uncertainRef, { attemptId: claimed.attemptId });
      return { status: "requires_reconciliation" };
    }
  },
});

async function reconcileStored(ctx: ActionCtx, intentId: Id<"paymentIntents">, suppliedHash?: string): Promise<Result> {
  const secret = serviceSecret();
  const { intent, attempt } = await ctx.runQuery(contextRef, { intentId });
  if (!attempt?.payerAddress) throw new Error("payout_attempt_not_found");
  if (attempt.status === "confirmed") return { status: "confirmed", txHash: attempt.txHash };
  const txHash = attempt.txHash ?? suppliedHash;
  if (!txHash) return { status: "requires_reconciliation" };
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error("invalid_hash");
  if (suppliedHash && attempt.txHash && suppliedHash.toLowerCase() !== attempt.txHash.toLowerCase()) throw new Error("transaction_already_bound");
  try {
    const client = createPublicClient({ chain: baseSepolia,
      transport: http(baseRpcUrl(), { timeout: 15_000, retryCount: 1 }) });
    if (await client.getChainId() !== PAYMENT_CHAIN_ID) throw new Error("wrong_rpc_network");
    const receipt = await client.waitForTransactionReceipt({ hash: txHash as Hash, confirmations: 2, timeout: 20_000 });
    if (receipt.transactionHash.toLowerCase() !== txHash.toLowerCase()) throw new Error("transaction_replaced_reconcile_manually");
    const [head, block] = await Promise.all([client.getBlockNumber({ cacheTime: 0 }), client.getBlock({ blockNumber: receipt.blockNumber })]);
    if (block.hash !== receipt.blockHash) throw new Error("receipt_reorged");
    const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer",
      logs: receipt.logs.filter(log => log.address.toLowerCase() === USDC_ADDRESS.toLowerCase()) }).filter(log =>
      log.args.from.toLowerCase() === attempt.payerAddress!.toLowerCase() &&
      log.args.to.toLowerCase() === intent.recipientAddress.toLowerCase() && log.args.value === intent.amountAtomic);
    if (transfers.length !== 1) throw new Error("expected_single_exact_transfer");
    const log = transfers[0];
    const observation = { network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, txHash, logIndex: log.logIndex,
      blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, fromAddress: log.args.from, toAddress: log.args.to,
      amountAtomic: log.args.value, confirmations: Number(head - receipt.blockNumber + 1n), succeeded: receipt.status === "success",
      observedAt: Number(block.timestamp) * 1000 };
    validateTransfer(observation, { fromAddress: attempt.payerAddress, toAddress: intent.recipientAddress, amountAtomic: intent.amountAtomic });
    await ctx.runMutation(api.payments.recordPayoutObservation, { serviceSecret: secret, attemptId: attempt._id, observation });
    return { status: "confirmed", txHash };
  } catch {
    await ctx.runMutation(uncertainRef, { attemptId: attempt._id });
    return { status: "requires_reconciliation", txHash };
  }
}

/** Read-only chain recovery plus existing observation posting; never signs. Works after flag disable/expiry. */
export const reconcile = internalAction({
  args: { intentId: v.id("paymentIntents"), txHash: v.optional(v.string()) },
  handler: async (ctx, args): Promise<Result> => reconcileStored(ctx, args.intentId, args.txHash),
});
