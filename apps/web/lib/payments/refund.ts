"use client";
import { executeApprovedPayout, reportPayoutTransaction, getPayoutRecovery,
  type ExecutePayoutOptions, type PayoutRecovery } from "./payout";
import type { Hash } from "viem";

/** The server binds this command to the original buyer, amount, and independent approval. */
export function executeApprovedRefund(options: Omit<ExecutePayoutOptions, "intentId" | "paymentKind"> & { commandId: string }) {
  const { commandId, ...rest } = options;
  return executeApprovedPayout({ ...rest, intentId: commandId, paymentKind: "buyer_refund" });
}

/** Observe the same submitted hash again; this never sends another transaction. */
export function reportRefundTransaction(input: { commandId: string; claimId: string; txHash: Hash; demoIdentity: string }) {
  const { commandId, ...rest } = input;
  return reportPayoutTransaction({ ...rest, intentId: commandId, paymentKind: "buyer_refund" });
}
export function getRefundRecovery(commandId: string): PayoutRecovery | null {
  return getPayoutRecovery(commandId);
}
