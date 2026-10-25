import { convexTest } from "convex-test";
import { makeFunctionReference, type FunctionArgs, type FunctionReturnType, type ApiFromModules } from "convex/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import schema from "../../../convex/schema";
import { internal, api } from "../../../convex/_generated/api";
import { digest } from "../../../convex/lib/finance";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "../../contracts/src/chain";
import type * as handlers from "../src/evidence-store";

// Synthetic reports/receipts/storage only. These transactional tests do not
// establish model inference, onchain settlement, or rights in any real video.
const modules = {
  "./_generated/server.ts": () => import("../../../convex/_generated/server"),
  "./seed.ts": () => import("../../../convex/seed"),
  "./payments.ts": () => import("../../../convex/payments"),
  "./evidenceSales.ts": () => import("../src/evidence-store"),
};
type EvidenceApi = ApiFromModules<{ evidenceSales: typeof handlers }>["evidenceSales"];
const sample = makeFunctionReference<"query", FunctionArgs<EvidenceApi["sample"]>, FunctionReturnType<EvidenceApi["sample"]>>("evidenceSales:sample");
const claim = makeFunctionReference<"mutation", FunctionArgs<EvidenceApi["claim"]>, FunctionReturnType<EvidenceApi["claim"]>>("evidenceSales:claim");
const sale = makeFunctionReference<"query", FunctionArgs<EvidenceApi["sale"]>, FunctionReturnType<EvidenceApi["sale"]>>("evidenceSales:sale");
const confirm = makeFunctionReference<"mutation", FunctionArgs<EvidenceApi["confirm"]>, FunctionReturnType<EvidenceApi["confirm"]>>("evidenceSales:confirm");
const SERVICE = "synthetic-only-evidence-service-secret-not-a-credential";
const PAYER = `0x${"11".repeat(20)}`, TREASURY = `0x${"22".repeat(20)}`;
const NONCE = `0x${"aa".repeat(32)}`, HASH = `0x${"bb".repeat(32)}`;
beforeEach(() => vi.stubEnv("SKARL_PAYMENTS_SERVICE_SECRET", SERVICE));
afterEach(() => vi.unstubAllEnvs());

