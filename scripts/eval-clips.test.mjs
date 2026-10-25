import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { canonical, computeMetrics, criterionAgreement, riskCoverage, wilson, CRITERIA, LICENSING_WARNING, preflightManifest, runEvaluation, runModelComparison, COMPARISON_VIDEO_MODELS, validateStoredReport } from "./eval-clips.mjs";

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
  // Report tests perform real local writes: a 5 ms wall deadline flakes under parallel checks.
  // Timeout tests inject a clock, so a realistic allowance does not add real waiting.
  return { dir, manifest, manifestPath, outputDir, save, options: { manifestPath, outputDir, url: "https://unit-test.convex.cloud", timeoutMs: 1000, pollMs: 2 } };
}

function storedResponse(row, options = {}) {
  const failed = options.failed ?? false, review = options.review ?? false;
  const quality = { schemaVersion: "1.0", reportId: `fixture:${row._id}`, submissionId: row._id, taskVersionId: "frozen-rubric",
    source: { sha256: row.sourceHash, durationMs: 1000 },
    pipeline: { version: "fixture-pipeline-not-live", status: failed ? "failed" : review ? "needs_review" : "completed", implementation: "inference",
      modelRuns: [{ provider: "fixture-not-live", model: options.actualVideoModel ?? row.evalVideoModel ?? "fixture-not-live", promptVersion: row.evalVideoModel ? "timestamped-frames-visible-events-v1" : "fixture-not-live", elapsedMs: options.videoLatency ?? 25 }] },
    criteria: CRITERIA.map((criterionId, index) => ({ criterionId, status: failed || review ? "unobservable" : "supported",
      evidence: failed || review ? [] : [{ modality: index === 2 ? "audio" : "video", startMs: 0, endMs: 500, claim: "synthetic test evidence" }], reason: "Synthetic test result only" })),
    duplicate: { status: "clear", matches: [] }, recommendation: failed || review ? "needs_review" : "accept",
    warnings: failed ? ["Analysis did not complete; inspect the job error code before review."] : [] };
  const observations = { ...(failed ? { failureCode: "provider_unavailable" } : {
    video: { visibility: "clear", observations: [] }, audio: { transcript: "synthetic narration", segments: [], claims: [] } }),
    evaluation: { evaluationOnly: true, projectionVersion: "prelicensing-advisory-v1", qualityReport: quality, qualityReportHash: sha(canonical(quality)) } };
  return { verificationOnly: true, evalRunId: row.evalRunId, ...(row.evalVideoModel ? { evalVideoModel: row.evalVideoModel } : {}), sourceHash: row.sourceHash, processingElapsedMs: 80,
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
      if (name === "submissions:evaluationRun") return { submissions: options.contaminated ? [{ _id: "unknown", clientRequestId: "unknown" }] : rows.filter(row => row.evalRunId === args.evalRunId),
        truncated: options.truncated ?? false };
      if (name === "submissions:getReport") {
        const row = rows.find(row => row._id === args.submissionId);
        return options.pending || (options.pendingModel && options.pendingModel === row.evalVideoModel) ? { report: null } : storedResponse(row, { ...options, ...options.byModel?.[row.evalVideoModel] });
      }
      throw new Error(`unexpected query ${name}`);
    },
    async mutation(name, args) {
      calls.push({ name, args });
      if (name === "submissions:generateUploadUrl") return "https://upload.invalid/private-url";
      if (name === "submissions:create") {
        const source = f.manifest.samples[rows.length % f.manifest.samples.length];
        const row = { _id: `submission-${rows.length}`, clientRequestId: args.clientRequestId,
          sourceHash: source.contentSha256, evalRunId: args.evalRunId, ...(args.evalVideoModel ? { evalVideoModel: args.evalVideoModel } : {}) };
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
  assert.deepEqual(result.failureAdjustedDecisionAccuracyCi95, wilson(1, 3));
  assert.deepEqual(result.conditionalDecisionAccuracyCi95, wilson(1, 2));
  assert.deepEqual(result.falseAcceptance.ci95, wilson(1, 2));
  assert.deepEqual(result.riskCoverage, { autoDecidedCount: 2, errorCount: 1, coverage: 2 / 3, risk: .5 });
  assert.equal(result.latency.clientTerminalReportMs.p50, 200);
  assert.equal(result.latency.clientTerminalReportMs.p95, 900);
});

test("Wilson intervals bound small negative sets and leave empty denominators undefined", () => {
  for (const [k, n, bounds] of [[0, 15, [0, .204]], [0, 20, [0, .161]], [1, 15, [.012, .298]]]) {
    wilson(k, n).forEach((value, index) => assert.ok(Math.abs(value - bounds[index]) < .0005));
  }
  assert.equal(wilson(0, 0), null);
  assert.equal(wilson(15, 15)[1], 1);
  for (const [k, n] of [[-1, 5], [6, 5], [1.5, 5], [true, 5]]) assert.throws(() => wilson(k, n));
  const empty = computeMetrics([]);
  assert.equal(empty.falseAcceptance.ci95, null);
  assert.equal(empty.riskCoverage.coverage, null);
  assert.equal(empty.riskCoverage.risk, null);
});

test("criterion kappa reports expected-row confusion and undefined degenerate cases", () => {
  const agreement = criterionAgreement([["supported", "supported"], ["contradicted", "contradicted"],
    ["unobservable", "supported"], ["unobservable", "unobservable"]]);
  assert.equal(agreement.confusionMatrix.unobservable.supported, 1);
  assert.ok(Math.abs(agreement.cohenKappa - 7 / 11) < 1e-12);
  assert.equal(criterionAgreement([]).cohenKappa, null);
  assert.equal(criterionAgreement([["supported", "supported"]]).cohenKappa, null);
  assert.deepEqual(riskCoverage([["accept", "needs_review"]], 1),
    { autoDecidedCount: 0, errorCount: 0, coverage: 0, risk: null });
});

test("Python and JavaScript agree on uncertainty, criterion agreement and selective risk including failures", () => {
  const decisions = [["accept", "accept", true], ["needs_review", "accept", true], ["request_correction", "request_correction", true],
    ["needs_review", "needs_review", true], ["accept", "needs_review", false]];
  const cases = decisions.map(([human, actual, successfulAnalysis], index) => ({ sampleId: `parity-${index}`, expected: expected(human), successfulAnalysis,
    qualityReport: { recommendation: actual, criteria: Object.entries(expected(actual).criteria).map(([criterionId, status]) => ({ criterionId, status })) } }));
  const manifest = { schemaVersion: "1.0", syntheticMetadata: true, samples: cases.map(item => ({ sampleId: item.sampleId, split: "test",
    actorId: "parity-actor", sessionId: "parity-session", originRecordingId: item.sampleId, variant: "synthetic-test-only", expected: item.expected })) };
  const predictions = cases.map(item => ({ sampleId: item.sampleId, successfulAnalysis: item.successfulAnalysis,
    ...expected(item.qualityReport.recommendation) }));
  const py = JSON.parse(execFileSync("python3", ["-c", "import json,sys; from evals.evaluate import score_predictions; m,p=json.load(sys.stdin); print(json.dumps(score_predictions(m,p,'test')))"],
    { input: JSON.stringify([manifest, predictions]), encoding: "utf8" }));
  const js = computeMetrics(cases);
  for (const key of ["failureAdjustedDecisionAccuracy", "failureAdjustedDecisionAccuracyCi95", "conditionalDecisionAccuracy",
    "conditionalDecisionAccuracyCi95", "criterionAgreement", "riskCoverage"]) assert.deepEqual(js[key], py[key], key);
  assert.deepEqual(js.falseAcceptance.ci95, py.falseAcceptance.ci95);
  assert.equal(js.falseAcceptance.rate, py.falseAcceptance.rate);
  assert.equal(js.riskCoverage.coverage, .6);
  assert.equal(js.riskCoverage.risk, 1 / 3);
  assert.equal(js.criterionAgreement.count, 12);
});


test("paired models use identical frozen clips and labels with independent scopes and per-model metrics", async t => {
  const f = await fixture(t, 2);
  f.manifest.samples[1].expected = expected("needs_review"); await f.save();
  const mock = transport(f, { byModel: {
    "gemini-4-argon": { videoLatency: 5000 }, "gemini-3.8-flash": { review: true, videoLatency: 3000 },
  } });
  const result = await runModelComparison(f.options, { createClient: mock.createClient });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.run.models.map(item => item.videoModel), COMPARISON_VIDEO_MODELS);
  const [argon, flash] = result.run.models;
  assert.notEqual(argon.evalRunId, flash.evalRunId);
  assert.equal(argon.metrics.caseCount, 2); assert.equal(flash.metrics.caseCount, 2);
  assert.equal(argon.metrics.failureAdjustedDecisionAccuracy, .5); assert.equal(flash.metrics.failureAdjustedDecisionAccuracy, .5);
  assert.equal(argon.metrics.falseAcceptance.rate, 1); assert.equal(flash.metrics.falseAcceptance.rate, 0);
  assert.equal(argon.metrics.latency.videoRequestMs.p50, 5000); assert.equal(flash.metrics.latency.videoRequestMs.p95, 3000);
  const children = await Promise.all(result.run.models.map(item => readFile(item.resultPath, "utf8").then(JSON.parse)));
  assert.equal(children[0].manifestSha256, children[1].manifestSha256);
  assert.deepEqual(children[0].cases.map(item => [item.contentSha256, item.expected]), children[1].cases.map(item => [item.contentSha256, item.expected]));
  assert.equal(mock.uploads.length, 4);
  for (const call of mock.calls.filter(item => item.name === "submissions:create")) {
    assert.equal(call.args.verificationOnly, true); assert.ok(COMPARISON_VIDEO_MODELS.includes(call.args.evalVideoModel));
    assert.equal(JSON.stringify(call.args).includes("expected"), false);
  }
  const table = await readFile(result.resultPath.replace(/\.json$/, ".md"), "utf8");
  assert.match(table, /False-accept rate/); assert.match(table, /gemini-4-argon/); assert.match(table, /5000\/5000/);
});

