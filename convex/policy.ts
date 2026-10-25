import { hasOrderAuthority } from "./lib/demoAuth";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { acceptAndPublishFor, approveFor } from "./finance";
import { requirePolicyService } from "./lib/serviceAuth";
import { audit, actorFor, digest, loadLedger, normalizeAddress } from "./lib/finance";
import { queuePolicyReview, resolvePolicyReview } from "./lib/policyReview";
import { checkSpokenLiveness, instructionLike } from "./lib/spokenLiveness";
import { accountBalance } from "../packages/ledger/src/index";
import { PAYMENT_CHAIN_ID } from "../packages/contracts/src/chain";

async function policyFailures(ctx: MutationCtx, order: Doc<"orders">) {
  if (!order.autoPay?.enabled) return ["auto_pay_disabled"];
  if (order.autoPay.setBy !== order.buyerTokenIdentifier || order.autoPay.requireAllChecks !== true || order.autoPay.maxPerClipAtomic <= 0n) return ["buyer_policy_invalid"];
  const signer = await ctx.db.query("memberships").withIndex("by_token_identifier", q => q.eq("tokenIdentifier", order.autoPay!.setBy)).unique();
  if (!hasOrderAuthority(signer, order)) return ["buyer_policy_signer_unauthorized"];
  return [];
}

