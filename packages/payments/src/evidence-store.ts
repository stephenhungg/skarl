import { paymentConfig } from "./config.ts";
/**
 * Convex handlers for paid, licensed evidence. The deployment entrypoint re-exports
 * these handlers as `evidenceSales`. No network calls or signing occur here.
 */
import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "../../../convex/_generated/server";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { digest, normalizeAddress, recordJournal } from "../../../convex/lib/finance";
import type { VerificationReport } from "../../../convex/lib/verificationReport";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "../../contracts/src/chain";
import { createEvidenceSaleJournal } from "../../ledger/src/index";
import { evidencePayTo } from "./evidence-payee";
import { chainIdentity, validateTransfer } from "./reconciliation";

export const EVIDENCE_PRICE_ATOMIC = paymentConfig.evidencePriceAtomic;
export const EVIDENCE_ACCOUNTING = "evidence_sale_inflow" as const;
type Context = QueryCtx | MutationCtx;
export interface SampleEvidence {
  sampleId: string; submissionId: Id<"submissions">; organizationId: Id<"organizations">; orderId: Id<"orders">;
  report: VerificationReport; storageUrl: string; mimeType: string; binding: string;
}
const secretArg = { serviceSecret: v.string() };
const nonceHash = (value: string) => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error("invalid_hash");
  return value.toLowerCase();
};
function service(secret: string) {
  const expected = process.env.SKARL_PAYMENTS_SERVICE_SECRET;
  if (!expected || expected.length < 32 || secret.length !== expected.length) throw new Error("payment_service_unauthorized");
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ secret.charCodeAt(i);
  if (mismatch) throw new Error("payment_service_unauthorized");
}

async function eligibleSample(ctx: Context, sampleId: string): Promise<SampleEvidence> {
  const id = sampleId.startsWith("sample-") ? ctx.db.normalizeId("submissions", sampleId.slice(7)) : null;
  const submission = id ? await ctx.db.get(id) : null;
  if (!submission || submission.status !== "accepted" || submission.verificationOnly || submission.evalRunId ||
    !submission.sourceHash || !submission.currentAnalysisId || !submission.originalAssetId || !submission.consentRecordId) {
    throw new Error("sample_not_available");
  }
  const [organization, order, delivery, analysis, original, consent, decision] = await Promise.all([
    ctx.db.get(submission.organizationId), ctx.db.get(submission.orderId),
    ctx.db.query("deliveries").withIndex("by_submission", q => q.eq("submissionId", submission._id)).unique(),
    ctx.db.get(submission.currentAnalysisId), ctx.db.get(submission.originalAssetId), ctx.db.get(submission.consentRecordId),
    submission.currentDecisionId ? ctx.db.get(submission.currentDecisionId) : null,
  ]);
  if (!organization || organization.status !== "active" || !order || !delivery?.manifest || !analysis || !original || !consent || !decision ||
    [order, delivery, analysis, original, consent, decision].some(row => row.organizationId !== submission.organizationId)) {
    throw new Error("sample_not_available");
  }
  const manifest = delivery.manifest;
  if (order.network !== PAYMENT_NETWORK || order.tokenAddress !== USDC_ADDRESS ||
    delivery.orderId !== submission.orderId || delivery.decisionId !== decision._id || decision.decision !== "accepted" ||
    decision.submissionId !== submission._id || decision.analysisResultId !== analysis._id || decision.taskVersionId !== submission.taskVersionId ||
    manifest.originalAssetId !== original._id || manifest.sourceHash !== submission.sourceHash || manifest.taskVersionId !== submission.taskVersionId ||
    manifest.consentRecordId !== consent._id || manifest.licenseVersion !== consent.licenseVersion || manifest.decisionId !== decision._id ||
    manifest.analysisResultId !== analysis._id || digest(manifest) !== delivery.manifestHash || delivery.termsHash !== order.termsHash ||
    analysis.submissionId !== submission._id || analysis.taskVersionId !== submission.taskVersionId || analysis.sourceHash !== submission.sourceHash ||
    analysis.pipelineStatus !== "completed" || analysis.implementation !== "inference" || !analysis.reportJson ||
    original.submissionId !== submission._id || original.purpose !== "original" || original.status !== "verified" ||
    original.contentHash !== submission.sourceHash || !original.mimeType.startsWith("video/") ||
    consent.submissionId !== submission._id || consent.contributorTokenIdentifier !== submission.contributorTokenIdentifier ||
    consent.licenseVersion !== "demo-consent-v1" || !consent.scope.trim()) throw new Error("sample_not_available");
  let report: VerificationReport;
  try { report = JSON.parse(analysis.reportJson) as VerificationReport; }
  catch { throw new Error("sample_not_available"); }
  // Persistence validates the complete report. Recheck its hash and source here
  // without importing the Node/AJV code generator into the Convex runtime.
  if (digest(report) !== analysis.reportHash || report.submissionId !== submission._id || report.taskVersionId !== submission.taskVersionId ||
    report.source?.sha256 !== submission.sourceHash || report.pipeline?.implementation !== "inference" ||
    report.pipeline.status !== "completed" || !report.pipeline.modelRuns?.length || !Array.isArray(report.criteria)) {
    throw new Error("sample_not_available");
  }
  const storageUrl = await ctx.storage.getUrl(original.storageId);
  if (!storageUrl) throw new Error("sample_not_available");
  const binding = digest({ submissionId: submission._id, deliveryId: delivery._id, manifestHash: delivery.manifestHash,
    reportHash: analysis.reportHash, consentReceiptHash: consent.receiptHash, licenseHash: consent.licenseHash });
  return { sampleId, submissionId: submission._id, organizationId: submission.organizationId, orderId: submission.orderId,
    report, storageUrl, mimeType: original.mimeType, binding };
}

