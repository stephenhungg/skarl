import type { Doc } from "../_generated/dataModel";
import { PAYMENT_NETWORK } from "../../packages/contracts/src/chain";

const evidenceSource = "https://github.com/stephenhungg/skarl/blob/main/docs/status.md#live-retry-after-recovery-deployment--october-25-2026-0305-pdt";

/** Dated external evidence, not a claim about today's wallet balance or policy. */
export const recordedWalletEvidence = {
  recordedAt: "2026-10-25T03:05:00-07:00", sourceUrl: evidenceSource,
  address: "0x0A9EfDF66c58543538824906aE267B969Ed651c5",
  policyId: "fa62ac94-e420-4013-bb4f-2dcab18deb7b", capAtomic: "2000000",
  rejections: [
    { kind: "over_cap", amountAtomic: "2000001", status: 403, code: "policy_violation", correlationId: "a5006791aba9be62-IAD" },
    { kind: "non_allowlisted_recipient", amountAtomic: "100000", status: 403, code: "policy_violation", correlationId: "a500679519ddbe62-IAD" },
  ],
};

export function walletEvidence() {
  const configuredAddress = process.env.CDP_AGENT_ADDRESS;
  const address = configuredAddress && /^0x[0-9a-fA-F]{40}$/.test(configuredAddress) && !/^0x0{40}$/i.test(configuredAddress)
    ? configuredAddress : null;
  const policyId = process.env.CDP_AGENT_POLICY_ID || null;
  const cap = process.env.CDP_PAYOUT_CAP_ATOMIC;
  const capAtomic = cap && /^[1-9]\d*$/.test(cap) ? cap : null;
  const executor = process.env.PAYOUT_EXECUTOR ?? "controller_wallet";
  return { address, explorerUrl: address ? `https://sepolia.basescan.org/address/${address}` : null,
    network: PAYMENT_NETWORK, label: "Base Sepolia", policyId, capAtomic,
    capSource: capAtomic ? "Configured CDP_PAYOUT_CAP_ATOMIC; not a live policy inspection" : null,
    capMissing: capAtomic ? null : "CDP_PAYOUT_CAP_ATOMIC is not configured; see the separately recorded policy cap",
    executorMode: executor, executorSource: "PAYOUT_EXECUTOR (defaults to controller_wallet)",
    recorded: recordedWalletEvidence,
    recordedRejections: recordedWalletEvidence.rejections.map(row => ({ ...row, simulated: false, sourceUrl: evidenceSource,
      recordedAt: recordedWalletEvidence.recordedAt, txHash: null })),
    missing: !address ? "CDP_AGENT_ADDRESS is not configured with a valid nonzero EVM address" :
      !policyId ? "CDP_AGENT_POLICY_ID is not configured" : null };
}

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown) => typeof value === "string" ? value : null;
const duration = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
function parsed(value: string | undefined) {
  try { return value ? object(JSON.parse(value)) : {}; } catch { return {}; }
}

/** Export dispatcher refusals only, never prompts, tool arguments or arbitrary model text. */
export function toolRefusals(transcriptJson: string) {
  let transcript: unknown;
  try { transcript = JSON.parse(transcriptJson); } catch { return []; }
  return list(transcript).flatMap((item, index) => {
    const step = object(item), result = object(step.result), call = object(step.call);
    return result.ok === false && typeof result.code === "string"
      ? [{ index, tool: text(call.name), code: result.code, source: "persisted_dispatcher_result" }] : [];
  });
}

/** Only source-bound visual reports vote; an audio call never becomes a second judge. */
export function juryEvidence(submission: Doc<"submissions">, analysis: Doc<"analysisResults"> | null) {
  if (analysis && (analysis.organizationId !== submission.organizationId || analysis.submissionId !== submission._id ||
    analysis.taskVersionId !== submission.taskVersionId || analysis.sourceHash !== submission.sourceHash)) throw new Error("analysis_reference_mismatch");
  const report = parsed(analysis?.reportJson), observations = parsed(analysis?.observationsJson);
  const bound = (candidate: ObjectValue) => candidate.submissionId === submission._id && candidate.taskVersionId === submission.taskVersionId &&
    object(candidate.source).sha256 === submission.sourceHash && object(candidate.pipeline).implementation === "inference";
  const available = analysis?.implementation === "inference" && ["completed", "needs_review"].includes(analysis.pipelineStatus) && bound(report);
  const modelRuns = available ? list(object(report.pipeline).modelRuns).map(object).map(run => ({
    provider: text(run.provider), model: text(run.model), promptVersion: text(run.promptVersion), latencyMs: duration(run.elapsedMs),
    missing: duration(run.elapsedMs) === null ? "No recorded model latency" : null,
  })) : [];
  const jury = object(observations.jury);
  const judges = available ? list(jury.judges).map(object).map(judge => {
    const candidate = object(judge.report), pipeline = object(candidate.pipeline);
    const usable = bound(candidate) && ["completed", "needs_review"].includes(String(pipeline.status)) && !judge.failureCode;
    const model = text(judge.model), run = modelRuns.find(row => row.model === model);
    return { model, provider: run?.provider ?? null, latencyMs: run?.latencyMs ?? null,
      verdict: usable ? text(candidate.recommendation) : null,
      criteria: usable ? list(candidate.criteria).map(object).map(row => ({ criterionId: text(row.criterionId), verdict: text(row.status) })) : [],
      missing: usable ? null : text(judge.failureCode) ?? "No available source-bound inference from this judge" };
  }) : [];
  const independent = judges.length >= 2 && judges.every(judge => judge.model) && new Set(judges.map(judge => judge.model)).size === judges.length;
  const criterionIds = [...new Set(judges.flatMap(judge => judge.criteria.flatMap(row => row.criterionId ? [row.criterionId] : [])))];
  const criteria = criterionIds.map(criterionId => {
    const verdicts = judges.map(judge => ({ model: judge.model, verdict: judge.criteria.find(row => row.criterionId === criterionId)?.verdict ?? null }));
    const comparable = independent && judges.every(judge => !judge.missing) && verdicts.every(row => ["supported", "contradicted", "unobservable"].includes(row.verdict ?? ""));
    return { criterionId, verdicts, agreement: comparable ? new Set(verdicts.map(row => row.verdict)).size === 1 : null,
      missing: comparable ? null : "Two available visual-model verdicts are required" };
  });
  const comparable = criteria.length > 0 && criteria.every(row => row.agreement !== null);
  return { submissionId: submission._id, advisoryOnly: true, modelRuns, judges, criteria,
    agreementFraction: comparable ? criteria.filter(row => row.agreement).length / criteria.length : null,
    latencyMs: analysis?.processingElapsedMs ?? null,
    missing: !analysis ? "No analysis yet" : !available ? "No source-bound inference report yet" :
      !independent ? "Two independent visual-model reports are required" : !comparable ? "Available verdicts from both visual models are required" : null };
}