test("paired resume polls each original submission and does not upload completed arms again", async t => {
  const f = await fixture(t), flags = { pendingModel: "gemini-3.8-flash" }, mock = transport(f, flags);
  let clock = Date.UTC(2026, 9, 25);
  const injected = { createClient: mock.createClient, now: () => clock, sleep: async ms => { clock += ms; } };
  const first = await runModelComparison(f.options, injected);
  assert.equal(first.exitCode, 1); assert.equal(first.run.models[0].status, "completed");
  flags.pendingModel = undefined;
  const resumed = await runModelComparison({ ...f.options, resume: first.resultPath }, injected);
  assert.equal(resumed.exitCode, 0); assert.equal(mock.uploads.length, 2);
  assert.equal(mock.calls.filter(item => item.name === "submissions:create").length, 2);
  assert.deepEqual(resumed.run.models.map(item => item.evalRunId), first.run.models.map(item => item.evalRunId));
});

test("explicit model evaluation refuses a stored response produced by the other video model", async t => {
  const f = await fixture(t), mock = transport(f, { actualVideoModel: "gemini-3.8-flash" });
  const result = await runEvaluation({ ...f.options, videoModel: "gemini-4-argon" }, { createClient: mock.createClient });
  assert.equal(result.exitCode, 1); assert.match(result.run.cases[0].error, /stored video model differs/);
  assert.equal(result.run.metrics.successfulAnalysisCoverage, 0);
});

