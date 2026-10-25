#!/usr/bin/env node
/** Private real-clip evaluation. Labels stay local; no acceptance/payment APIs. */
import { readFile, writeFile, stat, mkdir, rename } from "node:fs/promises";
import { resolve, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { resolveTaskSpec } from "../convex/lib/taskSpec.ts";
import { validateVerificationReportForRubric } from "@skarl/contracts/verification";
import { EVALUATION_VIDEO_MODELS, applyContentEvaluationGuard, CONTENT_EVALUATION_PROJECTION_VERSION } from "../convex/lib/verificationReport.ts";

const execute = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCORER = join(ROOT, "evals/evaluate.py");
export const RUNNER_VERSION = "real-clips-v3-content-scope";
export const COMPARISON_VIDEO_MODELS = EVALUATION_VIDEO_MODELS;
// Compatibility default for the original frozen evaluation manifests. New tasks set criterionIds.
export const CRITERIA = ["red-cup-pickup", "coaster-placement", "narration-alignment"];
export const LICENSING_WARNING = "Verification-only development upload; no training license, dataset sale, or payable may be created.";
const MIME = { ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime" };
const sha = value => createHash("sha256").update(value).digest("hex");
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
const sameIds = (values, expected = CRITERIA) => Array.isArray(values) && values.length === expected.length &&
  new Set(values).size === values.length && expected.every(id => values.includes(id));
const message = error => error instanceof Error ? error.message : String(error);

async function python(args) {
  const result = await execute("python3", [SCORER, ...args], { cwd: ROOT, timeout: 30_000, maxBuffer: 1024 * 1024 });
  return JSON.parse(result.stdout);
}

export async function preflightManifest(manifestPath, split = "test") {
  const path = resolve(manifestPath);
  if ((await stat(path)).size > 2 * 1024 * 1024) throw new Error("manifest exceeds 2 MiB");
  const raw = await readFile(path, "utf8"), manifest = JSON.parse(raw);
  if (manifest.syntheticMetadata !== false) throw new Error("real-clip evaluation requires syntheticMetadata:false");
  await python(["--manifest", path, "--check-manifest"]);
  const criterionIds = manifest.criterionIds ?? CRITERIA;
  if (!Array.isArray(criterionIds) || !criterionIds.length || criterionIds.length > 64 || new Set(criterionIds).size !== criterionIds.length || criterionIds.some(id => typeof id !== "string" || !id.trim())) throw new Error("invalid manifest criterionIds");
  const samples = manifest.samples.filter(sample => sample.split === split);
  if (samples.length < 1 || samples.length > 100) throw new Error("selected split must contain 1–100 cases");
  const previous = new Set();
  const cases = [];
  for (const sample of samples) {
    if (!sameIds(Object.keys(sample.expected.criteria), criterionIds)) throw new Error(`exact frozen task criterion IDs required: ${sample.sampleId}`);
    if (sample.duplicateOf !== undefined && !previous.has(sample.duplicateOf)) throw new Error(`duplicateOf must name a prior selected case: ${sample.sampleId}`);
    if (!/^[a-f0-9]{64}$/.test(sample.contentSha256 ?? "")) throw new Error(`contentSha256 required: ${sample.sampleId}`);
    const mediaPath = resolve(dirname(path), sample.mediaPath), mimeType = MIME[extname(mediaPath).toLowerCase()];
    if (!mimeType) throw new Error(`unsupported clip extension: ${sample.sampleId}`);
    const info = await stat(mediaPath);
    if (!info.isFile() || info.size < 1 || info.size > 25 * 1024 * 1024) throw new Error(`clip must be nonempty and <=25 MiB: ${sample.sampleId}`);
    if (sha(await readFile(mediaPath)) !== sample.contentSha256) throw new Error(`contentSha256 mismatch: ${sample.sampleId}`);
    cases.push({ sampleId: sample.sampleId, mediaPath, mimeType, sizeBytes: info.size, contentSha256: sample.contentSha256,
      ...(sample.duplicateOf ? { duplicateOf: sample.duplicateOf } : {}), expected: structuredClone(sample.expected) });
    previous.add(sample.sampleId);
  }
  return { path, raw, manifest, manifestSha256: sha(raw), split, criterionIds, cases };
}

export function validateStoredReport(response, item, run, rubricIds = run.rubric?.criteria?.map(criterion => criterion.criterionId) ?? CRITERIA) {
  if (response.verificationOnly !== true || response.evalRunId !== run.evalRunId || response.evalVideoModel !== run.videoModel || !!response.evalContentOnly !== !!run.contentOnly) throw new Error("report evaluation scope mismatch");
  const evaluation = response.observations?.evaluation;
  if (evaluation?.evaluationOnly !== true || evaluation.projectionVersion !== (run.contentOnly ? CONTENT_EVALUATION_PROJECTION_VERSION : "prelicensing-advisory-v1") ||
    (run.contentOnly ? evaluation.contentOnly !== true || evaluation.livenessTested !== false : evaluation.contentOnly === true || evaluation.livenessTested === false)) throw new Error("missing advisory evaluation projection");
  const quality = evaluation.qualityReport;
  const validation = validateVerificationReportForRubric(quality, rubricIds, run.taskSpec);
  if (!validation.valid || !sameIds(quality?.criteria?.map(c => c.criterionId), rubricIds)) throw new Error(`invalid quality report: ${validation.errors.join("; ")}`);
  if (!/^[a-f0-9]{64}$/.test(evaluation.qualityReportHash ?? "") || sha(canonical(quality)) !== evaluation.qualityReportHash) throw new Error("quality report canonical hash mismatch");
  if (quality.submissionId !== item.submissionId || quality.taskVersionId !== run.taskVersionId || quality.source.sha256 !== item.contentSha256 ||
    (response.sourceHash !== undefined && response.sourceHash !== item.contentSha256)) throw new Error("quality report source/rubric mismatch");
  const operational = response.report;
  if (!validateVerificationReportForRubric(operational, rubricIds, run.taskSpec).valid || operational.submissionId !== item.submissionId || operational.taskVersionId !== run.taskVersionId ||
    operational.source?.sha256 !== item.contentSha256 || operational.recommendation !== "needs_review" || operational.pipeline?.status === "completed") {
    throw new Error("verification-only operational report is not review-only");
  }
  if (!operational.warnings?.includes(LICENSING_WARNING) || quality.warnings.includes(LICENSING_WARNING)) {
    throw new Error("quality projection changed licensing warnings");
  }
  if (!run.contentOnly && canonical(operational.warnings.filter(warning => warning !== LICENSING_WARNING)) !== canonical(quality.warnings)) {
    throw new Error("quality projection changed non-licensing warnings");
  }
  const guarded = run.contentOnly ? applyContentEvaluationGuard(quality) : {
    ...quality, pipeline: { ...quality.pipeline, status: quality.pipeline.status === "failed" ? "failed" : "needs_review" },
    recommendation: "needs_review", warnings: [...new Set([...quality.warnings, LICENSING_WARNING])] };
  if (canonical(operational) !== canonical(guarded)) throw new Error(run.contentOnly
    ? "operational report differs beyond declared content-evaluation guards" : "operational report differs beyond the licensing guard");
  if (run.provenance?.pipelineVersion && run.provenance.pipelineVersion !== quality.pipeline.version) throw new Error("pipeline version changed within evaluation run");
  const failureCode = response.observations?.failureCode;
  const video = response.observations?.video, audio = response.observations?.audio;
  const twoObservations = ["clear", "occluded", "uncertain"].includes(video?.visibility) && Array.isArray(video?.observations)
    && typeof audio?.transcript === "string" && Array.isArray(audio?.segments) && Array.isArray(audio?.claims);
  const successfulAnalysis = !failureCode && twoObservations &&
    quality.pipeline.implementation === "inference" && ["completed", "needs_review"].includes(quality.pipeline.status);
  const visualRuns = quality.pipeline.modelRuns.filter(model => ["timestamped-frames-visible-events-v1", "timestamped-frames-visible-events-v2"].includes(model.promptVersion));
  if (run.videoModel && (visualRuns.some(model => model.model !== run.videoModel) || (successfulAnalysis && visualRuns.length !== 1))) {
    throw new Error("stored video model differs from requested evaluation model");
  }
  return { qualityReport: quality, qualityReportHash: evaluation.qualityReportHash, successfulAnalysis,
    ...(failureCode ? { failureCode } : !successfulAnalysis ? { failureCode: "inference_incomplete" } : {}) };
}

const nearestRank = (values, percentile) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)] : null;
};
/** Two-sided Wilson score interval, 95%; no estimate without observations. */
export function wilson(k, n) {
  if (!Number.isSafeInteger(k) || !Number.isSafeInteger(n) || k < 0 || n < k) throw new Error("Wilson counts must be integers with 0 <= k <= n");
  if (n === 0) return null;
  const z = 1.959963984540054, p = k / n, denominator = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / denominator;
  const radius = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denominator;
  return [k === 0 ? 0 : Math.max(0, center - radius), k === n ? 1 : Math.min(1, center + radius)];
}

