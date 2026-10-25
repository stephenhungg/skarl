import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { audit, digest } from "./finance";
import { POLICY_TOKEN } from "./demoAuth";

export type PolicyException = { code: "policy_review"; eventKey: string; orderId: string;
  submissionId?: string; intentId?: string; failures: string[]; detail: string; message: string };

/** Reuse the existing exceptions/dispositions store, preserving exact failing checks. */
export async function queuePolicyReview(ctx: MutationCtx, input: { organizationId: Id<"organizations">;
  orderId: Id<"orders">; submissionId?: Id<"submissions">; intentId?: Id<"paymentIntents">; failures: string[] }) {
  const entityId = input.intentId ?? input.submissionId!;
  const exception: PolicyException = { code: "policy_review", eventKey: `policy:${entityId}`, orderId: input.orderId,
    ...(input.submissionId ? { submissionId: input.submissionId } : {}), ...(input.intentId ? { intentId: input.intentId } : {}),
    failures: [...new Set(input.failures)], detail: input.failures.join(", "), message: input.failures.join(", ") };
  const exceptionKey = digest(exception);
  const prior = await ctx.db.query("reconciliationDispositions").withIndex("by_exception", q =>
    q.eq("organizationId", input.organizationId).eq("orderId", input.orderId).eq("exceptionKey", exceptionKey)).unique();
  if (!prior) await ctx.db.insert("reconciliationDispositions", { organizationId: input.organizationId, orderId: input.orderId,
    exceptionKey, snapshotJson: JSON.stringify(exception), status: "acknowledged", reason: exception.message,
    actorTokenIdentifier: POLICY_TOKEN, updatedAt: Date.now() });
  if (input.submissionId) {
    const submission = await ctx.db.get(input.submissionId);
    if (submission && submission.status !== "accepted" && submission.status !== "rejected") await ctx.db.patch(submission._id, { status: "needs_review", updatedAt: Date.now() });
  }
  await audit(ctx, { organizationId: input.organizationId, eventKey: `policy_review:${entityId}:${exceptionKey}`,
    actor: { kind: "service", identity: POLICY_TOKEN }, action: "policy_review_required",
    entityType: input.intentId ? "paymentIntents" : "submissions", entityId, reason: exception.message,
    evidenceReferences: [exceptionKey, input.orderId] });
  return { ok: false as const, code: input.failures[0]!, failures: exception.failures };
}

export async function resolvePolicyReview(ctx: MutationCtx, orderId: Id<"orders">, entityId: string, actor: string, reason: string) {
  const rows = await ctx.db.query("reconciliationDispositions").withIndex("by_order", q => q.eq("orderId", orderId)).collect();
  for (const row of rows) {
    const snapshot = JSON.parse(row.snapshotJson);
    if (snapshot.code === "policy_review" && (snapshot.submissionId === entityId || snapshot.intentId === entityId) && row.status !== "resolved") {
      await ctx.db.patch(row._id, { status: "resolved", actorTokenIdentifier: actor, reason, updatedAt: Date.now() });
    }
  }
}
