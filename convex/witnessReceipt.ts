import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { isFinanceAgent, requireRole } from "./lib/demoAuth";
import { requireTenant } from "./lib/finance";
import { checkSpokenLiveness } from "./lib/spokenLiveness";
import { BANK_WITNESS_LABEL, compareBankWitness, type BankActivity } from "./lib/nessie";
import { PAYMENT_NETWORK, PAYMENT_RAILS, USDC_ADDRESS } from "../packages/contracts/src/chain";
import { validateTransfer } from "../packages/payments/src/reconciliation";
import { createFulfillmentJournal, createPayoutJournal } from "../packages/ledger/src/index";

type Status = "agree" | "disagree" | "missing" | "pending" | "not_applicable";
export type Witness = {
  key: string; label: string; kind: "work" | "money" | "judgment";
  status: Status; detail: string; evidenceUrl: string | null; live: boolean;
};
export type WitnessReceipt = {
  submissionId: string; verdict: Doc<"submissions">["status"];
  recommendation: Doc<"analysisResults">["recommendation"] | null; witnesses: Witness[];
};
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value !== null && typeof value === "object" && !Array.isArray(value)
  ? value as ObjectValue : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === "string" ? value.slice(0, 1000) : "";
function parsed(value: string | undefined): ObjectValue {
  try { return value ? object(JSON.parse(value)) : {}; } catch { return {}; }
}
function witness(key: string, label: string, kind: Witness["kind"], status: Status,
  detail: string, evidenceUrl: string | null = null): Witness {
  // These records have no verified live-vs-replay provenance. A completed row is
  // not enough to claim live inference; Nessie is simulated and the chain is testnet.
  return { key, label, kind, status, detail, evidenceUrl, live: false };
}
const absent = (key: string, label: string, kind: Witness["kind"], detail: string) => witness(key, label, kind, "missing", detail);
const hash = (value: unknown): value is string => typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);

function reportStatus(report: ObjectValue): Status {
  const pipeline = object(report.pipeline), criteria = list(report.criteria).map(object);
  if (pipeline.implementation !== "inference" || !["completed", "needs_review"].includes(text(pipeline.status)) || !criteria.length) return "missing";
  if (criteria.some(row => row.status === "contradicted") || report.recommendation === "request_correction") return "disagree";
  return pipeline.status === "completed" && criteria.every(row => row.status === "supported") && report.recommendation === "accept" ? "agree" : "pending";
}

