// @vitest-environment node
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeAbiParameters, decodeFunctionData, encodePacked, keccak256, parseAbiParameters, zeroAddress } from "viem";
import { internal } from "./_generated/api";
import schema from "./schema";
import { canonical, digest } from "./lib/finance";
import { EAS_ABI, EAS_ADDRESS, EAS_SCHEMA, EAS_SCHEMA_UID, attestTransaction, buildAttestationFields, sha256Text } from "./lib/eas";
import { LEASE_MS, RETRY_MS } from "./attestations";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const mutation = (name: string) => makeFunctionReference<"mutation">(`attestations:${name}`);
const query = (name: string) => makeFunctionReference<"query">(`attestations:${name}`);
const ATTESTOR = `0x${"1".repeat(40)}`;
const TX = `0x${"2".repeat(64)}`;
const UID = `0x${"3".repeat(64)}`;
const PRIVATE_TEXT = "private contributor name and https://private.example/media";

// Every report, source byte, chain identifier and CDP response in this file is synthetic.
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-25T10:00:00Z")); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });
async function setup() {
  const t = convexTest(schema, modules);
  return { t, ...await t.mutation(internal.seed.demo, {}) };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function completed(f: Fixture, verificationOnly = false, suffix = "1") {
  return f.t.run(async ctx => {
    const sourceHash = sha256Text(`synthetic source ${suffix}`);
    const submissionId = await ctx.db.insert("submissions", {
      organizationId: f.organizationId, orderId: f.orderId, taskVersionId: f.taskVersionId,
      contributorTokenIdentifier: "demo:skarl:contributor", clientRequestId: `attest-test-${suffix}`,
      verificationOnly, status: "needs_review", sourceHash, updatedAt: Date.now(),
    });
    const scope = "Synthetic consent fixture";
    const licenseVersion = "demo-consent-v1";
    const consentRecordId = await ctx.db.insert("consentRecords", { organizationId: f.organizationId, submissionId,
      contributorTokenIdentifier: "demo:skarl:contributor", scope, licenseVersion,
      licenseHash: digest({ licenseVersion, scope }), receiptHash: "a".repeat(64), acknowledgedAt: Date.now() });
    const jobId = await ctx.db.insert("jobs", { organizationId: f.organizationId, submissionId, taskVersionId: f.taskVersionId,
      sourceHash, pipelineVersion: "red-cup-evidence-1.1", status: "completed", availableAt: Date.now(), attempt: 1, maxAttempts: 1, leaseGeneration: 1 });
    const report = { schemaVersion: "1.0", reportId: "synthetic", submissionId, taskVersionId: f.taskVersionId,
      source: { sha256: sourceHash, durationMs: 12000 },
      pipeline: { version: "red-cup-evidence-1.1", implementation: "inference", status: "completed", modelRuns: [
        { provider: "google", model: "gemini-3.8-flash", promptVersion: "timestamped-frames-visible-events-v1" },
        { provider: "google", model: "gemini-3.5-transcribe", promptVersion: "audio-only-events-v1" },
      ] }, recommendation: "needs_review", criteria: [], warnings: [PRIVATE_TEXT] };
    const reportJson = canonical(report);
    const reportStorageId = await ctx.storage.store(new Blob([reportJson], { type: "application/json" }));
    const analysisId = await ctx.db.insert("analysisResults", { organizationId: f.organizationId, jobId, submissionId,
      taskVersionId: f.taskVersionId, sourceHash, pipelineVersion: report.pipeline.version, leaseGeneration: 1,
      summary: PRIVATE_TEXT, reportJson, reportStorageId, reportHash: digest(report), evidenceAssetIds: [],
      completedAt: Date.now(), implementation: "inference", pipelineStatus: "completed", recommendation: "needs_review" });
    await ctx.db.patch(submissionId, { currentAnalysisId: analysisId, consentRecordId });
    return { analysisId, submissionId, consentRecordId, report, reportJson };
  });
}
async function claim(f: Fixture, item: Awaited<ReturnType<typeof completed>>) {
  return f.t.mutation(mutation("claim"), { analysisId: item.analysisId, attestor: ATTESTOR });
}
async function money(f: Fixture) {
  return f.t.run(async ctx => ({ payables: await ctx.db.query("payables").collect(),
    commands: await ctx.db.query("paymentCommands").collect(), journals: await ctx.db.query("journalEntries").collect() }));
}

describe("attestation persistence and public disclosure", () => {
  it("claims once per analysis and leases concurrent workers; later attempts retain the exact external request identity", async () => {
    const f = await setup(), item = await completed(f);
    const results = await Promise.all([claim(f, item), claim(f, item)]);
    const rows = results.filter(Boolean);
    expect(rows).toHaveLength(1);
    const first = rows[0];
    expect(first.fields).toMatchObject({ licensed: true, reportHash: `0x${digest(item.report)}`, videoModel: "gemini-3.8-flash" });
    vi.setSystemTime(Date.now() + LEASE_MS + 1);
    const resumed = await claim(f, item);
    expect(resumed._id).toBe(first._id);
    expect(resumed.requestId).toBe(first.requestId);
    expect(resumed.fields).toEqual(first.fields);
    expect(resumed.generation).toBe(first.generation + 1);
    await expect(f.t.mutation(mutation("markSending"), { id: first._id, generation: first.generation, startBlock: "123" })).rejects.toThrow("stale_attestation_attempt");
    await f.t.mutation(mutation("finish"), { id: first._id, generation: first.generation, error: "old_worker_failed" });
    expect((await f.t.run(ctx => ctx.db.get(first._id)))!.error).toBeUndefined();
  });

  it("publishes only confirmed current-analysis commitments and never writes financial state", async () => {
    const f = await setup(), item = await completed(f), before = await money(f);
    const row = await claim(f, item);
    expect(await f.t.query(query("forSubmission"), { submissionId: item.submissionId })).toBeNull();
    await f.t.mutation(mutation("recordTransaction"), { id: row._id, generation: row.generation, txHash: TX });
    expect(await f.t.query(query("forSubmission"), { submissionId: item.submissionId })).toBeNull();
    await f.t.mutation(mutation("finish"), { id: row._id, generation: row.generation, uid: UID, txHash: TX, logIndex: 0 });
    const view = await f.t.query(query("forSubmission"), { submissionId: item.submissionId });
    expect(Object.keys(view).sort()).toEqual(["basescanUrl", "easscanUrl", "fields", "txHash", "uid"]);
    expect(Object.keys(view.fields).sort()).toEqual(["licensed", "pipelineVersion", "recommendation", "reportHash", "rubricHash", "sourceSha256", "verifiedAt", "videoModel"]);
    expect(view).toMatchObject({ uid: UID, txHash: TX, easscanUrl: `https://base-sepolia.easscan.org/attestation/view/${UID}`,
      basescanUrl: `https://sepolia.basescan.org/tx/${TX}` });
    expect(JSON.stringify(view)).not.toContain(PRIVATE_TEXT);
    expect(JSON.stringify(view)).not.toContain(item.submissionId);
    expect(JSON.stringify(view)).not.toContain("demo:skarl:contributor");
    expect(await claim(f, item)).toBeNull();
    expect(await money(f)).toEqual(before);
    const newer = await completed(f, false, "newer");
    await f.t.run(ctx => ctx.db.patch(item.submissionId, { currentAnalysisId: newer.analysisId }));
    expect(await f.t.query(query("forSubmission"), { submissionId: item.submissionId })).toBeNull();
  });

  it("never marks verification-only uploads licensed, even if a normal consent record is attached", async () => {
    const f = await setup(), item = await completed(f, true);
    expect((await claim(f, item)).fields.licensed).toBe(false);
  });
  it.each(["missing", "wrong_scope", "changed_hash"])("fails closed on %s licensing provenance", async variant => {
    const f = await setup(), item = await completed(f);
    await f.t.run(async ctx => {
      if (variant === "missing") await ctx.db.patch(item.submissionId, { consentRecordId: undefined });
      else if (variant === "wrong_scope") await ctx.db.patch(item.consentRecordId, { licenseVersion: "verification-only-v1" });
      else await ctx.db.patch(item.consentRecordId, { licenseHash: "f".repeat(64) });
    });
    expect((await claim(f, item)).fields.licensed).toBe(false);
  });
  it.each(["bytes", "hash", "source", "pipeline"])("refuses changed report %s before reserving an external attempt", async variant => {
    const f = await setup(), item = await completed(f);
    await f.t.run(ctx => ctx.db.patch(item.analysisId, variant === "bytes" ? { reportJson: ` ${item.reportJson}` }
      : variant === "hash" ? { reportHash: "f".repeat(64) }
      : variant === "source" ? { sourceHash: "f".repeat(64) }
      : { pipelineVersion: "red-cup-evidence-9.9" }));
    expect(await claim(f, item)).toBeNull();
    const failures = await f.t.run(ctx => ctx.db.query("attestations").collect());
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ status: "failed", error: "attestation_report_invalid", analysisId: item.analysisId });
    expect(failures[0]!.fields).toBeUndefined();
    expect(failures[0]!.firstSendAt).toBeUndefined();
    expect(JSON.stringify(failures)).not.toContain(PRIVATE_TEXT);
    expect(await f.t.query(query("forSubmission"), { submissionId: item.submissionId })).toBeNull();
  });
  it("retries invalid legacy metadata after correction without duplicating durable intent", async () => {
    const f = await setup(), item = await completed(f);
    await f.t.run(ctx => ctx.db.patch(item.analysisId, { reportJson: "{invalid private parser input" }));
    expect(await claim(f, item)).toBeNull();
    const failed = (await f.t.run(ctx => ctx.db.query("attestations").collect()))[0]!;
    await expect(f.t.mutation(mutation("finish"), { id: failed._id, generation: failed.generation, uid: UID, txHash: TX, logIndex: 0 })).rejects.toThrow("invalid_attestation_receipt");
    await f.t.run(ctx => ctx.db.patch(item.analysisId, { reportJson: item.reportJson }));
    const retry = await claim(f, item);
    expect(retry._id).toBe(failed._id); expect(retry.status).toBe("pending"); expect(retry.error).toBeUndefined();
    expect(retry.fields).toMatchObject({ reportHash: `0x${digest(item.report)}`, licensed: true });
    expect(await f.t.run(ctx => ctx.db.query("attestations").collect())).toHaveLength(1);
  });
  it("uses a new CDP key only after an exact known revert and keeps old transaction history", async () => {
    const f = await setup(), item = await completed(f), first = await claim(f, item);
    let row = first;
    for (let attempt = 1; attempt <= 4; attempt++) {
      const txHash = `0x${String(attempt + 4).repeat(64)}`;
      await f.t.mutation(mutation("markSending"), { id: row._id, generation: row.generation, startBlock: "123" });
      await f.t.mutation(mutation("recordTransaction"), { id: row._id, generation: row.generation, txHash });
      await expect(f.t.mutation(mutation("retryReverted"), { id: row._id, generation: row.generation, txHash: TX })).rejects.toThrow("attestation_transaction_conflict");
      await f.t.mutation(mutation("retryReverted"), { id: row._id, generation: row.generation, txHash });
      const state = (await f.t.run(ctx => ctx.db.get(row._id)))!;
      if (attempt <= 3) {
        expect(state.previousAttempts).toHaveLength(attempt);
        expect(state.previousAttempts![attempt - 1]).toEqual({ txHash, requestId: row.requestId });
        expect(state.requestId).not.toBe(row.requestId);
        expect(state.txHash).toBeUndefined(); expect(state.firstSendAt).toBeUndefined(); expect(state.startBlock).toBeUndefined();
        expect(state.status).toBe("failed"); expect(state.error).toBe("attestation_transaction_reverted");
        row = await claim(f, item);
      } else {
        expect(state.previousAttempts).toHaveLength(3);
        expect(state.requestId).toBe(row.requestId); expect(state.txHash).toBe(txHash);
        expect(state.status).toBe("failed"); expect(state.error).toBe("attestation_revert_limit");
      }
    }
  });
  it("retains the transaction through timeout/failure and rejects conflicting transaction hashes", async () => {
    const f = await setup(), item = await completed(f), row = await claim(f, item);
    await f.t.mutation(mutation("markSending"), { id: row._id, generation: row.generation, startBlock: "123" });
    await f.t.mutation(mutation("recordTransaction"), { id: row._id, generation: row.generation, txHash: TX });
    await f.t.mutation(mutation("finish"), { id: row._id, generation: row.generation, error: "chain_outcome_unknown" });
    const failed = await f.t.run(ctx => ctx.db.get(row._id));
    expect(failed).toMatchObject({ status: "failed", txHash: TX, startBlock: "123", requestId: row.requestId });
    expect(await f.t.query(query("forSubmission"), { submissionId: item.submissionId })).toBeNull();
    vi.setSystemTime(Date.now() + RETRY_MS + 1);
    const resumed = await claim(f, item);
    await expect(f.t.mutation(mutation("recordTransaction"), { id: row._id, generation: resumed.generation, txHash: `0x${"4".repeat(64)}` })).rejects.toThrow("attestation_transaction_conflict");
    await expect(f.t.mutation(mutation("finish"), { id: row._id, generation: resumed.generation, error: "https://provider.example/SECRET" })).rejects.toThrow("unsafe_attestation_error");
  });
  it("paginates beyond the first twenty reports and suppresses already-reserved rows", async () => {
    const f = await setup();
    const items = [];
    for (let i = 0; i < 23; i++) items.push(await completed(f, false, String(i)));
    await claim(f, items[0]!);
    const first = await f.t.mutation(mutation("enqueuePage"), {});
    expect(first.scheduled).toBe(19);
    expect(first.cursor).toBeTruthy();
    const second = await f.t.mutation(mutation("enqueuePage"), { cursor: first.cursor });
    expect(second).toEqual({ scheduled: 3, cursor: null });
  });
  it("does not enqueue an unexpired worker and deduplicates due retry scheduling", async () => {
    const f = await setup(), item = await completed(f), row = await claim(f, item);
    expect(await f.t.mutation(mutation("enqueueRetries"), {})).toBe(0);
    await f.t.mutation(mutation("finish"), { id: row._id, generation: row.generation, error: "provider_unavailable" });
    vi.setSystemTime(Date.now() + RETRY_MS + 1);
    expect(await f.t.mutation(mutation("enqueueRetries"), {})).toBe(1);
    expect(await f.t.mutation(mutation("enqueueRetries"), {})).toBe(0);
  });
});