export function criterionAgreement(pairs) {
  const labels = ["contradicted", "supported", "unobservable"];
  const matrix = Object.fromEntries(labels.map(label => [label, Object.fromEntries(labels.map(actual => [actual, 0]))]));
  for (const [expected, actual] of pairs) matrix[expected][actual]++;
  const n = pairs.length;
  const observed = n ? labels.reduce((sum, label) => sum + matrix[label][label], 0) / n : null;
  const chance = n ? labels.reduce((sum, label) => sum +
    Object.values(matrix[label]).reduce((a, b) => a + b, 0) * labels.reduce((total, row) => total + matrix[row][label], 0), 0) / (n * n) : null;
  return { labels, count: n, confusionMatrix: matrix, matrixOrientation: "rows=human/expected, columns=predicted",
    observedAgreement: observed, expectedAgreement: chance, cohenKappa: chance !== null && chance < 1 ? (observed - chance) / (1 - chance) : null };
}

export function riskCoverage(pairs, total) {
  const decided = pairs.filter(([, actual]) => ["accept", "request_correction"].includes(actual));
  const errors = decided.filter(([expected, actual]) => expected !== actual).length;
  return { autoDecidedCount: decided.length, errorCount: errors, coverage: total ? decided.length / total : null,
    risk: decided.length ? errors / decided.length : null };
}

