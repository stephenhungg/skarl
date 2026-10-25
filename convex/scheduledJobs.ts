"use node";
import { makeFunctionReference, type FunctionArgs, type FunctionReturnType, type ApiFromModules } from "convex/server";
import { internalAction } from "./_generated/server";
import { api } from "./_generated/api";
import type * as Data from "./scheduledData";
import { observeTransfer } from "../apps/web/lib/payments/chain";
import { observeSolanaTransfer } from "../packages/payments/src/solana";
import { PAYMENT_NETWORK, SOLANA_PAYMENT_NETWORK } from "../packages/contracts/src/chain";
import type { Hash } from "viem";
type DataApi = ApiFromModules<{ scheduledData: typeof Data }>["scheduledData"];
const ref = <T extends "query" | "mutation", A extends Record<string, unknown>, R>(type: T, name: string) => makeFunctionReference<T, A, R>(`scheduledData:${name}`);
const reserveJob = ref<"mutation", FunctionArgs<DataApi["reserveJob"]>, FunctionReturnType<DataApi["reserveJob"]>>("mutation", "reserveJob");
const finishJob = ref<"mutation", FunctionArgs<DataApi["finishJob"]>, FunctionReturnType<DataApi["finishJob"]>>("mutation", "finishJob");
const ordersPage = ref<"query", FunctionArgs<DataApi["ordersPage"]>, FunctionReturnType<DataApi["ordersPage"]>>("query", "ordersPage");
const pendingForOrder = ref<"query", FunctionArgs<DataApi["pendingForOrder"]>, FunctionReturnType<DataApi["pendingForOrder"]>>("query", "pendingForOrder");
const reserveObservation = ref<"mutation", FunctionArgs<DataApi["reserveObservation"]>, FunctionReturnType<DataApi["reserveObservation"]>>("mutation", "reserveObservation");
const staleWebhooks = ref<"query", FunctionArgs<DataApi["staleWebhooks"]>, FunctionReturnType<DataApi["staleWebhooks"]>>("query", "staleWebhooks");
const saveReconciliation = ref<"mutation", FunctionArgs<DataApi["saveReconciliation"]>, FunctionReturnType<DataApi["saveReconciliation"]>>("mutation", "saveReconciliation");
const reserveFinance = ref<"mutation", FunctionArgs<DataApi["reserveFinance"]>, FunctionReturnType<DataApi["reserveFinance"]>>("mutation", "reserveFinance");
const finishFinance = ref<"mutation", FunctionArgs<DataApi["finishFinance"]>, FunctionReturnType<DataApi["finishFinance"]>>("mutation", "finishFinance");

type JobResult = { status: "complete" | "partial" | "noop" | "disabled"; orders: number; confirmed: number; pending: number; errors: number; agentRuns: number };
const empty = (status: JobResult["status"]): JobResult => ({ status, orders: 0, confirmed: 0, pending: 0, errors: 0, agentRuns: 0 });