describe("public EAS payload and trust boundaries", () => {
  function input() {
    const report = { submissionId: "synthetic-submission", taskVersionId: "synthetic-rubric", source: { sha256: "a".repeat(64) },
      pipeline: { version: "red-cup-evidence-1.1", implementation: "inference", status: "completed",
        modelRuns: [{ model: "gemini-4-argon", promptVersion: "timestamped-frames-visible-events-v1" }] },
      recommendation: "accept", warnings: [PRIVATE_TEXT] };
    return { report, args: { reportJson: canonical(report), reportHash: digest(report), sourceHash: report.source.sha256,
      rubricHash: "b".repeat(64), pipelineVersion: report.pipeline.version, submissionId: report.submissionId,
      taskVersionId: report.taskVersionId, completedAt: Date.now(), licensed: false } };
  }
  it("derives the revocable/no-resolver schema UID and encodes zero-recipient metadata only", () => {
    expect(EAS_SCHEMA_UID).toBe(keccak256(encodePacked(["string", "address", "bool"], [EAS_SCHEMA, zeroAddress, true])));
    const { args } = input(), fields = buildAttestationFields(args), tx = attestTransaction(fields);
    expect(tx.to).toBe(EAS_ADDRESS); expect(tx.value).toBe(0n);
    const decoded = decodeFunctionData({ abi: EAS_ABI, data: tx.data });
    expect(decoded.functionName).toBe("attest");
    const request = decoded.args![0] as { schema: string; data: { recipient: string; revocable: boolean; data: `0x${string}` } };
    expect(request.schema).toBe(EAS_SCHEMA_UID); expect(request.data.recipient).toBe(zeroAddress); expect(request.data.revocable).toBe(true);
    expect(decodeAbiParameters(parseAbiParameters(EAS_SCHEMA), request.data.data)).toEqual([
      fields.reportHash, fields.sourceSha256, fields.rubricHash, fields.pipelineVersion, "gemini-4-argon", "accept", BigInt(fields.verifiedAt), false,
    ]);
    expect(Buffer.from(tx.data.slice(2), "hex").toString()).not.toContain(PRIVATE_TEXT);
  });
  it.each(["failed", "ml_unavailable", "needs_review", "scaffold"])("never publishes an acceptance for %s analysis", status => {
    const { report, args } = input();
    if (status === "scaffold") report.pipeline.implementation = status;
    else report.pipeline.status = status;
    expect(() => buildAttestationFields({ ...args, reportJson: canonical(report), reportHash: digest(report) })).toThrow("invalid_attestation_recommendation");
  });
  it("rejects model/version metadata containing private free text", () => {
    const { report, args } = input();
    report.pipeline.modelRuns[0]!.model = PRIVATE_TEXT;
    expect(() => buildAttestationFields({ ...args, reportJson: canonical(report), reportHash: digest(report) })).toThrow("unapproved_video_model");
    report.pipeline.modelRuns[0]!.model = "gemini-4-argon";
    report.pipeline.version = PRIVATE_TEXT;
    expect(() => buildAttestationFields({ ...args, pipelineVersion: PRIVATE_TEXT, reportJson: canonical(report), reportHash: digest(report) })).toThrow("unapproved_pipeline_version");
  });
});