export function computeMetrics(cases, { contentOnly = false } = {}) {
  const successful = cases.filter(item => item.successfulAnalysis === true);
  const correct = successful.filter(item => item.qualityReport.recommendation === item.expected.recommendation).length;
  const negative = cases.filter(item => item.expected.recommendation !== "accept");
  const falseAccepts = negative.filter(item => item.successfulAnalysis && item.qualityReport?.recommendation === "accept").length;
  const reviews = successful.filter(item => item.qualityReport.recommendation === "needs_review").length;
  const client = cases.filter(item => item.qualityReport).map(item => item.clientTerminalReportMs);
  const backend = cases.filter(item => item.qualityReport).map(item => item.processingElapsedMs);
  const visual = cases.flatMap(item => item.qualityReport?.pipeline?.modelRuns ?? [])
    .filter(model => ["timestamped-frames-visible-events-v1", "timestamped-frames-visible-events-v2"].includes(model.promptVersion)).map(model => model.elapsedMs);
  const pairs = successful.flatMap(item => (item.qualityReport.criteria ?? []).map(criterion => [item.expected.criteria[criterion.criterionId], criterion.status]));
  const operationalReports = cases.map(item => item.rawResponse?.report).filter(Boolean);
  return { measurement: { scope: contentOnly ? "prerecorded_content_only" : "capture_quality_with_liveness",
      liveness: contentOnly ? "not_tested" : "included", payoutAccuracyMeasured: false },
    operational: { verificationOnly: true, acceptanceEligibleCount: 0, storedReportCount: operationalReports.length,
      reviewCount: operationalReports.filter(report => report.recommendation === "needs_review").length,
      failedCount: operationalReports.filter(report => report.pipeline?.status === "failed").length },
    caseCount: cases.length, successfulAnalysisCount: successful.length, failedOrIncompleteCount: cases.length - successful.length,
    correctSuccessfulDecisions: correct, failureAdjustedDecisionAccuracy: cases.length ? correct / cases.length : null,
    failureAdjustedDecisionAccuracyCi95: wilson(correct, cases.length),
    conditionalDecisionAccuracy: successful.length ? correct / successful.length : null,
    conditionalDecisionAccuracyCi95: wilson(correct, successful.length),
    criterionAgreement: criterionAgreement(pairs),
    riskCoverage: riskCoverage(successful.map(item => [item.expected.recommendation, item.qualityReport.recommendation]), cases.length),
    successfulAnalysisCoverage: cases.length ? successful.length / cases.length : null,
    falseAcceptance: { count: falseAccepts, negativeCaseCount: negative.length, rate: negative.length ? falseAccepts / negative.length : null, ci95: wilson(falseAccepts, negative.length) },
    reviewRate: cases.length ? cases.filter(item => item.qualityReport?.recommendation === "needs_review").length / cases.length : null,
    successfulReviewRate: cases.length ? reviews / cases.length : null, conditionalReviewRate: successful.length ? reviews / successful.length : null,
    storedReportReviewCount: cases.filter(item => item.qualityReport?.recommendation === "needs_review").length,
    latency: { method: "nearest-rank; terminal reports only, including provider failures", clientTerminalReportMs: { count: client.filter(Number.isFinite).length,
      p50: nearestRank(client, .5), p95: nearestRank(client, .95) }, backendProcessingMs: { count: backend.filter(Number.isFinite).length,
      p50: nearestRank(backend, .5), p95: nearestRank(backend, .95) },
      videoRequestMs: { count: visual.filter(Number.isFinite).length, p50: nearestRank(visual, .5), p95: nearestRank(visual, .95) },
      rightCensored: cases.filter(item => item.state === "timed_out").map(item => ({ sampleId: item.sampleId, observedWaitMs: item.clientObservedWaitMs })) } };
}