/** Reads existing transaction identities only. No signer, claim, facilitator or resend API. */
export const reconcile = internalAction({
  args: {},
  handler: async (ctx): Promise<JobResult> => {
    if (process.env.SKARL_SCHEDULED_JOBS_DISABLED === "true") return empty("disabled");
    const reservation = await ctx.runMutation(reserveJob, { job: "reconciliation" });
    if (!reservation) return empty("noop");
    const result = empty("complete"), secret = process.env.SKARL_PAYMENTS_SERVICE_SECRET;
    let cursor = reservation.cursor ?? undefined, failed = false;
    try {
      const page = await ctx.runQuery(ordersPage, { cursor: reservation.cursor });
      cursor = page.cursor;
      await Promise.all(page.orderIds.map(async orderId => {
        result.orders++;
        try {
          const pending = await ctx.runQuery(pendingForOrder, { orderId });
          await Promise.all(pending.map(async ({ attempt, intent }) => {
            if (!await ctx.runMutation(reserveObservation, { attemptId: attempt._id })) return;
            if (!attempt.txHash || !secret || secret.length < 32) { result.pending++; return; }
            try {
              if (intent.kind === "contributor_payout") {
                if (intent.network !== PAYMENT_NETWORK || !attempt.payerAddress) throw new Error("unsupported_payout_observation");
                const observation = await observeTransfer(attempt.txHash as Hash, { network: PAYMENT_NETWORK,
                  fromAddress: attempt.payerAddress, toAddress: intent.recipientAddress, amountAtomic: intent.amountAtomic });
                await ctx.runMutation(api.payments.recordPayoutObservation, { serviceSecret: secret, attemptId: attempt._id, observation });
              } else {
                if (!attempt.authorizationNonce) throw new Error("funding_authorization_missing");
                const expected = { network: intent.network, fromAddress: intent.buyerWalletAddress,
                  toAddress: intent.recipientAddress, amountAtomic: intent.amountAtomic };
                const observation = intent.network === SOLANA_PAYMENT_NETWORK
                  ? await observeSolanaTransfer(attempt.txHash, { ...expected, authorizationNonce: attempt.authorizationNonce, orderId })
                  : intent.network === PAYMENT_NETWORK ? await observeTransfer(attempt.txHash as Hash, expected, attempt.authorizationNonce)
                  : (() => { throw new Error("unsupported_payment_rail"); })();
                await ctx.runMutation(api.payments.confirmFunding, { serviceSecret: secret, attemptId: attempt._id,
                  authorizationNonce: attempt.authorizationNonce, observation });
              }
              result.confirmed++;
            } catch { result.pending++; }
          }));
          const exceptions = (await ctx.runQuery(api.exceptions.list, { demoIdentity: "finance-agent", orderId }))
            .filter(row => row.stillDetected).map(row => ({ exceptionKey: row.exceptionKey, exception: row.exception }))
            .sort((a, b) => a.exceptionKey.localeCompare(b.exceptionKey));
          await ctx.runMutation(saveReconciliation, { orderId, exceptionsJson: JSON.stringify(exceptions) });
        } catch { result.errors++; }
      }));
      if (secret && secret.length >= 32) {
        for (const row of await ctx.runQuery(staleWebhooks, {})) {
          try { await ctx.runMutation(api.chainWitness.finishWebhook, { serviceSecret: secret, receiptId: row.receiptId,
            status: row.linked ? "processed" : "unknown_transfer" }); }
          catch { result.errors++; }
        }
      }
    } catch { failed = true; result.errors++; }
    result.status = result.errors || result.pending ? "partial" : "complete";
    await ctx.runMutation(finishJob, { stateId: reservation.stateId, generation: reservation.generation,
      cursor, ...(failed ? { errorCode: "scheduled_reconciliation_failed" } : {}) });
    return result;
  },
});

/** Changed accrual/exception snapshots only; reuses the existing bounded, unprivileged tool loop. */
export const finance = internalAction({
  args: {},
  handler: async (ctx): Promise<JobResult> => {
    if (process.env.SKARL_SCHEDULED_JOBS_DISABLED === "true" || process.env.FINANCE_AGENT_BACKGROUND_ENABLED === "false") return empty("disabled");
    const reservation = await ctx.runMutation(reserveJob, { job: "finance" });
    if (!reservation) return empty("noop");
    const result = empty("complete");
    let cursor = reservation.cursor ?? undefined, failed = false;
    try {
      const page = await ctx.runQuery(ordersPage, { cursor: reservation.cursor });
      cursor = page.cursor;
      await Promise.all(page.orderIds.map(async orderId => {
        result.orders++;
        let claim: FunctionReturnType<DataApi["reserveFinance"]> = null;
        try {
          claim = await ctx.runMutation(reserveFinance, { orderId });
          if (!claim) return;
          const run = await ctx.runAction(api.financeAgent.run, { demoIdentity: "finance-agent", orderId,
            requestId: claim.requestId, prompt: claim.prompt });
          await ctx.runMutation(finishFinance, { stateId: claim.stateId, generation: claim.generation, runId: run.runId });
          result.agentRuns++;
        } catch {
          result.errors++;
          if (claim) await ctx.runMutation(finishFinance, { stateId: claim.stateId, generation: claim.generation, errorCode: "scheduled_agent_failed" });
        }
      }));
    } catch { failed = true; result.errors++; }
    result.status = result.errors ? "partial" : "complete";
    await ctx.runMutation(finishJob, { stateId: reservation.stateId, generation: reservation.generation,
      cursor, ...(failed ? { errorCode: "scheduled_finance_failed" } : {}) });
    return result;
  },
});
