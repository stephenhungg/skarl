import { makeFunctionReference, type ApiFromModules } from "convex/server";
import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type * as bankWitness from "./bankWitness";
import type * as attestationsApi from "./attestations";
import { financeScope, orderRows } from "./lib/dashboardRead";
import { isFinanceAgent } from "./lib/demoAuth";
import { requireBuyerOrder } from "./lib/finance";
import { paymentRail, PAYMENT_NETWORK, SOLANA_PAYMENT_NETWORK } from "../packages/contracts/src/chain";
import { validateTransfer } from "../packages/payments/src/reconciliation";
import { walletEvidence, juryEvidence, toolRefusals } from "./lib/proofEvidence";
import crons from "./crons";
import http from "./http";

const orderArgs = { demoIdentity: v.string(), orderId: v.id("orders") };
const memberArgs = { demoIdentity: v.string() };
type Scope = { demoIdentity: string; orderId: Id<"orders"> };
type EvidenceApi = ApiFromModules<{ bankWitness: typeof bankWitness; attestations: typeof attestationsApi }>;
const bankRef = makeFunctionReference("bankWitness:reconciliation4Way") as EvidenceApi["bankWitness"]["reconciliation4Way"];
const bankExceptionsRef = makeFunctionReference("bankWitness:bankExceptions") as EvidenceApi["bankWitness"]["bankExceptions"];
const attestationRef = makeFunctionReference("attestations:forSubmission") as EvidenceApi["attestations"]["forSubmission"];

/** Proof's requested owning-buyer boundary remains narrower than the shared
 * organization's dashboard authority. Do not expose another buyer's evidence
 * when that shared helper gains new operational privileges.
 */
async function proofScope(ctx: QueryCtx, demoIdentity: string, orderId?: Id<"orders">) {
  const scope = await financeScope(ctx, demoIdentity, orderId);
  const broad = scope.principal.roles.includes("controller") || isFinanceAgent(scope.principal);
  const orders = scope.orders.filter(order => broad || order.buyerTokenIdentifier === scope.principal.tokenIdentifier);
  if (orderId && !orders.length) throw new Error("order_not_owned");
  return { ...scope, orders, orderIds: new Set(orders.map(order => order._id)) };
}
async function scopedOrder(ctx: QueryCtx, args: Scope) {
  const scope = await proofScope(ctx, args.demoIdentity, args.orderId);
  return { ...scope, order: scope.orders[0]! };
}
async function bankModel(ctx: QueryCtx, args: Scope) {
  await scopedOrder(ctx, args);
  const [reconciliation, exceptions] = await Promise.all([
    ctx.runQuery(bankRef, args), ctx.runQuery(bankExceptionsRef, args),
  ]);
  return { ...reconciliation, label: "Mock bank (Capital One Nessie)", bankExceptions: exceptions,
    missing: !reconciliation.rows.length ? "No funding or payout intent yet" :
      !reconciliation.bankAvailable ? "A fresh Nessie bank snapshot is required" : null };
}
export const bank4Way = query({ args: orderArgs, handler: bankModel });

export const agentWallet = query({ args: memberArgs, handler: async (ctx, args) => {
  await proofScope(ctx, args.demoIdentity);
  return walletEvidence();
} });

async function paymentEvidence(ctx: QueryCtx, intent: Doc<"paymentIntents">) {
  const attempts = await ctx.db.query("paymentAttempts").withIndex("by_intent", q => q.eq("paymentIntentId", intent._id)).collect();
  const rows = await Promise.all(attempts.map(async attempt => {
    if (attempt.organizationId !== intent.organizationId || attempt.network !== intent.network ||
      attempt.tokenAddress !== intent.tokenAddress || attempt.amountAtomic !== intent.amountAtomic ||
      (intent.kind === "contributor_payout" && attempt.paymentCommandId !== intent.paymentCommandId)) throw new Error("payment_reference_mismatch");
    const observations = await ctx.db.query("chainObservations").withIndex("by_attempt", q => q.eq("paymentAttemptId", attempt._id)).collect();
    if (observations.some(row => row.organizationId !== intent.organizationId)) throw new Error("cross_organization_reference");
    return { attempt, observations: observations.map(row => {
      let agrees = false;
      try {
        validateTransfer(row, { network: intent.network, amountAtomic: intent.amountAtomic, toAddress: intent.recipientAddress,
          fromAddress: intent.kind === "contributor_payout" ? attempt.payerAddress ?? "" : intent.buyerWalletAddress });
        agrees = !attempt.txHash || (intent.network === PAYMENT_NETWORK
          ? attempt.txHash.toLowerCase() === row.txHash.toLowerCase() : attempt.txHash === row.txHash);
      } catch { /* A stored discrepancy is evidence, never proof of payment. */ }
      return { id: row._id, txHash: row.txHash, logIndex: row.logIndex, network: row.network,
        explorerUrl: paymentRail(row.network).explorerTx(row.txHash), amountAtomic: row.amountAtomic.toString(),
        observedAt: row.observedAt, confirmations: row.confirmations, succeeded: row.succeeded, agrees };
    }) };
  }));
  return rows;
}