test("paired model list and manifest remain frozen before another network connection", async t => {
  const f = await fixture(t), mock = transport(f);
  const first = await runModelComparison(f.options, { createClient: mock.createClient });
  const checkpoint = JSON.parse(await readFile(first.resultPath, "utf8"));
  checkpoint.models.reverse(); await writeFile(first.resultPath, JSON.stringify(checkpoint));
  let connected = false;
  await assert.rejects(runModelComparison({ ...f.options, resume: first.resultPath }, { createClient: async () => { connected = true; } }), /models differs/);
  assert.equal(connected, false);
  await writeFile(first.resultPath, JSON.stringify(first.run));
  await writeFile(f.manifestPath, `${await readFile(f.manifestPath, "utf8")}\n`);
  await assert.rejects(runModelComparison({ ...f.options, resume: first.resultPath }, { createClient: async () => { connected = true; } }), /manifest/);
  assert.equal(connected, false);
});

test("invalid model selection fails before constructing a network client", async t => {
  const f = await fixture(t);
  let connected = false;
  const injected = { createClient: async () => { connected = true; } };
  await assert.rejects(runEvaluation({ ...f.options, videoModel: "arbitrary-unapproved-model" }, injected), /unsupported evaluation video model/);
  await assert.rejects(runModelComparison({ ...f.options, videoModel: "gemini-4-argon" }, injected), /choose/);
  assert.equal(connected, false);
});

test("paired evaluation refuses rubric drift before uploading the second arm", async t => {
  const f = await fixture(t), mock = transport(f), originalQuery = mock.client.query;
  let summaries = 0;
  mock.client.query = async (name, args) => {
    const result = await originalQuery(name, args);
    if (name === "dashboard:orderSummary" && ++summaries === 2) result.rubric.contentHash = "c".repeat(64);
    return result;
  };
  const result = await runModelComparison(f.options, { createClient: mock.createClient });
  assert.equal(result.exitCode, 1);
  assert.equal(result.run.models[0].status, "completed");
  assert.match(result.run.models[1].error, /rubric content hash/);
  assert.equal(mock.uploads.length, 1);
});

test("a failed model arm earns no accuracy credit while the other arm still runs", async t => {
  const f = await fixture(t);
  f.manifest.samples[0].expected = expected("needs_review"); await f.save();
  const mock = transport(f, { byModel: { "gemini-4-argon": { failed: true }, "gemini-3.8-flash": { review: true } } });
  const result = await runModelComparison(f.options, { createClient: mock.createClient });
  assert.equal(result.exitCode, 1);
  assert.equal(result.run.models[0].metrics.failureAdjustedDecisionAccuracy, 0);
  assert.equal(result.run.models[0].metrics.successfulAnalysisCoverage, 0);
  assert.equal(result.run.models[1].metrics.failureAdjustedDecisionAccuracy, 1);
  assert.equal(mock.uploads.length, 2);
});
