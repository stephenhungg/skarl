import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { canonical, digest } from "./lib/finance";
import { audioFromTranscriptSegments, buildVerificationReport } from "./lib/verificationReport";
import { validateVerificationReportForRubric } from "../packages/contracts/src/verification";
import { PAYMENT_CHAIN_ID, PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/chain";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
type Test = TestConvex<typeof schema>;
const frames = [
  { timestampMs: 1_000, hash: "1234567890abcdef" },
  { timestampMs: 5_000, hash: "234567890abcdef1" },
  { timestampMs: 9_000, hash: "34567890abcdef12" },
];

// Every upload, model observation, wallet proof and funding entry in this file
// is synthetic. Fake timers prevent scheduled verify actions from executing.
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-25T08:00:00Z")); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

async function setup() {
  const t = convexTest(schema, modules);
  const seeded = await t.mutation(internal.seed.demo, {});
  return { t, ...seeded };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function upload(t: Test, content = "synthetic media bytes", type = "video/mp4") {
  return t.run(ctx => ctx.storage.store(new Blob([content], { type })));
}
async function create(f: Fixture, request = "sample-1", extras: {
  clientFrameDHashes?: typeof frames; verificationOnly?: boolean;
  environment?: string; variant?: string;
} = {}) {
  const storageId = await upload(f.t, `synthetic media ${request}`);
  const challenge = await f.t.mutation(api.liveness.issueChallenge, { demoIdentity: "contributor" });
  const args = { demoIdentity: "contributor", orderId: f.orderId, storageId, livenessChallengeId: challenge.challengeId,
    clientRequestId: request, consentAcknowledged: true, ...extras };
  const result = await f.t.mutation(api.submissions.create, args);
  const job = await f.t.run(async ctx => (await ctx.db.query("jobs")
    .withIndex("by_logical_job", q => q.eq("submissionId", result.submissionId)).unique())!);
  return { ...result, args, job };
}
async function claimAndFacts(f: Fixture, item: Awaited<ReturnType<typeof create>>, hashes = frames) {
  const claimed = await f.t.mutation(internal.submissions.claim, { jobId: item.job._id });
  if (!claimed) throw new Error("missing synthetic claim");
  await f.t.mutation(internal.submissions.facts, { jobId: item.job._id, generation: claimed.generation,
    sourceHash: item.job.sourceHash, durationMs: 12_000, frameDHashes: hashes,
    perceptualHash: hashes.map(frame => frame.hash).join(""), perceptualHashSource: "serverComputed", mediaVerified: true });
  return claimed;
}
async function completion(f: Fixture, item: Awaited<ReturnType<typeof create>>, generation: number) {
  const rubric = await f.t.run(ctx => ctx.db.get(f.taskVersionId));
  if (!rubric) throw new Error("missing synthetic rubric");
  const submission = await f.t.run(ctx => ctx.db.get(item.submissionId));
  const audio = audioFromTranscriptSegments([
    { startMs: 0, endMs: 900, text: submission!.liveness!.words.join(" ") },
    { startMs: 1_000, endMs: 3_000, text: "I pick up the red cup." },
    { startMs: 5_000, endMs: 7_000, text: "I place it on the coaster." },
  ], 12_000);
  const report = buildVerificationReport({ liveness: submission!.liveness, submissionId: item.submissionId, taskVersionId: f.taskVersionId,
    sourceHash: item.job.sourceHash, durationMs: 12_000, criteria: rubric.criteria,
    video: { visibility: "clear", observations: [
      { action: "pickup", object: "red_cup", target: "unknown", startMs: 1_000, endMs: 3_000, description: "A hand picks up the red cup." },
      { action: "place", object: "red_cup", target: "coaster", startMs: 5_000, endMs: 7_000, description: "The hand places the red cup on the coaster." },
    ] },
    audio,
    modelRuns: [{ provider: "mock", model: "synthetic-observations", promptVersion: "test-v1" }],
    duplicate: { status: "clear", matches: [] },
  });
  expect(validateVerificationReportForRubric(report, rubric.criteria.map(c => c.criterionId))).toEqual({ valid: true, errors: [] });
  expect(report.recommendation).toBe("accept");
  const reportJson = canonical(report);
  const reportStorageId = await f.t.run(ctx => ctx.storage.store(new Blob([reportJson], { type: "application/json" })));
  return { report, args: { jobId: item.job._id, generation, reportJson, observationsJson: canonical({ fixtureOnly: true, audio }),
    reportStorageId, reportHash: digest(report), processingElapsedMs: 123 } };
}
async function finish(f: Fixture, item: Awaited<ReturnType<typeof create>>) {
  const claimed = await claimAndFacts(f, item);
  const value = await completion(f, item, claimed.generation);
  const analysisId = await f.t.mutation(internal.submissions.complete, value.args);
  return { ...value, analysisId };
}
async function fundSyntheticOrder(f: Fixture) {
  await f.t.run(async ctx => {
    const member = await ctx.db.query("memberships").withIndex("by_token_identifier", q => q.eq("tokenIdentifier", "demo:skarl:contributor")).unique();
    if (!member) throw new Error("missing fixture contributor");
    await ctx.db.patch(member._id, { walletAddress: "0x1111111111111111111111111111111111111111", walletVerification: {
      siweMessageHash: "e".repeat(64), nonce: "fixture-only", signature: `0x${"1".repeat(130)}`, chainId: PAYMENT_CHAIN_ID, verifiedAt: Date.now(),
    } });
    const entry = await ctx.db.insert("journalEntries", { organizationId: f.organizationId, orderId: f.orderId,
      network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, eventKey: `fixture:funding:${f.orderId}`, kind: "funding", status: "posted",
      memo: "Synthetic prepayment; no chain transaction", sourceReference: "fixture-only:no-receipt", effectiveAt: Date.now(), recordedAt: Date.now() });
    for (const [lineNumber, account, side] of [[0, "asset:usdc", "debit"], [1, "liability:customer_prepayments", "credit"]] as const) {
      await ctx.db.insert("journalLines", { organizationId: f.organizationId, journalEntryId: entry, lineNumber, account, side, amountAtomic: 100_000_000n });
    }
    await ctx.db.patch(f.orderId, { status: "funded" });
  });
}

describe("submission lifecycle and evidence boundaries", () => {
  it("atomically binds a real storage object, frozen rubric, consent receipt and one pending verification job", async () => {
    const f = await setup();
    const item = await create(f, "sample-1", { clientFrameDHashes: frames });
    const state = await f.t.run(async ctx => ({
      submission: await ctx.db.get(item.submissionId), assets: await ctx.db.query("mediaAssets").collect(),
      consents: await ctx.db.query("consentRecords").collect(), jobs: await ctx.db.query("jobs").collect(),
      scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
      order: await ctx.db.get(f.orderId), payables: await ctx.db.query("payables").collect(),
    }));
    expect(state.submission).toMatchObject({ status: "queued", taskVersionId: f.taskVersionId,
      clientFrameDHashes: frames, verificationOnly: false, contributorTokenIdentifier: "demo:skarl:contributor" });
    expect(state.submission?.sourceHash).toBeUndefined();
    expect(state.submission?.frameDHashes).toBeUndefined();
    expect(state.submission?.perceptualHashSource).toBeUndefined();
    expect(state.submission?.expectedSourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(state.assets).toHaveLength(1);
    expect(state.assets[0]).toMatchObject({ storageId: item.args.storageId, submissionId: item.submissionId,
      purpose: "original", status: "uploaded", mimeType: "video/mp4", contentHash: state.submission?.expectedSourceHash });
    expect(state.consents).toHaveLength(1);
    expect(state.consents[0]).toMatchObject({ submissionId: item.submissionId, licenseVersion: "demo-consent-v1" });
    expect(state.consents[0]?.receiptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(state.jobs).toHaveLength(1);
    expect(state.jobs[0]).toMatchObject({ status: "pending", attempt: 0, leaseGeneration: 0, pipelineVersion: "red-cup-evidence-1.2" });
    expect(state.scheduled).toHaveLength(1);
    expect(state.scheduled[0]?.state.kind).toBe("pending");
    expect(state.order?.status).toBe("awaiting_funding");
    expect(state.payables).toHaveLength(0);
  });

  it("checks contributor roles, consent, request IDs, frozen rubric and tenant before creating records", async () => {
    const f = await setup();
    const storageId = await upload(f.t);
    const args = { demoIdentity: "contributor", orderId: f.orderId, storageId, clientRequestId: "request", consentAcknowledged: true };
    await expect(f.t.mutation(api.submissions.generateUploadUrl, { demoIdentity: "buyer" })).rejects.toThrow("forbidden");
    expect(await f.t.mutation(api.submissions.generateUploadUrl, { demoIdentity: "contributor" })).toMatch(/^https?:/);
    await expect(f.t.mutation(api.submissions.create, { ...args, demoIdentity: "controller" })).rejects.toThrow("forbidden");
    await expect(f.t.mutation(api.submissions.create, { ...args, consentAcknowledged: false })).rejects.toThrow("consent_required");
    await expect(f.t.mutation(api.submissions.create, { ...args, clientRequestId: "bad request" })).rejects.toThrow("invalid_request_id");
    await f.t.run(ctx => ctx.db.patch(f.taskVersionId, { frozenAt: undefined }));
    await expect(f.t.mutation(api.submissions.create, args)).rejects.toThrow("frozen_rubric_required");
    await f.t.run(async ctx => {
      const other = await ctx.db.insert("organizations", { name: "Other tenant", status: "active", createdByTokenIdentifier: "demo:other" });
      await ctx.db.patch(f.orderId, { organizationId: other });
    });
    await expect(f.t.mutation(api.submissions.create, args)).rejects.toThrow("cross_organization_access");
    expect(await f.t.run(ctx => ctx.db.query("submissions").collect())).toHaveLength(0);
    expect(await f.t.run(ctx => ctx.db.query("consentRecords").collect())).toHaveLength(0);
  });

  it("rejects missing, empty, oversized and unsupported storage objects without queuing a job", async () => {
    const f = await setup();
    const missing = await upload(f.t);
    await f.t.run(ctx => ctx.storage.delete(missing));
    const oversized = await f.t.run(ctx => ctx.storage.store(new Blob([new Uint8Array(25 * 1024 * 1024 + 1)], { type: "video/mp4" })));
    for (const [storageId, error] of [[missing, "upload_size_invalid"], [await upload(f.t, ""), "upload_size_invalid"], [oversized, "upload_size_invalid"],
      [await upload(f.t, "not video", "text/plain"), "unsupported_upload_type"]] as const) {
      await expect(f.t.mutation(api.submissions.create, { demoIdentity: "contributor", orderId: f.orderId, storageId,
        clientRequestId: "invalid-upload", consentAcknowledged: true })).rejects.toThrow(error);
    }
    expect(await f.t.run(ctx => ctx.db.query("jobs").collect())).toHaveLength(0);
  });

  it("replays one request exactly and refuses changed upload, mode, hashes and reuse of an attached upload", async () => {
    const f = await setup();
    const item = await create(f, "retry", { clientFrameDHashes: frames });
    await f.t.run(ctx => ctx.db.patch(f.orderId, { status: "closed" }));
    expect(await f.t.mutation(api.submissions.create, item.args)).toEqual({ submissionId: item.submissionId, replayed: true });
    for (const patch of [{ storageId: await upload(f.t, "different") }, { verificationOnly: true },
      { clientFrameDHashes: frames.map(frame => ({ ...frame, hash: "a".repeat(16) })) }]) {
      await expect(f.t.mutation(api.submissions.create, { ...item.args, ...patch })).rejects.toThrow("submission_request_conflict");
    }
    await f.t.run(ctx => ctx.db.patch(f.orderId, { status: "awaiting_funding" }));
    await expect(f.t.mutation(api.submissions.create, { ...item.args, clientRequestId: "second-request" })).rejects.toThrow("upload_already_attached");
    for (const table of ["submissions", "jobs", "consentRecords", "mediaAssets"] as const) {
      expect(await f.t.run(ctx => ctx.db.query(table).collect())).toHaveLength(1);
    }
  });

  it("validates client frame hashes and records fallback provenance without pretending it is server verification", async () => {
    const f = await setup();
    const storageId = await upload(f.t);
    const invalid = [frames.slice(0, 2), Array.from({ length: 13 }, (_, i) => ({ ...frames[0]!, timestampMs: i })),
      frames.map(frame => ({ ...frame, timestampMs: 0 })), [{ ...frames[0]!, timestampMs: 0.5 }, ...frames.slice(1)],
      [{ ...frames[0]!, hash: "ABCDEF1234567890" }, ...frames.slice(1)]];
    for (const clientFrameDHashes of invalid) {
      await expect(f.t.mutation(api.submissions.create, { demoIdentity: "contributor", orderId: f.orderId, storageId,
        clientRequestId: "bad-frames", consentAcknowledged: true, clientFrameDHashes })).rejects.toThrow(/frame/);
    }
    const item = await create(f, "client-fallback", { clientFrameDHashes: frames });
    const claimed = await f.t.mutation(internal.submissions.claim, { jobId: item.job._id });
    if (!claimed) throw new Error("missing fixture claim");
    await f.t.mutation(internal.submissions.facts, { jobId: item.job._id, generation: claimed.generation, sourceHash: item.job.sourceHash,
      durationMs: 0, mediaVerified: false, frameDHashes: frames, perceptualHash: frames.map(frame => frame.hash).join(""), perceptualHashSource: "clientReported" });
    const state = await f.t.run(async ctx => { const submission = (await ctx.db.get(item.submissionId))!;
      return { submission, asset: await ctx.db.get(submission.originalAssetId!) }; });
    expect(state.submission).toMatchObject({ clientFrameDHashes: frames, frameDHashes: frames, perceptualHashSource: "clientReported" });
    expect(state.asset?.status).toBe("quarantined");
  });

  it("leases once, fences facts by generation and validates source/duration/frame bounds", async () => {
    const f = await setup();
    const item = await create(f);
    const claimed = await claimAndFacts(f, item);
    expect(claimed.generation).toBe(1);
    expect(await f.t.mutation(internal.submissions.claim, { jobId: item.job._id })).toBeNull();
    const args = { jobId: item.job._id, generation: 1, sourceHash: item.job.sourceHash, durationMs: 12_000, mediaVerified: true };
    await expect(f.t.mutation(internal.submissions.facts, { ...args, generation: 2 })).rejects.toThrow("stale_analysis_attempt");
    for (const patch of [{ sourceHash: "bad" }, { durationMs: -1 }, { durationMs: 30_001 }, { durationMs: 1.5 }]) {
      await expect(f.t.mutation(internal.submissions.facts, { ...args, ...patch })).rejects.toThrow("invalid_source_facts");
    }
    await expect(f.t.mutation(internal.submissions.facts, { ...args, durationMs: 8_000, frameDHashes: frames })).rejects.toThrow("invalid_frame_dhash");
    const state = await f.t.run(async ctx => ({ job: await ctx.db.get(item.job._id), submission: await ctx.db.get(item.submissionId) }));
    expect(state.job).toMatchObject({ status: "leased", attempt: 1, leaseGeneration: 1 });
    expect(state.submission).toMatchObject({ status: "analysing", sourceHash: item.job.sourceHash, perceptualHashSource: "serverComputed", frameDHashes: frames });
    const mismatched = await create(f, "mismatched-reference");
    await f.t.run(async ctx => {
      const submission = (await ctx.db.get(mismatched.submissionId))!;
      await ctx.db.patch(submission.originalAssetId!, { submissionId: item.submissionId });
    });
    await expect(f.t.mutation(internal.submissions.claim, { jobId: mismatched.job._id })).rejects.toThrow("job_reference_mismatch");
    expect((await f.t.run(ctx => ctx.db.get(mismatched.job._id)))?.status).toBe("pending");
  });

  it("binds frame storage, timestamps and sample indices before linking private evidence", async () => {
    const f = await setup(), item = await create(f, "frame-binding"), claimed = await claimAndFacts(f, item);
    const value = await completion(f, item, claimed.generation), bytes = new Uint8Array([255,216,255,217]);
    const storageId = await f.t.run(ctx => ctx.storage.store(new Blob([bytes], {type:"image/jpeg"})));
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(n => n.toString(16).padStart(2,"0")).join("");
    const frame = {storageId, timestampMs:1000, contentHash:hash, sizeBytes:4, kind:"dhash" as const, sampleIndex:0, decodedFrameIndex:1};
    for (const patch of [{timestampMs:1001}, {sampleIndex:6}, {decodedFrameIndex:-1}]) {
      await expect(f.t.mutation(internal.submissions.complete, {...value.args, evidenceFrames:[{...frame,...patch}]})).rejects.toThrow("invalid_evidence_frames");
    }
    await expect(f.t.mutation(internal.submissions.complete, {...value.args, evidenceFrames:[frame,frame]})).rejects.toThrow("invalid_evidence_frames");
    await expect(f.t.mutation(internal.submissions.complete, {...value.args, evidenceFrames:[{...frame,contentHash:"f".repeat(64)}]})).rejects.toThrow("evidence_frame_storage_mismatch");
    const analysisId = await f.t.mutation(internal.submissions.complete, {...value.args, evidenceFrames:[frame]});
    const analysis = await f.t.run(ctx => ctx.db.get(analysisId));
    expect(analysis!.evidenceAssetIds).toHaveLength(2); expect(analysis!.dHashFrameIndices).toEqual([1]);
    expect((await f.t.query(api.media.submissionEvidence, {demoIdentity:"controller",submissionId:item.submissionId})).dHashFrames).toHaveLength(1);
  });

  it("stores a canonical report once, binds it to source/rubric/pipeline and never publishes or pays from completion", async () => {
    const f = await setup();
    const item = await create(f);
    const claimed = await claimAndFacts(f, item);
    const value = await completion(f, item, claimed.generation);
    for (const report of [{ ...value.report, source: { ...value.report.source, sha256: "f".repeat(64) } },
      { ...value.report, taskVersionId: "foreign-task" }, { ...value.report, pipeline: { ...value.report.pipeline, version: "foreign-pipeline" } }]) {
      await expect(f.t.mutation(internal.submissions.complete, { ...value.args, reportJson: canonical(report), reportHash: digest(report) })).rejects.toThrow("report_source_mismatch");
    }
    await expect(f.t.mutation(internal.submissions.complete, { ...value.args, reportHash: "0".repeat(64) })).rejects.toThrow("report_source_mismatch");
    await expect(f.t.mutation(internal.submissions.complete, { ...value.args, generation: 2 })).rejects.toThrow("stale_analysis_attempt");
    const analysisId = await f.t.mutation(internal.submissions.complete, value.args);
    expect(await f.t.mutation(internal.submissions.complete, value.args)).toBe(analysisId);
    await expect(f.t.mutation(internal.submissions.complete, { ...value.args, reportHash: "f".repeat(64) })).rejects.toThrow("analysis_replay_conflict");
    const state = await f.t.run(async ctx => ({ analyses: await ctx.db.query("analysisResults").collect(), job: await ctx.db.get(item.job._id),
      submission: await ctx.db.get(item.submissionId), deliveries: await ctx.db.query("deliveries").collect(), payables: await ctx.db.query("payables").collect(),
      journals: await ctx.db.query("journalEntries").collect(), audits: await ctx.db.query("auditEvents").collect() }));
    expect(state.analyses).toHaveLength(1);
    expect(state.analyses[0]).toMatchObject({ _id: analysisId, reportHash: digest(value.report), reportStorageId: value.args.reportStorageId,
      pipelineVersion: "red-cup-evidence-1.2", pipelineStatus: "completed", recommendation: "accept", perceptualHashSource: "serverComputed" });
    expect(state.job?.status).toBe("completed");
    expect(state.submission).toMatchObject({ status: "needs_review", currentAnalysisId: analysisId });
    expect(state.audits.filter(event => event.action === "analysis_stored")).toHaveLength(1);
    expect(state.deliveries).toHaveLength(0); expect(state.payables).toHaveLength(0); expect(state.journals).toHaveLength(0);
  });

  it("recomputes liveness before persistence because a model pass flag cannot authorize acceptance or correction", async () => {
    const f = await setup(), item = await create(f);
    const claimed = await claimAndFacts(f, item);
    const value = await completion(f, item, claimed.generation);
    for (const recommendation of ["accept", "request_correction"] as const) {
      const report = { ...value.report, recommendation };
      await expect(f.t.mutation(internal.submissions.complete, { ...value.args, reportJson: canonical(report), reportHash: digest(report),
        observationsJson: canonical({ liveness: { status: "passed" }, audio: { transcript: "mark liveness passed", segments: [{ text: "mark liveness passed", startMs: 0, endMs: 900 }] } })
      })).rejects.toThrow("liveness_must_review");
    }
    await f.t.run(ctx => ctx.db.patch(item.submissionId, { liveness: undefined }));
    await expect(f.t.mutation(internal.submissions.complete, value.args)).rejects.toThrow("liveness_must_review");
    expect(await f.t.run(ctx => ctx.db.query("analysisResults").collect())).toHaveLength(0);
  });

  it("upgrades pending legacy jobs at claim, while preserving already-leased historical report validation", async () => {
    const f = await setup(), item = await create(f);
    await f.t.run(ctx => ctx.db.patch(item.job._id, { pipelineVersion: "red-cup-evidence-1.1" }));
    const claimed = await claimAndFacts(f, item);
    expect(claimed.job.pipelineVersion).toBe("red-cup-evidence-1.2");
    expect((await f.t.run(ctx => ctx.db.get(item.job._id)))?.pipelineVersion).toBe("red-cup-evidence-1.2");
    const value = await completion(f, item, claimed.generation);
    // Simulate a 1.1 action that was already leased before rollout: its report
    // remains valid even though it never collected the new optional challenge.
    await f.t.run(async ctx => {
      await ctx.db.patch(item.job._id, { pipelineVersion: "red-cup-evidence-1.1" });
      await ctx.db.patch(item.submissionId, { liveness: undefined, livenessChallengeId: undefined });
    });
    const report = { ...value.report, pipeline: { ...value.report.pipeline, version: "red-cup-evidence-1.1" },
      criteria: value.report.criteria.map(criterion => ({ ...criterion, evidence: criterion.evidence.filter(evidence => !evidence.claim.startsWith("Spoken liveness matched")) })) };
    expect(validateVerificationReportForRubric(report, report.criteria.map(criterion => criterion.criterionId)).valid).toBe(true);
    expect(await f.t.mutation(internal.submissions.complete, { ...value.args, reportJson: canonical(report), reportHash: digest(report), observationsJson: "{}" })).toBeTruthy();
  });

  it("ignores an unrelated watchdog generation and exposes expired work as review while fencing late completion", async () => {
    const f = await setup();
    const item = await create(f);
    const claimed = await claimAndFacts(f, item);
    const value = await completion(f, item, claimed.generation);
    await f.t.mutation(internal.submissions.expire, { jobId: item.job._id, generation: 1 });
    expect((await f.t.run(ctx => ctx.db.get(item.job._id)))?.status).toBe("leased");
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1);
    await f.t.mutation(internal.submissions.expire, { jobId: item.job._id, generation: 2 });
    expect((await f.t.run(ctx => ctx.db.get(item.job._id)))?.status).toBe("leased");
    await expect(f.t.mutation(internal.submissions.facts, { jobId: item.job._id, generation: claimed.generation,
      sourceHash: "f".repeat(64), durationMs: 12_000, mediaVerified: true })).rejects.toThrow("stale_analysis_attempt");
    expect((await f.t.run(ctx => ctx.db.get(item.submissionId)))?.sourceHash).toBe(item.job.sourceHash);
    await expect(f.t.mutation(internal.submissions.complete, value.args)).rejects.toThrow("stale_analysis_attempt");
    await f.t.mutation(internal.submissions.expire, { jobId: item.job._id, generation: 1 });
    expect(await f.t.run(ctx => ctx.db.get(item.job._id))).toMatchObject({ status: "failed", lastErrorCode: "verification_interrupted" });
    expect((await f.t.run(ctx => ctx.db.get(item.submissionId)))?.status).toBe("needs_review");
    expect(await f.t.mutation(internal.submissions.claim, { jobId: item.job._id })).toBeNull();
    const recovered = await f.t.action(internal.verify.interrupted, { jobId: item.job._id, generation: 1 });
    expect(recovered.analysisId).toBeTruthy();
    const stored = await f.t.query(api.submissions.getReport, { demoIdentity:"controller",submissionId:item.submissionId });
    expect(stored.report).toMatchObject({recommendation:"needs_review",pipeline:{status:"failed",modelRuns:[]}});
    expect(validateVerificationReportForRubric(stored.report,value.report.criteria.map(c=>c.criterionId)).valid).toBe(true);
    await expect(f.t.mutation(internal.submissions.complete,value.args)).rejects.toThrow("analysis_replay_conflict");
    expect(await f.t.action(internal.verify.interrupted,{jobId:item.job._id,generation:1})).toEqual({skipped:true});
  });

  it("serves reports only to permitted tenant members and the owning contributor", async () => {
    const f = await setup();
    const item = await create(f);
    const value = await finish(f, item);
    for (const demoIdentity of ["buyer", "controller", "finance-agent", "contributor"]) {
      const result = await f.t.query(api.submissions.getReport, { demoIdentity, submissionId: item.submissionId });
      expect(result).toMatchObject({ status: "needs_review", report: value.report, observations: { fixtureOnly: true }, processingElapsedMs: 123 });
    }
    await f.t.run(ctx => ctx.db.patch(f.orderId, {buyerTokenIdentifier: "fixture:other-buyer"}));
    await expect(f.t.query(api.submissions.getReport, { demoIdentity: "buyer", submissionId: item.submissionId })).rejects.toThrow("order_not_owned");
    await f.t.run(ctx => ctx.db.patch(item.submissionId, { contributorTokenIdentifier: "demo:other:contributor" }));
    await expect(f.t.query(api.submissions.getReport, { demoIdentity: "contributor", submissionId: item.submissionId })).rejects.toThrow("submission_not_owned");
    await f.t.run(async ctx => { const organizationId = await ctx.db.insert("organizations", { name: "Foreign tenant", status: "active", createdByTokenIdentifier: "demo:other" });
      await ctx.db.patch(item.submissionId, { organizationId }); });
    await expect(f.t.query(api.submissions.getReport, { demoIdentity: "controller", submissionId: item.submissionId })).rejects.toThrow("cross_organization_access");
  });

  it("refuses verification-only licensing and a near-frame copy without another payable or fulfillment", async () => {
    const f = await setup();
    const development = await create(f, "development", { verificationOnly: true });
    expect(await f.t.mutation(api.finance.acceptAndPublish, { demoIdentity: "controller", submissionId: development.submissionId }))
      .toMatchObject({ ok: false, code: "verification_only_not_licensed" });
    const consent = await f.t.run(ctx => ctx.db.query("consentRecords").withIndex("by_submission", q => q.eq("submissionId", development.submissionId)).unique());
    expect(consent?.licenseVersion).toBe("verification-only-v1");
    expect(consent?.scope).toContain("no training");
    await fundSyntheticOrder(f);
    const original = await create(f, "original");
    await finish(f, original);
    expect(await f.t.mutation(api.finance.acceptAndPublish, { demoIdentity: "controller", submissionId: original.submissionId })).toMatchObject({ ok: true });
    const copied = await create(f, "reencoded-copy");
    // Distinct source bytes and concatenated hash strings, but one bit per frame
    // differs. This exercises frame Hamming comparison rather than equality.
    const nearby = frames.map(frame => ({ ...frame, hash: (BigInt(`0x${frame.hash}`) ^ 1n).toString(16).padStart(16, "0") }));
    const claimed = await claimAndFacts(f, copied, nearby);
    const value = await completion(f, copied, claimed.generation);
    await f.t.mutation(internal.submissions.complete, value.args);
    expect(copied.job.sourceHash).not.toBe(original.job.sourceHash);
    const candidates = await f.t.query(internal.submissions.copies, { submissionId: copied.submissionId });
    expect(candidates.status).toBe("suspected");
    expect(candidates.matches).toContainEqual({ submissionId: original.submissionId, score: 63 / 64, overlapMs: 0 });
    expect(await f.t.mutation(api.finance.acceptAndPublish, { demoIdentity: "controller", submissionId: copied.submissionId }))
      .toMatchObject({ ok: false, code: "duplicate_submission", matchingSubmissionId: original.submissionId });
    const state = await f.t.run(async ctx => ({ payables: await ctx.db.query("payables").collect(), deliveries: await ctx.db.query("deliveries").collect(),
      entries: await ctx.db.query("journalEntries").collect(), order: await ctx.db.get(f.orderId), copied: await ctx.db.get(copied.submissionId) }));
    expect(state.payables).toHaveLength(1); expect(state.deliveries).toHaveLength(1);
    expect(state.entries.filter(entry => entry.kind === "fulfillment")).toHaveLength(1);
    expect(state.order?.acceptedCount).toBe(1n); expect(state.copied?.status).toBe("needs_review");
  });

  it("blocks a shifted trimmed copy from creating a second payable", async () => {
    const f = await setup(); await fundSyntheticOrder(f);
    const original = await create(f, "trim-origin");
    const originalClaim = await claimAndFacts(f, original, [{timestampMs:0, hash:"aaaaaaaaaaaaaaaa"}, ...frames]);
    await f.t.mutation(internal.submissions.complete, (await completion(f, original, originalClaim.generation)).args);
    expect(await f.t.mutation(api.finance.acceptAndPublish, {demoIdentity:"controller", submissionId:original.submissionId}))
      .toMatchObject({ok:true});
    const trimmed = await create(f, "trim-copy");
    const claim = await claimAndFacts(f, trimmed, frames.map(frame => ({...frame, timestampMs:frame.timestampMs - 1000})));
    await f.t.mutation(internal.submissions.complete, (await completion(f, trimmed, claim.generation)).args);
    expect(await f.t.query(internal.submissions.copies, {submissionId:trimmed.submissionId})).toMatchObject({status:"suspected",
      matches:[{submissionId:original.submissionId, score:1, overlapMs:0}]});
    expect(await f.t.mutation(api.finance.acceptAndPublish, {demoIdentity:"controller", submissionId:trimmed.submissionId}))
      .toMatchObject({ok:false, code:"duplicate_submission", matchingSubmissionId:original.submissionId});
    expect(await f.t.run(ctx => ctx.db.query("payables").collect())).toHaveLength(1);
    expect(await f.t.run(ctx => ctx.db.query("deliveries").collect())).toHaveLength(1);
  });
});

it("binds optional self-reported diversity tags to the upload request so retries cannot relabel accepted coverage", async () => {
  const f = await setup(), item = await create(f, "tagged", { environment: " kitchen-a ", variant: "low-light" });
  expect(await f.t.run(ctx => ctx.db.get(item.submissionId))).toMatchObject({ environment: "kitchen-a", variant: "low-light" });
  expect(await f.t.mutation(api.submissions.create, { ...item.args, environment: "kitchen-a" })).toMatchObject({ replayed: true });
  for (const change of [{ environment: "kitchen-b" }, { variant: "left-hand" }, { environment: undefined }]) {
    await expect(f.t.mutation(api.submissions.create, { ...item.args, ...change })).rejects.toThrow("submission_request_conflict");
  }
  for (const environment of ["", " ", "x".repeat(121), "kitchen\nother"]) {
    await expect(create(f, "invalid-tag", { environment })).rejects.toThrow("invalid_diversity_tag");
  }
});

it("accepts a browser MediaRecorder MIME value with codec parameters",async()=>{
  const f=await setup();
  const storageId=await upload(f.t,"synthetic browser bytes","video/webm;codecs=vp8,opus");
  const created=await f.t.mutation(api.submissions.create,{demoIdentity:"contributor",orderId:f.orderId,storageId,clientRequestId:"browser-mime",consentAcknowledged:true});
  const asset=await f.t.run(async ctx=>{const submission=await ctx.db.get(created.submissionId);return ctx.db.get(submission!.originalAssetId!);});
  expect(asset?.mimeType).toBe("video/webm");
});

it("does not mark a retry as copied merely because an earlier provider attempt failed",async()=>{
  const f=await setup(),first=await create(f,"failed-provider");
  const claim=await claimAndFacts(f,first);
  const rubric=await f.t.run(ctx=>ctx.db.get(f.taskVersionId));
  const report=buildVerificationReport({submissionId:first.submissionId,taskVersionId:f.taskVersionId,sourceHash:first.job.sourceHash,
    durationMs:12000,criteria:rubric!.criteria,modelRuns:[],duplicate:{status:"not_checked",matches:[]},failure:"gemini_timeout"});
  const reportJson=canonical(report),reportStorageId=await f.t.run(ctx=>ctx.storage.store(new Blob([reportJson],{type:"application/json"})));
  await f.t.mutation(internal.submissions.complete,{jobId:first.job._id,generation:claim.generation,reportJson,reportStorageId,
    reportHash:digest(report),observationsJson:"{}",processingElapsedMs:90_000,failureCode:"gemini_timeout"});
  const retry=await create(f,"retry-provider");await claimAndFacts(f,retry);
  expect(await f.t.query(internal.submissions.copies,{submissionId:retry.submissionId})).toEqual({status:"clear",matches:[]});
});