/** Evidence can satisfy a buyer's rule; it cannot grant itself payment authority. */
export async function evaluateSubmissionFor(ctx: MutationCtx, args: { submissionId: Id<"submissions"> }) {
  const submission = await ctx.db.get(args.submissionId);
  if (!submission) throw new Error("submission_not_found");
  const order = await ctx.db.get(submission.orderId);
  if (!order || order.organizationId !== submission.organizationId) throw new Error("order_not_found");
  const principal = await requirePolicyService(ctx, order.organizationId);
  if (submission.status === "accepted" || submission.status === "rejected") return { ok: true as const, replayed: true };
  const failures = await policyFailures(ctx, order);
  const analysis = submission.currentAnalysisId ? await ctx.db.get(submission.currentAnalysisId) : null;
  const rubric = await ctx.db.get(submission.taskVersionId);
  if (!analysis || analysis.organizationId !== order.organizationId || analysis.submissionId !== submission._id ||
    analysis.sourceHash !== submission.sourceHash || analysis.taskVersionId !== submission.taskVersionId ||
    analysis.implementation !== "inference" || analysis.pipelineStatus !== "completed" || analysis.recommendation !== "accept") failures.push("completed_accept_inference_required");
  // JSON belongs to trusted report persistence, but absent/malformed/legacy data fails closed.
  let report: any, observations: any;
  try { report = JSON.parse(analysis?.reportJson ?? "null"); observations = JSON.parse(analysis?.observationsJson ?? "null"); }
  catch { failures.push("report_invalid"); }
  if (!report || digest(report) !== analysis?.reportHash || report.submissionId !== submission._id ||
    report.source?.sha256 !== submission.sourceHash || report.taskVersionId !== submission.taskVersionId ||
    report.pipeline?.implementation !== "inference" || report.pipeline?.status !== "completed" || report.recommendation !== "accept") failures.push("report_binding_or_outcome_invalid");
  const findings = Array.isArray(report?.criteria) ? report.criteria : [];
  if (!rubric || !rubric.criteria.length || findings.length !== rubric.criteria.length || new Set(findings.map((c: any) => c?.criterionId)).size !== findings.length) failures.push("rubric_checks_incomplete");
  for (const criterion of rubric?.criteria ?? []) {
    if (findings.find((c: any) => c?.criterionId === criterion.criterionId)?.status !== "supported") failures.push(`criterion:${criterion.criterionId}`);
  }
  const jury = observations?.jury;
  if (!jury || jury.agreementFraction !== 1 || !Array.isArray(jury.disagreedCriteria) || jury.disagreedCriteria.length ||
    !Array.isArray(jury.judges) || jury.judges.length < 2 || jury.judges.some((judge: any) => judge?.failureCode ||
      judge?.report?.recommendation !== "accept" || judge?.report?.pipeline?.implementation !== "inference" || judge?.report?.pipeline?.status !== "completed")) failures.push("jury_not_accept");
  if (report?.duplicate?.status !== "clear" || !Array.isArray(report?.duplicate?.matches) || report.duplicate.matches.length) failures.push("duplicate_not_clear");
  if (submission.liveness) {
    const liveness = checkSpokenLiveness(submission.liveness, observations?.audio, report?.source?.durationMs);
    if (liveness.status !== "passed") failures.push(`liveness:${liveness.status}`);
  }
  if (instructionLike(observations?.audio?.transcript ?? "") || report?.promptInjection === true || observations?.promptInjection === true ||
    (Array.isArray(report?.warnings) && report.warnings.some((warning: unknown) => typeof warning === "string" && /instruction-like|prompt.?injection/i.test(warning)))) failures.push("prompt_injection_flag");
  const consent = submission.consentRecordId ? await ctx.db.get(submission.consentRecordId) : null;
  if (!consent || consent.organizationId !== order.organizationId || consent.submissionId !== submission._id ||
    consent.contributorTokenIdentifier !== submission.contributorTokenIdentifier || !consent.licenseVersion.trim() || !consent.scope.trim() || consent.revocationStatus) failures.push("consent_license_required");
  if (submission.verificationOnly) failures.push("verification_only_not_licensed");
  if (failures.length) return queuePolicyReview(ctx, { organizationId: order.organizationId, orderId: order._id, submissionId: submission._id, failures });
  const ledger = await loadLedger(ctx, order.organizationId);
  if (accountBalance(ledger, "liability:customer_prepayments", { orderId: order._id }) < order.pricePerSampleAtomic) {
    return queuePolicyReview(ctx, { organizationId: order.organizationId, orderId: order._id, submissionId: submission._id, failures: ["insufficient_funded_remaining"] });
  }
  const accepted = await acceptAndPublishFor(ctx, { demoIdentity: "", submissionId: submission._id }, principal);
  if (!accepted.ok) return queuePolicyReview(ctx, { organizationId: order.organizationId, orderId: order._id, submissionId: submission._id, failures: [accepted.code] });
  await resolvePolicyReview(ctx, order._id, submission._id, principal.tokenIdentifier, "All buyer-signed acceptance checks passed.");
  await ctx.scheduler.runAfter(0, makeFunctionReference<"mutation", { payableId: Id<"payables"> }>("finance:proposeAccepted"), { payableId: accepted.payableId });
  return accepted;
}
export const evaluateSubmission = internalMutation({ args: { submissionId: v.id("submissions") }, handler: evaluateSubmissionFor });

