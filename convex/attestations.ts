import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { canonical, digest } from "./lib/finance";
import { EAS_SCHEMA_UID, attestationLinks, attestationRequestId, buildAttestationFields } from "./lib/eas";

export const LEASE_MS = 3 * 60_000;
export const RETRY_MS = 2 * 60_000;
const runRef = makeFunctionReference<"action">("attestationsNode:run");
const pageRef = makeFunctionReference<"mutation", {cursor?: string}, {cursor: string | null; scheduled: number}>("attestations:enqueuePage");
const retryRef = makeFunctionReference<"mutation", Record<string, never>, number>("attestations:enqueueRetries");
const sweepRef = makeFunctionReference<"action", {cursor?: string}>("attestations:sweep");

/** Public by design: the same eight non-PII fields are already public on EAS.
 * This returns only the current analysis's confirmed attestation, never private report JSON.
 */
export const forSubmission = query({
  args: { submissionId: v.id("submissions") },
  handler: async (ctx, { submissionId }) => {
    const submission = await ctx.db.get(submissionId);
    if (!submission?.currentAnalysisId) return null;
    const row = await ctx.db.query("attestations").withIndex("by_analysis", q => q.eq("analysisId", submission.currentAnalysisId!)).unique();
    if (row?.status !== "confirmed" || !row.attestationUid || !row.txHash || !row.fields) return null;
    return { uid: row.attestationUid, txHash: row.txHash, ...attestationLinks(row.attestationUid, row.txHash), fields: row.fields };
  },
});

/** Bounded pagination means newer reports are not starved by older confirmed rows. */
export const enqueuePage = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("analysisResults").paginate({ cursor: args.cursor ?? null, numItems: 20 });
    let scheduled = 0;
    for (const analysis of page.page) {
      if (!analysis.reportJson) continue; // Legacy scaffold has no canonical report to commit to.
      const existing = await ctx.db.query("attestations").withIndex("by_analysis", q => q.eq("analysisId", analysis._id)).unique();
      if (!existing) { await ctx.scheduler.runAfter(0, runRef, { analysisId: analysis._id }); scheduled++; }
    }
    return { cursor: page.isDone ? null : page.continueCursor, scheduled };
  },
});
export const enqueueRetries = internalMutation({
  args: {},
  handler: async ctx => {
    let scheduled = 0;
    for (const status of ["pending", "submitted", "failed"] as const) {
      const rows = await ctx.db.query("attestations").withIndex("by_retry", q => q.eq("status", status).lte("nextRetryAt", Date.now())).take(20);
      for (const row of rows) {
        if (row.leaseUntil > Date.now()) continue;
        // Move the retry marker atomically to prevent repeated enqueue storms.
        await ctx.db.patch(row._id, { nextRetryAt: Date.now() + RETRY_MS });
        await ctx.scheduler.runAfter(0, runRef, { analysisId: row.analysisId }); scheduled++;
      }
    }
    return scheduled;
  },
});
export const sweep = internalAction({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{scheduled: number; more: boolean}> => {
    if (process.env.EAS_ATTESTATIONS_ENABLED !== "true") return { scheduled: 0, more: false };
    const retries = args.cursor ? 0 : await ctx.runMutation(retryRef, {});
    const page = await ctx.runMutation(pageRef, args);
    if (page.cursor) await ctx.scheduler.runAfter(1000, sweepRef, { cursor: page.cursor });
    return { scheduled: retries + page.scheduled, more: !!page.cursor };
  },
});