function workWitnesses(submission: Doc<"submissions">, analysis: Doc<"analysisResults"> | null): Witness[] {
  const available = analysis?.implementation === "inference" && ["completed", "needs_review"].includes(analysis.pipelineStatus);
  // Review-required inference still has useful independent observations. Only
  // scaffold/unavailable/failed analysis is excluded; none can authorize acceptance.
  const observations = available ? parsed(analysis.observationsJson) : {};
  const report = available ? parsed(analysis.reportJson) : {};
  const jury = object(observations.jury), judges = list(jury.judges).map(object);
  const disagreement = list(jury.disagreedCriteria).filter((value): value is string => typeof value === "string");
  const fraction = typeof jury.agreementFraction === "number" && Number.isFinite(jury.agreementFraction)
    && jury.agreementFraction >= 0 && jury.agreementFraction <= 1 ? jury.agreementFraction : null;
  const judgeStatuses = judges.map(judge => judge.failureCode ? "missing" : reportStatus(object(judge.report)));
  const rows: Witness[] = [];
  if (judges.length) {
    const status = disagreement.length || (fraction !== null && fraction < 1) || judgeStatuses.includes("disagree") ? "disagree"
      : fraction === 1 && judges.length >= 2 && judgeStatuses.every(value => value === "agree") ? "agree" : "pending";
    rows.push(witness("vision_jury", "Vision jury agreement (advisory)", "work", status,
      `${judges.length} model reports; agreement fraction: ${fraction ?? "unavailable"}; disputed criteria: ${disagreement.join(", ") || "none recorded"}. Unavailable reports are not agreement.`));
    judges.forEach((judge, index) => rows.push(witness(`vision:${index}:${text(judge.model) || "unknown"}`,
      `Vision model: ${text(judge.model) || "unknown"}`, "work", judgeStatuses[index]!,
      `Stored recommendation: ${text(object(judge.report).recommendation) || "unavailable"}${judge.failureCode ? `; failure: ${text(judge.failureCode)}` : ""}. Advisory observation, not payment authority.`)));
  } else {
    rows.push(absent("vision_jury", "Vision jury agreement (advisory)", "work", "No stored independent vision jury reports or agreement result."));
    // Jury opt-out still leaves a single visual model's report. Do not mistake
    // the audio model in modelRuns for a second independent visual judge.
    list(object(report.pipeline).modelRuns).map(object)
      .filter(run => run.promptVersion === "timestamped-frames-visible-events-v1")
      .forEach((run, index) => rows.push(witness(`vision:${index}:${text(run.model) || "unknown"}`,
        `Vision model: ${text(run.model) || "unknown"}`, "work", reportStatus(report),
        `Stored single-model recommendation: ${text(report.recommendation) || "unavailable"}; no independent jury agreement is recorded.`)));
  }
  const audio = object(observations.audio), segments = list(audio.segments);
  const hasTranscript = typeof audio.transcript === "string" || segments.some(segment => typeof object(segment).text === "string");
  const transcript = typeof audio.transcript === "string" ? text(audio.transcript)
    : segments.map(segment => text(object(segment).text)).join(" ").slice(0, 1000);
  rows.push(hasTranscript
    ? witness("audio_transcription", "Audio transcription", "work", "agree",
      `Stored audio transcription available; ${segments.length} timestamped segments. Excerpt (untrusted narration): ${transcript || "[empty transcript]"}. Transcription availability does not establish that narration is true.`)
    : absent("audio_transcription", "Audio transcription", "work", "No stored audio transcription; silence, a failed call, and missing evidence are not agreement."));
  const trace = submission.sensorTrace;
  rows.push(trace ? witness("sensor_trace", "IMU / sensor trace (client-reported)", "work", "pending",
    `${trace.sampleCount} samples over ${trace.durationMs} ms at ${trace.sampleRateHz} Hz; sensors: ${trace.sensors.join(", ")}. Client-reported summary: ${trace.motionSummary.activeMotionIntervals.length} active intervals; accel RMS ${trace.motionSummary.accelRmsG ?? "unavailable"} g; gyro RMS ${trace.motionSummary.gyroRmsRadPerSec ?? "unavailable"} rad/s. Not independent proof of the filmed action.`)
    : absent("sensor_trace", "IMU / sensor trace", "work", "No sensor trace attached to this submission."));
  const duplicate = object(report.duplicate), matches = list(duplicate.matches).map(object);
  const scores = matches.flatMap(match => typeof match.score === "number" && Number.isFinite(match.score) ? [match.score] : []);
  rows.push(witness("duplicate_check", "Duplicate / copy check (heuristic)", "work",
    duplicate.status === "suspected" ? "disagree" : duplicate.status === "clear" ? "agree" : "missing",
    ["clear", "suspected"].includes(text(duplicate.status))
      ? `Stored check: ${text(duplicate.status)}; ${matches.length} candidate matches; scores: ${scores.length ? scores.join(", ") : "none recorded"}. Hash source: ${submission.perceptualHashSource ?? analysis?.perceptualHashSource ?? "unrecorded"}.`
      : "No completed duplicate check. Missing scores are not a zero-copy score."));
  // The existing comparator persists positive flags as a warning, but does not
  // persist a separate clean-scan result. Absence of that warning is not a pass.
  const injectionFlag = list(report.warnings).includes("Instruction-like media content requires human review; it has no authority.");
  rows.push(injectionFlag ? witness("prompt_injection", "Prompt-injection scan (heuristic)", "work", "disagree",
    "The stored comparator flagged instruction-like media content for human review. Narration and model output have no authority.")
    : absent("prompt_injection", "Prompt-injection scan (heuristic)", "work", "No explicit stored prompt-injection scan result. Absence of a warning is not a clean scan; treat narration and model output as untrusted data."));
  // Legacy submissions have no challenge. The shared pure comparator validates
  // the stored fields and timestamped audio; model-provided pass flags are ignored.
  const liveness = object(object(submission).liveness), livenessStatus = text(liveness.status);
  if ("words" in liveness) {
    const result = checkSpokenLiveness(liveness as unknown as Parameters<typeof checkSpokenLiveness>[0],
      audio as unknown as Parameters<typeof checkSpokenLiveness>[1],
      typeof object(report.source).durationMs === "number" ? object(report.source).durationMs as number : 0);
    rows.push(witness("spoken_liveness", "Spoken liveness (stored challenge + transcript)", "work",
      result.status === "passed" ? "agree" : result.status === "missing_transcript" || result.status === "missing_challenge" ? "missing" : "disagree",
      result.status === "passed" ? `Issued words match the stored transcript in order at ${result.evidence.startMs}–${result.evidence.endMs} ms (containing segment bounds). This deterministic comparison does not prove speaker identity or authorize acceptance.`
        : result.warning));
  } else {
    rows.push(witness("spoken_liveness", "Spoken liveness", "work", Object.keys(liveness).length ? "pending" : "missing",
      Object.keys(liveness).length ? `Stored liveness data present${livenessStatus ? ` (${livenessStatus})` : ""}; no compatible verified result is established by this projection.`
        : "No stored spoken-liveness result on this submission."));
  }
  return rows;
}