async function payoutsModel(ctx: QueryCtx, args: Scope) {
  const { order } = await scopedOrder(ctx, args);
  const intents = await ctx.db.query("paymentIntents").withIndex("by_order", q => q.eq("orderId", order._id)).collect();
  const rows = [];
  for (const intent of intents) {
    if (intent.organizationId !== order.organizationId) throw new Error("cross_organization_reference");
    if (intent.kind !== "contributor_payout") continue;
    const [payable, command] = await Promise.all([ctx.db.get(intent.payableId), ctx.db.get(intent.paymentCommandId)]);
    if (!payable || !command || payable.organizationId !== order.organizationId || command.organizationId !== order.organizationId ||
      payable.orderId !== order._id || command.orderId !== order._id || command.payableId !== payable._id ||
      payable.amountAtomic !== intent.amountAtomic || command.amountAtomic !== intent.amountAtomic ||
      payable.recipientAddress.toLowerCase() !== intent.recipientAddress.toLowerCase() || command.recipientAddress.toLowerCase() !== intent.recipientAddress.toLowerCase()) throw new Error("payment_reference_mismatch");
    const evidence = await paymentEvidence(ctx, intent);
    const observations = evidence.flatMap(row => row.observations);
    // Even a confirmed status needs one exact, successful, sufficiently confirmed transfer.
    const chainObserved = observations.length === 1 && observations[0]!.agrees;
    const attempts = evidence.map(({ attempt, observations }) => ({ id: attempt._id, status: attempt.status,
      txHash: attempt.txHash ?? null, explorerUrl: attempt.txHash ? paymentRail(attempt.network).explorerTx(attempt.txHash) : null,
      createdAt: attempt.createdAt, updatedAt: attempt.updatedAt, observations }));
    // claimPayout stores no historical executor. Today's flag and the sender
    // address cannot establish which signing path produced an old attempt.
    const executor = null;
    rows.push({ intentId: intent._id, amountAtomic: intent.amountAtomic.toString(), network: intent.network,
      label: "Base Sepolia", simulated: order.publicId.startsWith("scenario:"), storedStatus: intent.status,
      status: chainObserved && intent.status === "confirmed" ? "paid" : intent.status === "confirmed" ? "requires_reconciliation" : intent.status,
      chainObserved, executor, executorMissing: "Payout attempts do not persist the historical executor",
      txHash: observations[0]?.txHash ?? attempts.find(row => row.txHash)?.txHash ?? null,
      explorerUrl: observations[0]?.explorerUrl ?? attempts.find(row => row.explorerUrl)?.explorerUrl ?? null,
      attempts, missing: chainObserved ? null : "An exact confirmed chain transfer is required" });
  }
  return { rows, missing: rows.length ? null : "No contributor payout proposal yet" };
}
export const payouts = query({ args: orderArgs, handler: payoutsModel });

