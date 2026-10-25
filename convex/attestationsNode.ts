"use node";
import { CdpClient } from "@coinbase/cdp-sdk";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { AttestationFailure, easClient, executeAttestation } from "./lib/easSender";
import type { AttestationFields } from "./lib/eas";

const claim = makeFunctionReference<"mutation", { analysisId: Id<"analysisResults">; attestor: string }, Doc<"attestations"> | null>("attestations:claim");
const markSending = makeFunctionReference<"mutation">("attestations:markSending");
const recordTransaction = makeFunctionReference<"mutation">("attestations:recordTransaction");
const retryReverted = makeFunctionReference<"mutation">("attestations:retryReverted");
const finish = makeFunctionReference<"mutation">("attestations:finish");

export const run = internalAction({
  args: { analysisId: v.id("analysisResults") },
  handler: async (ctx, args): Promise<{status: string}> => {
    if (process.env.EAS_ATTESTATIONS_ENABLED !== "true") return {status: "disabled"};
    const attestor = process.env.EAS_ATTESTOR_ADDRESS, policyId = process.env.EAS_ATTESTOR_POLICY_ID;
    if (!attestor || !policyId) return {status: "configuration_required"};
    const row = await ctx.runMutation(claim, { ...args, attestor });
    if (!row?.fields) return {status: "skipped"};
    const identity = { id: row._id, generation: row.generation };
    let transactionHash = row.txHash;
    try {
      const result = await executeAttestation({ intent: {...row, fields: row.fields as AttestationFields}, cdp: new CdpClient(), client: easClient(), policyId,
        markSending: startBlock => ctx.runMutation(markSending, {...identity, startBlock}),
        recordTransaction: async txHash => { await ctx.runMutation(recordTransaction, {...identity, txHash}); transactionHash = txHash; },
      });
      await ctx.runMutation(finish, { ...identity, ...result });
      return {status: "confirmed"};
    } catch (error) {
      if (error instanceof AttestationFailure && error.code === "attestation_transaction_reverted" && transactionHash) {
        await ctx.runMutation(retryReverted, { ...identity, txHash: transactionHash });
        return {status: "failed"};
      }
      // Never persist provider error bodies (SDK errors can carry credentials).
      await ctx.runMutation(finish, { ...identity, error: error instanceof AttestationFailure ? error.code : "attestation_attempt_failed" });
      return {status: "failed"};
    }
  },
});
