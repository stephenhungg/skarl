"use client";

import { useCallback, useRef, useState } from "react";
import type { EIP1193Provider, Hash } from "viem";
import {
  executeApprovedPayout, PayoutExecutionError, reportPayoutTransaction,
  type PayoutProgress, type PayoutRecovery, type PayoutSubmission,
} from "./payout";

export type PayoutState = {
  status: "idle" | PayoutProgress | "submitted" | "error";
  result?: PayoutSubmission;
  error?: PayoutExecutionError;
  recovery?: PayoutRecovery;
};

/** Call after finance.approve succeeds. `submitted` is not a paid/confirmed state. */
export function usePayout({ demoIdentity, provider }: { demoIdentity: string; provider: EIP1193Provider | null }) {
  const [state, setState] = useState<PayoutState>({ status: "idle" });
  const inFlight = useRef(false);

  const run = useCallback(async (operation: () => Promise<PayoutSubmission>) => {
    if (inFlight.current) throw new PayoutExecutionError("A payout operation is already in progress.");
    inFlight.current = true;
    try {
      const result = await operation();
      setState({ status: "submitted", result, recovery: result });
      return result;
    } catch (error) {
      const failure = error instanceof PayoutExecutionError ? error : new PayoutExecutionError(
        error instanceof Error ? error.message : "Payout failed.", undefined, error,
      );
      setState({ status: "error", error: failure, recovery: failure.recovery });
      throw failure;
    } finally {
      inFlight.current = false;
    }
  }, []);

  const execute = useCallback((intentId: string) => run(async () => {
    if (!provider) throw new PayoutExecutionError("Connect the treasury browser wallet first.");
    return executeApprovedPayout({ intentId, demoIdentity, provider, onProgress: status => setState({ status }) });
  }), [demoIdentity, provider, run]);

  const recover = useCallback((recovery: PayoutRecovery & { txHash: Hash }) => run(async () => {
    setState({ status: "recording", recovery });
    return reportPayoutTransaction({ ...recovery, demoIdentity });
  }), [demoIdentity, run]);

  return { ...state, busy: !["idle", "submitted", "error"].includes(state.status), execute, recover };
}
