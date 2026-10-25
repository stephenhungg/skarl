import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/chain";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const request = makeFunctionReference<"mutation">("consent:requestRevocation");
const queue = makeFunctionReference<"query">("consent:revocationRequests");
const CONTRIBUTOR = "demo:skarl:contributor";

async function setup() {
  const t = convexTest(schema, modules), seeded = await t.mutation(internal.seed.demo, {});
  const sample = await t.run(async ctx => {
    const now = Date.now();
    const submissionId = await ctx.db.insert("submissions", { organizationId: seeded.organizationId,
      orderId: seeded.orderId, taskVersionId: seeded.taskVersionId, contributorTokenIdentifier: CONTRIBUTOR,
      status: "accepted", clientRequestId: "synthetic-consent", updatedAt: now });
    const consentRecordId = await ctx.db.insert("consentRecords", { organizationId: seeded.organizationId, submissionId,
      contributorTokenIdentifier: CONTRIBUTOR, licenseVersion: "demo-consent-v1", licenseHash: "f".repeat(64),
      scope: "Synthetic test license", acknowledgedAt: now, receiptHash: "d".repeat(64) });
    await ctx.db.patch(submissionId, { consentRecordId });
    const decisionId = await ctx.db.insert("reviewDecisions", { organizationId: seeded.organizationId, submissionId,
      taskVersionId: seeded.taskVersionId, decisionKey: "synthetic:accepted", decision: "accepted",
      reviewerTokenIdentifier: "demo:skarl:controller", reason: "Synthetic acceptance", evidenceHash: "a".repeat(64), decidedAt: now });
    await ctx.db.insert("payables", { organizationId: seeded.organizationId, orderId: seeded.orderId, submissionId, decisionId,
      network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, contributorTokenIdentifier: CONTRIBUTOR,
      recipientAddress: `0x${"1".repeat(40)}`, amountAtomic: 7500000n, sourceEventKey: `fulfillment:${submissionId}`, status: "accrued", createdAt: now });
    const journalEntryId = await ctx.db.insert("journalEntries", { organizationId: seeded.organizationId, orderId: seeded.orderId,
      network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, eventKey: `fulfillment:${submissionId}`, kind: "fulfillment",
      status: "posted", memo: "Synthetic earned obligation; no real delivery", sourceReference: submissionId, effectiveAt: now, recordedAt: now });
    await ctx.db.insert("journalLines", { organizationId: seeded.organizationId, journalEntryId,
      account: "expense:contributor_acquisition", side: "debit", amountAtomic: 7500000n, lineNumber: 0 });
    await ctx.db.insert("journalLines", { organizationId: seeded.organizationId, journalEntryId,
      account: "liability:contributor_payables", side: "credit", amountAtomic: 7500000n, lineNumber: 1 });
    return { submissionId, consentRecordId };
  });
  return { t, ...seeded, ...sample };
}

