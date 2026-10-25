import { getStatus, type WorkflowId } from "@convex-dev/workflow";
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/chain";
import { internal, components } from "./_generated/api";
import { controllerApproved, workflow } from "./approvalWorkflow";
import { demoToken } from "./lib/demoAuth";
import { paymentBinding, sourceVersion } from "./lib/finance";
import schema from "./schema";

// Synthetic approved business records isolate the durable dispatch boundary.
// These tests perform no inference, wallet signing, RPC or onchain payment.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const RECIPIENT = `0x${"11".repeat(20)}`;
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

async function setup() {
  const t = convexTest(schema, modules);
  workflowTest.register(t);
  const seeded = await t.mutation(internal.seed.demo, {});
  const workflowId = "synthetic-workflow-not-a-live-run" as WorkflowId;
  const fields = await t.run(async (ctx) => {
    const now = Date.now();
    const submissionId = await ctx.db.insert("submissions", { organizationId: seeded.organizationId,
      orderId: seeded.orderId, taskVersionId: seeded.taskVersionId, contributorTokenIdentifier: demoToken("contributor"),
      status: "accepted", clientRequestId: "synthetic-dispatch-boundary", updatedAt: now });
    const decisionId = await ctx.db.insert("reviewDecisions", { organizationId: seeded.organizationId,
      submissionId, taskVersionId: seeded.taskVersionId, decisionKey: "synthetic-workflow-acceptance",
      decision: "accepted", reviewerTokenIdentifier: demoToken("controller"), reason: "Synthetic fixture, not inference",
      evidenceHash: "f".repeat(64), decidedAt: now });
    const payableId = await ctx.db.insert("payables", { organizationId: seeded.organizationId, orderId: seeded.orderId,
      submissionId, decisionId, network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS,
      contributorTokenIdentifier: demoToken("contributor"), recipientAddress: RECIPIENT, amountAtomic: 7_500_000n,
      sourceEventKey: `synthetic:fulfillment:${submissionId}`, status: "payout_in_progress", createdAt: now });
    const payable = (await ctx.db.get(payableId))!;
    const binding = { organizationId: seeded.organizationId, orderId: seeded.orderId, payableId,
      network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, recipientAddress: RECIPIENT, amountAtomic: payable.amountAtomic,
      requesterTokenIdentifier: demoToken("finance-agent"), sourceVersion: sourceVersion(payable) };
    const bindingHash = paymentBinding(binding);
    const requestedBy = { kind: "service" as const, identity: demoToken("finance-agent") };
    const paymentCommandId = await ctx.db.insert("paymentCommands", { ...binding, bindingHash,
      commandId: `payout:${payableId}`, kind: "contributor_payout", requestedBy,
      status: "approved", attemptCount: 0, leaseGeneration: 0, updatedAt: now });
    const approvalId = await ctx.db.insert("approvals", { organizationId: seeded.organizationId, paymentCommandId,
      requestedBy, approverTokenIdentifier: demoToken("controller"), bindingHash, status: "approved",
      reason: "Synthetic independent approval fixture", decidedAt: now, expiresAt: now + 3_600_000 });
    await ctx.db.patch(paymentCommandId, { approvalId });
    const intentId = await ctx.db.insert("paymentIntents", { ...binding, bindingHash,
      intentId: `payout:${payableId}`, kind: "contributor_payout", paymentCommandId, approvalWorkflowId: workflowId,
      status: "approved", expiresAt: now + 3_600_000, updatedAt: now });
    const controller = await ctx.db.query("memberships").withIndex("by_token_identifier", q => q.eq("tokenIdentifier", demoToken("controller"))).unique();
    const agent = await ctx.db.query("memberships").withIndex("by_token_identifier", q => q.eq("tokenIdentifier", demoToken("finance-agent"))).unique();
    return { intentId, paymentCommandId, approvalId, payableId, bindingHash, controllerId: controller!._id, agentId: agent!._id };
  });
  const args = { intentId: fields.intentId, approvalId: fields.approvalId, bindingHash: fields.bindingHash, workflowId };
  const outbox = () => t.run(ctx => ctx.db.query("outboxEvents").collect());
  return { t, ...seeded, ...fields, args, outbox };
}