async function setup() {
  const t = convexTest(schema, modules);
  const seed = await t.mutation(internal.seed.demo, {});
  const data = await t.run(async ctx => {
    const now = Date.now(), sourceHash = "a".repeat(64);
    const submissionId = await ctx.db.insert("submissions", { organizationId: seed.organizationId, orderId: seed.orderId,
      taskVersionId: seed.taskVersionId, contributorTokenIdentifier: "demo:skarl:contributor", status: "accepted",
      clientRequestId: "synthetic-evidence", sourceHash, updatedAt: now });
    const storageId = await ctx.storage.store(new Blob(["synthetic media"], { type: "video/mp4" }));
    const originalAssetId = await ctx.db.insert("mediaAssets", { organizationId: seed.organizationId, submissionId,
      storageId, purpose: "original", status: "verified", contentHash: sourceHash, mimeType: "video/mp4", sizeBytes: 15, durationMs: 4000 });
    const consentRecordId = await ctx.db.insert("consentRecords", { organizationId: seed.organizationId, submissionId,
      contributorTokenIdentifier: "demo:skarl:contributor", licenseVersion: "demo-consent-v1", licenseHash: "c".repeat(64),
      scope: "Synthetic test demonstration only", acknowledgedAt: now, receiptHash: "d".repeat(64) });
    const jobId = await ctx.db.insert("jobs", { organizationId: seed.organizationId, submissionId, taskVersionId: seed.taskVersionId,
      sourceHash, pipelineVersion: "synthetic", status: "completed", availableAt: now, attempt: 1, maxAttempts: 1, leaseGeneration: 1 });
    const report = { schemaVersion: "1.0", reportId: "synthetic-report", submissionId, taskVersionId: seed.taskVersionId,
      source: { sha256: sourceHash, durationMs: 4000 }, pipeline: { version: "synthetic", status: "completed", implementation: "inference",
        modelRuns: [{ provider: "synthetic", model: "fixture", promptVersion: "synthetic" }] },
      criteria: [{ criterionId: "red-cup-pickup", status: "supported", evidence: [{ modality: "video", startMs: 0, endMs: 1000, claim: "Synthetic fixture" }], reason: "Synthetic fixture" }],
      duplicate: { status: "clear", matches: [] }, recommendation: "needs_review", warnings: ["Synthetic fixture; no inference was run."] };
    const reportStorageId = await ctx.storage.store(new Blob([JSON.stringify(report)], { type: "application/json" }));
    const analysisId = await ctx.db.insert("analysisResults", { organizationId: seed.organizationId, jobId, submissionId,
      taskVersionId: seed.taskVersionId, sourceHash, pipelineVersion: "synthetic", leaseGeneration: 1,
      summary: "Synthetic evidence", reportStorageId, reportHash: digest(report), reportJson: JSON.stringify(report), evidenceAssetIds: [originalAssetId],
      completedAt: now, implementation: "inference", pipelineStatus: "completed", recommendation: "needs_review" });
    const decisionId = await ctx.db.insert("reviewDecisions", { organizationId: seed.organizationId, submissionId,
      analysisResultId: analysisId, taskVersionId: seed.taskVersionId, decisionKey: "synthetic-accepted", decision: "accepted",
      reviewerTokenIdentifier: "demo:skarl:controller", reason: "Synthetic acceptance", evidenceHash: digest(report), decidedAt: now });
    const manifest = { schemaVersion: "1.0" as const, originalAssetId, sourceHash, taskVersionId: seed.taskVersionId,
      consentRecordId, licenseVersion: "demo-consent-v1", decisionId, analysisResultId: analysisId };
    const order = (await ctx.db.get(seed.orderId))!;
    const deliveryId = await ctx.db.insert("deliveries", { organizationId: seed.organizationId, orderId: seed.orderId, submissionId,
      decisionId, manifest, manifestHash: digest(manifest), termsHash: order.termsHash, eventKey: `synthetic:${submissionId}`, publishedAt: now });
    await ctx.db.patch(submissionId, { originalAssetId, consentRecordId, currentAnalysisId: analysisId, currentDecisionId: decisionId });
    return { submissionId, originalAssetId, consentRecordId, analysisId, deliveryId, report, order };
  });
  const sampleId = `sample-${data.submissionId}`;
  const authorization = { serviceSecret: SERVICE, sampleId, payerAddress: PAYER, recipientAddress: TREASURY,
    authorizationNonce: NONCE, amountAtomic: 250_000n, validBefore: Date.now() + 300_000, facilitator: "cdp" as const };
  const observation = { network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, txHash: HASH, logIndex: 1,
    blockNumber: 100n, blockHash: `0x${"dd".repeat(32)}`, fromAddress: PAYER, toAddress: TREASURY,
    amountAtomic: 250_000n, confirmations: 2, succeeded: true, observedAt: Date.now() };
  return { t, ...seed, ...data, sampleId, authorization, observation };
}

