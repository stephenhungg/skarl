import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { canonical, digest } from "./lib/finance";
import { privacyFromObservations } from "./lib/provenance";
import schema from "./schema";

// All storage, model observations and attestation receipts below are synthetic.
// These tests establish trust boundaries, not live inference or an EAS transaction.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const forSubmission = makeFunctionReference<"query">("provenance:forSubmission");
const CONTRIBUTOR = "demo:skarl:contributor";

async function setup() {
  const t = convexTest(schema, modules), seeded = await t.mutation(internal.seed.demo, {});
  const sample = await t.run(async ctx => {
    const now = Date.now(), sourceHash = digest("synthetic media");
    const submissionId = await ctx.db.insert("submissions", { organizationId: seeded.organizationId,
      orderId: seeded.orderId, taskVersionId: seeded.taskVersionId, contributorTokenIdentifier: CONTRIBUTOR,
      status: "needs_review", clientRequestId: "synthetic-provenance", sourceHash, expectedSourceHash: digest("client declaration"),
      liveness: { words: ["red", "maple", "moon"], issuedAt: now - 1000, consumedAt: now }, updatedAt: now });
    const storageId = await ctx.storage.store(new Blob(["synthetic media"]));
    const originalAssetId = await ctx.db.insert("mediaAssets", { organizationId: seeded.organizationId, submissionId,
      storageId, purpose: "original", status: "verified", contentHash: sourceHash, mimeType: "video/mp4", sizeBytes: 15, durationMs: 12000 });
    const licenseVersion = "demo-consent-v1", scope = "Synthetic demonstration license";
    const consentRecordId = await ctx.db.insert("consentRecords", { organizationId: seeded.organizationId, submissionId,
      contributorTokenIdentifier: CONTRIBUTOR, licenseVersion, scope, licenseHash: digest({ licenseVersion, scope }),
      acknowledgedAt: now, receiptHash: digest("synthetic consent") });
    const jobId = await ctx.db.insert("jobs", { organizationId: seeded.organizationId, submissionId,
      taskVersionId: seeded.taskVersionId, sourceHash, pipelineVersion: "red-cup-evidence-1.2", status: "completed",
      availableAt: now, attempt: 1, maxAttempts: 1, leaseGeneration: 1 });
    const report = { schemaVersion: "1.0", reportId: "synthetic", submissionId, taskVersionId: seeded.taskVersionId,
      source: { sha256: sourceHash, durationMs: 12000 }, pipeline: { implementation: "inference", status: "completed",
        version: "red-cup-evidence-1.2", modelRuns: [] }, criteria: [], duplicate: { status: "not_checked", matches: [] },
      recommendation: "needs_review", warnings: [] };
    const reportJson = canonical(report), reportHash = digest(report);
    const reportStorageId = await ctx.storage.store(new Blob([reportJson]));
    const observations = { video: { visibility: "clear", observations: [{ action: "pickup", object: "red_cup",
      target: "unknown", startMs: 1000, endMs: 2000, description: "Hands lift a red cup." }] },
      audio: { transcript: "red maple moon", segments: [{ startMs: 500, endMs: 2500, text: "red maple moon" }], claims: [] } };
    const analysisId = await ctx.db.insert("analysisResults", { organizationId: seeded.organizationId, submissionId, jobId,
      taskVersionId: seeded.taskVersionId, sourceHash, pipelineVersion: "red-cup-evidence-1.2", leaseGeneration: 1,
      implementation: "inference", pipelineStatus: "completed", recommendation: "needs_review", summary: "Synthetic",
      reportStorageId, reportHash, reportJson, observationsJson: JSON.stringify(observations), evidenceAssetIds: [], completedAt: now });
    await ctx.db.patch(submissionId, { originalAssetId, consentRecordId, currentAnalysisId: analysisId });
    const fields = { reportHash: `0x${reportHash}`, sourceSha256: `0x${sourceHash}`, rubricHash: `0x${digest("rubric")}`,
      pipelineVersion: "red-cup-evidence-1.2", videoModel: "synthetic", recommendation: "needs_review" as const,
      verifiedAt: Math.floor(now / 1000), licensed: true };
    const attestationId = await ctx.db.insert("attestations", { analysisId, submissionId, schemaUid: digest("schema"),
      attestor: `0x${"1".repeat(40)}`, fields, requestId: "synthetic-eas-request", status: "confirmed",
      attestationUid: `0x${"a".repeat(64)}`, txHash: `0x${"b".repeat(64)}`, logIndex: 0,
      generation: 1, leaseUntil: 0, nextRetryAt: now, createdAt: now, updatedAt: now });
    return { submissionId, consentRecordId, originalAssetId, analysisId, reportHash, sourceHash, observations,
      fields, attestationId, now };
  });
  return { t, ...seeded, ...sample };
}