/** Server-only original URL; the Next route returns an expiring proxy URL instead. */
export const sample = query({ args: { ...secretArg, sampleId: v.string() }, handler: async (ctx, args) => {
  service(args.serviceSecret);
  return { ...await eligibleSample(ctx, args.sampleId), accountingVersion: 2 as const, recipientAddress: evidencePayTo() };
} });

export interface SaleTerms {
  version: 1; sampleId: string; orderId: Id<"orders">; binding: string; payerAddress: string;
  recipientAddress: string; amountAtomic: string; authorizationNonce: string; validBefore: number; facilitator: string;
}
export interface EvidenceSale {
  attempt: Doc<"paymentAttempts">; terms: SaleTerms; accountingTreatment: typeof EVIDENCE_ACCOUNTING;
}
async function termsFor(ctx: Context, attempt: Doc<"paymentAttempts">): Promise<SaleTerms> {
  const audit = await ctx.db.query("auditEvents").withIndex("by_event_key", q =>
    q.eq("organizationId", attempt.organizationId).eq("eventKey", `evidence-sale:${attempt._id}`)).unique();
  if (!audit || audit.action !== "evidence_sale_claimed" || audit.entityId !== attempt._id || attempt.paymentIntentId || attempt.paymentCommandId) {
    throw new Error("evidence_sale_not_found");
  }
  const terms = JSON.parse(audit.reason) as SaleTerms;
  if (terms.version !== 1 || terms.amountAtomic !== EVIDENCE_PRICE_ATOMIC.toString() || terms.payerAddress !== attempt.payerAddress ||
    terms.authorizationNonce !== attempt.authorizationNonce || attempt.amountAtomic !== EVIDENCE_PRICE_ATOMIC ||
    attempt.network !== PAYMENT_NETWORK || attempt.tokenAddress !== USDC_ADDRESS) throw new Error("evidence_sale_binding_changed");
  return terms;
}
const lookupArgs = { ...secretArg, sampleId: v.string(), payerAddress: v.string(), authorizationNonce: v.string() };
export const sale = query({ args: lookupArgs, handler: async (ctx, args): Promise<EvidenceSale | null> => {
  service(args.serviceSecret);
  const attempt = await ctx.db.query("paymentAttempts").withIndex("by_authorization_nonce", q =>
    q.eq("network", PAYMENT_NETWORK).eq("payerAddress", normalizeAddress(args.payerAddress)).eq("authorizationNonce", nonceHash(args.authorizationNonce))).unique();
  if (!attempt) return null;
  const terms = await termsFor(ctx, attempt);
  if (terms.sampleId !== args.sampleId) throw new Error("authorization_already_claimed");
  return { attempt, terms, accountingTreatment: EVIDENCE_ACCOUNTING };
} });

