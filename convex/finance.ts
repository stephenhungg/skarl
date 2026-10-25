import { resolveTaskSpec } from "./lib/taskSpec";
import { configNumber } from "./lib/config";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { workflow, controllerApproved } from "./approvalWorkflow";
import { makeFunctionReference } from "convex/server";
import { mutation, internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { hasOrderAuthority, DemoRoleError, demoToken, requireRole, type DemoPrincipal, type DemoRole } from "./lib/demoAuth";
import { actorFor, audit, digest, normalizeAddress, paymentBinding, recordJournal, sourceVersion, requireBuyerOrder } from "./lib/finance";
import { resolvePolicyReview } from "./lib/policyReview";
import { compareFrameHashes } from "./lib/copyDetection";
import { createFulfillmentJournal } from "../packages/ledger/src/index";
import { MAX_ATOMIC_USDC, PAYMENT_CHAIN_ID, PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/index";
import { diversityRefusal } from "./lib/diversity";
import { requireFinanceService } from "./lib/serviceAuth";

export async function authorize(ctx: MutationCtx, identity: string, roles: DemoRole | readonly DemoRole[]) {
  try { return { principal: await requireRole(ctx, identity, roles), denied: undefined }; }
  catch (error) {
    if (!(error instanceof DemoRoleError)) throw error;
    return { principal: error.principal, denied: error.code };
  }
}
export async function refuse(ctx: MutationCtx, principal: DemoPrincipal, entity: { _id: string; organizationId: Id<"organizations"> },
  action: string, code: string, evidenceReferences: string[] = []) {
  await audit(ctx, { organizationId: entity.organizationId,
    eventKey: `refused:${action}:${entity._id}:${principal.tokenIdentifier}:${code}`,
    actor: actorFor(principal), action: `${action}_refused`, entityType: ["acceptance", "review"].includes(action) ? "submissions" : action === "payment_proposal" ? "payables" : "paymentIntents",
    entityId: entity._id, reason: code, evidenceReferences });
  // Returning a refusal commits its audit event. Throwing here would roll it back.
  return { ok: false as const, code };
}


export async function acceptAndPublishFor(ctx: MutationCtx, args: { demoIdentity: string; submissionId: Id<"submissions"> }, servicePrincipal?: DemoPrincipal) {
    const auth = servicePrincipal ? { principal: servicePrincipal, denied: undefined } : await authorize(ctx, args.demoIdentity, ["buyer", "controller"]);
    if (!auth.principal) return { ok: false as const, code: auth.denied! };
    const principal = auth.principal;
    const submission = await ctx.db.get(args.submissionId);
    if (!submission || submission.organizationId !== principal.organizationId) return { ok: false as const, code: "not_found" };
    if (auth.denied) return refuse(ctx, principal, submission, "acceptance", auth.denied);
    const ownedOrder = await ctx.db.get(submission.orderId);
    if (!ownedOrder) return { ok: false as const, code: "not_found" };
    requireBuyerOrder(principal, ownedOrder);
    if (principal.roles.includes("finance-agent") || principal.tokenIdentifier === demoToken("finance-agent")) return refuse(ctx, principal, submission, "acceptance", "agent_approval_refused");
    if (submission.contributorTokenIdentifier === principal.tokenIdentifier) return refuse(ctx, principal, submission, "acceptance", "self_review_refused");
    if (submission.verificationOnly) return refuse(ctx, principal, submission, "acceptance", "verification_only_not_licensed");
    const eventKey = `fulfillment:${submission._id}`;
    const previous = await ctx.db.query("payables").withIndex("by_source_event", q =>
      q.eq("organizationId", submission.organizationId).eq("sourceEventKey", eventKey)).unique();
    if (previous) {
      const delivery = await ctx.db.query("deliveries").withIndex("by_submission", q => q.eq("submissionId", submission._id)).unique();
      const journal = await ctx.db.query("journalEntries").withIndex("by_event_key", q =>
        q.eq("organizationId", submission.organizationId).eq("eventKey", eventKey)).unique();
      if (!delivery || !journal || submission.status !== "accepted") throw new Error("incomplete_fulfillment_invariant");
      return { ok: true as const, payableId: previous._id, deliveryId: delivery._id, journalEntryId: journal._id, replayed: true };
    }
    if (!submission.sourceHash || !/^[a-f0-9]{64}$/.test(submission.sourceHash)) return refuse(ctx, principal, submission, "acceptance", "verified_source_required");
    if (submission.perceptualHash !== undefined && (!submission.perceptualHash.trim() || submission.perceptualHash !== submission.perceptualHash.trim().toLowerCase())) {
      return refuse(ctx, principal, submission, "acceptance", "noncanonical_perceptual_hash");
    }
    // Indexed range reads and acceptance writes share the transaction: concurrent copies conflict/retry.
    const exact = await ctx.db.query("submissions").withIndex("by_source_hash", q =>
      q.eq("organizationId", submission.organizationId).eq("sourceHash", submission.sourceHash)).collect();
    const perceptual = submission.perceptualHash ? await ctx.db.query("submissions").withIndex("by_perceptual_hash", q =>
      q.eq("organizationId", submission.organizationId).eq("perceptualHash", submission.perceptualHash)).collect() : [];
    const frameCandidates = submission.frameDHashes?.length ? await ctx.db.query("submissions")
      .withIndex("by_org_status", q => q.eq("organizationId", submission.organizationId).eq("status", "accepted"))
      .filter(q => q.neq(q.field("simulationOnly"), true)).take(configNumber("SKARL_DUPLICATE_CANDIDATE_LIMIT") + 1) : [];
    if (frameCandidates.length > configNumber("SKARL_DUPLICATE_CANDIDATE_LIMIT")) return refuse(ctx, principal, submission, "acceptance", "copy_check_capacity_exceeded");
    // Simulated replay obligations must never poison the real duplicate pool.
    const eligibleCandidates = [];
    for (const candidate of [...exact, ...perceptual, ...frameCandidates]) {
      const candidateOrder = candidate.orderId === ownedOrder._id ? ownedOrder : await ctx.db.get(candidate.orderId);
      if (candidateOrder?.publicId.startsWith("scenario:") && candidate.orderId !== submission.orderId) continue;
      eligibleCandidates.push(candidate);
    }
    const matching = eligibleCandidates.find(candidate => candidate._id !== submission._id && candidate.status === "accepted" &&
      (candidate.sourceHash === submission.sourceHash || (!!candidate.perceptualHash && candidate.perceptualHash === submission.perceptualHash) ||
        compareFrameHashes(submission.frameDHashes ?? [], candidate.frameDHashes ?? []) !== null));
    if (matching) {
      await ctx.db.patch(submission._id, { status: "needs_review", updatedAt: Date.now() });
      const result = await refuse(ctx, principal, submission, "acceptance", "duplicate_submission", [matching._id, submission.sourceHash,
        ...(submission.perceptualHash ? [submission.perceptualHash] : [])]);
      return { ...result, matchingSubmissionId: matching._id };
    }
    const order = await ctx.db.get(submission.orderId);
    const rubric = await ctx.db.get(submission.taskVersionId);
    if (!order || order.organizationId !== principal.organizationId || !rubric || rubric.organizationId !== order.organizationId ||
      rubric.orderId !== order._id || order.taskVersionId !== rubric._id || rubric.frozenAt === undefined) {
      return refuse(ctx, principal, submission, "acceptance", "task_version_mismatch");
    }
    if (!["funded", "collecting"].includes(order.status)) return refuse(ctx, principal, submission, "acceptance", "order_not_funded_or_open");
    if (order.quantityRequested <= 0n || order.acceptedCount < 0n || order.acceptedCount >= order.quantityRequested) return refuse(ctx, principal, submission, "acceptance", "quota_exhausted");
    if (order.diversity) {
      const accepted = (await ctx.db.query("submissions").withIndex("by_order_status", q =>
        q.eq("orderId", order._id).eq("status", "accepted")).collect())
        .filter(sample => sample.organizationId === order.organizationId);
      const quota = diversityRefusal(order, accepted, submission);
      if (quota) return refuse(ctx, principal, submission, "acceptance", "diversity_quota_exceeded", [order._id, quota]);
    }
    if (Date.now() > order.deadlineAt) return refuse(ctx, principal, submission, "acceptance", "order_expired");
    if (order.pricePerSampleAtomic <= 0n || order.contributorRateAtomic <= 0n ||
      order.budgetAtomic !== order.quantityRequested * order.pricePerSampleAtomic || order.budgetAtomic > MAX_ATOMIC_USDC) {
      return refuse(ctx, principal, submission, "acceptance", "invalid_order_amounts");
    }
    if (["uploading", "rejected", "accepted"].includes(submission.status)) return refuse(ctx, principal, submission, "acceptance", "submission_not_reviewable");
    const analysis = submission.currentAnalysisId ? await ctx.db.get(submission.currentAnalysisId) : null;
    if (analysis && (analysis.organizationId !== submission.organizationId || analysis.submissionId !== submission._id ||
      analysis.sourceHash !== submission.sourceHash || analysis.taskVersionId !== rubric._id)) {
      return refuse(ctx, principal, submission, "acceptance", "analysis_source_mismatch");
    }
    const humanDecision = submission.currentDecisionId ? await ctx.db.get(submission.currentDecisionId) : null;
    let humanAccepted = false;
    if (humanDecision && humanDecision.organizationId === submission.organizationId && humanDecision.submissionId === submission._id &&
      humanDecision.taskVersionId === rubric._id && humanDecision.decision === "accepted" && humanDecision.reason.trim() &&
      humanDecision.evidenceHash === (analysis?.reportHash ?? submission.sourceHash) &&
      humanDecision.analysisResultId === (analysis?._id)) {
      const reviewer = await ctx.db.query("memberships").withIndex("by_token_identifier", q =>
        q.eq("tokenIdentifier", humanDecision.reviewerTokenIdentifier)).unique();
      humanAccepted = !!reviewer && reviewer.organizationId === submission.organizationId && reviewer.status === "active" &&
        hasOrderAuthority(reviewer, order) && !reviewer.roles.includes("finance-agent") && !reviewer.roles.includes("contributor") &&
        reviewer.tokenIdentifier !== submission.contributorTokenIdentifier && reviewer.tokenIdentifier !== demoToken("finance-agent");
    }
    const machineAccepted = !!resolveTaskSpec(rubric) && analysis?.implementation === "inference" && analysis.pipelineStatus === "completed" && analysis.recommendation === "accept";
    if (!machineAccepted && !humanAccepted) return refuse(ctx, principal, submission, "acceptance", "acceptance_evidence_required");
    const original = submission.originalAssetId ? await ctx.db.get(submission.originalAssetId) : null;
    const consent = submission.consentRecordId ? await ctx.db.get(submission.consentRecordId) : null;
    if (!original || original.organizationId !== submission.organizationId || original.submissionId !== submission._id ||
      original.purpose !== "original" || original.status !== "verified" || original.contentHash !== submission.sourceHash ||
      !consent || consent.organizationId !== submission.organizationId || consent.submissionId !== submission._id ||
      consent.contributorTokenIdentifier !== submission.contributorTokenIdentifier || !consent.licenseVersion.trim() || !consent.scope.trim()) {
      return refuse(ctx, principal, submission, "acceptance", "licensed_media_required");
    }
    if (consent.revocationStatus) return refuse(ctx, principal, submission, "acceptance", "consent_revocation_pending_or_revoked");
    const contributor = await ctx.db.query("memberships").withIndex("by_token_identifier", q =>
      q.eq("tokenIdentifier", submission.contributorTokenIdentifier)).unique();
    if (!contributor || contributor.organizationId !== submission.organizationId || contributor.status !== "active" ||
      !contributor.roles.includes("contributor") || contributor.roles.includes("controller") || !contributor.walletAddress ||
      !contributor.walletVerification || contributor.walletVerification.chainId !== PAYMENT_CHAIN_ID) {
      return refuse(ctx, principal, submission, "acceptance", "verified_contributor_wallet_required");
    }
    const recipientAddress = normalizeAddress(contributor.walletAddress);
    const now = Date.now();
    const decisionId = humanAccepted ? humanDecision!._id : await ctx.db.insert("reviewDecisions", {
      organizationId: submission.organizationId, submissionId: submission._id, analysisResultId: analysis!._id,
      taskVersionId: rubric._id, decisionKey: `accept:${submission._id}`, decision: "accepted",
      reviewerTokenIdentifier: principal.tokenIdentifier, reason: servicePrincipal ? "Buyer-signed policy accepted all stored verification checks." : "Buyer accepted the stored evidence report.",
      evidenceHash: analysis!.reportHash, decidedAt: now,
    });
    const journalEntryId = await recordJournal(ctx, submission.organizationId, createFulfillmentJournal({
      eventId: eventKey, orderId: order._id, sampleId: submission._id, contributorId: contributor.tokenIdentifier,
      priceMicroUsdc: order.pricePerSampleAtomic, contributorMicroUsdc: order.contributorRateAtomic,
    }));
    const manifest = { schemaVersion: "1.0" as const, originalAssetId: original._id, sourceHash: submission.sourceHash,
      taskVersionId: rubric._id, consentRecordId: consent._id, licenseVersion: consent.licenseVersion, decisionId,
      ...(analysis ? { analysisResultId: analysis._id } : {}) };
    const deliveryId = await ctx.db.insert("deliveries", { organizationId: submission.organizationId, orderId: order._id,
      submissionId: submission._id, decisionId, manifest, manifestHash: digest(manifest), termsHash: order.termsHash, eventKey, publishedAt: now });
    const payableId = await ctx.db.insert("payables", {
      organizationId: submission.organizationId, network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS,
      orderId: order._id, submissionId: submission._id, decisionId, contributorTokenIdentifier: contributor.tokenIdentifier,
      recipientAddress, amountAtomic: order.contributorRateAtomic, sourceEventKey: eventKey, status: "accrued", createdAt: now,
    });
    await ctx.db.patch(submission._id, { status: "accepted", currentDecisionId: decisionId, updatedAt: now });
    const acceptedCount = order.acceptedCount + 1n;
    await ctx.db.patch(order._id, { acceptedCount, status: acceptedCount === order.quantityRequested ? "fulfilled" : "collecting", updatedAt: now });
    await audit(ctx, { organizationId: submission.organizationId, eventKey: `accepted:${submission._id}`, actor: actorFor(principal),
      action: "submission_accepted_and_published", entityType: "submissions", entityId: submission._id,
      reason: "Licensed manifest published; fulfillment and contributor obligation posted atomically.", evidenceReferences: [decisionId, deliveryId, payableId, journalEntryId] });
    return { ok: true as const, payableId, deliveryId, journalEntryId, replayed: false };
}
export const acceptAndPublish = mutation({
  args: { demoIdentity: v.string(), submissionId: v.id("submissions") },
  handler: (ctx, args) => acceptAndPublishFor(ctx, args),
});

export async function proposePaymentFor(ctx: MutationCtx, args: { demoIdentity: string; payableId: Id<"payables"> }) {
    return proposeAuthorizedPayment(ctx, args, await authorize(ctx, args.demoIdentity, ["finance-agent", "buyer", "controller"]));
}

/** Internal finance-run dispatcher only; public args never supply a principal. */
export async function proposeAgentPaymentFor(ctx: MutationCtx, args: { payableId: Id<"payables"> }) {
    return proposeAuthorizedPayment(ctx, args, { principal: await requireFinanceService(ctx), denied: undefined });
}

async function proposeAuthorizedPayment(ctx: MutationCtx, args: { payableId: Id<"payables"> }, auth: Awaited<ReturnType<typeof authorize>>) {
    if (!auth.principal) return { ok: false as const, code: auth.denied! };
    const principal = auth.principal;
    const payable = await ctx.db.get(args.payableId);
    if (!payable || payable.organizationId !== principal.organizationId) return { ok: false as const, code: "not_found" };
    if (auth.denied) return refuse(ctx, principal, payable, "payment_proposal", auth.denied);
    const order = await ctx.db.get(payable.orderId);
    if (!order) return refuse(ctx, principal, payable, "payment_proposal", "order_not_found");
    requireBuyerOrder(principal, order);
    const version = sourceVersion(payable);
    const existing = await ctx.db.query("paymentIntents").withIndex("by_payable", q => q.eq("payableId", payable._id)).unique();
    if (existing) {
      if (existing.kind !== "contributor_payout" || existing.sourceVersion !== version) return refuse(ctx, principal, payable, "payment_proposal", "payable_changed");
      if (!existing.approvalWorkflowId && existing.status === "proposed") {
        const approvalWorkflowId = await workflow.start(ctx, internal.approvalWorkflow.awaitController, { intentId: existing._id, bindingHash: existing.bindingHash });
        await ctx.db.patch(existing._id, { approvalWorkflowId });
      }
      return { ok: true as const, intentId: existing._id, paymentCommandId: existing.paymentCommandId, replayed: true };
    }
    if (payable.status !== "accrued" || payable.amountAtomic <= 0n) return refuse(ctx, principal, payable, "payment_proposal", "payable_not_open");
    const priorCommands = await ctx.db.query("paymentCommands").withIndex("by_payable", q => q.eq("payableId", payable._id)).collect();
    if (priorCommands.length) return refuse(ctx, principal, payable, "payment_proposal", "existing_payment_command_requires_reconciliation");
    const now = Date.now();
    const binding = { organizationId: payable.organizationId, orderId: payable.orderId, payableId: payable._id,
      network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, recipientAddress: normalizeAddress(payable.recipientAddress),
      amountAtomic: payable.amountAtomic, sourceVersion: version, requesterTokenIdentifier: principal.tokenIdentifier };
    const bindingHash = paymentBinding(binding);
    const paymentCommandId = await ctx.db.insert("paymentCommands", { ...binding, commandId: `payout:${payable._id}`,
      kind: "contributor_payout", requestedBy: actorFor(principal), bindingHash, status: "proposed", attemptCount: 0, leaseGeneration: 0, updatedAt: now });
    const intentId = await ctx.db.insert("paymentIntents", { ...binding, kind: "contributor_payout", intentId: `payout:${payable._id}`,
      paymentCommandId, bindingHash, expiresAt: now + configNumber("SKARL_PAYMENT_APPROVAL_TTL_MS"), status: "proposed", updatedAt: now });
    const approvalWorkflowId = await workflow.start(ctx, internal.approvalWorkflow.awaitController, { intentId, bindingHash });
    await ctx.db.patch(intentId, { approvalWorkflowId });
    await audit(ctx, { organizationId: payable.organizationId, eventKey: `proposed:${payable._id}`, actor: actorFor(principal),
      action: "payment_proposed", entityType: "paymentIntents", entityId: intentId,
      reason: "Proposal derived from the stored payable; buyer-signed policy or buyer review approval required.", evidenceReferences: [payable._id, paymentCommandId] });
    await ctx.scheduler.runAfter(0, makeFunctionReference<"mutation", { intentId: Id<"paymentIntents"> }>("policy:policyApproval"), { intentId });
    return { ok: true as const, intentId, paymentCommandId, replayed: false };
}
export const proposePayment = mutation({
  args: { demoIdentity: v.string(), payableId: v.id("payables") },
  handler: proposePaymentFor,
});

/** A model-selected approval tool always refuses under the service actor. */
export async function refuseAgentApprovalFor(ctx: MutationCtx, intentId: Id<"paymentIntents">) {
    const principal = await requireFinanceService(ctx);
    const intent = await ctx.db.get(intentId);
    if (!intent || intent.organizationId !== principal.organizationId) return { ok: false as const, code: "not_found" };
    if (intent.kind !== "contributor_payout") return refuse(ctx, principal, intent, "payment_approval", "not_a_payout_intent");
    return refuse(ctx, principal, intent, "payment_approval",
      intent.requesterTokenIdentifier === principal.tokenIdentifier ? "self_approval_refused" : "agent_approval_refused", [intent.paymentCommandId]);
}

export async function approveFor(ctx: MutationCtx, args: {demoIdentity: string; intentId: Id<"paymentIntents">; reason?: string}, servicePrincipal?: DemoPrincipal) {
    const auth = servicePrincipal ? { principal: servicePrincipal, denied: undefined } : await authorize(ctx, args.demoIdentity, ["buyer", "controller"]);
    if (!auth.principal) return { ok: false as const, code: auth.denied! };
    const principal = auth.principal;
    const intent = await ctx.db.get(args.intentId);
    if (!intent || intent.organizationId !== principal.organizationId) return { ok: false as const, code: "not_found" };
    if (intent.kind !== "contributor_payout") return refuse(ctx, principal, intent, "payment_approval", "not_a_payout_intent");
    if (intent.requesterTokenIdentifier === principal.tokenIdentifier) return refuse(ctx, principal, intent, "payment_approval", "self_approval_refused", [intent.paymentCommandId]);
    if (auth.denied || principal.roles.includes("finance-agent") || principal.tokenIdentifier === demoToken("finance-agent")) return refuse(ctx, principal, intent, "payment_approval", principal.roles.includes("finance-agent") || principal.tokenIdentifier === demoToken("finance-agent") ? "agent_approval_refused" : auth.denied!, [intent.paymentCommandId]);
    const order = await ctx.db.get(intent.orderId);
    if (!order) return refuse(ctx, principal, intent, "payment_approval", "order_not_found");
    requireBuyerOrder(principal, order);
    const command = await ctx.db.get(intent.paymentCommandId);
    const payable = await ctx.db.get(intent.payableId);
    if (payable?.contributorTokenIdentifier === principal.tokenIdentifier) return refuse(ctx, principal, intent, "payment_approval", "self_payout_approval_refused");
    if (!command || !payable || command.organizationId !== intent.organizationId || payable.organizationId !== intent.organizationId ||
      command.payableId !== payable._id || command.orderId !== payable.orderId || intent.orderId !== payable.orderId ||
      command.requesterTokenIdentifier !== intent.requesterTokenIdentifier || command.requestedBy.identity !== intent.requesterTokenIdentifier ||
      sourceVersion(payable) !== intent.sourceVersion || command.sourceVersion !== intent.sourceVersion ||
      intent.recipientAddress !== normalizeAddress(payable.recipientAddress) || intent.amountAtomic !== payable.amountAtomic ||
      command.bindingHash !== intent.bindingHash || paymentBinding(command) !== intent.bindingHash ||
      intent.network !== command.network || intent.tokenAddress !== command.tokenAddress ||
      intent.recipientAddress !== command.recipientAddress || intent.amountAtomic !== command.amountAtomic) {
      return refuse(ctx, principal, intent, "payment_approval", "proposal_binding_changed");
    }
    if (Date.now() >= intent.expiresAt) return refuse(ctx, principal, intent, "payment_approval", "proposal_expired");
    if (command.approvalId) {
      const previous = await ctx.db.get(command.approvalId);
      if (!previous || previous.status !== "approved" || previous.bindingHash !== intent.bindingHash || previous.expiresAt !== intent.expiresAt ||
        !["approved", "submitted", "pending", "reconciling", "confirmed", "finalized"].includes(command.status) ||
        !["approved", "submitted", "pending", "reconciling", "confirmed", "finalized"].includes(intent.status) ||
        previous.requestedBy.identity !== intent.requesterTokenIdentifier || previous.approverTokenIdentifier === intent.requesterTokenIdentifier ||
        previous.approverTokenIdentifier === demoToken("finance-agent")) {
        return refuse(ctx, principal, intent, "payment_approval", "approval_invalidated");
      }
      return { ok: true as const, approvalId: previous._id, paymentCommandId: command._id, replayed: true };
    }
    if (intent.status !== "proposed" || command.status !== "proposed" || payable.status !== "accrued" || command.attemptCount !== 0) {
      return refuse(ctx, principal, intent, "payment_approval", "payment_not_approvable");
    }
    const reviewReason = args.reason?.trim();
    if (args.reason !== undefined && (!reviewReason || args.reason.length > 2000)) return refuse(ctx, principal, intent, "payment_approval", "invalid_approval_reason");
    const now = Date.now();
    const approvalId = await ctx.db.insert("approvals", { organizationId: intent.organizationId, paymentCommandId: command._id,
      requestedBy: command.requestedBy, approverTokenIdentifier: principal.tokenIdentifier, bindingHash: intent.bindingHash,
      status: "approved", reason: servicePrincipal ? "Buyer-signed policy approved exact stored payout terms within the cap." : reviewReason ?? "Buyer review approved exact stored payout terms.", decidedAt: now, expiresAt: intent.expiresAt });
    await ctx.db.patch(command._id, { status: "approved", approvalId, updatedAt: now });
    await ctx.db.patch(intent._id, { status: "approved", updatedAt: now });
    await ctx.db.patch(payable._id, { status: "payout_in_progress" });
    const approvalWorkflowId = intent.approvalWorkflowId ?? await workflow.start(ctx, internal.approvalWorkflow.awaitController, { intentId: intent._id, bindingHash: intent.bindingHash });
    if (!intent.approvalWorkflowId) await ctx.db.patch(intent._id, { approvalWorkflowId });
    await workflow.sendEvent(ctx, { ...controllerApproved, workflowId: approvalWorkflowId,
      value: { approvalId, bindingHash: intent.bindingHash } });
    await audit(ctx, { organizationId: intent.organizationId, eventKey: `approved:${intent._id}`, actor: actorFor(principal),
      action: "payment_approved", entityType: "paymentIntents", entityId: intent._id,
      reason: reviewReason ?? "Independent approval recorded; wallet execution and chain reconciliation remain separate.", evidenceReferences: [approvalId, command._id] });
    await resolvePolicyReview(ctx, order._id, intent._id, principal.tokenIdentifier, "Payout approved with exact stored terms.");
    await ctx.scheduler.runAfter(0, makeFunctionReference<"mutation">("financeAnalystData:scanOrder"), { orderId: order._id });
    return { ok: true as const, approvalId, paymentCommandId: command._id, replayed: false };
}
export const approve = mutation({
  args: {demoIdentity: v.string(), intentId: v.id("paymentIntents"), reason: v.optional(v.string())},
  handler: (ctx, args) => approveFor(ctx, args),
});

/** Same finance-service proposal path used by the typed agent tools. */
export const proposeAccepted = internalMutation({
  args: { payableId: v.id("payables") },
  handler: (ctx, args) => proposeAgentPaymentFor(ctx, args),
});
export const reject = mutation({
  args: { demoIdentity: v.string(), intentId: v.id("paymentIntents"), reason: v.string() },
  handler: async (ctx, args) => {
    const principal = await requireRole(ctx, args.demoIdentity, ["buyer", "controller"]);
    if (principal.roles.includes("finance-agent")) throw new Error("agent_approval_refused");
    const intent = await ctx.db.get(args.intentId);
    if (!intent || intent.kind !== "contributor_payout") throw new Error("payout_not_found");
    const order = await ctx.db.get(intent.orderId);
    if (!order) throw new Error("order_not_found");
    requireBuyerOrder(principal, order);
    if (!args.reason.trim() || args.reason.length > 2000) throw new Error("invalid_rejection_reason");
    const command = await ctx.db.get(intent.paymentCommandId);
    if (!command || command.attemptCount || !["proposed", "cancelled"].includes(command.status)) throw new Error("payment_not_rejectable");
    await ctx.db.patch(intent._id, { status: "cancelled", updatedAt: Date.now() });
    await ctx.db.patch(command._id, { status: "cancelled", updatedAt: Date.now() });
    await audit(ctx, { organizationId: order.organizationId, eventKey: `payment_rejected:${intent._id}`, actor: actorFor(principal),
      action: "payment_rejected", entityType: "paymentIntents", entityId: intent._id, reason: args.reason.trim(), evidenceReferences: [command._id] });
    await resolvePolicyReview(ctx, order._id, intent._id, principal.tokenIdentifier, args.reason.trim());
    return { ok: true as const };
  },
});