type Interval = { startMs: number; endMs: number };
/** Only source-bound, available jury reports can supply a supported pickup interval. */
function juryPickupIntervals(submission: Doc<"submissions">, analysis: Doc<"analysisResults"> | null): Interval[][] {
  if (!analysis || analysis.implementation !== "inference" || !["completed", "needs_review"].includes(analysis.pipelineStatus)) return [];
  const report = parsed(analysis.reportJson), durationMs = object(report.source).durationMs;
  if (typeof durationMs !== "number" || !Number.isSafeInteger(durationMs) || durationMs <= 0) return [];
  const judges = list(object(parsed(analysis.observationsJson).jury).judges).map(object);
  if (judges.length < 2 || judges.length > 16 || judges.some(judge => !text(judge.model).trim()) ||
    new Set(judges.map(judge => text(judge.model))).size !== judges.length) return [];
  const intervals: Interval[][] = [];
  for (const judge of judges) {
    const judgeReport = object(judge.report), pipeline = object(judgeReport.pipeline), source = object(judgeReport.source);
    if (judge.failureCode || pipeline.implementation !== "inference" || !["completed", "needs_review"].includes(text(pipeline.status)) ||
      judgeReport.submissionId !== submission._id || judgeReport.taskVersionId !== submission.taskVersionId ||
      source.sha256 !== submission.sourceHash || source.durationMs !== durationMs || pipeline.version !== analysis.pipelineVersion) return [];
    const findings = list(judgeReport.criteria).map(object).filter(row => row.criterionId === "red-cup-pickup");
    if (findings.length !== 1 || findings[0]!.status !== "supported") return [];
    const evidence = list(findings[0]!.evidence).slice(0, 64).map(object).filter(row => row.modality === "video" &&
      typeof row.startMs === "number" && Number.isSafeInteger(row.startMs) && row.startMs >= 0 &&
      typeof row.endMs === "number" && Number.isSafeInteger(row.endMs) && row.endMs > row.startMs && row.endMs <= durationMs)
      .map(row => ({ startMs: row.startMs as number, endMs: row.endMs as number }));
    if (!evidence.length) return [];
    intervals.push(evidence);
  }
  return intervals;
}