async function resolveUrl() {
  let value = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!value) {
    try {
      const lines = (await readFile(join(ROOT, ".env.local"), "utf8")).split(/\r?\n/);
      for (const key of ["CONVEX_URL", "NEXT_PUBLIC_CONVEX_URL"]) {
        const line = lines.find(line => line.startsWith(`${key}=`));
        if (line) { value = line.slice(key.length + 1).trim().replace(/^["']|["']$/g, ""); break; }
      }
    } catch { /* Shared demo fallback does not require a local secret. */ }
  }
  const url = new URL(value || "https://keen-marmot-986.convex.cloud");
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
    !(url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) throw new Error("invalid Convex deployment URL");
  return url.origin;
}

async function defaultClient(url) {
  const [{ ConvexHttpClient }, { makeFunctionReference }] = await Promise.all([import("convex/browser"), import("convex/server")]);
  const boundedFetch = (input, init = {}) => fetch(input, { ...init,
    signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) });
  const client = new ConvexHttpClient(url, { logger: false, fetch: boundedFetch });
  return { query: (name, args) => client.query(makeFunctionReference(name), args), mutation: (name, args) => client.mutation(makeFunctionReference(name), args),
    upload: async (uploadUrl, bytes, mimeType) => {
      const response = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": mimeType }, body: bytes, signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`upload HTTP ${response.status}`);
      const result = await response.json();
      if (typeof result.storageId !== "string") throw new Error("upload omitted storageId");
      return result.storageId;
    } };
}

async function atomicJson(path, value) {
  await writeFile(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}

function markdown(run) {
  const m = run.metrics;
  const percent = value => value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
  const ci = value => value ? `[${value.map(percent).join(", ")}]` : "n/a";
  return `# Clip evaluation ${run.evalRunId}\n\nPrivate verification-only evaluation; advisory quality before licensing. No acceptance, dataset sale or payment requested.\n\n` +
    `Measurement: **${run.contentOnly ? "CONTENT QUALITY ONLY — liveness not tested" : "Capture quality including actual liveness"}**. All cases are verification-only and operationally ineligible for acceptance/payment. Stored operational reviews: ${m.operational.reviewCount}/${m.operational.storedReportCount}; failed operational reports: ${m.operational.failedCount}. These decision/false-accept metrics do not measure payout accuracy.\n\n` +
    `Requested video model: ${run.videoModel ?? "deployment default (see stored modelRuns)"}. Status: ${run.status}. Manifest SHA-256: \`${run.manifestSha256}\`. Split: ${run.split}.\n\n` +
    `Successful analyses: ${m.successfulAnalysisCount}/${m.caseCount}. Failure-adjusted decision accuracy: ${percent(m.failureAdjustedDecisionAccuracy)} (Wilson 95% CI ${ci(m.failureAdjustedDecisionAccuracyCi95)}). Conditional accuracy: ${percent(m.conditionalDecisionAccuracy)} (Wilson 95% CI ${ci(m.conditionalDecisionAccuracyCi95)}). Inference coverage: ${percent(m.successfulAnalysisCoverage)}.\n\n` +
    `False accepts: ${m.falseAcceptance.count}/${m.falseAcceptance.negativeCaseCount} negative cases (${percent(m.falseAcceptance.rate)}; Wilson 95% CI ${ci(m.falseAcceptance.ci95)}). Stored-report review rate over all cases: ${percent(m.reviewRate)}. Review rate among successful analyses: ${percent(m.conditionalReviewRate)}. Provider fallback reviews do not earn correct decisions.\n\n` +
    `Risk-coverage operating point: ${m.riskCoverage.autoDecidedCount}/${m.caseCount} auto-decided (${percent(m.riskCoverage.coverage)} coverage); ${m.riskCoverage.errorCount} errors (${percent(m.riskCoverage.risk)} risk). Auto-decided means successful accept/request_correction recommendations, not financial authorization. Failed/incomplete analyses and needs_review abstain.\n\n` +
    `Criterion Cohen's kappa vs supplied human labels: ${m.criterionAgreement.cohenKappa ?? "n/a"} (${m.criterionAgreement.count} successful-analysis criterion pairs). Confusion matrix: rows=human/expected, columns=predicted.\n\n` +
    `| Human / predicted | ${m.criterionAgreement.labels.join(" | ")} |\n| --- | --- | --- | --- |\n` +
    m.criterionAgreement.labels.map(label => `| ${label} | ${m.criterionAgreement.labels.map(actual => m.criterionAgreement.confusionMatrix[label][actual]).join(" | ")} |`).join("\n") + "\n\n" +
    `Client terminal report p50/p95: ${m.latency.clientTerminalReportMs.p50 ?? "n/a"}/${m.latency.clientTerminalReportMs.p95 ?? "n/a"} ms. Backend processing p50/p95: ${m.latency.backendProcessingMs.p50 ?? "n/a"}/${m.latency.backendProcessingMs.p95 ?? "n/a"} ms. Right-censored client timeouts: ${m.latency.rightCensored.length}.\n\n` +
    `Video request p50/p95: ${m.latency.videoRequestMs.p50 ?? "n/a"}/${m.latency.videoRequestMs.p95 ?? "n/a"} ms (${m.latency.videoRequestMs.count} timed visual responses).\n\n` +
    `Client latency is wall time from the first create attempt, including downtime before resume. Percentiles use nearest rank on terminal reports; timeout censoring is listed separately.\n\n` +
    `The offline scorer's inferenceRan remains false. Cloud attempts and validated raw reports are recorded separately in the JSON. Raw label agreement may count provider fallback reviews; use failure-adjusted metrics above.\n\n` +
    `| Case | State | Successful inference | Expected | Quality projection | Failure |\n| --- | --- | --- | --- | --- | --- |\n` +
    run.cases.map(item => `| ${item.sampleId.replaceAll("|", "\\|")} | ${item.state} | ${!!item.successfulAnalysis} | ${item.expected.recommendation} | ${item.qualityReport?.recommendation ?? "—"} | ${item.failureCode ?? item.error ?? "—"} |`).join("\n") + "\n";
}

export async function runEvaluation(options, injected = {}) {
  const now = injected.now ?? Date.now, wait = injected.sleep ?? sleep;
  if (options.contentOnly !== undefined && typeof options.contentOnly !== "boolean") throw new Error("invalid content-only mode");
  const contentOnly = options.contentOnly === true;
  if (options.videoModel !== undefined && !COMPARISON_VIDEO_MODELS.includes(options.videoModel)) throw new Error("unsupported evaluation video model");
  const preflight = await preflightManifest(options.manifestPath, options.split ?? "test");
  if (options.frozenManifestSha256 && preflight.manifestSha256 !== options.frozenManifestSha256) throw new Error("comparison frozen manifest differs");
  const runnerSha256 = sha(await readFile(fileURLToPath(import.meta.url)));
  const outputDir = resolve(options.outputDir ?? join(ROOT, "evals/results"));
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  let run, resultPath;
  if (options.resume) {
    resultPath = resolve(options.resume);
    run = JSON.parse(await readFile(resultPath, "utf8"));
    if (run.runnerVersion !== RUNNER_VERSION || run.manifestSha256 !== preflight.manifestSha256 || run.frozenManifestRaw !== preflight.raw || run.split !== preflight.split || run.videoModel !== options.videoModel || run.contentOnly !== contentOnly) {
      throw new Error("resume rejected: frozen manifest/version/split/model/content mode differs");
    }
    if (run.provenance?.runnerSha256 !== runnerSha256) throw new Error("resume rejected: runner source differs");
    if (!/^eval-[0-9a-f-]{36}$/.test(run.evalRunId) || run.cases.length !== preflight.cases.length || run.cases.some((item, index) => item.sampleId !== preflight.cases[index].sampleId ||
      item.contentSha256 !== preflight.cases[index].contentSha256 || item.duplicateOf !== preflight.cases[index].duplicateOf ||
      item.clientRequestId !== `eval:${run.evalRunId.slice(5)}:${sha(item.sampleId).slice(0, 32)}` ||
      canonical(item.expected) !== canonical(preflight.cases[index].expected))) throw new Error("resume case inventory differs");
    // Source locations may move, but their exact frozen bytes must still match.
    run.cases.forEach((item, index) => { item.mediaPath = preflight.cases[index].mediaPath; });
  } else {
    const id = randomUUID(), startedAt = new Date(now()).toISOString();
    resultPath = options.resultPath ?? join(outputDir, `${startedAt.replaceAll(/[:.]/g, "-")}-${id}.json`);
    let gitHead = null, gitDirty = null;
    try {
      gitHead = (await execute("git", ["rev-parse", "HEAD"], { cwd: ROOT, timeout: 5000 })).stdout.trim();
      gitDirty = !!(await execute("git", ["status", "--porcelain"], { cwd: ROOT, timeout: 5000, maxBuffer: 1024 * 1024 })).stdout.trim();
    } catch {}
    run = { runnerVersion: RUNNER_VERSION, contentOnly, ...(options.videoModel ? { videoModel: options.videoModel } : {}), evalRunId: `eval-${id}`, startedAt, split: preflight.split,
      manifestSha256: preflight.manifestSha256, frozenManifestRaw: preflight.raw, frozenManifest: preflight.manifest,
      provenance: { gitHead, gitDirty, runnerSha256, nodeVersion: process.version, scorerSha256: sha(await readFile(SCORER)), labelsFrozenAt: startedAt },
      cloud: { backend: "Convex", attempted: false, licensing: "verification-only; no training license or payment", resumeCount: 0 },
      cases: preflight.cases.map(item => ({ ...item, clientRequestId: `eval:${id}:${sha(item.sampleId).slice(0, 32)}`, state: "pending" })) };
  }
  const manifestFile = resultPath.replace(/\.json$/, ".manifest.json"), predictionsFile = resultPath.replace(/\.json$/, ".predictions.json");
  await writeFile(manifestFile, preflight.raw, { mode: 0o600 });
  const save = async () => {
    run.updatedAt = new Date(now()).toISOString(); run.metrics = computeMetrics(run.cases, { contentOnly });
    await atomicJson(resultPath, run);
    await writeFile(resultPath.replace(/\.json$/, ".md"), markdown(run), { mode: 0o600 });
  };
  run.status = "running";
  run.rawScorer ??= { inferenceRan: false, notRunReason: "incomplete_prediction_coverage" };
  if (options.resume) run.cloud.resumeCount++;
  await save(); // Labels and source fingerprints are durable before ANY network.
  const timeoutMs = options.timeoutMs ?? 6 * 60_000, pollMs = options.pollMs ?? 1500;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30 * 60_000 || !Number.isFinite(pollMs) || pollMs <= 0) throw new Error("invalid polling bounds");
  try {
    const url = options.url ?? await resolveUrl();
    if (run.cloud.url && run.cloud.url !== url) throw new Error("resume backend URL differs");
    run.cloud.url = url; run.cloud.attempted = true; await save();
    const client = await (injected.createClient ?? defaultClient)(url);
    const identity = { demoIdentity: "contributor" };
    const context = options.orderId ? { orderId: options.orderId } : await client.query("dashboard:demoContext", identity);
    if (!context?.orderId) throw new Error("seeded demo order required");
    const summary = await client.query("dashboard:orderSummary", { ...identity, orderId: context.orderId });
    const rubric = summary?.rubric;
    if (!rubric || !Number.isFinite(rubric.frozenAt) || !/^[a-f0-9]{64}$/.test(rubric.contentHash ?? "") || !sameIds(rubric.criteria?.map(item => item.criterionId), preflight.criterionIds) ||
      (context.taskVersionId !== undefined && rubric._id !== context.taskVersionId) || rubric.orderId !== context.orderId) throw new Error("frozen task rubric mismatch");
    if ((preflight.manifest.expectedRubricContentHash !== undefined && preflight.manifest.expectedRubricContentHash !== rubric.contentHash) ||
      (options.frozenRubricContentHash && options.frozenRubricContentHash !== rubric.contentHash) ||
      (options.frozenTaskVersionId && options.frozenTaskVersionId !== rubric._id) || (options.frozenOrderId && options.frozenOrderId !== context.orderId)) throw new Error("expected rubric content hash mismatch");
    if ((run.orderId && run.orderId !== context.orderId) || (run.taskVersionId && run.taskVersionId !== rubric._id)) throw new Error("resume order/rubric differs");
    if (run.provenance.frozenRubric && run.provenance.frozenRubric.contentHash !== rubric.contentHash) throw new Error("resume rubric content hash differs");
    run.orderId = context.orderId; run.taskVersionId = rubric._id; run.rubric = rubric; run.taskSpec = resolveTaskSpec(rubric);
    run.provenance.frozenRubric = { taskVersionId: rubric._id, contentHash: rubric.contentHash, frozenAt: rubric.frozenAt }; await save();
    const scope = async () => {
      const inventory = await client.query("submissions:evaluationRun", { ...identity, orderId: run.orderId, evalRunId: run.evalRunId });
      if (inventory?.truncated || !Array.isArray(inventory?.submissions)) throw new Error("evaluation scope inventory truncated or invalid");
      const seen = new Set();
      for (const row of inventory.submissions) {
        const item = run.cases.find(item => item.clientRequestId === row.clientRequestId);
        if (!item || seen.has(row.clientRequestId) || typeof row._id !== "string" || (item.submissionId && item.submissionId !== row._id) ||
          (row.sourceHash !== undefined && row.sourceHash !== item.contentSha256) || row.evalVideoModel !== run.videoModel || !!row.evalContentOnly !== contentOnly) throw new Error("evaluation scope contaminated");
        item.submissionId = row._id; seen.add(row.clientRequestId);
      }
      if (run.cases.some(item => item.submissionId && !seen.has(item.clientRequestId))) throw new Error("evaluation scope missing existing submission");
    };
    await scope(); await save();
    for (const item of run.cases) {
      if (item.qualityReport) continue;
      const reference = item.duplicateOf && run.cases.find(other => other.sampleId === item.duplicateOf);
      if (reference && !reference.successfulAnalysis) { item.state = "blocked"; item.error = "duplicate reference did not complete successful inference"; await save(); continue; }
      try {
        await scope();
        if (!item.submissionId) {
          if (!item.storageId) {
            const bytes = await readFile(item.mediaPath);
            if (sha(bytes) !== item.contentSha256) throw new Error("source changed after labels froze");
            const uploadUrl = await client.mutation("submissions:generateUploadUrl", identity);
            item.storageId = await client.upload(uploadUrl, bytes, item.mimeType); item.state = "uploaded"; await save();
          }
          item.firstCreateAt ??= now(); await save();
          const created = await client.mutation("submissions:create", { ...identity, orderId: run.orderId, storageId: item.storageId,
            clientRequestId: item.clientRequestId, consentAcknowledged: true, verificationOnly: true, evalRunId: run.evalRunId, ...(run.videoModel ? { evalVideoModel: run.videoModel } : {}), ...(contentOnly ? { evalContentOnly: true } : {}) });
          if (typeof created.submissionId !== "string") throw new Error("create omitted submissionId");
          item.submissionId = created.submissionId; item.state = "submitted"; await save();
        }
        const pollStarted = now();
        item.firstCreateAt ??= pollStarted;
        item.state = "submitted"; delete item.error; await save();
        while (now() - pollStarted < timeoutMs) {
          await scope(); // Unknown rows fail closed, including on resume/poll.
          const response = await client.query("submissions:getReport", { ...identity, submissionId: item.submissionId });
          if (response.report) {
            item.rawResponse = response;
            Object.assign(item, validateStoredReport(response, item, run));
            if ((preflight.manifest.expectedPipelineVersion !== undefined && item.qualityReport.pipeline.version !== preflight.manifest.expectedPipelineVersion) ||
              (options.frozenPipelineVersion && item.qualityReport.pipeline.version !== options.frozenPipelineVersion)) {
              delete item.qualityReport; item.successfulAnalysis = false; throw new Error("expected pipeline version mismatch");
            }
            run.provenance.pipelineVersion ??= item.qualityReport.pipeline.version;
            item.processingElapsedMs = response.processingElapsedMs;
            item.clientTerminalReportMs = Math.max(0, now() - item.firstCreateAt);
            item.state = "completed"; item.terminalAt = new Date(now()).toISOString(); await save(); break;
          }
          await wait(pollMs);
        }
        if (!item.qualityReport) { item.state = "timed_out"; item.clientObservedWaitMs = Math.max(0, now() - item.firstCreateAt); await save(); }
      } catch (error) {
        item.state = "failed"; item.error = message(error); await save();
        if (/scope|contaminat/.test(item.error)) throw error;
      }
    }
    await scope();
    const predictions = run.cases.filter(item => item.qualityReport).map(item => ({ sampleId: item.sampleId, successfulAnalysis: item.successfulAnalysis === true,
      recommendation: item.qualityReport.recommendation, duplicateStatus: item.qualityReport.duplicate.status,
      criteria: Object.fromEntries(item.qualityReport.criteria.map(criterion => [criterion.criterionId, criterion.status])) }));
    await atomicJson(predictionsFile, predictions);
    run.rawScorer = predictions.length === run.cases.length
      ? await (injected.score ?? python)(["--manifest", manifestFile, "--predictions", predictionsFile, "--split", run.split])
      : { inferenceRan: false, notRunReason: "incomplete_prediction_coverage", predictionCount: predictions.length };
    run.status = run.cases.every(item => item.successfulAnalysis) ? "completed" : "partial";
  } catch (error) { run.status = "partial"; run.error = message(error); }
  await save();
  return { run, resultPath, exitCode: run.status === "completed" ? 0 : 1 };
}

/** Paired, frozen-source evaluation; independent duplicate scope for each model. */
export async function runModelComparison(options, injected = {}) {
  if (options.videoModel !== undefined) throw new Error("choose --video-model or --compare-video-models");
  if (options.contentOnly !== undefined && typeof options.contentOnly !== "boolean") throw new Error("invalid content-only mode");
  const contentOnly = options.contentOnly === true;
  const preflight = await preflightManifest(options.manifestPath, options.split ?? "test");
  const now = injected.now ?? Date.now;
  const outputDir = resolve(options.outputDir ?? join(ROOT, "evals/results"));
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  const runnerSha256 = sha(await readFile(fileURLToPath(import.meta.url)));
  let run, resultPath;
  if (options.resume) {
    resultPath = resolve(options.resume);
    run = JSON.parse(await readFile(resultPath, "utf8"));
    if (run.comparisonVersion !== RUNNER_VERSION || run.manifestSha256 !== preflight.manifestSha256 ||
      run.frozenManifestRaw !== preflight.raw || run.split !== preflight.split || run.contentOnly !== contentOnly || run.runnerSha256 !== runnerSha256 ||
      canonical(run.models?.map(item => item.videoModel)) !== canonical(COMPARISON_VIDEO_MODELS)) {
      throw new Error("comparison resume rejected: frozen manifest/version/split/models differs or content mode differs");
    }
  } else {
    const id = randomUUID(), startedAt = new Date(now()).toISOString();
    resultPath = join(outputDir, `${startedAt.replaceAll(/[:.]/g, "-")}-comparison-${id}.json`);
    run = { comparisonVersion: RUNNER_VERSION, contentOnly, comparisonId: `comparison-${id}`, startedAt, split: preflight.split,
      manifestSha256: preflight.manifestSha256, frozenManifestRaw: preflight.raw, runnerSha256,
      models: COMPARISON_VIDEO_MODELS.map(videoModel => ({ videoModel, status: "pending" })) };
  }
  const save = async () => {
    run.updatedAt = new Date(now()).toISOString();
    await atomicJson(resultPath, run);
    const percent = value => value == null ? "n/a" : `${(value * 100).toFixed(1)}%`;
    const ci = value => value ? `[${value.map(percent).join(", ")}]` : "n/a";
    const latency = value => `${value?.p50 ?? "n/a"}/${value?.p95 ?? "n/a"}`;
    const rows = run.models.map(item => {
      const m = item.metrics;
      return `| ${item.videoModel} | ${item.status} | ${m?.caseCount ?? "—"} | ${percent(m?.successfulAnalysisCoverage)} | ${percent(m?.failureAdjustedDecisionAccuracy)} ${ci(m?.failureAdjustedDecisionAccuracyCi95)} | ${m ? `${m.falseAcceptance.count}/${m.falseAcceptance.negativeCaseCount}` : "—"} | ${percent(m?.falseAcceptance.rate)} ${ci(m?.falseAcceptance.ci95)} | ${percent(m?.reviewRate)} | ${m ? `${m.operational.reviewCount}/${m.operational.storedReportCount}` : "—"} | ${percent(m?.riskCoverage.coverage)} / ${percent(m?.riskCoverage.risk)} | ${m?.criterionAgreement.cohenKappa ?? "n/a"} | ${latency(m?.latency.videoRequestMs)} | ${latency(m?.latency.backendProcessingMs)} | ${latency(m?.latency.clientTerminalReportMs)} |`;
    });
    await writeFile(resultPath.replace(/\.json$/, ".md"),
      `# Paired video-model evaluation\n\nMeasurement: **${contentOnly ? "CONTENT QUALITY ONLY — liveness not tested" : "Capture quality including actual liveness"}**. Every operational submission remains verification-only and ineligible for acceptance/payment.\n\nStatus: ${run.status}. Frozen manifest SHA-256: \`${run.manifestSha256}\`. Split: ${run.split}.\n\n` +
      "Same frozen source bytes and labels in both arms; distinct evaluation scopes prevent cross-model copies from contaminating results. Labels are never sent to models. Both arms are verification-only. No global model environment is changed.\n\n" +
      "| Video model | Status | Cases | Inference coverage | Decision accuracy [Wilson 95% CI] (failures incorrect) | False accepts / negatives | False-accept rate [Wilson 95% CI] | Review rate | Operational reviews / stored (eligible: 0) | Auto-decided coverage / risk | Criterion kappa | Video p50/p95 ms | Backend p50/p95 ms | Client p50/p95 ms |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n" +
      rows.join("\n") + "\n\nPercentiles use nearest rank. Failed or incomplete analysis earns no correct-decision credit. Provider fallback reviews remain in review rate; timeouts are censored in child results. Video latency counts timed visual responses, including responses that later fail another stage. Models run sequentially (Argon, then Flash); this is a paired clip comparison, not a randomized latency experiment. Child reports include criterion confusion matrices (human rows, predicted columns). Kappa is undefined for empty or single-class perfect agreement. Auto-decided coverage excludes failures and reviews; risk is error among successful accept/request_correction recommendations. Intervals are descriptive binomial Wilson intervals, not independence or conformal guarantees. Child JSON preserves actual modelRuns, reports, scorer output and provenance.\n",
      { mode: 0o600 });
  };
  run.status = "running";
  await save(); // Both model choices and exact labels are frozen before any network.
  for (const item of run.models) {
    try {
      item.resultPath ??= resultPath.replace(/\.json$/, `.${item.videoModel}.json`);
      await save(); // Persist the child checkpoint path before it can submit anything.
      const existing = await stat(item.resultPath).then(() => true, error => {
        if (error.code === "ENOENT") return false;
        throw error;
      });
      const result = await runEvaluation({ ...options, outputDir, videoModel: item.videoModel,
        resultPath: item.resultPath, frozenManifestSha256: run.manifestSha256,
        frozenRubricContentHash: run.frozenRubric?.contentHash, frozenTaskVersionId: run.frozenRubric?.taskVersionId,
        frozenOrderId: run.orderId, frozenPipelineVersion: run.pipelineVersion, resume: existing ? item.resultPath : undefined }, injected);
      item.resultPath = result.resultPath; item.evalRunId = result.run.evalRunId;
      if (result.run.provenance.frozenRubric) { run.frozenRubric ??= result.run.provenance.frozenRubric; run.orderId ??= result.run.orderId; }
      run.pipelineVersion ??= result.run.provenance.pipelineVersion;
      item.status = result.run.status; item.metrics = result.run.metrics;
      if (result.run.error) item.error = result.run.error; else delete item.error;
    } catch (error) { item.status = "partial"; item.error = message(error); }
    await save();
  }
  run.status = run.models.every(item => item.status === "completed") ? "completed" : "partial";
  await save();
  return { run, resultPath, exitCode: run.status === "completed" ? 0 : 1 };
}

async function main(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (["--resume", "--split", "--timeout-ms", "--video-model", "--order-id"].includes(arg)) {
      const value = argv[++index];
      if (!value) throw new Error(`missing ${arg} value`);
      options[arg === "--timeout-ms" ? "timeoutMs" : arg === "--video-model" ? "videoModel" : arg === "--order-id" ? "orderId" : arg.slice(2)] = arg === "--timeout-ms" ? Number(value) : value;
    } else if (arg === "--compare-video-models") options.compareVideoModels = true;
    else if (arg === "--content-only") options.contentOnly = true;
    else if (!arg.startsWith("-") && !options.manifestPath) options.manifestPath = arg;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.manifestPath) throw new Error("usage: pnpm eval:clips <manifest.json> [--split test] [--order-id ID] [--resume results.json] [--timeout-ms 360000] [--video-model MODEL | --compare-video-models] [--content-only]");
  const result = await (options.compareVideoModels ? runModelComparison : runEvaluation)(options);
  console.log(`${result.run.status}: ${result.resultPath}\n${JSON.stringify(result.run.metrics ?? result.run.models, null, 2)}`);
  return result.exitCode;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await main(process.argv.slice(2)); }
  catch (error) { console.error(`evaluation failed before upload: ${message(error)}`); process.exitCode = 2; }
}