describe("evidence sales transactional boundary", () => {
  it("requires the private service secret even for sample and sale lookup", async () => {
    const f = await setup();
    for (const serviceSecret of ["", "bad", "x".repeat(SERVICE.length)]) {
      await expect(f.t.query(sample, { serviceSecret, sampleId: f.sampleId })).rejects.toThrow("payment_service_unauthorized");
      await expect(f.t.query(sale, { serviceSecret, sampleId: f.sampleId, payerAddress: PAYER, authorizationNonce: NONCE })).rejects.toThrow("payment_service_unauthorized");
      await expect(f.t.mutation(claim, { ...f.authorization, serviceSecret })).rejects.toThrow("payment_service_unauthorized");
    }
  });

  it("returns only licensed, accepted, delivered and source-bound completed evidence", async () => {
    const f = await setup();
    const result = await f.t.query(sample, { serviceSecret: SERVICE, sampleId: f.sampleId });
    expect(result.report).toEqual(f.report);
    expect(result.storageUrl).toMatch(/^https?:/);
    expect(result.binding).toMatch(/^[a-f0-9]{64}$/);
    await f.t.run(ctx => ctx.db.patch(f.submissionId, { status: "rejected" }));
    await expect(f.t.query(sample, { serviceSecret: SERVICE, sampleId: f.sampleId })).rejects.toThrow("sample_not_available");
    await expect(f.t.mutation(claim, f.authorization)).rejects.toThrow("sample_not_available");
    await f.t.run(ctx => ctx.db.patch(f.submissionId, { status: "accepted", verificationOnly: true }));
    await expect(f.t.query(sample, { serviceSecret: SERVICE, sampleId: f.sampleId })).rejects.toThrow("sample_not_available");
    await f.t.run(ctx => ctx.db.patch(f.submissionId, { verificationOnly: false }));
    await f.t.run(ctx => ctx.db.patch(f.originalAssetId, { status: "quarantined" }));
    await expect(f.t.query(sample, { serviceSecret: SERVICE, sampleId: f.sampleId })).rejects.toThrow("sample_not_available");
  });

  it("refuses incomplete, swapped or changed report/manifest/consent bindings", async () => {
    for (const field of ["report", "manifest", "consent", "incomplete", "scaffold"] as const) {
      const f = await setup();
      await f.t.run(async ctx => {
        if (field === "report") await ctx.db.patch(f.analysisId, { reportJson: JSON.stringify({ ...f.report, source: { sha256: "b".repeat(64) } }) });
        if (field === "manifest") await ctx.db.patch(f.deliveryId, { manifestHash: "b".repeat(64) });
        if (field === "consent") await ctx.db.patch(f.consentRecordId, { licenseVersion: "verification-only-v1" });
        if (field === "incomplete") await ctx.db.patch(f.analysisId, { pipelineStatus: "needs_review" });
        if (field === "scaffold") await ctx.db.patch(f.analysisId, { implementation: "scaffold" });
      });
      await expect(f.t.query(sample, { serviceSecret: SERVICE, sampleId: f.sampleId })).rejects.toThrow("sample_not_available");
    }
  });

  it("does not expose cross-organization or disabled-organization samples", async () => {
    const f = await setup();
    const foreign = await f.t.run(ctx => ctx.db.insert("organizations", { name: "Synthetic other tenant",
      status: "active", createdByTokenIdentifier: "synthetic-other-controller" }));
    await f.t.run(ctx => ctx.db.patch(f.originalAssetId, { organizationId: foreign }));
    await expect(f.t.query(sample, { serviceSecret: SERVICE, sampleId: f.sampleId })).rejects.toThrow("sample_not_available");
    await f.t.run(ctx => ctx.db.patch(f.originalAssetId, { organizationId: f.organizationId }));
    await f.t.run(ctx => ctx.db.patch(f.organizationId, { status: "disabled" }));
    await expect(f.t.query(sample, { serviceSecret: SERVICE, sampleId: f.sampleId })).rejects.toThrow("sample_not_available");
  });

  it("claims once before settlement and binds nonce to sample, recipient and expiry", async () => {
    const f = await setup();
    const first = await f.t.mutation(claim, f.authorization);
    expect(first.replayed).toBe(false);
    expect(await f.t.mutation(claim, f.authorization)).toEqual({ ...first, replayed: true });
    for (const changed of [{ sampleId: "sample-other" }, { recipientAddress: `0x${"33".repeat(20)}` }, { validBefore: f.authorization.validBefore + 1 }]) {
      await expect(f.t.mutation(claim, { ...f.authorization, ...changed })).rejects.toThrow("authorization_already_claimed");
    }
    await expect(f.t.mutation(claim, { ...f.authorization, amountAtomic: 1n })).rejects.toThrow("quote_changed");
    const recorded = await f.t.query(sale, { serviceSecret: SERVICE, sampleId: f.sampleId, payerAddress: PAYER, authorizationNonce: NONCE });
    expect(recorded?.attempt.status).toBe("prepared");
    expect(recorded?.terms).toMatchObject({ facilitator: "cdp", binding: first.binding, amountAtomic: "250000" });
    expect(await f.t.run(ctx => ctx.db.query("journalEntries").collect())).toHaveLength(0);
    expect(await f.t.run(ctx => ctx.db.query("paymentAttempts").collect())).toHaveLength(1);
  });

  it("shares nonce deduplication with the existing whole-order funding path", async () => {
    const f = await setup();
    await f.t.mutation(api.payments.recordFundingAttempt, { serviceSecret: SERVICE, demoIdentity: "buyer", orderId: f.orderId,
      payerAddress: PAYER, recipientAddress: TREASURY, authorizationNonce: NONCE, amountAtomic: f.order.budgetAtomic, validBefore: Date.now() + 60_000 });
    await expect(f.t.mutation(claim, f.authorization)).rejects.toThrow("evidence_sale_not_found");
    const other = await setup();
    await other.t.mutation(claim, other.authorization);
    await expect(other.t.mutation(api.payments.recordFundingAttempt, { serviceSecret: SERVICE, demoIdentity: "buyer", orderId: other.orderId,
      payerAddress: PAYER, recipientAddress: TREASURY, authorizationNonce: NONCE, amountAtomic: other.order.budgetAtomic, validBefore: Date.now() + 60_000 }))
      .rejects.toThrow("authorization_already_claimed");
  });

  it("posts one balanced funding-like inflow after receipt checks without altering order/payables", async () => {
    const f = await setup();
    const attempt = await f.t.mutation(claim, f.authorization);
    const args = { serviceSecret: SERVICE, attemptId: attempt.attemptId, authorizationNonce: NONCE, observation: f.observation };
    for (const changed of [{ amountAtomic: 1n }, { toAddress: PAYER }, { confirmations: 1 }, { network: "eip155:8453" }, { succeeded: false }]) {
      await expect(f.t.mutation(confirm, { ...args, observation: { ...f.observation, ...changed } })).rejects.toThrow();
    }
    expect(await f.t.run(ctx => ctx.db.query("journalEntries").collect())).toHaveLength(0);
    await f.t.mutation(api.payments.recordTransaction, { serviceSecret: SERVICE, attemptId: attempt.attemptId, txHash: HASH });
    const first = await f.t.mutation(confirm, args);
    const replay = await f.t.mutation(confirm, args);
    expect(first.replayed).toBe(false);
    expect(replay).toMatchObject({ observationId: first.observationId, replayed: true });
    const state = await f.t.run(async ctx => ({ order: await ctx.db.get(f.orderId), journals: await ctx.db.query("journalEntries").collect(),
      lines: await ctx.db.query("journalLines").collect(), observations: await ctx.db.query("chainObservations").collect(),
      payables: await ctx.db.query("payables").collect(), intents: await ctx.db.query("paymentIntents").collect() }));
    expect(state.order).toEqual(f.order);
    expect(state.payables).toHaveLength(0);
    expect(state.intents).toHaveLength(0);
    expect(state.journals).toHaveLength(1);
    expect(state.journals[0]).toMatchObject({ kind: "funding", sourceReference: `${PAYMENT_NETWORK}:${HASH}:1` });
    expect(state.lines.map(line => [line.account, line.side, line.amountAtomic])).toEqual([
      ["asset:usdc", "debit", 250_000n], ["liability:customer_prepayments", "credit", 250_000n] ]);
    expect(state.observations).toHaveLength(1);
    const second = await f.t.mutation(claim, { ...f.authorization, authorizationNonce: `0x${"cc".repeat(32)}` });
    await expect(f.t.mutation(confirm, { ...args, attemptId: second.attemptId, authorizationNonce: `0x${"cc".repeat(32)}` }))
      .rejects.toThrow("transfer_already_claimed_or_changed");
  });

  it("still records actual received money if media is quarantined after claim, without releasing media", async () => {
    const f = await setup();
    const attempt = await f.t.mutation(claim, f.authorization);
    await f.t.run(ctx => ctx.db.patch(f.originalAssetId, { status: "quarantined" }));
    expect((await f.t.mutation(confirm, { serviceSecret: SERVICE, attemptId: attempt.attemptId, authorizationNonce: NONCE, observation: f.observation })).replayed).toBe(false);
    await expect(f.t.query(sample, { serviceSecret: SERVICE, sampleId: f.sampleId })).rejects.toThrow("sample_not_available");
  });
});
