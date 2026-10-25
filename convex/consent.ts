import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireRole } from "./lib/demoAuth";
import { actorFor, audit, requireTenant } from "./lib/finance";

/** A request records contributor intent; it does not pretend to delete a delivered copy. */
export const requestRevocation = mutation({
  args: { demoIdentity: v.string(), submissionId: v.id("submissions"), reason: v.string() },
  handler: async (ctx, args) => {
    const principal = await requireRole(ctx, args.demoIdentity, "contributor");
    const submission = await ctx.db.get(args.submissionId);
    if (!submission) throw new Error("submission_not_found");
    requireTenant(principal, submission);
    if (submission.contributorTokenIdentifier !== principal.tokenIdentifier) throw new Error("submission_not_owned");
    const reason = args.reason.trim();
    if (!reason || reason.length > 1000) throw new Error("invalid_revocation_reason");
    const consent = submission.consentRecordId ? await ctx.db.get(submission.consentRecordId) : null;
    if (!consent) throw new Error("consent_not_found");
    if (consent.organizationId !== submission.organizationId || consent.submissionId !== submission._id ||
      consent.contributorTokenIdentifier !== principal.tokenIdentifier) throw new Error("consent_reference_mismatch");
    // The first request is authoritative. Retries cannot rewrite its reason or timestamp.
    if (consent.revocationStatus) return { consentRecordId: consent._id, status: consent.revocationStatus,
      requestedAt: consent.revocationRequestedAt ?? null, replayed: true };
    const requestedAt = Date.now();
    await ctx.db.patch(consent._id, { revocationStatus: "requested", revocationRequestedAt: requestedAt, revocationReason: reason });
    await audit(ctx, { organizationId: submission.organizationId, eventKey: `consent_revocation_requested:${consent._id}`,
      actor: actorFor(principal), action: "consent_revocation_requested", entityType: "submissions", entityId: submission._id,
      reason, evidenceReferences: [consent._id] });
    return { consentRecordId: consent._id, status: "requested" as const, requestedAt, replayed: false };
  },
});

/** Controller exceptions-like inbox. Reasons stay out of buyer-facing provenance. */
export const revocationRequests = query({
  args: { demoIdentity: v.string(), orderId: v.optional(v.id("orders")) },
  handler: async (ctx, args) => {
    const principal = await requireRole(ctx, args.demoIdentity, "controller");
    if (args.orderId) {
      const order = await ctx.db.get(args.orderId);
      if (!order) throw new Error("order_not_found");
      requireTenant(principal, order);
    }
    const records = await ctx.db.query("consentRecords").withIndex("by_org_revocation", q =>
      q.eq("organizationId", principal.organizationId).eq("revocationStatus", "requested")).collect();
    const items = await Promise.all(records.map(async record => {
      const submission = await ctx.db.get(record.submissionId);
      if (!submission || submission.organizationId !== principal.organizationId || submission.consentRecordId !== record._id ||
        submission.contributorTokenIdentifier !== record.contributorTokenIdentifier ||
        (args.orderId && submission.orderId !== args.orderId)) return null;
      return { consentRecordId: record._id, submissionId: submission._id, orderId: submission.orderId,
        status: record.revocationStatus!, requestedAt: record.revocationRequestedAt ?? null, reason: record.revocationReason ?? null };
    }));
    return items.filter(item => item !== null).sort((a, b) => (b.requestedAt ?? 0) - (a.requestedAt ?? 0));
  },
});