async function fundingModel(ctx: QueryCtx, args: Scope) {
  const { order } = await scopedOrder(ctx, args);
  const intents = await ctx.db.query("paymentIntents").withIndex("by_order", q => q.eq("orderId", order._id)).collect();
  const rows = [];
  for (const intent of intents) {
    if (intent.organizationId !== order.organizationId) throw new Error("cross_organization_reference");
    if (intent.kind === "contributor_payout") continue;
    const evidence = await paymentEvidence(ctx, intent);
    const receipts = intent.network === PAYMENT_NETWORK ? await ctx.db.query("cdpWebhookReceipts").withIndex("by_treasury", q =>
      q.eq("organizationId", order.organizationId).eq("treasury", intent.recipientAddress.toLowerCase())).collect() : [];
    const observations = evidence.flatMap(row => row.observations);
    // Match the complete transfer identity and terms, never all receipts in a shared treasury.
    const webhooks = receipts.filter(receipt => (observations.some(row => row.txHash.toLowerCase() === receipt.txHash.toLowerCase() &&
      row.logIndex === receipt.logIndex) || evidence.some(row => row.attempt.txHash?.toLowerCase() === receipt.txHash.toLowerCase())) && receipt.fromAddress.toLowerCase() === intent.buyerWalletAddress.toLowerCase() &&
      receipt.toAddress.toLowerCase() === intent.recipientAddress.toLowerCase() && receipt.amountAtomic === intent.amountAtomic.toString());
    const signed = evidence.find(row => row.attempt.authorizationNonce);
    const steps = [
      { stage: "402", timestamp: null, evidence: [], missing: "HTTP 402 challenge issuance is not persisted" },
      { stage: "signed", timestamp: signed?.attempt.createdAt ?? null,
        evidence: signed ? [signed.attempt._id] : [], missing: signed ? null : "No durable signed-payment claim yet" },
      // recordTransaction.updatedAt is overwritten by reconciliation; do not invent a settlement timestamp.
      { stage: "settled", timestamp: null, evidence: evidence.flatMap(row => row.attempt.txHash ? [paymentRail(intent.network).explorerTx(row.attempt.txHash)] : []),
        missing: "Facilitator settlement receipt and timestamp are not persisted; a transaction hash alone is insufficient" },
      { stage: "webhook", timestamp: webhooks.length ? Math.min(...webhooks.map(row => row.receivedAt)) : null,
        evidence: webhooks.map(row => row._id), missing: webhooks.length ? null : intent.network === PAYMENT_NETWORK ? "No matching CDP webhook receipt" : "CDP webhooks do not cover Solana Devnet" },
      { stage: "chain", timestamp: observations.length ? Math.min(...observations.map(row => row.observedAt)) : null,
        evidence: observations.map(row => row.explorerUrl), missing: observations.some(row => row.agrees) ? null : "No exact confirmed chain observation yet" },
    ];
    rows.push({ intentId: intent._id, network: intent.network, label: intent.network === PAYMENT_NETWORK ? "Base Sepolia" : "Solana Devnet",
      amountAtomic: intent.amountAtomic.toString(), status: intent.status, simulated: order.publicId.startsWith("scenario:"), steps, observations,
      webhooks: webhooks.map(row => ({ id: row._id, status: row.status, receivedAt: row.receivedAt, txHash: row.txHash, logIndex: row.logIndex })) });
  }
  return { rows, missing: rows.length ? null : "No signed funding attempt yet" };
}
export const fundingTimeline = query({ args: orderArgs, handler: fundingModel });

async function attestationsModel(ctx: QueryCtx, args: Scope) {
  const { order } = await scopedOrder(ctx, args);
  const submissions = await ctx.db.query("submissions").withIndex("by_order_status", q => q.eq("orderId", order._id)).collect();
  const rows = await Promise.all(submissions.map(async submission => {
    if (submission.organizationId !== order.organizationId) throw new Error("cross_organization_reference");
    if (submission.currentAnalysisId) {
      const analysis = await ctx.db.get(submission.currentAnalysisId);
      if (!analysis || analysis.organizationId !== order.organizationId || analysis.submissionId !== submission._id ||
        analysis.sourceHash !== submission.sourceHash || analysis.taskVersionId !== submission.taskVersionId) throw new Error("analysis_reference_mismatch");
    }
    const attestation = await ctx.runQuery(attestationRef, { submissionId: submission._id });
    return { submissionId: submission._id, attestation, missing: attestation ? null : "No confirmed EAS attestation for the current analysis" };
  }));
  return { rows, missing: rows.length ? null : "No submission yet" };
}
export const attestations = query({ args: orderArgs, handler: attestationsModel });

async function solanaLicensesModel(ctx: QueryCtx, args: Scope) {
  const { order } = await scopedOrder(ctx, args);
  const rail = paymentRail(SOLANA_PAYMENT_NETWORK);
  const rows = (await ctx.db.query("solanaLicenses").withIndex("by_order", q => q.eq("orderId", order._id)).collect()).map(row => {
    if (row.organizationId !== order.organizationId) throw new Error("cross_organization_reference");
    return { submissionId: row.submissionId, deliveryId: row.deliveryId, status: row.status, licenseDigest: row.licenseDigest,
      standard: "Token-2022 (MetadataPointer + TokenMetadata, supply 1, mint authority revoked)", network: row.network,
      mintAddress: row.mintAddress ?? null, holderAddress: row.holderAddress ?? null, testnetOnly: true as const,
      tokenUrl: row.mintAddress ? rail.explorerAddress(row.mintAddress) : null,
      transactionUrl: row.signature ? rail.explorerTx(row.signature) : null, lastError: row.lastError ?? null };
  });
  return { rows, missing: rows.some(row => row.status === "minted") ? null : rows.length ? "No confirmed license mint yet" : "No published delivery yet" };
}
export const solanaLicenses = query({ args: orderArgs, handler: solanaLicensesModel });

