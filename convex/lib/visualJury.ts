"use node";
import { resolveTaskSpec } from "./taskSpec";
import { observeVideo, observeAudio, GeminiFailure, videoModel, audioModel } from "./gemini";
import { buildVerificationReport, buildVerificationReports, EVALUATION_VIDEO_MODELS, type BuildVerificationReportInput,
  type EvaluationVideoModel, type ModelRun, type VerificationReport } from "./verificationReport";

export interface VisualJury {
  advisoryOnly: true;
  agreementFraction: number | null;
  disagreedCriteria: string[];
  judges: { model: string; failureCode?: string; report: VerificationReport }[];
}
type ReportContext = Omit<BuildVerificationReportInput, "video" | "audio" | "modelRuns" | "failure">;

/** Independent silent-frame requests; only deterministic rubric comparisons vote. */
export async function observeEvidence(
  media: { videoFrames: Parameters<typeof observeVideo>[0]; audio?: Uint8Array | null },
  input: ReportContext,
  evaluationModel?: EvaluationVideoModel,
  contentScope?: { verificationOnly: true; evalRunId: string; evalContentOnly: true },
) {
  // Only an explicit opt-out disables the panel. Evaluation overrides keep one model.
  const taskSpec = input.taskSpec ?? resolveTaskSpec({ criteria: input.criteria });
  if (!taskSpec) throw new GeminiFailure("task_spec_unavailable");
  const enabled = evaluationModel === undefined && process.env.VERIFIER_JURY !== "off";
  const models = enabled ? [...EVALUATION_VIDEO_MODELS] : [evaluationModel];
  const [visualOutcomes, audioOutcomes] = await Promise.all([
    Promise.allSettled(models.map(model => observeVideo(media.videoFrames, input.durationMs, model, { taskSpec: taskSpec, criteria: input.criteria }))),
    Promise.allSettled([media.audio ? observeAudio(media.audio, input.durationMs, { taskSpec: taskSpec, criteria: input.criteria })
      : Promise.reject(new GeminiFailure("audio_stream_missing"))]),
  ]);
  const judges = visualOutcomes.map((outcome, index) => outcome.status === "fulfilled"
    ? { observation: outcome.value.observation, run: outcome.value.run, failure: undefined }
    : { observation: undefined, run: { provider: "google", model: models[index] ?? videoModel(),
      promptVersion: "timestamped-frames-visible-events-v2" } as ModelRun,
      failure: outcome.reason instanceof GeminiFailure ? outcome.reason.code : "video_unavailable" });
  const speech = audioOutcomes[0]!;
  const audio = speech.status === "fulfilled" ? speech.value.observation : undefined;
  const audioFailure = speech.status === "rejected"
    ? speech.reason instanceof GeminiFailure ? speech.reason.code : "audio_unavailable" : undefined;
  const audioRuns: ModelRun[] = speech.status === "fulfilled" ? [speech.value.run]
    : media.audio ? [{ provider: "google", model: audioModel(), promptVersion: "audio-only-events-v2" }] : [];
  const modelRuns = [...judges.map(judge => judge.run), ...audioRuns].slice(0, 16);
  const failure = audioFailure ?? judges.find(judge => judge.failure !== undefined)?.failure;
  const warnings = [...(input.warnings ?? [])];
  let jury: VisualJury | undefined;
  if (enabled) {
    const reports = judges.map(judge => {
      const judgeInput: BuildVerificationReportInput = { ...input, video: judge.observation, audio,
        modelRuns: [judge.run, ...audioRuns].slice(0, 16), failure: audioFailure ?? judge.failure,
        reportId: `${input.reportId ?? input.submissionId}:visual:${judge.run.model}` };
      const report = contentScope ? buildVerificationReports(judgeInput, contentScope).qualityReport : buildVerificationReport(judgeInput);
      if (!report) throw new GeminiFailure("evaluation_projection_unavailable");
      return { model: judge.run.model, ...(judge.failure ? { failureCode: judge.failure } : {}), report };
    });
    const unavailable = judges.some(judge => judge.failure !== undefined);
    const disagreedCriteria = input.criteria.filter(criterion => unavailable ||
      new Set(reports.map(judge => judge.report.criteria.find(item => item.criterionId === criterion.criterionId)?.status)).size !== 1).map(criterion => criterion.criterionId);
    // Failed fallback findings are not evidence of inter-model agreement.
    jury = { advisoryOnly: true, agreementFraction: unavailable || audioFailure ? null
      : (input.criteria.length - disagreedCriteria.length) / input.criteria.length, disagreedCriteria, judges: reports };
    warnings.push(...reports.flatMap(judge => judge.report.warnings));
    if (disagreedCriteria.length) warnings.push(`Visual judges disagree: ${disagreedCriteria.join(", ")}`);
  }
  return { video: judges[0]!.observation, audio, modelRuns, failure, warnings: [...new Set(warnings)], jury };
}
