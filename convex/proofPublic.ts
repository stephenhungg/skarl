import { demoOrderPublicId, publicOrderPrefix } from "./lib/config";
import { makeFunctionReference, type ApiFromModules, type FunctionReturnType } from "convex/server";
import { v } from "convex/values";
import { httpAction, internalQuery } from "./_generated/server";
import { PAYMENT_NETWORK, paymentRail, SOLANA_PAYMENT_NETWORK } from "../packages/contracts/src/chain";
import { validateTransfer } from "../packages/payments/src/reconciliation";
import { attestationLinks } from "./lib/eas";
import { checkPublicRateLimit } from "./lib/publicRateLimit";

/** Same explicit publication boundary as mcpPublic, independent of demo role selectors.
 * Allowlisted aggregates only: never return raw documents, private text, wallet
 * addresses, media URLs, contributor linkage, or outgoing transaction identities.
 */
export const snapshot = internalQuery({ args: { orderId: v.string() }, handler: async (ctx, args) => {
  const id = ctx.db.normalizeId("orders", args.orderId), order = id ? await ctx.db.get(id) : null;
  if (!order || !(order.publicId === demoOrderPublicId() || order.publicId.startsWith(publicOrderPrefix()))) return null;
  const intents = await ctx.db.query("paymentIntents").withIndex("by_order", q => q.eq("orderId", order._id)).collect();
  const funding = [];
  let chainObservedPayoutCount = 0;
  for (const intent of intents) {
    if (intent.organizationId !== order.organizationId) throw new Error("cross_organization_reference");
    const attempts = await ctx.db.query("paymentAttempts").withIndex("by_intent", q => q.eq("paymentIntentId", intent._id)).collect();
    const transfers = [];
    let observationCount = 0;
    for (const attempt of attempts) {
      if (attempt.organizationId !== order.organizationId || attempt.network !== intent.network || attempt.amountAtomic !== intent.amountAtomic ||
        attempt.tokenAddress !== intent.tokenAddress || (intent.kind === "contributor_payout" && attempt.paymentCommandId !== intent.paymentCommandId)) throw new Error("payment_reference_mismatch");
      const observations = await ctx.db.query("chainObservations").withIndex("by_attempt", q => q.eq("paymentAttemptId", attempt._id)).collect();
      for (const row of observations) {
        observationCount++;
        if (row.organizationId !== order.organizationId) throw new Error("cross_organization_reference");
        try {
          validateTransfer(row, { network: intent.network, amountAtomic: intent.amountAtomic, toAddress: intent.recipientAddress,
            fromAddress: intent.kind === "contributor_payout" ? attempt.payerAddress ?? "" : intent.buyerWalletAddress });
          if (attempt.txHash && (intent.network === PAYMENT_NETWORK
            ? attempt.txHash.toLowerCase() !== row.txHash.toLowerCase() : attempt.txHash !== row.txHash)) continue;
          transfers.push({ txHash: row.txHash, logIndex: row.logIndex, observedAt: row.observedAt,
            explorerUrl: paymentRail(row.network).explorerTx(row.txHash) });
        } catch { /* Discrepancies cannot become public success claims. */ }
      }
    }
    const chainObserved = observationCount === 1 && transfers.length === 1;
    if (intent.kind === "contributor_payout") { if (chainObserved) chainObservedPayoutCount++; }
    else funding.push({ network: intent.network, label: intent.network === PAYMENT_NETWORK ? "Base Sepolia" : "Solana Devnet",
      amountAtomic: intent.amountAtomic.toString(), chainObserved, transfers,
      missing: chainObserved ? null : "An exact confirmed funding transfer is required" });
  }
  const submissions = await ctx.db.query("submissions").withIndex("by_order_status", q => q.eq("orderId", order._id)).collect();
  const attestations = [];
  for (const submission of submissions) {
    if (submission.organizationId !== order.organizationId) throw new Error("cross_organization_reference");
    if (!submission.currentAnalysisId) continue;
    const row = await ctx.db.query("attestations").withIndex("by_analysis", q => q.eq("analysisId", submission.currentAnalysisId!)).unique();
    if (row?.submissionId === submission._id && row.status === "confirmed" && row.attestationUid && row.txHash) {
      attestations.push({ uid: row.attestationUid, ...attestationLinks(row.attestationUid, row.txHash) });
    }
  }
  // License tokens are custodial devnet mints: publish the token and its creation tx, never holder or contributor linkage.
  const solanaRail = paymentRail(SOLANA_PAYMENT_NETWORK);
  const licenses = (await ctx.db.query("solanaLicenses").withIndex("by_order", q => q.eq("orderId", order._id)).collect())
    .filter(row => row.organizationId === order.organizationId && row.status === "minted" && row.mintAddress && row.signature)
    .map(row => ({ standard: "Token-2022", licenseDigest: row.licenseDigest, mintAddress: row.mintAddress!,
      tokenUrl: solanaRail.explorerAddress(row.mintAddress!), transactionUrl: solanaRail.explorerTx(row.signature!) }));
  return { version: 1, orderId: order._id, demoOnly: true, network: order.network,
    acceptedCount: order.acceptedCount.toString(), quantityRequested: order.quantityRequested.toString(),
    funding: { rows: funding, missing: funding.length ? null : "No signed funding attempt yet" },
    payouts: { chainObservedCount: chainObservedPayoutCount.toString(), missing: chainObservedPayoutCount ? null : "No exact confirmed contributor payout yet" },
    attestations: { rows: attestations, missing: attestations.length ? null : "No confirmed EAS attestation for a current analysis" },
    bank: { label: "Mock bank (Capital One Nessie)", simulated: true },
    solanaLicenses: { rows: licenses, testnetOnly: true, missing: licenses.length ? null : "No confirmed Token-2022 license mint yet" },
  };
} });

type Snapshot = FunctionReturnType<ApiFromModules<{ proofPublic: { snapshot: typeof snapshot } }>["proofPublic"]["snapshot"]>;
const snapshotRef = makeFunctionReference<"query", { orderId: string }, Snapshot>("proofPublic:snapshot");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: {
  "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
  "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS",
} });

export const handle = httpAction(async (ctx, request) => {
  const limited = await checkPublicRateLimit(ctx, request, "discovery");
  if (limited) return limited;
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => key !== "orderId") || params.getAll("orderId").length !== 1 || !params.get("orderId")) return json({ error: "one_orderId_required" }, 400);
  try {
    const proof = await ctx.runQuery(snapshotRef, { orderId: params.get("orderId")! });
    return proof ? json(proof) : json({ error: "public_order_not_found" }, 404);
  } catch { return json({ error: "proof_unavailable" }, 503); }
});