async function guardModel(ctx: QueryCtx, demoIdentity: string) {
  const scope = await proofScope(ctx, demoIdentity);
  const exceptions = (await Promise.all(scope.orders.map(order => ctx.db.query("scheduledCheckpoints")
    .withIndex("by_order", q => q.eq("orderId", order._id)).collect()))).flat().filter(row => row.kind === "reconciliation");
  let feedExceptionCount = 0;
  for (const row of exceptions) {
    if (row.organizationId !== scope.principal.organizationId) throw new Error("cross_organization_reference");
    const payload: unknown = row.payloadJson ? JSON.parse(row.payloadJson) : [];
    if (Array.isArray(payload)) feedExceptionCount += payload.length;
  }
  return { projectUrl: "https://one-atlas-hmeq.atlassian.net/jira/software/projects/SKARL/boards", projectKey: "SKARL",
    note: "Agents cannot approve payments. Jira actions cannot grant financial authority.",
    feedExceptionCount: feedExceptionCount.toString(), feedExceptionSource: "scheduled reconciliation snapshots (eligible for feed; not confirmed Jira mirrors)",
    mirroredExceptionCount: null, lastSyncAt: null, uncertainWrites: null,
    missing: "Jira mirror receipts, last-sync and uncertain-write audit live in Forge KVS, not Convex" };
}
export const guard = query({ args: memberArgs, handler: (ctx, args) => guardModel(ctx, args.demoIdentity) });

async function featuresModel(ctx: QueryCtx, demoIdentity: string) {
  const scope = await proofScope(ctx, demoIdentity);
  const data = await orderRows(ctx, scope.orders);
  const checkpoints = await ctx.db.query("scheduledCheckpoints").withIndex("by_key", q => q.eq("organizationId", scope.principal.organizationId)).collect();
  const visible = checkpoints.filter(row => row.orderId ? scope.orderIds.has(row.orderId) : !scope.principal.roles.includes("buyer"));
  const runs = visible.map(row => ({ key: row.key, kind: row.kind, status: row.status, updatedAt: row.updatedAt,
    nextAt: row.nextAt, lastErrorCode: row.lastErrorCode ?? null }));
  const registeredCrons = Object.entries(crons.crons).map(([name, entry]) => {
    // Health wrappers invoke the same jobs; preserve their tenant-scoped checkpoint evidence.
    const key = ["scheduledJobs:reconcile", "healthJobs:reconcile"].includes(entry.name) ? "job:reconciliation" :
      ["scheduledJobs:finance", "healthJobs:finance"].includes(entry.name) ? "job:finance" : null;
    const checkpoint = key ? runs.find(row => row.key === key) : null;
    return { name, function: entry.name, schedule: entry.schedule, lastRunAt: checkpoint?.updatedAt ?? null,
      lastStatus: checkpoint?.status ?? null, missing: checkpoint ? null : "No visible scheduledData checkpoint for this cron" };
  });
  const media = (await Promise.all(data.submissions.map(submission => ctx.db.query("mediaAssets")
    .withIndex("by_submission_purpose", q => q.eq("submissionId", submission._id)).collect()))).flat();
  if (media.some(row => row.organizationId !== scope.principal.organizationId)) throw new Error("cross_organization_reference");
  return { registrationEvidence: "Functions and routes registered in this running source version; execution evidence is separate",
    workflow: { function: "approvalWorkflow:awaitController", component: "workflow", approvalWaitCount: data.intents.filter(row => row.kind === "contributor_payout" && row.approvalWorkflowId).length.toString(),
      missing: data.intents.some(row => row.kind === "contributor_payout" && row.approvalWorkflowId) ? null : "No stored approval Workflow yet" },
    crons: registeredCrons, scheduler: { runs, lastRunAt: runs.length ? Math.max(...runs.map(row => row.updatedAt)) : null,
      missing: runs.length ? null : "No visible scheduledData checkpoint yet" },
    storage: { assetCount: media.length.toString(), missing: media.length ? null : "No stored media asset yet" },
    nodeActions: ["verify:run", "financeAgent:run", "agentWallet:execute", "attestationsNode:run"],
    httpActions: http.getRoutes().map(([path, method]) => ({ path, method })),
    missing: null };
}
export const convexFeatures = query({ args: memberArgs, handler: (ctx, args) => featuresModel(ctx, args.demoIdentity) });