export async function policyApprovalFor(ctx: MutationCtx, args: { intentId: Id<"paymentIntents"> }) {
  const intent = await ctx.db.get(args.intentId);
  if (!intent || intent.kind !== "contributor_payout") throw new Error("payout_not_found");
  const order = await ctx.db.get(intent.orderId);
  if (!order || order.organizationId !== intent.organizationId) throw new Error("order_not_found");
  const principal = await requirePolicyService(ctx, order.organizationId);
  if (intent.status !== "proposed") return { ok: false as const, code: "payment_not_proposed" };
  const failures = await policyFailures(ctx, order);
  if (intent.requesterTokenIdentifier === principal.tokenIdentifier) failures.push("self_approval_refused");
  if (intent.amountAtomic <= 0n) failures.push("invalid_payout_amount");
  if (order.autoPay && intent.amountAtomic > order.autoPay.maxPerClipAtomic) failures.push("over_cap_payout");
  const payable = await ctx.db.get(intent.payableId);
  const submission = payable ? await ctx.db.get(payable.submissionId) : null;
  const decision = payable ? await ctx.db.get(payable.decisionId) : null;
  if (!payable || payable.organizationId !== order.organizationId || payable.orderId !== order._id || payable.amountAtomic !== intent.amountAtomic ||
    !submission || submission.organizationId !== order.organizationId || submission.orderId !== order._id || submission.status !== "accepted" ||
    submission.currentDecisionId !== payable.decisionId || submission.contributorTokenIdentifier !== payable.contributorTokenIdentifier ||
    !decision || decision.submissionId !== submission._id || decision.organizationId !== order.organizationId || decision.decision !== "accepted") failures.push("accepted_payable_binding_required");
  const contributor = payable ? await ctx.db.query("memberships").withIndex("by_token_identifier", q => q.eq("tokenIdentifier", payable.contributorTokenIdentifier)).unique() : null;
  if (!contributor || contributor.organizationId !== order.organizationId || contributor.status !== "active" ||
    !contributor.roles.includes("contributor") || contributor.roles.includes("finance-agent") || contributor.roles.includes("controller") ||
    !contributor.walletAddress || contributor.walletVerification?.chainId !== PAYMENT_CHAIN_ID ||
    contributor.walletVerification.verifiedAt <= 0 || contributor.walletVerification.verifiedAt > Date.now() ||
    !contributor.walletVerification.nonce || !contributor.walletVerification.signature || !contributor.walletVerification.siweMessageHash ||
    normalizeAddress(contributor.walletAddress) !== intent.recipientAddress) failures.push("verified_contributor_wallet_required");
  const consent = submission?.consentRecordId ? await ctx.db.get(submission.consentRecordId) : null;
  if (!consent || consent.organizationId !== order.organizationId || consent.submissionId !== submission?._id ||
    consent.contributorTokenIdentifier !== payable?.contributorTokenIdentifier || consent.revocationStatus ||
    !consent.licenseVersion.trim() || !consent.scope.trim()) failures.push("consent_license_required");
  const ledger = await loadLedger(ctx, order.organizationId);
  const fundedAtomic = ledger.journals.filter(j => j.orderId === order._id && j.kind === "funding").reduce((total, journal) =>
    total + journal.lines.filter(line => line.account === "asset:usdc").reduce((sum, line) => sum + line.debit - line.credit, 0n), 0n);
  const others = await ctx.db.query("paymentIntents").withIndex("by_order", q => q.eq("orderId", order._id)).collect();
  const reserved = others.filter(i => i._id !== intent._id && i.kind === "contributor_payout" &&
    ["approved", "submitted", "pending", "reconciling"].includes(i.status)).reduce((sum, i) => sum + i.amountAtomic, 0n);
  if (!["funded", "collecting", "fulfilled"].includes(order.status) || fundedAtomic !== order.budgetAtomic ||
    accountBalance(ledger, "asset:usdc", { orderId: order._id }) < reserved + intent.amountAtomic) failures.push("insufficient_funded_remaining");
  if (failures.length) return queuePolicyReview(ctx, { organizationId: order.organizationId, orderId: order._id, intentId: intent._id, failures });
  const result = await approveFor(ctx, { demoIdentity: "", intentId: intent._id }, principal);
  if (!result.ok) return queuePolicyReview(ctx, { organizationId: order.organizationId, orderId: order._id, intentId: intent._id, failures: [result.code] });
  await audit(ctx, { organizationId: order.organizationId, eventKey: `policy_approved:${intent._id}`, actor: actorFor(principal),
    action: "policy_payment_approved", entityType: "paymentIntents", entityId: intent._id,
    reason: "Agent proposed; buyer-signed cap, accepted payable, verified wallet and funded remaining passed. Chain confirmation is still required.",
    evidenceReferences: [order._id, payable!._id, result.approvalId, digest(order.autoPay)] });
  await resolvePolicyReview(ctx, order._id, intent._id, principal.tokenIdentifier, "Buyer-signed payment checks passed.");
  return result;
}
export const policyApproval = internalMutation({ args: { intentId: v.id("paymentIntents") }, handler: policyApprovalFor });