async function detectorWitness(ctx: QueryCtx, submission: Doc<"submissions">, analysis: Doc<"analysisResults"> | null): Promise<Witness> {
  const runs = await ctx.db.query("derivedAnnotations").withIndex("by_submission", q => q.eq("submissionId", submission._id)).collect();
  if (runs.some(run => run.organizationId !== submission.organizationId)) throw new Error("annotation_reference_mismatch");
  const run = runs.filter(row => row.kind === "objects").sort((a, b) => b.createdAt - a.createdAt || b._creationTime - a._creationTime)[0];
  if (!run) return absent("detector", "Object detector (advisory, client-computed)", "work",
    "No stored browser-derived objects run. Advisory, client-computed detector evidence is missing.");
  const intervals = juryPickupIntervals(submission, analysis);
  // These timestamps are recomputed from validated uploaded frames by saveDerived,
  // not accepted from a client summary. A clip-wide count cannot establish overlap.
  const matching = (run.cupInHandTimestampsMs ?? []).filter(tMs => Number.isFinite(tMs) && tMs >= 0 && intervals.length > 0 &&
    intervals.every(windows => windows.some(interval => tMs >= interval.startMs && tMs <= interval.endMs)));
  const agrees = (run.summary.cupInHandFrames ?? 0) > 0 && matching.length > 0;
  const comparison = agrees ? `${matching.length} cup/hand-overlap frames coincide with every available jury model's supported red-cup-pickup interval`
    : intervals.length ? "No cup/hand-overlap frame coincides with every available jury model's supported red-cup-pickup interval"
      : "No valid, source-bound supported red-cup-pickup interval is available from an independent jury; this run cannot corroborate it";
  return witness("detector", "Object detector (advisory, client-computed)", "work", agrees ? "agree" : "disagree",
    `${run.model.name} ${run.model.version} (${run.model.runtime}); advisory and client-computed. ${comparison}. Spatial cup/hand overlap is a heuristic, does not establish cup color or grasp, and never changes verdicts, acceptance, or payables.`,
    await ctx.storage.getUrl(run.storageId));
}

async function bankWitness(ctx: QueryCtx, intent: Doc<"paymentIntents">, payable: Doc<"payables">): Promise<Witness> {
  const [operation, snapshot, treasury, destination] = await Promise.all([
    ctx.db.query("bankOperations").withIndex("by_intent", q => q.eq("paymentIntentId", intent._id)).unique(),
    ctx.db.query("bankSnapshots").withIndex("by_org", q => q.eq("organizationId", intent.organizationId)).unique(),
    ctx.db.query("bankAccounts").withIndex("by_owner", q => q.eq("organizationId", intent.organizationId).eq("owner", "treasury")).unique(),
    ctx.db.query("bankAccounts").withIndex("by_owner", q => q.eq("organizationId", intent.organizationId).eq("owner", payable.contributorTokenIdentifier)).unique(),
  ]);
  const make = (status: Status, detail: string) => witness(`bank:${intent._id}`, BANK_WITNESS_LABEL, "money", status, detail);
  if (operation && (operation.organizationId !== intent.organizationId || operation.orderId !== intent.orderId)) throw new Error("bank_reference_mismatch");
  if (!snapshot || snapshot.status !== "available" || snapshot.accountId !== treasury?.accountId ||
    Date.now() - snapshot.fetchedAt >= 5 * 60_000 || snapshot.fetchedAt > Date.now()) {
    return make("missing", "Simulated bank snapshot unavailable or stale; no fiat movement is established.");
  }
  let activities: BankActivity[];
  try {
    const value: unknown = JSON.parse(snapshot.activitiesJson);
    if (!Array.isArray(value) || value.some(row => !row || typeof row !== "object" || typeof row.description !== "string")) throw new Error("invalid_snapshot");
    activities = value;
  } catch { return make("missing", "Simulated bank snapshot is unreadable; no comparison available."); }
  if (!operation) return make(activities.some(activity => activity.description === intent.intentId) ? "disagree" : "missing",
    "No durable simulated bank operation for this payout; any unclaimed activity is not corroboration.");
  const expected = { intentId: intent.intentId, amountAtomic: payable.amountAtomic.toString(), accountId: treasury?.accountId ?? "",
    kind: "transfer" as const, payeeId: destination?.accountId };
  if (treasury?.status !== "ready" || destination?.status !== "ready" || !expected.accountId || !expected.payeeId ||
    operation.intentId !== intent.intentId || operation.amountAtomic !== payable.amountAtomic || operation.kind !== "transfer" ||
    operation.accountId !== expected.accountId || operation.payeeId !== expected.payeeId) {
    return make("disagree", "Simulated bank operation does not match the payout's stored account, recipient, or amount bindings.");
  }
  const result = compareBankWitness(expected, activities);
  return make(result.status === "match" ? "agree" : result.status === "mismatch" ? "disagree"
    : result.reason === "bank_record_pending" || operation.status === "uncertain" || operation.status === "sending" ? "pending" : "missing",
    `Simulated bank: ${result.reason ?? "stored activity matches payout"}; activity IDs: ${result.activityIds.join(", ") || "none"}; operation ${operation.status}. Not real fiat settlement.`);
}