describe("consent withdrawal requests (synthetic)", () => {
  it("records one durable intent and audit while preserving already earned compensation and posted books", async () => {
    const f = await setup(), args = { demoIdentity: "contributor", submissionId: f.submissionId, reason: "  Stop future use, please.  " };
    const financialSnapshot = () => f.t.run(async ctx => ({ payables: await ctx.db.query("payables").collect(),
      journals: await ctx.db.query("journalEntries").collect(), lines: await ctx.db.query("journalLines").collect(),
      attempts: await ctx.db.query("paymentAttempts").collect(), observations: await ctx.db.query("chainObservations").collect() }));
    const before = await financialSnapshot();
    const result = await f.t.mutation(request, args);
    expect(result).toMatchObject({ consentRecordId: f.consentRecordId, status: "requested", replayed: false });
    expect(await f.t.mutation(request, { ...args, reason: "A retry must not overwrite the first reason" }))
      .toEqual({ ...result, replayed: true });
    const consent = await f.t.run(ctx => ctx.db.get(f.consentRecordId));
    expect(consent).toMatchObject({ revocationStatus: "requested", revocationRequestedAt: result.requestedAt,
      revocationReason: "Stop future use, please." });
    const events = await f.t.run(ctx => ctx.db.query("auditEvents").collect());
    expect(events.filter(event => event.action === "consent_revocation_requested")).toMatchObject([{
      entityType: "submissions", entityId: f.submissionId, reason: "Stop future use, please.", evidenceReferences: [f.consentRecordId] }]);
    expect(await financialSnapshot(), "Withdrawal cannot erase an earned debt or falsify immutable accounting history").toEqual(before);
    expect(await f.t.query(queue, { demoIdentity: "controller", orderId: f.orderId })).toEqual([{
      consentRecordId: f.consentRecordId, submissionId: f.submissionId, orderId: f.orderId,
      status: "requested", requestedAt: result.requestedAt, reason: "Stop future use, please." }]);
  });

  it("requires the owning contributor and a real bounded reason before creating a request", async () => {
    const f = await setup(), args = { demoIdentity: "contributor", submissionId: f.submissionId, reason: "Stop use" };
    for (const demoIdentity of ["buyer", "controller", "finance-agent"]) {
      await expect(f.t.mutation(request, { ...args, demoIdentity })).rejects.toThrow();
    }
    for (const reason of ["  ", "x".repeat(1001)]) {
      await expect(f.t.mutation(request, { ...args, reason })).rejects.toThrow("invalid_revocation_reason");
    }
    await f.t.run(ctx => ctx.db.patch(f.submissionId, { contributorTokenIdentifier: "synthetic:other" }));
    await expect(f.t.mutation(request, args)).rejects.toThrow("submission_not_owned");
    expect(await f.t.query(queue, { demoIdentity: "controller" })).toEqual([]);
    expect((await f.t.run(ctx => ctx.db.query("auditEvents").collect())).filter(event => event.action === "consent_revocation_requested"))
      .toHaveLength(0);
  });

  it("does not mutate a foreign consent record even when a local submission points at it", async () => {
    const f = await setup();
    const foreign = await f.t.run(ctx => ctx.db.insert("organizations", { name: "Synthetic foreign", status: "active",
      createdByTokenIdentifier: "synthetic:foreign" }));
    await f.t.run(ctx => ctx.db.patch(f.consentRecordId, { organizationId: foreign }));
    await expect(f.t.mutation(request, { demoIdentity: "contributor", submissionId: f.submissionId, reason: "Stop use" }))
      .rejects.toThrow("consent_reference_mismatch");
    expect((await f.t.run(ctx => ctx.db.get(f.consentRecordId)))?.revocationStatus).toBeUndefined();
    await f.t.run(ctx => ctx.db.patch(f.submissionId, { organizationId: foreign }));
    await expect(f.t.mutation(request, { demoIdentity: "contributor", submissionId: f.submissionId, reason: "Stop use" }))
      .rejects.toThrow("cross_organization_access");
  });

  it("limits the private exception inbox to the controller and checks the requested order's tenant", async () => {
    const f = await setup();
    await f.t.mutation(request, { demoIdentity: "contributor", submissionId: f.submissionId, reason: "Private reason" });
    for (const demoIdentity of ["buyer", "contributor", "finance-agent"]) {
      await expect(f.t.query(queue, { demoIdentity })).rejects.toThrow();
    }
    const foreign = await f.t.run(ctx => ctx.db.insert("organizations", { name: "Synthetic foreign", status: "active",
      createdByTokenIdentifier: "synthetic:foreign" }));
    await f.t.run(ctx => ctx.db.patch(f.orderId, { organizationId: foreign }));
    await expect(f.t.query(queue, { demoIdentity: "controller", orderId: f.orderId })).rejects.toThrow("cross_organization_access");
  });

  it("never downgrades a completed revocation back to requested on replay", async () => {
    const f = await setup();
    await f.t.run(ctx => ctx.db.patch(f.consentRecordId, { revocationStatus: "revoked", revokedAt: Date.now() }));
    expect(await f.t.mutation(request, { demoIdentity: "contributor", submissionId: f.submissionId, reason: "Retry" }))
      .toMatchObject({ status: "revoked", replayed: true });
    expect(await f.t.query(queue, { demoIdentity: "controller" })).toEqual([]);
  });
});