describe("sample provenance witnesses (synthetic)", () => {
  it("lists advisory client-derived runs without leaking storage grants or creator identities", async () => {
    const f = await setup();
    await f.t.run(async ctx => {
      const storageId = await ctx.storage.store(new Blob(["synthetic browser labels"]));
      await ctx.db.insert("derivedAnnotations", { submissionId: f.submissionId, organizationId: f.organizationId,
        kind: "objects", model: { name: "Synthetic detector", version: "fixture-v1", runtime: "browser-webgpu" }, storageId,
        summary: { kind: "objects", frames: 2, objectLabels: { cup: 2 }, cupInHandFrames: 1, durationMs: 1000 },
        createdBy: CONTRIBUTOR, createdAt: f.now, advisory: true });
    });
    const result = await f.t.query(forSubmission, { demoIdentity: "buyer", submissionId: f.submissionId });
    expect(result.derivedAnnotations).toEqual([{ kind: "objects",
      model: { name: "Synthetic detector", version: "fixture-v1", runtime: "browser-webgpu" },
      summary: { kind: "objects", frames: 2, objectLabels: { cup: 2 }, cupInHandFrames: 1, durationMs: 1000 },
      createdAt: f.now, derived: true, advisory: true, basis: "client_computed" }]);
    const serialized = JSON.stringify(result.derivedAnnotations);
    for (const privateValue of ["storageId", "url", "createdBy", CONTRIBUTOR]) expect(serialized).not.toContain(privateValue);
  });

  it("returns stored consent and derived evidence without exposing the contributor identity or narrative", async () => {
    const f = await setup();
    const result = await f.t.query(forSubmission, { demoIdentity: "buyer", submissionId: f.submissionId });
    expect(result).toMatchObject({ schemaVersion: "skarl.provenance.v1", consentRecordId: f.consentRecordId,
      licenseVersion: "demo-consent-v1", licenseScope: "Synthetic demonstration license", consentTimestamp: f.now,
      consentEvidence: "stored_acknowledgement", sourceSha256: f.sourceHash, sourceHashBasis: "verified_original",
      eas: { status: "confirmed", uid: `0x${"a".repeat(64)}` },
      liveness: { status: "passed", basis: "derived_spoken_word_match", evidence: { startMs: 500, endMs: 2500 } },
      privacyReview: "not_checked", revocation: { status: "not_requested" } });
    expect(result.contributorPseudonymousId).toMatch(/^[a-f0-9]{64}$/);
    const serialized = JSON.stringify(result);
    for (const privateValue of [CONTRIBUTOR, "red maple moon", "Hands lift", "storageId", "contributorTokenIdentifier"]) {
      expect(serialized, `Provenance must not turn ${privateValue} into public identity/media evidence`).not.toContain(privateValue);
    }
    for (const demoIdentity of ["controller", "contributor"]) {
      expect(await f.t.query(forSubmission, { demoIdentity, submissionId: f.submissionId })).toEqual(result);
    }
  });

  it("requires the actual buyer or contributor, not merely a matching role", async () => {
    const f = await setup(), args = { demoIdentity: "buyer", submissionId: f.submissionId };
    await expect(f.t.query(forSubmission, { ...args, demoIdentity: "finance-agent" })).rejects.toThrow("forbidden");
    await f.t.run(ctx => ctx.db.patch(f.orderId, { buyerTokenIdentifier: "synthetic:other-buyer" }));
    await expect(f.t.query(forSubmission, args)).rejects.toThrow("submission_not_owned");
    await f.t.run(ctx => ctx.db.patch(f.submissionId, { contributorTokenIdentifier: "synthetic:other-contributor" }));
    await expect(f.t.query(forSubmission, { ...args, demoIdentity: "contributor" })).rejects.toThrow("submission_not_owned");
  });

  it("rejects cross-tenant access even for a controller and never follows foreign consent links", async () => {
    const f = await setup(), args = { demoIdentity: "controller", submissionId: f.submissionId };
    const foreign = await f.t.run(ctx => ctx.db.insert("organizations", { name: "Synthetic foreign", status: "active",
      createdByTokenIdentifier: "synthetic:foreign-controller" }));
    await f.t.run(ctx => ctx.db.patch(f.consentRecordId, { organizationId: foreign }));
    await expect(f.t.query(forSubmission, args)).rejects.toThrow("consent_reference_mismatch");
    await f.t.run(ctx => ctx.db.patch(f.submissionId, { organizationId: foreign }));
    await expect(f.t.query(forSubmission, args)).rejects.toThrow("cross_organization_access");
  });

  it("does not promote a client-declared or quarantined source hash to verified provenance", async () => {
    const f = await setup(), args = { demoIdentity: "contributor", submissionId: f.submissionId };
    await f.t.run(ctx => ctx.db.patch(f.originalAssetId, { status: "quarantined" }));
    expect(await f.t.query(forSubmission, args)).toMatchObject({ sourceSha256: null, sourceHashBasis: "unavailable" });
    await f.t.run(ctx => ctx.db.patch(f.submissionId, { originalAssetId: undefined, sourceHash: undefined }));
    expect(await f.t.query(forSubmission, args)).toMatchObject({ sourceSha256: null, sourceHashBasis: "unavailable",
      eas: { status: "unavailable" }, liveness: { status: "not_checked" } });
  });

  it.each(["submitted", "wrong_report", "wrong_source", "stale_report"])("a %s receipt cannot witness this sample's current report", async mode => {
    const f = await setup();
    await f.t.run(async ctx => {
      if (mode === "submitted") await ctx.db.patch(f.attestationId, { status: "submitted" });
      if (mode === "wrong_report") await ctx.db.patch(f.attestationId, { fields: { ...f.fields, reportHash: `0x${"0".repeat(64)}` } });
      if (mode === "wrong_source") await ctx.db.patch(f.attestationId, { fields: { ...f.fields, sourceSha256: `0x${"0".repeat(64)}` } });
      if (mode === "stale_report") await ctx.db.patch(f.analysisId, { reportHash: "0".repeat(64) });
    });
    expect(await f.t.query(forSubmission, { demoIdentity: "buyer", submissionId: f.submissionId }))
      .toMatchObject({ eas: { status: "unavailable", uid: null, easscanUrl: null, basescanUrl: null } });
  });

  it("keeps requested/revoked consent visible without exposing the private reason or claiming EAS was revoked", async () => {
    const f = await setup();
    for (const revocationStatus of ["requested", "revoked"] as const) {
      await f.t.run(ctx => ctx.db.patch(f.consentRecordId, { revocationStatus, revocationRequestedAt: f.now,
        revocationReason: "Private contributor reason", ...(revocationStatus === "revoked" ? { revokedAt: f.now + 1000 } : {}) }));
      const result = await f.t.query(forSubmission, { demoIdentity: "buyer", submissionId: f.submissionId });
      expect(result.revocation.status).toBe(revocationStatus);
      expect(result.eas.status, "The old EAS snapshot remains historical evidence, not proof of continuing consent").toBe("confirmed");
      expect(JSON.stringify(result)).not.toContain("Private contributor reason");
    }
  });

  it("uses visual mentions only as a privacy heuristic; narration and missing signals never clear privacy", async () => {
    const f = await setup(), args = { demoIdentity: "contributor", submissionId: f.submissionId };
    await f.t.run(ctx => ctx.db.patch(f.analysisId, { observationsJson: JSON.stringify({ ...f.observations,
      audio: { ...f.observations.audio, transcript: "A bystander face", segments: [{ startMs: 0, endMs: 1000, text: "A bystander face" }] } }) }));
    expect(await f.t.query(forSubmission, args)).toMatchObject({ privacyReview: "not_checked", liveness: { status: "words_not_found" } });
    await f.t.run(ctx => ctx.db.patch(f.analysisId, { observationsJson: JSON.stringify({ ...f.observations,
      video: { ...f.observations.video, observations: [{ ...f.observations.video.observations[0], description: "A bystander face is visible." }] } }) }));
    expect(await f.t.query(forSubmission, args)).toMatchObject({ privacyReview: "needs_review",
      privacyEvidence: { basis: "stored_visual_description_heuristic", evidence: [{ startMs: 1000, endMs: 2000, signal: "face_or_person_mention" }] } });
    expect(privacyFromObservations({ observations: [{ description: "A face", startMs: -1, endMs: 1000 }] }, 12000))
      .toMatchObject({ privacyReview: "not_checked", privacyEvidence: { evidence: [] } });
  });
});