/** A read-only receipt, not a new verifier, approval, or settlement authority. */
export const forSubmission = query({
  args: { demoIdentity: v.string(), submissionId: v.id("submissions") },
  handler: async (ctx, args): Promise<WitnessReceipt> => {
    const principal = await requireRole(ctx, args.demoIdentity, ["controller", "buyer", "contributor"]);
    if (isFinanceAgent(principal)) throw new Error("forbidden");
    const submission = await ctx.db.get(args.submissionId);
    if (!submission) throw new Error("submission_not_found");
    requireTenant(principal, submission);
    const order = await ctx.db.get(submission.orderId);
    if (!order) throw new Error("order_not_found");
    requireTenant(principal, order);
    if (!principal.roles.includes("controller")) {
      const ownsSubmission = principal.roles.includes("contributor") && submission.contributorTokenIdentifier === principal.tokenIdentifier;
      const ownsOrder = principal.roles.includes("buyer") && order.buyerTokenIdentifier === principal.tokenIdentifier;
      if (!ownsSubmission && !ownsOrder) throw new Error(principal.roles.includes("contributor") ? "submission_not_owned" : "order_not_owned");
    }
    const [analysis, decision, orderPayables] = await Promise.all([
      submission.currentAnalysisId ? ctx.db.get(submission.currentAnalysisId) : null,
      submission.currentDecisionId ? ctx.db.get(submission.currentDecisionId) : null,
      ctx.db.query("payables").withIndex("by_order", q => q.eq("orderId", order._id)).collect(),
    ]);
    if (analysis && (analysis.organizationId !== order.organizationId || analysis.submissionId !== submission._id ||
      analysis.taskVersionId !== submission.taskVersionId || analysis.sourceHash !== submission.sourceHash)) throw new Error("analysis_source_mismatch");
    if (decision && (decision.organizationId !== order.organizationId || decision.submissionId !== submission._id ||
      decision.taskVersionId !== submission.taskVersionId)) throw new Error("decision_reference_mismatch");
    const recommendation = !analysis ? null : analysis.implementation === "inference" && analysis.pipelineStatus === "completed"
      ? analysis.recommendation : "needs_review";
    const witnesses = workWitnesses(submission, analysis);
    witnesses.push(await detectorWitness(ctx, submission, analysis));
    const attestation = analysis ? await ctx.db.query("attestations").withIndex("by_analysis", q => q.eq("analysisId", analysis._id)).unique() : null;
    if (attestation && attestation.submissionId !== submission._id) throw new Error("attestation_reference_mismatch");
    const attested = attestation?.status === "confirmed" && hash(attestation.attestationUid) && hash(attestation.txHash) && !!attestation.fields;
    const attestationMatches = attested && analysis &&
      attestation.fields!.reportHash.replace(/^0x/, "") === analysis.reportHash.replace(/^0x/, "") &&
      attestation.fields!.sourceSha256.replace(/^0x/, "") === analysis.sourceHash.replace(/^0x/, "") &&
      attestation.fields!.pipelineVersion === analysis.pipelineVersion && attestation.fields!.recommendation === recommendation;
    witnesses.push(witness("eas_attestation", "EAS attestation (Base Sepolia testnet)", "work", attested ? attestationMatches ? "agree" : "disagree"
      : attestation?.status === "pending" || attestation?.status === "submitted" ? "pending" : "missing",
    attested ? `Confirmed UID: ${attestation.attestationUid}. ${attestationMatches ? "Commits to the current report; does not prove that every report claim is true" : "Attested fields do not match the current analysis"}.`
      : `No confirmed EAS attestation for the current analysis${attestation ? `; stored status: ${attestation.status}${attestation.error ? ` (${attestation.error})` : ""}` : ""}.`,
    attested ? `https://base-sepolia.easscan.org/attestation/view/${attestation.attestationUid}` : null));
    witnesses.push(analysis ? witness("deterministic_judge", "Deterministic judge recommendation", "judgment",
      recommendation === "accept" ? "agree" : recommendation === "request_correction" ? "disagree" : "pending",
      `Stored recommendation: ${recommendation}; implementation: ${analysis.implementation}; pipeline: ${analysis.pipelineStatus}. Advisory; does not authorize payment.`)
      : absent("deterministic_judge", "Deterministic judge recommendation", "judgment", "No stored analysis recommendation."));
    witnesses.push(decision ? witness("human_controller", "Human controller decision", "judgment",
      decision.decision === "accepted" ? "agree" : "disagree", `Recorded decision: ${decision.decision}; reason: ${decision.reason.slice(0, 1000)}.`)
      : absent("human_controller", "Human controller decision", "judgment", "No recorded human controller decision."));
    const payables = orderPayables.filter(row => row.submissionId === submission._id);
    if (payables.length > 1) throw new Error("duplicate_payable_reference");
    const payable = payables[0];
    if (!payable) {
      witnesses.push(absent("finance_agent", "Finance-agent proposals / refusals", "judgment", "No related payable; no payout proposal or refusal can be attributed to this sample."),
        absent("payable", "Contributor payable (Base Sepolia testnet)", "money", "No payable recorded for this submission."),
        absent("ledger_journal", "Ledger journal (testnet USDC)", "money", "No related payable journal recorded."),
        absent("payout_chain", "Payout chain observation (Base Sepolia testnet)", "money", "No payout observation for this submission."),
        absent("bank_witness", BANK_WITNESS_LABEL, "money", "No related payout intent to compare with simulated bank activity."));
      return { submissionId: submission._id, verdict: submission.status, recommendation, witnesses };
    }
    if (payable.organizationId !== order.organizationId || payable.contributorTokenIdentifier !== submission.contributorTokenIdentifier) throw new Error("payable_reference_mismatch");
    witnesses.push(witness("payable", "Contributor payable (Base Sepolia testnet)", "money",
      payable.status === "reversed" || payable.amountAtomic !== order.contributorRateAtomic ? "disagree" : "agree",
      `Stored obligation: ${payable.amountAtomic.toString()} micro-USDC; status: ${payable.status}. An obligation alone is not proof of payment.`));
    const intents = await ctx.db.query("paymentIntents").withIndex("by_payable", q => q.eq("payableId", payable._id)).collect();
    const entries = await ctx.db.query("journalEntries").withIndex("by_order", q => q.eq("orderId", order._id)).collect();
    const payoutKeys = new Set(intents.map(intent => intent.intentId));
    const relatedEntries = entries.filter(entry => entry.eventKey === payable.sourceEventKey || payoutKeys.has(entry.eventKey));
    for (const entry of relatedEntries) {
      if (entry.organizationId !== order.organizationId) throw new Error("journal_reference_mismatch");
      const lines = await ctx.db.query("journalLines").withIndex("by_entry", q => q.eq("journalEntryId", entry._id)).collect();
      if (lines.some(line => line.organizationId !== order.organizationId)) throw new Error("journal_reference_mismatch");
      const expected = entry.eventKey === payable.sourceEventKey
        ? createFulfillmentJournal({ eventId: entry.eventKey, orderId: order._id, sampleId: submission._id,
          contributorId: payable.contributorTokenIdentifier, priceMicroUsdc: order.pricePerSampleAtomic, contributorMicroUsdc: payable.amountAtomic })
        : createPayoutJournal({ eventId: entry.eventKey, orderId: order._id, payableId: submission._id,
          contributorId: payable.contributorTokenIdentifier, amountMicroUsdc: payable.amountAtomic });
      const matches = relatedEntries.filter(row => row.eventKey === entry.eventKey).length === 1 &&
        entry.kind === expected.kind && entry.network === PAYMENT_NETWORK && entry.tokenAddress === USDC_ADDRESS &&
        (entry.reference ?? entry.sourceReference) === submission._id &&
        entry.contributorTokenIdentifier === payable.contributorTokenIdentifier && lines.length === expected.lines.length &&
        expected.lines.every((line, index) => lines[index]?.account === line.account &&
          lines[index]?.side === (line.debit > 0n ? "debit" : "credit") && lines[index]?.amountAtomic === (line.debit || line.credit));
      witnesses.push(witness(`ledger:${entry._id}`, `Ledger journal: ${entry.kind} (testnet USDC)`, "money", matches ? "agree" : "disagree",
        `Posted event ${entry.eventKey}; ${lines.length} lines; ${matches ? "exact accounts and amounts match the obligation" : "accounts, amounts, or bindings do not match the obligation"}.`));
    }
    if (!relatedEntries.some(entry => entry.eventKey === payable.sourceEventKey)) witnesses.push(absent("ledger_journal", "Ledger journal (testnet USDC)", "money", "No fulfillment journal for the payable's source event."));
    const auditEntities = [{ type: "payables", id: payable._id as string }];
    let payoutCount = 0;
    for (const intent of intents) {
      if (intent.kind !== "contributor_payout" || intent.organizationId !== order.organizationId || intent.orderId !== order._id ||
        intent.amountAtomic !== payable.amountAtomic || intent.recipientAddress !== payable.recipientAddress) throw new Error("payment_reference_mismatch");
      auditEntities.push({ type: "paymentIntents", id: intent._id });
      const command = await ctx.db.get(intent.paymentCommandId);
      if (!command || command.organizationId !== order.organizationId || command.orderId !== order._id || command.payableId !== payable._id ||
        command.amountAtomic !== payable.amountAtomic || command.recipientAddress !== payable.recipientAddress) throw new Error("payment_reference_mismatch");
      const attempts = await ctx.db.query("paymentAttempts").withIndex("by_command", q => q.eq("paymentCommandId", command._id)).collect();
      for (const attempt of attempts) {
        if (attempt.organizationId !== order.organizationId || (attempt.paymentIntentId && attempt.paymentIntentId !== intent._id)) throw new Error("payment_reference_mismatch");
        const observations = await ctx.db.query("chainObservations").withIndex("by_attempt", q => q.eq("paymentAttemptId", attempt._id)).collect();
        for (const observation of observations) {
          if (observation.organizationId !== order.organizationId) throw new Error("payment_reference_mismatch");
          let status: Status = "agree", reason = "Confirmed observation matches the stored payout amount, sender, recipient, and Base USDC token";
          try { validateTransfer(observation, { network: PAYMENT_NETWORK, amountAtomic: payable.amountAtomic,
            toAddress: payable.recipientAddress, fromAddress: attempt.payerAddress ?? "" }); }
          catch (error) { reason = error instanceof Error ? error.message : "invalid_transfer"; status = reason === "insufficient_confirmations" ? "pending" : "disagree"; }
          if (!attempt.txHash || attempt.txHash.toLowerCase() !== observation.txHash.toLowerCase()) { status = "disagree"; reason = "attempt_transaction_mismatch"; }
          witnesses.push(witness(`payout:${observation._id}`, "Payout chain observation (Base Sepolia testnet)", "money", status,
            `${reason}; ${observation.amountAtomic.toString()} micro-USDC; tx ${observation.txHash}; log ${observation.logIndex}; ${observation.confirmations} confirmations.`,
            observation.network === PAYMENT_NETWORK && hash(observation.txHash) ? PAYMENT_RAILS[PAYMENT_NETWORK].explorerTx(observation.txHash) : null));
          payoutCount++;
        }
      }
      witnesses.push(await bankWitness(ctx, intent, payable));
    }
    if (!payoutCount) witnesses.push(witness("payout_chain", "Payout chain observation (Base Sepolia testnet)", "money",
      intents.some(intent => ["submitted", "reconciling", "approved"].includes(intent.status)) ? "pending" : "missing",
      "No stored payout chain observation. Approval, submission, and timeouts do not prove settlement."));
    if (!intents.length) witnesses.push(absent("bank_witness", BANK_WITNESS_LABEL, "money", "No related payout intent to compare with simulated bank activity."));
    const events = (await Promise.all(auditEntities.map(entity => ctx.db.query("auditEvents").withIndex("by_entity", q =>
      q.eq("organizationId", order.organizationId).eq("entityType", entity.type).eq("entityId", entity.id)).collect()))).flat()
      .filter(event => event.actor.identity === "demo:skarl:finance-agent" &&
        ["payment_proposed", "payment_proposal_refused", "payment_approval_refused", "independent_approval_requested"].includes(event.action));
    events.sort((a, b) => a.occurredAt - b.occurredAt || a._id.localeCompare(b._id));
    for (const event of events) witnesses.push(witness(`finance:${event._id}`, "Finance-agent proposal / refusal", "judgment",
      event.action.endsWith("_refused") ? "disagree" : "pending", `${event.action}: ${event.reason.slice(0, 1000)}. A proposal is not independent approval or settlement.`));
    const proposals = intents.filter(intent => intent.kind === "contributor_payout" && intent.requesterTokenIdentifier === "demo:skarl:finance-agent");
    for (const intent of proposals) {
      if (events.some(event => event.action === "payment_proposed" && event.entityId === intent._id)) continue;
      witnesses.push(witness(`finance:proposal:${intent._id}`, "Finance-agent payout proposal", "judgment", "pending",
        `Stored proposal ${intent.intentId}; ${intent.amountAtomic.toString()} micro-USDC; current intent status: ${intent.status}. Proposal alone does not prove independent approval or settlement.`));
    }
    // Some tool refusals (e.g. a batch amount cap) do not produce an auditEvent.
    // Read only steps explicitly naming this payable/its intent, never an entire
    // order-wide model explanation that could disclose another contributor.
    const runs = await ctx.db.query("financeAgentRuns").withIndex("by_order", q => q.eq("orderId", order._id)).collect();
    let toolRefusals = 0;
    const intentIds = new Set(intents.map(intent => intent._id as string));
    for (const run of runs) {
      if (run.organizationId !== order.organizationId) throw new Error("finance_run_reference_mismatch");
      let steps: unknown[];
      try { steps = list(JSON.parse(run.transcriptJson)); } catch { continue; }
      steps.forEach((value, index) => {
        const step = object(value), call = object(step.call), args = object(call.arguments), result = object(step.result);
        const related = args.payableId === payable._id || list(args.payableIds).includes(payable._id) || intentIds.has(text(args.intentId));
        if (!related || result.ok !== false || !["proposePaymentBatch", "requestApproval", "approve", "approvePayment"].includes(text(call.name))) return;
        witnesses.push(witness(`finance:run:${run._id}:${index}`, "Finance-agent tool refusal", "judgment", "disagree",
          `${text(call.name)} refused: ${text(result.code) || "unspecified refusal"}; recorded model: ${run.model}. No approval or payment is inferred from model output.`));
        toolRefusals++;
      });
    }
    if (!events.length && !proposals.length && !toolRefusals) witnesses.push(absent("finance_agent", "Finance-agent proposals / refusals", "judgment", "No stored finance-agent proposal or refusal for this payable."));
    return { submissionId: submission._id, verdict: submission.status, recommendation, witnesses };
  },
});