async function juryModel(ctx: QueryCtx, demoIdentity: string, submissionId: Id<"submissions">) {
  const submission = await ctx.db.get(submissionId);
  if (!submission) throw new Error("submission_not_found");
  const scope = await scopedOrder(ctx, { demoIdentity, orderId: submission.orderId });
  requireBuyerOrder(scope.principal, scope.order);
  if (submission.organizationId !== scope.order.organizationId) throw new Error("cross_organization_reference");
  const analysis = submission.currentAnalysisId ? await ctx.db.get(submission.currentAnalysisId) : null;
  return juryEvidence(submission, analysis);
}
export const jury = query({ args: { ...memberArgs, submissionId: v.id("submissions") },
  handler: (ctx, args) => juryModel(ctx, args.demoIdentity, args.submissionId) });

async function agentRunsModel(ctx: QueryCtx, args: Scope) {
  const scope = await scopedOrder(ctx, args), data = await orderRows(ctx, scope.orders);
  const commands = await Promise.all(data.intents.filter(row => row.kind === "contributor_payout").map(row => ctx.db.get(row.paymentCommandId)));
  if (commands.some(row => !row || row.organizationId !== scope.order.organizationId || row.orderId !== scope.order._id)) throw new Error("payment_reference_mismatch");
  const entities = new Set<string>([scope.order._id, ...data.submissions.map(row => row._id), ...data.payables.map(row => row._id),
    ...data.intents.map(row => row._id), ...data.runs.map(row => row._id), ...commands.flatMap(row => row ? [row._id] : [])]);
  const events = (await ctx.db.query("auditEvents").withIndex("by_org_time", q => q.eq("organizationId", scope.order.organizationId)).collect())
    .filter(row => entities.has(row.entityId));
  const refusalEvents = events.filter(row => row.action.endsWith("_refused")).map(row => ({ id: row._id, action: row.action,
    reason: row.reason, occurredAt: row.occurredAt, actor: row.actor, evidenceReferences: row.evidenceReferences }));
  const approvals = (await Promise.all(commands.flatMap(command => command?.approvalId ? [ctx.db.get(command.approvalId)] : [])))
    .flatMap(row => {
      if (!row) return [];
      const command = commands.find(command => command?._id === row.paymentCommandId);
      if (row.organizationId !== scope.order.organizationId || !command || command.approvalId !== row._id ||
        command.bindingHash !== row.bindingHash || command.requesterTokenIdentifier !== row.requestedBy.identity) throw new Error("approval_reference_mismatch");
      return [{ id: row._id, status: row.status, reason: row.reason, decidedAt: row.decidedAt,
        approver: row.approverTokenIdentifier, policyEngine: row.approverTokenIdentifier === "service:skarl:policy-engine" }];
    });
  const rows = data.runs.sort((a, b) => b.startedAt - a.startedAt).map(run => ({ id: run._id, provider: run.provider ?? "gemini", model: run.model,
    badge: `${run.provider ?? "gemini"} / ${run.model}`, status: run.status, startedAt: run.startedAt, completedAt: run.completedAt ?? null,
    proposedAtomic: run.proposedAtomic.toString(), explanation: run.explanation ?? null, toolRefusals: toolRefusals(run.transcriptJson) }));
  return { rows, refusalEvents, approvals, simulated: scope.order.publicId.startsWith("scenario:"),
    refusalMissing: refusalEvents.length || rows.some(row => row.toolRefusals.length) ? null : "No recorded refusal event yet",
    policyApprovalMissing: approvals.some(row => row.policyEngine && row.status === "approved") ? null : "No stored policy-engine approval yet",
    missing: rows.length ? null : "No finance-agent run yet" };
}
export const agentRuns = query({ args: orderArgs, handler: agentRunsModel });

export const summary = query({ args: orderArgs, handler: async (ctx, args) => {
  const { order } = await scopedOrder(ctx, args);
  const submissions = await ctx.db.query("submissions").withIndex("by_order_status", q => q.eq("orderId", args.orderId)).collect();
  const [bank4Way, payouts, fundingTimeline, attestations, guard, convexFeatures, agentRuns, juries, solanaLicenses] = await Promise.all([
    bankModel(ctx, args), payoutsModel(ctx, args), fundingModel(ctx, args), attestationsModel(ctx, args),
    guardModel(ctx, args.demoIdentity), featuresModel(ctx, args.demoIdentity), agentRunsModel(ctx, args),
    Promise.all(submissions.map(row => juryModel(ctx, args.demoIdentity, row._id))), solanaLicensesModel(ctx, args),
  ]);
  return { orderId: order._id, simulated: order.publicId.startsWith("scenario:"), bank4Way, agentWallet: walletEvidence(), payouts,
    fundingTimeline, attestations, guard, convexFeatures, agentRuns, jury: { rows: juries, missing: juries.length ? null : "No submission yet" }, solanaLicenses };
} });