/** Durable intent and per-analysis serialization precede every external attempt. */
export const claim = internalMutation({
  args: { analysisId: v.id("analysisResults"), attestor: v.string() },
  handler: async (ctx, args): Promise<Doc<"attestations"> | null> => {
    const now = Date.now();
    if (!/^0x[0-9a-fA-F]{40}$/.test(args.attestor)) throw new Error("invalid_attestor");
    const existing = await ctx.db.query("attestations").withIndex("by_analysis", q => q.eq("analysisId", args.analysisId)).unique();
    if (existing && (existing.attestor.toLowerCase() !== args.attestor.toLowerCase())) throw new Error("attestor_changed");
    if (existing?.status === "confirmed" || (existing && existing.leaseUntil > now)) return null;
    if (existing?.fields) {
      await ctx.db.patch(existing._id, { generation: existing.generation + 1, leaseUntil: now + LEASE_MS, nextRetryAt: now + LEASE_MS, updatedAt: now });
      return (await ctx.db.get(existing._id))!;
    }
    const analysis = await ctx.db.get(args.analysisId);
    if (!analysis?.reportJson) return null;
    const id = existing?._id ?? await ctx.db.insert("attestations", { analysisId: analysis._id, submissionId: analysis.submissionId,
      schemaUid: EAS_SCHEMA_UID, attestor: args.attestor, requestId: attestationRequestId(`skarl-eas:${analysis._id}:${analysis.reportHash}`),
      status: "pending", generation: 0, leaseUntil: 0, nextRetryAt: now + RETRY_MS, createdAt: now, updatedAt: now });
    try {
      const submission = await ctx.db.get(analysis.submissionId), rubric = await ctx.db.get(analysis.taskVersionId);
      const consent = submission?.consentRecordId ? await ctx.db.get(submission.consentRecordId) : null;
      if (!submission || !rubric || rubric.frozenAt === undefined || submission.organizationId !== analysis.organizationId ||
        rubric.organizationId !== analysis.organizationId || submission.taskVersionId !== rubric._id) throw new Error("attestation_scope_mismatch");
      // Match the canonical bytes used by submissions.complete, not a new serialization convention.
      const parsed = JSON.parse(analysis.reportJson);
      if (canonical(parsed) !== analysis.reportJson || digest(parsed) !== analysis.reportHash) throw new Error("noncanonical_report");
      const licensed = submission.verificationOnly !== true && !!consent && consent.submissionId === submission._id &&
        consent.organizationId === submission.organizationId && consent.contributorTokenIdentifier === submission.contributorTokenIdentifier &&
        consent.licenseVersion === "demo-consent-v1" && consent.licenseHash === digest({licenseVersion: consent.licenseVersion, scope: consent.scope});
      const fields = buildAttestationFields({ ...analysis, rubricHash: rubric.contentHash, reportJson: analysis.reportJson, licensed });
      await ctx.db.patch(id, { fields, status: "pending", error: undefined, generation: (existing?.generation ?? 0) + 1,
        leaseUntil: now + LEASE_MS, nextRetryAt: now + LEASE_MS, updatedAt: now });
      return (await ctx.db.get(id))!;
    } catch {
      // Invalid legacy metadata must be visible/retryable without persisting parser or report text.
      await ctx.db.patch(id, { status: "failed", error: "attestation_report_invalid", leaseUntil: 0, nextRetryAt: now + RETRY_MS, updatedAt: now });
      return null;
    }
  },
});
const identity = { id: v.id("attestations"), generation: v.number() };
export const markSending = internalMutation({
  args: { ...identity, startBlock: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || row.generation !== args.generation || row.status === "confirmed") throw new Error("stale_attestation_attempt");
    if (!/^\d+$/.test(args.startBlock)) throw new Error("invalid_start_block");
    if (!row.firstSendAt) await ctx.db.patch(row._id, { firstSendAt: Date.now(), startBlock: args.startBlock, updatedAt: Date.now() });
  },
});
export const recordTransaction = internalMutation({
  args: { ...identity, txHash: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || row.generation !== args.generation || row.status === "confirmed") throw new Error("stale_attestation_attempt");
    if (!/^0x[a-fA-F0-9]{64}$/.test(args.txHash) || (row.txHash && row.txHash !== args.txHash)) throw new Error("attestation_transaction_conflict");
    await ctx.db.patch(row._id, { txHash: args.txHash, status: "submitted", updatedAt: Date.now() });
  },
});
export const finish = internalMutation({
  args: { ...identity, uid: v.optional(v.string()), txHash: v.optional(v.string()), logIndex: v.optional(v.number()), error: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || row.generation !== args.generation || row.status === "confirmed") return;
    const now = Date.now();
    if (args.error) {
      if (!/^[a-z_]{1,80}$/.test(args.error)) throw new Error("unsafe_attestation_error");
      await ctx.db.patch(row._id, { status: "failed", error: args.error, leaseUntil: 0, nextRetryAt: now + RETRY_MS, updatedAt: now });
    } else {
      if (!row.fields || !args.uid || !/^0x[a-fA-F0-9]{64}$/.test(args.uid) || !args.txHash || !/^0x[a-fA-F0-9]{64}$/.test(args.txHash) ||
        (row.txHash && row.txHash !== args.txHash) || !Number.isSafeInteger(args.logIndex) || args.logIndex! < 0) throw new Error("invalid_attestation_receipt");
      await ctx.db.patch(row._id, { status: "confirmed", attestationUid: args.uid, txHash: args.txHash, logIndex: args.logIndex,
        error: undefined, leaseUntil: 0, updatedAt: now });
    }
  },
});
/** Called only after the Node action verifies this exact receipt reverted with two confirmations.
 * An ambiguous timeout never calls this. Preserve the old attempt before creating a fresh CDP key.
 */
export const retryReverted = internalMutation({
  args: { ...identity, txHash: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || row.generation !== args.generation || row.status === "confirmed") return;
    if (row.txHash !== args.txHash) throw new Error("attestation_transaction_conflict");
    const attempt = (row.attempt ?? 0) + 1, now = Date.now();
    if (attempt > 3) {
      await ctx.db.patch(row._id, { status: "failed", error: "attestation_revert_limit", leaseUntil: 0, nextRetryAt: now + 60 * 60_000 });
      return;
    }
    await ctx.db.patch(row._id, { status: "failed", error: "attestation_transaction_reverted", attempt,
      previousAttempts: [...(row.previousAttempts ?? []), { txHash: args.txHash, requestId: row.requestId }],
      requestId: attestationRequestId(`skarl-eas:${row.analysisId}:${row.fields?.reportHash}:retry:${attempt}`),
      txHash: undefined, firstSendAt: undefined, startBlock: undefined, leaseUntil: 0, nextRetryAt: now + RETRY_MS, updatedAt: now });
  },
});
/** Operator-only audit/backfill inventory. No report text is returned. */
export const inventory = internalQuery({
  args: {},
  handler: async ctx => (await ctx.db.query("attestations").take(1000)).map(row => ({
    analysisId: row.analysisId, submissionId: row.submissionId, status: row.status, error: row.error,
    uid: row.attestationUid, txHash: row.txHash, fields: row.fields,
    ...(row.attestationUid && row.txHash ? attestationLinks(row.attestationUid, row.txHash) : {}),
  })),
});
