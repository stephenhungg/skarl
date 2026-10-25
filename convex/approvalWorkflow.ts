import { defineEvent, vWorkflowId, WorkflowManager } from "@convex-dev/workflow";
import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { MAX_ATOMIC_USDC, PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/index";
import { components, internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { demoToken } from "./lib/demoAuth";
import { requireFinanceService } from "./lib/serviceAuth";
import { actorFor, audit, normalizeAddress, paymentBinding, sourceVersion, isOrderApprover } from "./lib/finance";

export const workflow = new WorkflowManager(components.workflow);

/** A wake-up signal; payment authority comes from the persisted approval. */
export const controllerApproved = defineEvent({
  name: "controllerApproved",
  validator: v.object({ approvalId: v.id("approvals"), bindingHash: v.string() }),
});

export const awaitController = workflow.define({
  args: { intentId: v.id("paymentIntents"), bindingHash: v.string() },
  returns: v.null(),
}).handler(async (step, args): Promise<null> => {
  const approval = await step.awaitEvent(controllerApproved);
  if (approval.bindingHash !== args.bindingHash) throw new Error("approval_event_binding_changed");
  await step.runMutation(internal.approvalWorkflow.queueApprovedDispatch, {
    ...args, approvalId: approval.approvalId, workflowId: step.workflowId,
  });
  return null;
});

/** Releases a wallet-execution request. This function never signs or sends money. */
export const queueApprovedDispatch = internalMutation({
  args: { intentId: v.id("paymentIntents"), bindingHash: v.string(), approvalId: v.id("approvals"), workflowId: vWorkflowId },
  handler: async (ctx, args) => {
    const agent = await requireFinanceService(ctx);
    const intent = await ctx.db.get(args.intentId);
    if (!intent || intent.kind !== "contributor_payout" || intent.organizationId !== agent.organizationId) {
      throw new Error("payout_intent_not_found");
    }
    if (intent.approvalWorkflowId !== args.workflowId || intent.bindingHash !== args.bindingHash) {
      throw new Error("approval_workflow_binding_changed");
    }
    const command = await ctx.db.get(intent.paymentCommandId);
    const payable = await ctx.db.get(intent.payableId);
    const approval = await ctx.db.get(args.approvalId);
    if (!command || !payable || !approval || command.kind !== "contributor_payout" ||
      command.organizationId !== intent.organizationId || payable.organizationId !== intent.organizationId || approval.organizationId !== intent.organizationId ||
      command.payableId !== payable._id || command.orderId !== intent.orderId || payable.orderId !== intent.orderId ||
      command.approvalId !== approval._id || approval.paymentCommandId !== command._id ||
      command.requesterTokenIdentifier !== intent.requesterTokenIdentifier || command.requestedBy.identity !== intent.requesterTokenIdentifier ||
      approval.requestedBy.identity !== intent.requesterTokenIdentifier || approval.requestedBy.kind !== command.requestedBy.kind ||
      approval.bindingHash !== intent.bindingHash || command.bindingHash !== intent.bindingHash ||
      paymentBinding(command) !== intent.bindingHash || paymentBinding(intent) !== intent.bindingHash ||
      sourceVersion(payable) !== intent.sourceVersion || command.sourceVersion !== intent.sourceVersion ||
      intent.recipientAddress !== normalizeAddress(payable.recipientAddress) || command.recipientAddress !== intent.recipientAddress ||
      intent.amountAtomic !== payable.amountAtomic || command.amountAtomic !== intent.amountAtomic || intent.amountAtomic <= 0n || intent.amountAtomic > MAX_ATOMIC_USDC ||
      intent.network !== PAYMENT_NETWORK || command.network !== PAYMENT_NETWORK || payable.network !== PAYMENT_NETWORK ||
      intent.tokenAddress !== USDC_ADDRESS || command.tokenAddress !== USDC_ADDRESS || payable.tokenAddress !== USDC_ADDRESS) {
      throw new Error("approved_payout_binding_changed");
    }
    const now = Date.now();
    if (intent.expiresAt <= now || approval.expiresAt <= now || approval.expiresAt !== intent.expiresAt || approval.decidedAt > now) {
      throw new Error("approval_expired_or_invalid");
    }
    if (approval.status !== "approved" || intent.status !== "approved" || command.status !== "approved" ||
      payable.status !== "payout_in_progress" || command.attemptCount !== 0) {
      throw new Error("payout_not_dispatchable");
    }
    if (approval.approverTokenIdentifier === intent.requesterTokenIdentifier || approval.approverTokenIdentifier === demoToken("finance-agent")) {
      throw new Error("independent_controller_required");
    }
    const approver = await ctx.db.query("memberships").withIndex("by_token_identifier", (q) =>
      q.eq("tokenIdentifier", approval.approverTokenIdentifier)).unique();
    const order = await ctx.db.get(intent.orderId);
    if (!order || !isOrderApprover(approver, order)) {
      throw new Error("independent_controller_required");
    }

    const eventKey = `dispatch:${command._id}`;
    const existing = await ctx.db.query("outboxEvents").withIndex("by_event_key", (q) =>
      q.eq("organizationId", intent.organizationId).eq("eventKey", eventKey)).unique();
    if (existing) {
      if (existing.kind !== "dispatch_settlement" || existing.orderId !== intent.orderId ||
        existing.paymentCommandId !== command._id || existing.paymentIntentId !== intent._id) {
        throw new Error("dispatch_event_conflict");
      }
      if (existing.status === "failed") throw new Error("dispatch_event_requires_reconciliation");
      return { outboxEventId: existing._id, replayed: true };
    }
    const outboxEventId = await ctx.db.insert("outboxEvents", { organizationId: intent.organizationId, eventKey,
      kind: "dispatch_settlement", orderId: intent.orderId, paymentCommandId: command._id, paymentIntentId: intent._id,
      status: "pending", availableAt: now, attempt: 0, leaseGeneration: 0 });
    await audit(ctx, { organizationId: intent.organizationId, eventKey: `dispatch_queued:${command._id}`, actor: actorFor(agent),
      action: "payment_dispatch_queued", entityType: "paymentIntents", entityId: intent._id,
      reason: "Durable workflow released the independently approved payout for wallet execution; no money sent.",
      evidenceReferences: [args.workflowId, approval._id, command._id, outboxEventId] });
    if (process.env.PAYOUT_EXECUTOR === "cdp_agent" && !order.publicId.startsWith("scenario:")) {
      await ctx.scheduler.runAfter(0, makeFunctionReference<"action", { intentId: typeof intent._id }>("agentWallet:execute"), { intentId: intent._id });
    }
    return { outboxEventId, replayed: false };
  },
});