describe("approved workflow dispatch boundary", () => {
  it("queues exactly one request and audit without creating a payment attempt or journal", async () => {
    const f = await setup();
    const first = await f.t.mutation(internal.approvalWorkflow.queueApprovedDispatch, f.args);
    const replay = await f.t.mutation(internal.approvalWorkflow.queueApprovedDispatch, f.args);
    expect(first.replayed).toBe(false);
    expect(replay).toEqual({ ...first, replayed: true });
    expect(await f.outbox()).toMatchObject([{ eventKey: `dispatch:${f.paymentCommandId}`, kind: "dispatch_settlement",
      paymentIntentId: f.intentId, paymentCommandId: f.paymentCommandId, status: "pending", attempt: 0 }]);
    const state = await f.t.run(async ctx => ({ attempts: await ctx.db.query("paymentAttempts").collect(),
      journals: await ctx.db.query("journalEntries").collect(), audits: await ctx.db.query("auditEvents").collect() }));
    expect(state.attempts).toHaveLength(0);
    expect(state.journals).toHaveLength(0);
    expect(state.audits.filter(event => event.action === "payment_dispatch_queued")).toHaveLength(1);
  });

  it.each(["workflow", "event-binding"])("rejects a mismatched %s", async kind => {
    const f = await setup();
    const args = kind === "workflow" ? { ...f.args, workflowId: "different-workflow" as WorkflowId }
      : { ...f.args, bindingHash: "e".repeat(64) };
    await expect(f.t.mutation(internal.approvalWorkflow.queueApprovedDispatch, args)).rejects.toThrow("approval_workflow_binding_changed");
    expect(await f.outbox()).toHaveLength(0);
  });

  it.each(["amount", "recipient", "command-binding", "approval-link"])("rejects changed %s before queueing", async kind => {
    const f = await setup();
    await f.t.run(async ctx => {
      if (kind === "amount") await ctx.db.patch(f.payableId, { amountAtomic: 8_000_000n });
      else if (kind === "recipient") await ctx.db.patch(f.payableId, { recipientAddress: `0x${"22".repeat(20)}` });
      else if (kind === "command-binding") await ctx.db.patch(f.paymentCommandId, { bindingHash: "a".repeat(64) });
      else await ctx.db.patch(f.paymentCommandId, { approvalId: undefined });
    });
    await expect(f.t.mutation(internal.approvalWorkflow.queueApprovedDispatch, f.args)).rejects.toThrow("approved_payout_binding_changed");
    expect(await f.outbox()).toHaveLength(0);
  });

  it.each(["inactive", "wrong-role", "agent-role", "conflicting-role"])("rejects a controller who became %s", async kind => {
    const f = await setup();
    await f.t.run(async ctx => {
      if (kind === "inactive") await ctx.db.patch(f.controllerId, { status: "revoked" });
      else await ctx.db.patch(f.controllerId, { roles: kind === "wrong-role" ? ["buyer"]
        : kind === "agent-role" ? ["controller", "finance-agent"] : ["controller", "contributor"] });
    });
    await expect(f.t.mutation(internal.approvalWorkflow.queueApprovedDispatch, f.args)).rejects.toThrow("independent_controller_required");
    expect(await f.outbox()).toHaveLength(0);
  });

  it("refuses the known agent even if misprovisioned as a controller", async () => {
    const f = await setup();
    await f.t.run(async ctx => {
      await ctx.db.patch(f.agentId, { roles: ["finance-agent", "controller"] });
      await ctx.db.patch(f.approvalId, { approverTokenIdentifier: demoToken("finance-agent") });
    });
    await expect(f.t.mutation(internal.approvalWorkflow.queueApprovedDispatch, f.args)).rejects.toThrow("independent_controller_required");
    expect(await f.outbox()).toHaveLength(0);
  });

  it.each(["expired-intent", "expiry-mismatch", "revoked", "cancelled-command", "attempted"])("refuses %s", async kind => {
    const f = await setup();
    await f.t.run(async ctx => {
      if (kind === "expired-intent") await ctx.db.patch(f.intentId, { expiresAt: Date.now() - 1 });
      else if (kind === "expiry-mismatch") await ctx.db.patch(f.approvalId, { expiresAt: Date.now() + 100 });
      else if (kind === "revoked") await ctx.db.patch(f.approvalId, { status: "revoked" });
      else if (kind === "cancelled-command") await ctx.db.patch(f.paymentCommandId, { status: "cancelled" });
      else await ctx.db.patch(f.paymentCommandId, { attemptCount: 1 });
    });
    await expect(f.t.mutation(internal.approvalWorkflow.queueApprovedDispatch, f.args)).rejects.toThrow(
      kind === "expired-intent" || kind === "expiry-mismatch" ? "approval_expired_or_invalid" : "payout_not_dispatchable");
    expect(await f.outbox()).toHaveLength(0);
  });

  it("checks the finance agent's current persisted role", async () => {
    const f = await setup();
    await f.t.run(ctx => ctx.db.patch(f.agentId, { roles: ["buyer"] }));
    await expect(f.t.mutation(internal.approvalWorkflow.queueApprovedDispatch, f.args)).rejects.toThrow("forbidden");
    expect(await f.outbox()).toHaveLength(0);
  });

  it("never reactivates an existing failed dispatch event", async () => {
    const f = await setup();
    const queued = await f.t.mutation(internal.approvalWorkflow.queueApprovedDispatch, f.args);
    await f.t.run(ctx => ctx.db.patch(queued.outboxEventId, { status: "failed" }));
    await expect(f.t.mutation(internal.approvalWorkflow.queueApprovedDispatch, f.args)).rejects.toThrow("dispatch_event_requires_reconciliation");
    expect(await f.outbox()).toMatchObject([{ status: "failed" }]);
  });
});

describe("durable approval event", () => {
  it.each([false, true])("waits for approval and resumes exactly once (early event: %s)", async early => {
    const f = await setup();
    const workflowId = await f.t.run(ctx => workflow.start(ctx, internal.approvalWorkflow.awaitController,
      { intentId: f.intentId, bindingHash: f.bindingHash }, { startAsync: true }));
    await f.t.run(ctx => ctx.db.patch(f.intentId, { approvalWorkflowId: workflowId }));
    if (!early) {
      await f.t.finishAllScheduledFunctions(vi.runAllTimers);
      expect((await f.t.run(ctx => getStatus(ctx, components.workflow, workflowId))).type).toBe("inProgress");
      expect(await f.outbox()).toHaveLength(0);
    }
    await f.t.run(ctx => workflow.sendEvent(ctx, { ...controllerApproved, workflowId,
      value: { approvalId: f.approvalId, bindingHash: f.bindingHash } }));
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await f.t.run(ctx => getStatus(ctx, components.workflow, workflowId))).type).toBe("completed");
    expect(await f.outbox()).toHaveLength(1);
  });
});
