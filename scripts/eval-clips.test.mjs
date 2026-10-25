import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { canonical, computeMetrics, CRITERIA, LICENSING_WARNING, preflightManifest, runEvaluation, validateStoredReport } from "./eval-clips.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
const expected = recommendation => ({ recommendation, duplicateStatus: "clear",
  criteria: Object.fromEntries(CRITERIA.map(id => [id, recommendation === "accept" ? "supported" : "unobservable"])) });

async function fixture(t, count = 1) {
  const dir = await mkdtemp(join(tmpdir(), "skarl-eval-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const manifest = { schemaVersion: "1.0", syntheticMetadata: false, samples: [] };
  for (let index = 0; index < count; index++) {
    // Deliberately not a playable recording: transport/model results are mocked.
    const bytes = Buffer.from(`synthetic-test-bytes-${index}`), mediaPath = `case-${index}.mp4`;
    await writeFile(join(dir, mediaPath), bytes);
    manifest.samples.push({ sampleId: `case-${index}`, actorId: "test-only-machine-actor", sessionId: "test-only-session",
      originRecordingId: `test-only-recording-${index}`, split: "test", variant: "unit-test-placeholder", mediaPath,
      contentSha256: sha(bytes), expected: expected("accept") });
  }
  const manifestPath = join(dir, "manifest.json"), outputDir = join(dir, "results");
  const save = () => writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  await save();
  return { dir, manifest, manifestPath, outputDir, save, options: { manifestPath, outputDir, url: "https://unit-test.convex.cloud", timeoutMs: 5, pollMs: 2 } };
}

function storedResponse(row, options = {}) {
  const failed = options.failed ?? false;
  const quality = { schemaVersion: "1.0", reportId: `fixture:${row._id}`, submissionId: row._id, taskVersionId: "frozen-rubric",
    source: { sha256: row.sourceHash, durationMs: 1000 },
    pipeline: { version: "fixture-pipeline-not-live", status: failed ? "failed" : "completed", implementation: "inference",
      modelRuns: [{ provider: "fixture-not-live", model: "fixture-not-live", promptVersion: "fixture-not-live" }] },
    criteria: CRITERIA.map((criterionId, index) => ({ criterionId, status: failed ? "unobservable" : "supported",
      evidence: failed ? [] : [{ modality: index === 2 ? "audio" : "video", startMs: 0, endMs: 500, claim: "synthetic test evidence" }], reason: "Synthetic test result only" })),
    duplicate: { status: "clear", matches: [] }, recommendation: failed ? "needs_review" : "accept",
    warnings: failed ? ["Analysis did not complete; inspect the job error code before review."] : [] };
  const observations = { ...(failed ? { failureCode: "provider_unavailable" } : {
    video: { visibility: "clear", observations: [] }, audio: { transcript: "synthetic narration", segments: [], claims: [] } }),
    evaluation: { evaluationOnly: true, projectionVersion: "prelicensing-advisory-v1", qualityReport: quality, qualityReportHash: sha(canonical(quality)) } };
  return { verificationOnly: true, evalRunId: row.evalRunId, sourceHash: row.sourceHash, processingElapsedMs: 80,
    observations, report: { ...quality, pipeline: { ...quality.pipeline, status: failed ? "failed" : "needs_review" },
      recommendation: "needs_review", warnings: [...quality.warnings, LICENSING_WARNING] } };
}

function transport(f, options = {}) {
  const rows = [], calls = [], uploads = [];
  const client = {
    async query(name, args) {
      calls.push({ name, args });
      if (name === "dashboard:demoContext") return { orderId: "demo-order", taskVersionId: "frozen-rubric" };
      if (name === "dashboard:orderSummary") return { rubric: { _id: "frozen-rubric", orderId: "demo-order", frozenAt: 1,
        contentHash: "b".repeat(64), criteria: CRITERIA.map(criterionId => ({ criterionId })) } };
      if (name === "submissions:evaluationRun") return { submissions: options.contaminated ? [{ _id: "unknown", clientRequestId: "unknown" }] : rows,
        truncated: options.truncated ?? false };
      if (name === "submissions:getReport") return options.pending ? { report: null } : storedResponse(rows.find(row => row._id === args.submissionId), options);
      throw new Error(`unexpected query ${name}`);
    },
    async mutation(name, args) {
      calls.push({ name, args });
      if (name === "submissions:generateUploadUrl") return "https://upload.invalid/private-url";
      if (name === "submissions:create") {
        const source = f.manifest.samples[rows.length];
        const row = { _id: `submission-${rows.length}`, clientRequestId: args.clientRequestId,
          sourceHash: source.contentSha256, evalRunId: args.evalRunId };
        rows.push(row);
        return { submissionId: row._id };
      }
      throw new Error(`unexpected mutation ${name}`);
    },
    async upload(url, bytes, mime) { uploads.push({ url, bytes, mime }); return `storage-${uploads.length}`; },
  };
  return { client, rows, calls, uploads, createClient: async () => client };
}

test("preflight rejects synthetic metadata, wrong hashes and rubric labels before client construction", async t => {
  for (const invalid of ["synthetic", "hash", "rubric"]) {
    const f = await fixture(t);
    if (invalid === "synthetic") f.manifest.syntheticMetadata = true;
    if (invalid === "hash") f.manifest.samples[0].contentSha256 = "a".repeat(64);
    if (invalid === "rubric") f.manifest.samples[0].expected.criteria = { object: "supported" };
    await f.save();
    let clients = 0;
    await assert.rejects(runEvaluation(f.options, { createClient: async () => { clients++; throw new Error("must not connect"); } }));
    assert.equal(clients, 0);
  }
});

test("duplicate dependency must precede the selected case", async t => {
  const f = await fixture(t, 2);
  f.manifest.samples[0].duplicateOf = "case-1"; await f.save();
  await assert.rejects(preflightManifest(f.manifestPath), /prior selected case/);
});

test("freezes exact labels before any network and never sends labels in mutation arguments", async t => {
  const f = await fixture(t), mock = transport(f);
  const createClient = async () => {
    const path = (await readdir(f.outputDir)).find(name => name.endsWith(".json") && !name.endsWith(".manifest.json"));
    const frozen = JSON.parse(await readFile(join(f.outputDir, path), "utf8"));
    assert.equal(frozen.frozenManifestRaw, await readFile(f.manifestPath, "utf8"));
    assert.deepEqual(frozen.cases[0].expected, f.manifest.samples[0].expected);
    return mock.client;
  };
  const result = await runEvaluation(f.options, { createClient });
  assert.equal(result.exitCode, 0);
  assert.equal(result.run.rawScorer.inferenceRan, false);
  assert.equal(result.run.metrics.failureAdjustedDecisionAccuracy, 1);
  assert.equal(result.run.provenance.frozenRubric.contentHash, "b".repeat(64));
  assert.match(result.run.provenance.runnerSha256, /^[a-f0-9]{64}$/);
  assert.equal(typeof result.run.provenance.gitDirty, "boolean");
  assert.equal(mock.uploads.length, 1);
  for (const call of mock.calls) assert.equal(JSON.stringify(call.args).includes("expected"), false);
  const creation = mock.calls.find(call => call.name === "submissions:create").args;
  assert.equal(creation.verificationOnly, true);
  assert.match(creation.evalRunId, /^eval-/);
  assert.deepEqual(Object.keys(creation).sort(), ["demoIdentity", "orderId", "storageId", "clientRequestId", "consentAcknowledged", "verificationOnly", "evalRunId"].sort());
});

test("valid provider fallback reviews can be scored but never earn successful accuracy", async t => {
  const f = await fixture(t);
  f.manifest.samples[0].expected = expected("needs_review"); await f.save();
  const mock = transport(f, { failed: true });
  const result = await runEvaluation(f.options, { createClient: mock.createClient });
  assert.equal(result.exitCode, 1);
  assert.equal(result.run.rawScorer.inferenceRan, false);
  assert.equal(result.run.rawScorer.recommendations.accuracy, 1);
  assert.equal(result.run.metrics.failureAdjustedDecisionAccuracy, 0);
  assert.equal(result.run.metrics.successfulAnalysisCoverage, 0);
  assert.equal(result.run.metrics.reviewRate, 1);
  assert.equal(result.run.metrics.successfulReviewRate, 0);
  assert.equal(result.run.metrics.storedReportReviewCount, 1);
});

test("timeouts remain censored and resume polls the same submission without upload/create", async t => {
  const f = await fixture(t), options = { pending: true }, mock = transport(f, options);
  let clock = Date.UTC(2026, 9, 25);
  const injected = { createClient: mock.createClient, now: () => clock, sleep: async ms => { clock += ms; } };
  const first = await runEvaluation(f.options, injected);
  assert.equal(first.exitCode, 1);
  assert.equal(first.run.cases[0].state, "timed_out");
  assert.equal(first.run.rawScorer.notRunReason, "incomplete_prediction_coverage");
  assert.equal(first.run.metrics.latency.rightCensored.length, 1);
  options.pending = false;
  const resumed = await runEvaluation({ ...f.options, resume: first.resultPath }, injected);
  assert.equal(resumed.exitCode, 0);
  assert.equal(mock.uploads.length, 1);
  assert.equal(mock.calls.filter(call => call.name === "submissions:create").length, 1);
  assert.equal(resumed.run.cases[0].submissionId, first.run.cases[0].submissionId);
  assert.equal(resumed.run.cloud.resumeCount, 1);
});

test("resume rejects changed manifest bytes before any network", async t => {
  const f = await fixture(t), mock = transport(f);
  const first = await runEvaluation(f.options, { createClient: mock.createClient });
  await writeFile(f.manifestPath, `${await readFile(f.manifestPath, "utf8")}\n`);
  let connected = false;
  await assert.rejects(runEvaluation({ ...f.options, resume: first.resultPath }, { createClient: async () => { connected = true; } }), /frozen manifest/);
  assert.equal(connected, false);
});

test("resume discovers an ambiguously committed create instead of submitting analysis again", async t => {
  const f = await fixture(t), mock = transport(f);
  const mutation = mock.client.mutation;
  let lost = false;
  mock.client.mutation = async (name, args) => {
    const result = await mutation(name, args);
    if (name === "submissions:create" && !lost) { lost = true; throw new Error("simulated lost create response"); }
    return result;
  };
  const first = await runEvaluation(f.options, { createClient: mock.createClient });
  assert.equal(first.exitCode, 1);
  const resumed = await runEvaluation({ ...f.options, resume: first.resultPath }, { createClient: mock.createClient });
  assert.equal(resumed.exitCode, 0);
  assert.equal(mock.uploads.length, 1);
  assert.equal(mock.calls.filter(call => call.name === "submissions:create").length, 1);
});

test("unknown or truncated run inventory aborts without uploading", async t => {
  for (const flags of [{ contaminated: true }, { truncated: true }]) {
    const f = await fixture(t), mock = transport(f, flags);
    const result = await runEvaluation(f.options, { createClient: mock.createClient });
    assert.equal(result.exitCode, 1);
    assert.match(result.run.error, /scope/);
    assert.equal(mock.uploads.length, 0);
  }
});

test("failed duplicate references block dependents without upload", async t => {
  const f = await fixture(t, 2);
  f.manifest.samples[1].duplicateOf = "case-0"; await f.save();
  const mock = transport(f, { failed: true });
  const result = await runEvaluation(f.options, { createClient: mock.createClient });
  assert.equal(result.run.cases[1].state, "blocked");
  assert.equal(mock.uploads.length, 1);
  assert.equal(result.run.rawScorer.notRunReason, "incomplete_prediction_coverage");
});

test("stored quality validation rejects wrong content hash and discarded warnings", () => {
  const row = { _id: "submission", sourceHash: "a".repeat(64), evalRunId: "eval-test" };
  const item = { submissionId: row._id, contentSha256: row.sourceHash };
  const run = { evalRunId: row.evalRunId, taskVersionId: "frozen-rubric" };
  const response = storedResponse(row);
  assert.equal(validateStoredReport(response, item, run).successfulAnalysis, true);
  const wrong = structuredClone(response); wrong.observations.evaluation.qualityReportHash = "b".repeat(64);
  assert.throws(() => validateStoredReport(wrong, item, run), /canonical hash/);
  const discarded = storedResponse(row, { failed: true }); discarded.report.warnings = [LICENSING_WARNING];
  assert.throws(() => validateStoredReport(discarded, item, run), /non-licensing/);
  const source = storedResponse(row);
  source.observations.evaluation.qualityReport.source.sha256 = "c".repeat(64);
  source.observations.evaluation.qualityReportHash = sha(canonical(source.observations.evaluation.qualityReport));
  assert.throws(() => validateStoredReport(source, item, run), /source\/rubric/);
  const altered = storedResponse(row); altered.report.reportId = "different-report";
  assert.throws(() => validateStoredReport(altered, item, run), /beyond the licensing guard/);
});

test("failure-adjusted metrics preserve negative denominators and nearest-rank percentiles", () => {
  const cases = [
    { sampleId: "false-accept", expected: expected("needs_review"), successfulAnalysis: true,
      qualityReport: { recommendation: "accept" }, clientTerminalReportMs: 100, processingElapsedMs: 70 },
    { sampleId: "failed-review", expected: expected("needs_review"), successfulAnalysis: false,
      qualityReport: { recommendation: "needs_review" }, clientTerminalReportMs: 900, processingElapsedMs: 800 },
    { sampleId: "correct", expected: expected("accept"), successfulAnalysis: true,
      qualityReport: { recommendation: "accept" }, clientTerminalReportMs: 200, processingElapsedMs: 100 },
  ];
  const result = computeMetrics(cases);
  assert.equal(result.failureAdjustedDecisionAccuracy, 1 / 3);
  assert.equal(result.conditionalDecisionAccuracy, .5);
  assert.equal(result.falseAcceptance.rate, .5);
  assert.equal(result.latency.clientTerminalReportMs.p50, 200);
  assert.equal(result.latency.clientTerminalReportMs.p95, 900);
});