export const claim = mutation({ args: { ...lookupArgs, recipientAddress: v.string(), amountAtomic: v.int64(),
  validBefore: v.number(), facilitator: v.union(v.literal("cdp"), v.literal("x402.org"), v.literal("custom")) }, handler: async (ctx, args) => {
  service(args.serviceSecret);
  const payerAddress = normalizeAddress(args.payerAddress), recipientAddress = normalizeAddress(args.recipientAddress);
  const authorizationNonce = nonceHash(args.authorizationNonce);
  if (args.amountAtomic !== EVIDENCE_PRICE_ATOMIC || payerAddress === recipientAddress || /^0x0{40}$/.test(recipientAddress)) throw new Error("quote_changed");
  const prior = await ctx.db.query("paymentAttempts").withIndex("by_authorization_nonce", q =>
    q.eq("network", PAYMENT_NETWORK).eq("payerAddress", payerAddress).eq("authorizationNonce", authorizationNonce)).unique();
  if (prior) {
    const terms = await termsFor(ctx, prior);
    if (terms.sampleId !== args.sampleId || terms.recipientAddress !== recipientAddress || terms.validBefore !== args.validBefore) {
      throw new Error("authorization_already_claimed");
    }
    return { attemptId: prior._id, replayed: true, binding: terms.binding };
  }
  if (!Number.isSafeInteger(args.validBefore) || args.validBefore <= Date.now()) throw new Error("authorization_expired");
  if (recipientAddress !== evidencePayTo()) throw new Error("quote_changed");
  const eligible = await eligibleSample(ctx, args.sampleId);
  const now = Date.now();
  const attemptId = await ctx.db.insert("paymentAttempts", { organizationId: eligible.organizationId, network: PAYMENT_NETWORK,
    tokenAddress: USDC_ADDRESS, attemptId: `evidence:${digest({ sampleId: args.sampleId, payerAddress, authorizationNonce })}`,
    attempt: 1, amountAtomic: EVIDENCE_PRICE_ATOMIC, payerAddress, authorizationNonce, status: "prepared", createdAt: now, updatedAt: now });
  const terms: SaleTerms = { version: 1, sampleId: args.sampleId, orderId: eligible.orderId, binding: eligible.binding,
    payerAddress, recipientAddress, amountAtomic: EVIDENCE_PRICE_ATOMIC.toString(), authorizationNonce,
    validBefore: args.validBefore, facilitator: args.facilitator };
  await ctx.db.insert("auditEvents", { organizationId: eligible.organizationId, eventKey: `evidence-sale:${attemptId}`,
    actor: { kind: "service", identity: "skarl:payments" }, action: "evidence_sale_claimed", entityType: "paymentAttempt",
    entityId: attemptId, reason: JSON.stringify(terms), evidenceReferences: [eligible.submissionId, eligible.binding], occurredAt: now });
  return { attemptId, replayed: false, binding: eligible.binding };
} });

const observation = v.object({ network: v.string(), tokenAddress: v.string(), txHash: v.string(), logIndex: v.number(),
  blockNumber: v.int64(), blockHash: v.string(), fromAddress: v.string(), toAddress: v.string(), amountAtomic: v.int64(),
  confirmations: v.number(), succeeded: v.boolean(), observedAt: v.number() });
export const confirm = mutation({ args: { ...secretArg, attemptId: v.id("paymentAttempts"), authorizationNonce: v.string(), observation },
  handler: async (ctx, args) => {
    service(args.serviceSecret);
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt) throw new Error("evidence_sale_not_found");
    const terms = await termsFor(ctx, attempt);
    if (nonceHash(args.authorizationNonce) !== terms.authorizationNonce) throw new Error("authorization_mismatch");
    validateTransfer(args.observation, { fromAddress: terms.payerAddress, toAddress: terms.recipientAddress, amountAtomic: EVIDENCE_PRICE_ATOMIC });
    const txHash = nonceHash(args.observation.txHash);
    if (attempt.txHash && attempt.txHash !== txHash) throw new Error("transaction_already_bound");
    const previous = await ctx.db.query("chainObservations").withIndex("by_transfer", q =>
      q.eq("network", PAYMENT_NETWORK).eq("txHash", txHash).eq("logIndex", args.observation.logIndex)).unique();
    if (previous) {
      if (previous.paymentAttemptId !== attempt._id || previous.blockHash !== args.observation.blockHash ||
        previous.amountAtomic !== args.observation.amountAtomic || previous.fromAddress !== normalizeAddress(args.observation.fromAddress) ||
        previous.toAddress !== normalizeAddress(args.observation.toAddress)) throw new Error("transfer_already_claimed_or_changed");
      return { observationId: previous._id, replayed: true, accountingTreatment: EVIDENCE_ACCOUNTING };
    }
    if (attempt.status === "confirmed") throw new Error("attempt_already_confirmed");
    const observationId = await ctx.db.insert("chainObservations", { ...args.observation, organizationId: attempt.organizationId,
      paymentAttemptId: attempt._id, network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, txHash,
      fromAddress: normalizeAddress(args.observation.fromAddress), toAddress: normalizeAddress(args.observation.toAddress) });
    // The receipt is real even if content was quarantined after the claim.
    // Recognize revenue only while the purchased, bound evidence is available.
    let delivered = false;
    try { delivered = (await eligibleSample(ctx, terms.sampleId)).binding === terms.binding; }
    catch { /* Preserve the inflow as a separate liability, never order funding. */ }
    const journalEntryId = await recordJournal(ctx, attempt.organizationId, createEvidenceSaleJournal({
      eventId: `evidence:${attempt._id}`, orderId: terms.orderId, amountMicroUsdc: EVIDENCE_PRICE_ATOMIC,
      sampleId: terms.sampleId, recipientAddress: terms.recipientAddress, delivered }));
    await ctx.db.patch(journalEntryId, { sourceReference: chainIdentity(args.observation) });
    await ctx.db.patch(attempt._id, { txHash, status: "confirmed", updatedAt: Date.now() });
    return { observationId, journalEntryId, replayed: false, accountingTreatment: EVIDENCE_ACCOUNTING };
  },
});
