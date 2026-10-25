import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { canonical, digest, paymentBinding, sourceVersion } from "./lib/finance";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/chain";
import schema from "./schema";

// Isolated synthetic storage/report/ledger records; no inference or chain transfer.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const forOrder = makeFunctionReference<"query">("datasets:forOrder");
const CONTRIBUTOR = "demo:skarl:contributor";
const RECIPIENT = "0x1111111111111111111111111111111111111111";

async function setup() {
  const t = convexTest(schema, modules);
  const seeded = await t.mutation(internal.seed.demo, {});
  return { t, ...seeded };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function delivered(f: Fixture, key = "sample", human = false) {
  return f.t.run(async ctx => {
    const now = Date.now(), sourceHash = digest(key);
    const rubric = (await ctx.db.get(f.taskVersionId))!;
    const order = (await ctx.db.get(f.orderId))!;
    const submissionId = await ctx.db.insert("submissions", { organizationId: f.organizationId,
      orderId: f.orderId, taskVersionId: f.taskVersionId, contributorTokenIdentifier: CONTRIBUTOR,
      status: "accepted", clientRequestId: key, sourceHash, updatedAt: now });
    const storageId = await ctx.storage.store(new Blob(["synthetic original"], { type: "video/mp4" }));
    const originalAssetId = await ctx.db.insert("mediaAssets", { organizationId: f.organizationId, submissionId,
      storageId, purpose: "original", status: "verified", contentHash: sourceHash, mimeType: "video/mp4", sizeBytes: 18, durationMs: 12000 });
    const licenseVersion = "demo-consent-v1", scope = "Synthetic robotics research license";
    const consentRecordId = await ctx.db.insert("consentRecords", { organizationId: f.organizationId, submissionId,
      contributorTokenIdentifier: CONTRIBUTOR, licenseVersion, scope, licenseHash: digest({ licenseVersion, scope }),
      acknowledgedAt: now, receiptHash: digest({ submissionId, licenseVersion, scope }) });
    const jobId = await ctx.db.insert("jobs", { organizationId: f.organizationId, submissionId, taskVersionId: f.taskVersionId,
      sourceHash, pipelineVersion: "red-cup-evidence-1.2", status: "completed", availableAt: now, attempt: 1, maxAttempts: 1, leaseGeneration: 1 });
    const report = { schemaVersion: "1.0", reportId: `fixture:${key}`, submissionId, taskVersionId: f.taskVersionId,
      source: { sha256: sourceHash, durationMs: 12000 },
      pipeline: { version: "red-cup-evidence-1.2", status: "completed", implementation: "inference",
        modelRuns: [{ provider: "synthetic", model: "fixture", promptVersion: "fixture-v1" }] },
      criteria: rubric.criteria.map(c => ({ criterionId: c.criterionId, status: "supported", reason: "Synthetic finding",
        evidence: [{ modality: "video", startMs: 1000, endMs: 2000, claim: "Synthetic observation" }] })),
      duplicate: { status: "clear", matches: [] }, recommendation: "accept", warnings: [] };
    const reportJson = canonical(report), reportHash = digest(report);
    const reportStorageId = await ctx.storage.store(new Blob([reportJson], { type: "application/json" }));
    const analysisId = await ctx.db.insert("analysisResults", { organizationId: f.organizationId, submissionId, jobId,
      taskVersionId: f.taskVersionId, sourceHash, pipelineVersion: "red-cup-evidence-1.2", leaseGeneration: 1,
      summary: "Synthetic completed projection", reportStorageId, reportJson, reportHash, evidenceAssetIds: [originalAssetId], completedAt: now,
      implementation: "inference", pipelineStatus: "completed", recommendation: "accept",
      observationsJson: JSON.stringify({ audio: { transcript: "red cup", segments: [{ startMs: 1000, endMs: 2000, text: "red cup" }], claims: [] } }) });
    const decisionId = await ctx.db.insert("reviewDecisions", { organizationId: f.organizationId, submissionId,
      analysisResultId: analysisId, taskVersionId: f.taskVersionId, decisionKey: human ? `human:${digest(key)}` : `accept:${submissionId}`,
      decision: "accepted", reviewerTokenIdentifier: "demo:skarl:controller", reason: "Synthetic controller acceptance",
      ...(human ? { reasonCode: "fixture_review", note: "Synthetic manual review" } : {}), evidenceHash: reportHash, decidedAt: now });
    await ctx.db.patch(submissionId, { originalAssetId, consentRecordId, currentAnalysisId: analysisId, currentDecisionId: decisionId });
    const manifest = { schemaVersion: "1.0" as const, originalAssetId, sourceHash, taskVersionId: f.taskVersionId,
      consentRecordId, licenseVersion, decisionId, analysisResultId: analysisId };
    const deliveryId = await ctx.db.insert("deliveries", { organizationId: f.organizationId, orderId: f.orderId,
      submissionId, decisionId, manifest, manifestHash: digest(manifest), termsHash: order.termsHash,
      eventKey: `fulfillment:${submissionId}`, publishedAt: now });
    const payableId = await ctx.db.insert("payables", { organizationId: f.organizationId, network: PAYMENT_NETWORK,
      tokenAddress: USDC_ADDRESS, orderId: f.orderId, submissionId, decisionId, contributorTokenIdentifier: CONTRIBUTOR,
      recipientAddress: RECIPIENT, amountAtomic: 9007199254740993n, sourceEventKey: `fulfillment:${submissionId}`, status: "accrued", createdAt: now });
    return { submissionId, originalAssetId, consentRecordId, analysisId, decisionId, deliveryId, payableId, sourceHash, now };
  });
}
async function paidEvidence(f: Fixture, sample: Awaited<ReturnType<typeof delivered>>) {
  return f.t.run(async ctx => {
    const payable = (await ctx.db.get(sample.payableId))!;
    const payerAddress = "0x2222222222222222222222222222222222222222", txHash = `0x${"a".repeat(64)}`;
    const binding = { organizationId: f.organizationId, orderId: f.orderId, payableId: sample.payableId,
      network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, amountAtomic: payable.amountAtomic, recipientAddress: RECIPIENT,
      requesterTokenIdentifier: "demo:skarl:finance-agent", sourceVersion: sourceVersion(payable) };
    const commandId = await ctx.db.insert("paymentCommands", { ...binding, commandId: `fixture-payout:${sample.payableId}`,
      kind: "contributor_payout", requestedBy: { kind: "service", identity: "demo:skarl:finance-agent" },
      bindingHash: paymentBinding(binding), status: "confirmed", attemptCount: 1, leaseGeneration: 1, updatedAt: sample.now });
    const attemptId = await ctx.db.insert("paymentAttempts", { organizationId: f.organizationId, network: PAYMENT_NETWORK,
      tokenAddress: USDC_ADDRESS, paymentCommandId: commandId, attemptId: `fixture-attempt:${commandId}`, attempt: 1,
      amountAtomic: payable.amountAtomic, txHash, payerAddress, status: "confirmed", createdAt: sample.now, updatedAt: sample.now });
    const observationId = await ctx.db.insert("chainObservations", { organizationId: f.organizationId, network: PAYMENT_NETWORK,
      tokenAddress: USDC_ADDRESS, paymentAttemptId: attemptId, txHash, logIndex: 3, blockNumber: 123n,
      blockHash: `0x${"b".repeat(64)}`, fromAddress: payerAddress, toAddress: RECIPIENT,
      amountAtomic: payable.amountAtomic, confirmations: 2, succeeded: true, observedAt: sample.now });
    await ctx.db.patch(sample.payableId, { status: "paid" });
    return { commandId, attemptId, observationId, txHash };
  });
}
const args = (f: Fixture, demoIdentity = "buyer") => ({ demoIdentity, orderId: f.orderId });

describe("buyer dataset delivery (synthetic evidence)", () => {
  it("exports only delivered licensed originals and preserves exact payout amounts", async () => {
    const f = await setup(), sample = await delivered(f);
    const result = await f.t.query(forOrder, args(f));
    expect(result).toMatchObject({ schema: "skarl.dataset.v1", orderId: f.orderId,
      task: { id: f.taskVersionId, version: 1 }, samples: [{ submissionId: sample.submissionId,
        sourceSha256: sample.sourceHash, durationMs: 12000, acceptedAt: sample.now,
        acceptance: { basis: "machine", decisionId: sample.decisionId },
        license: { version: "demo-consent-v1", scope: "Synthetic robotics research license" },
        payout: { status: "pending", amountAtomic: "9007199254740993", txHash: null, explorerUrl: null },
        duplicate: { status: "clear" } }] });
    expect(result.samples).toHaveLength(1);
    expect(result.samples[0].media.url).toMatch(/^https?:/);
    expect(result.samples[0].criteria[0]).toEqual({ criterionId: "red-cup-pickup", status: "supported",
      evidence: [{ modality: "video", startMs: 1000, endMs: 2000 }] });
    expect(result.samples[0].transcriptSegments).toEqual([{ startMs: 1000, endMs: 2000, text: "red cup" }]);
    expect(result.samples[0]).not.toHaveProperty("contributorTokenIdentifier");
    expect(() => JSON.stringify(result)).not.toThrow();
    expect((await f.t.query(forOrder, args(f, "controller"))).samples).toHaveLength(1);
  });

  it.each([
    { verificationOnly: true }, { evalRunId: "held-out-evaluation" }, { evalVideoModel: "gemini-4-argon" },
    { status: "needs_review" }, { status: "rejected" }, { status: "needs_correction" },
  ] as Partial<Doc<"submissions">>[])("does not turn a stale delivery into a license for %j", async patch => {
    const f = await setup(), sample = await delivered(f);
    await f.t.run(ctx => ctx.db.patch(sample.submissionId, patch));
    expect((await f.t.query(forOrder, args(f))).samples).toEqual([]);
  });

  it("does not equate accepted status with actual delivery or continuing consent", async () => {
    const f = await setup(), unpublished = await delivered(f, "unpublished"), unlicensed = await delivered(f, "unlicensed");
    await f.t.run(async ctx => { await ctx.db.delete(unpublished.deliveryId); await ctx.db.delete(unlicensed.consentRecordId); });
    expect((await f.t.query(forOrder, args(f))).samples).toEqual([]);
  });

  it("returns an empty dataset before an order has delivered samples", async () => {
    const f = await setup();
    expect(await f.t.query(forOrder, args(f))).toMatchObject({ schema: "skarl.dataset.v1", orderId: f.orderId, samples: [] });
  });

  it("refuses contributors and finance agents even if they know the order ID", async () => {
    const f = await setup();
    await delivered(f);
    for (const identity of ["contributor", "finance-agent"]) await expect(f.t.query(forOrder, args(f, identity))).rejects.toThrow("forbidden");
  });

  it("requires the order's buyer, not merely any buyer in the tenant", async () => {
    const f = await setup();
    await f.t.run(ctx => ctx.db.patch(f.orderId, { buyerTokenIdentifier: "demo:someone-else:buyer" }));
    await expect(f.t.query(forOrder, args(f))).rejects.toThrow("order_not_owned");
    expect((await f.t.query(forOrder, args(f, "controller"))).samples).toEqual([]);
  });

  it("enforces the tenant boundary for both buyers and controllers", async () => {
    const f = await setup();
    await f.t.run(async ctx => {
      const organizationId = await ctx.db.insert("organizations", { name: "Other tenant", createdByTokenIdentifier: "other", status: "active" });
      await ctx.db.patch(f.orderId, { organizationId });
    });
    for (const identity of ["buyer", "controller"]) await expect(f.t.query(forOrder, args(f, identity))).rejects.toThrow("cross_organization_access");
  });

  it.each(["swapped_source", "quarantined_original", "changed_manifest", "changed_report", "wrong_consent"])(
    "never issues media URLs for %s", async corruption => {
      const f = await setup(), sample = await delivered(f);
      await f.t.run(async ctx => {
        if (corruption === "swapped_source") await ctx.db.patch(sample.originalAssetId, { contentHash: "f".repeat(64) });
        if (corruption === "quarantined_original") await ctx.db.patch(sample.originalAssetId, { status: "quarantined" });
        if (corruption === "changed_manifest") await ctx.db.patch(sample.deliveryId, { manifestHash: "f".repeat(64) });
        if (corruption === "changed_report") await ctx.db.patch(sample.analysisId, { reportHash: "f".repeat(64) });
        if (corruption === "wrong_consent") await ctx.db.patch(sample.consentRecordId, { contributorTokenIdentifier: "another-contributor" });
      });
      expect((await f.t.query(forOrder, args(f))).samples).toEqual([]);
    });

  it("does not label a payable paid without a reconciled chain observation", async () => {
    const f = await setup(), sample = await delivered(f);
    await f.t.run(ctx => ctx.db.patch(sample.payableId, { status: "paid" }));
    expect((await f.t.query(forOrder, args(f))).samples[0].payout).toMatchObject({ status: "pending", txHash: null, explorerUrl: null });
  });

  it("exports the client-reported motion summary without publishing its private raw storage ID", async () => {
    const f = await setup(), sample = await delivered(f);
    await f.t.run(async ctx => {
      const storageId = await ctx.storage.store(new Blob(["synthetic raw IMU trace"], { type: "application/json" }));
      await ctx.db.patch(sample.submissionId, { sensorTrace: { storageId, sampleRateHz: 50, sampleCount: 500,
        durationMs: 10000, sensors: ["gyroscope"],
        device: { model: "Synthetic phone", os: "iOS", osVersion: "26", appVersion: "0.1.0", cameraFacing: "back", requestedVideoQuality: "720p" },
        recordedAt: "2026-10-25T10:00:00.000Z", clock: "js-callback-performance-now", sizeBytes: 25, attachedAt: sample.now,
        motionSummary: { source: "clientReported", version: 1, binWidthMs: 250, accelRmsG: null, gyroRmsRadPerSec: 0.1,
          linearAccelerationRmsMps2: null, meanTiltDegrees: 4.5, steadinessRatio: 0.9, activeMotionIntervals: [], bins: [] } } });
    });
    const trace = (await f.t.query(forOrder, args(f))).samples[0].sensorTrace;
    expect(trace).toMatchObject({ rawTraceExists: true, sampleRateHz: 50, sampleCount: 500,
      motionSummary: { source: "clientReported", meanTiltDegrees: 4.5, steadinessRatio: 0.9 } });
    expect(trace).not.toHaveProperty("storageId");
    expect(trace).not.toHaveProperty("url");
  });

  it("exports a paid BaseScan link only from a validated confirmed transfer", async () => {
    const f = await setup(), sample = await delivered(f), payment = await paidEvidence(f, sample);
    expect((await f.t.query(forOrder, args(f))).samples[0].payout).toEqual({ status: "paid",
      amountAtomic: "9007199254740993", txHash: payment.txHash,
      explorerUrl: `https://sepolia.basescan.org/tx/${payment.txHash}` });
  });

  it.each(["reconciling", "wrong_recipient", "insufficient_confirmations", "wrong_tx_hash", "failed_receipt"])(
    "keeps %s payout evidence pending instead of claiming payment", async failure => {
      const f = await setup(), sample = await delivered(f), payment = await paidEvidence(f, sample);
      await f.t.run(async ctx => {
        if (failure === "reconciling") await ctx.db.patch(payment.attemptId, { status: "reconciling" });
        if (failure === "wrong_recipient") await ctx.db.patch(payment.observationId, { toAddress: "0x3333333333333333333333333333333333333333" });
        if (failure === "insufficient_confirmations") await ctx.db.patch(payment.observationId, { confirmations: 1 });
        if (failure === "wrong_tx_hash") await ctx.db.patch(payment.observationId, { txHash: `0x${"c".repeat(64)}` });
        if (failure === "failed_receipt") await ctx.db.patch(payment.observationId, { succeeded: false });
      });
      expect((await f.t.query(forOrder, args(f))).samples[0].payout).toMatchObject({ status: "pending", txHash: null, explorerUrl: null });
    });

  it("derives liveness from the stored challenge and transcript rather than inventing a result", async () => {
    const f = await setup(), sample = await delivered(f);
    await f.t.run(async ctx => {
      await ctx.db.patch(sample.submissionId, { liveness: { words: ["red", "cup", "coaster"], issuedAt: sample.now - 1000, consumedAt: sample.now } });
      await ctx.db.patch(sample.analysisId, { observationsJson: JSON.stringify({ audio: { transcript: "red cup coaster",
        segments: [{ startMs: 1000, endMs: 2000, text: "red cup coaster" }], claims: [] } }) });
    });
    expect((await f.t.query(forOrder, args(f))).samples[0].liveness).toMatchObject({ status: "passed",
      evidence: { modality: "audio", startMs: 1000, endMs: 2000 } });
    await f.t.run(ctx => ctx.db.patch(sample.analysisId, { observationsJson: JSON.stringify({ audio: { transcript: "red cup",
      segments: [{ startMs: 1000, endMs: 2000, text: "red cup" }], claims: [] } }) }));
    expect((await f.t.query(forOrder, args(f))).samples[0].liveness.status).toBe("words_not_found");
  });

  it("exports a confirmed EAS UID tied to the delivered report snapshot", async () => {
    const f = await setup(), sample = await delivered(f), uid = `0x${"d".repeat(64)}`, txHash = `0x${"e".repeat(64)}`;
    const attestationId = await f.t.run(async ctx => {
      const analysis = (await ctx.db.get(sample.analysisId))!, rubric = (await ctx.db.get(f.taskVersionId))!;
      return ctx.db.insert("attestations", { analysisId: sample.analysisId, submissionId: sample.submissionId,
        schemaUid: "synthetic-schema", attestor: RECIPIENT, requestId: "synthetic-attestation", status: "confirmed",
        attestationUid: uid, txHash, logIndex: 1, generation: 1, leaseUntil: 0, nextRetryAt: sample.now,
        createdAt: sample.now, updatedAt: sample.now,
        fields: { reportHash: `0x${analysis.reportHash}`, sourceSha256: `0x${sample.sourceHash}`, rubricHash: `0x${rubric.contentHash}`,
          pipelineVersion: analysis.pipelineVersion, videoModel: "fixture", recommendation: "accept", verifiedAt: Math.floor(sample.now / 1000), licensed: true } });
    });
    expect((await f.t.query(forOrder, args(f))).samples[0].attestation).toMatchObject({ uid,
      easscanUrl: `https://base-sepolia.easscan.org/attestation/view/${uid}`, basescanUrl: `https://sepolia.basescan.org/tx/${txHash}` });
    await f.t.run(ctx => ctx.db.patch(attestationId, { status: "submitted" }));
    expect((await f.t.query(forOrder, args(f))).samples[0].attestation).toBeNull();
  });

  it("includes delivered human acceptance even when the machine recommended review", async () => {
    const f = await setup(), sample = await delivered(f, "human-overrode-review", true);
    await f.t.run(async ctx => {
      const analysis = (await ctx.db.get(sample.analysisId))!;
      const report = JSON.parse(analysis.reportJson!);
      report.recommendation = "needs_review";
      report.criteria[0].status = "unobservable";
      const reportHash = digest(report);
      await ctx.db.patch(sample.analysisId, { reportJson: canonical(report), reportHash, recommendation: "needs_review" });
      await ctx.db.patch(sample.decisionId, { evidenceHash: reportHash });
    });
    expect((await f.t.query(forOrder, args(f))).samples[0]).toMatchObject({ submissionId: sample.submissionId,
      acceptance: { basis: "human_controller" }, criteria: expect.arrayContaining([expect.objectContaining({ criterionId: "red-cup-pickup", status: "unobservable" })]) });
  });

  it("preserves a delivered human decision without pretending unavailable analysis ran", async () => {
    const f = await setup(), sample = await delivered(f, "human-without-analysis", true);
    await f.t.run(async ctx => {
      const delivery = (await ctx.db.get(sample.deliveryId))!;
      const { analysisResultId: _analysisResultId, ...manifest } = delivery.manifest!;
      await ctx.db.patch(sample.deliveryId, { manifest, manifestHash: digest(manifest) });
      await ctx.db.patch(sample.decisionId, { analysisResultId: undefined, evidenceHash: sample.sourceHash });
      await ctx.db.patch(sample.submissionId, { currentAnalysisId: undefined });
    });
    const result = (await f.t.query(forOrder, args(f))).samples[0];
    expect(result.acceptance.basis).toBe("human_controller");
    expect(result.criteria.every((criterion: { status: string; evidence: unknown[] }) =>
      criterion.status === "unobservable" && criterion.evidence.length === 0)).toBe(true);
    expect(result.transcriptSegments).toEqual([]);
    expect(result.duplicate.status).toBe("not_checked");
    expect(result.attestation).toBeNull();
  });

  it("distinguishes explicit human review from controller approval of machine evidence", async () => {
    const f = await setup();
    await delivered(f, "human-reviewed", true);
    expect((await f.t.query(forOrder, args(f))).samples[0].acceptance.basis).toBe("human_controller");
  });
});
