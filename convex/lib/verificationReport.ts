import { configNumber, evaluationVideoModels } from "./config.ts";
import { resolveTaskSpec, normalizeTaskSpec, type TaskSpec } from "./taskSpec.ts";
import { checkSpokenLiveness, MISSING_LIVENESS_WARNING, instructionLike, type SpokenLivenessChallenge } from "./spokenLiveness.ts";

/** Pure, advisory evidence comparison. No model, storage, or payment authority. */
export const PIPELINE_VERSION = "task-evidence-2.0";
/** Evaluation overrides are deliberately bounded and never change payment authority. */
export const EVALUATION_VIDEO_MODELS = evaluationVideoModels();
export type EvaluationVideoModel = typeof EVALUATION_VIDEO_MODELS[number];
export type Action = "pickup" | "place";
export type ObservedObject = string;
export type Target = string;
export type FindingStatus = "supported" | "contradicted" | "unobservable";
export interface ActionObservation {
  action: Action;
  object: ObservedObject;
  target: Target;
  startMs: number;
  endMs: number;
  description: string;
}
export interface VideoObservation {
  visibility: "clear" | "occluded" | "uncertain";
  observations: ActionObservation[];
}
export interface TranscriptSegment { startMs: number; endMs: number; text: string }
export interface AudioObservation {
  transcript: string;
  segments: TranscriptSegment[];
  claims: ActionObservation[];
}
export interface ModelRun {
  provider: string;
  model: string;
  promptVersion: string;
  elapsedMs?: number;
  inputTokens?: number;
  outputTokens?: number;
}
export interface RubricCriterion {
  criterionId: string;
  description: string;
  modality: "visual" | "audio" | "cross_modal" | "temporal";
}
export interface Evidence {
  modality: "video" | "audio" | "text";
  startMs: number;
  endMs: number;
  claim: string;
  sourceId?: string;
}
export interface CriterionFinding {
  criterionId: string;
  status: FindingStatus;
  evidence: Evidence[];
  reason: string;
}
export interface DuplicateResult {
  status: "not_checked" | "clear" | "suspected";
  matches: { submissionId: string; score: number; overlapMs: number }[];
}
export interface VerificationReport {
  observations?: { video?: VideoObservation; audio?: AudioObservation };
  schemaVersion: "1.0";
  reportId: string;
  submissionId: string;
  taskVersionId: string;
  source: { sha256: string; durationMs: number };
  pipeline: {
    version: string;
    status: "completed" | "needs_review" | "failed";
    implementation: "inference";
    modelRuns: ModelRun[];
  };
  criteria: CriterionFinding[];
  duplicate: DuplicateResult;
  recommendation: "accept" | "request_correction" | "needs_review";
  warnings: string[];
}
export interface BuildVerificationReportInput {
  submissionId: string;
  taskVersionId: string;
  sourceHash: string;
  durationMs: number;
  taskSpec?: TaskSpec;
  criteria: RubricCriterion[];
  video?: VideoObservation;
  audio?: AudioObservation;
  liveness?: SpokenLivenessChallenge;
  modelRuns: ModelRun[];
  duplicate: DuplicateResult;
  warnings?: string[];
  failure?: string;
  reportId?: string;
}

const MAX_RAW_LENGTH = configNumber("VERIFIER_MAX_RAW_LENGTH");
const MAX_ACTIONS = configNumber("VERIFIER_MAX_ACTIONS");
const MAX_SEGMENTS = configNumber("VERIFIER_MAX_SEGMENTS");
const MAX_TEXT_LENGTH = configNumber("VERIFIER_MAX_TEXT_LENGTH");
const TEMPORAL_TOLERANCE_MS = configNumber("VERIFIER_TEMPORAL_TOLERANCE_MS");
const actionProperties = {
  action: { type: "string", enum: ["pickup", "place"] },
  object: { type: "string", minLength: 1, maxLength: 80 },
  target: { type: "string", minLength: 1, maxLength: 80 },
  startMs: { type: "integer", minimum: 0 },
  endMs: { type: "integer", minimum: 0 },
  description: { type: "string", minLength: 1, maxLength: 2_000 },
} as const;
const actionSchema = {
  type: "object", additionalProperties: false, properties: actionProperties,
  required: ["action", "object", "target", "startMs", "endMs", "description"],
} as const;
const segmentSchema = {
  type: "object", additionalProperties: false,
  properties: {
    startMs: { type: "integer", minimum: 0 }, endMs: { type: "integer", minimum: 0 },
    text: { type: "string", minLength: 1, maxLength: 2_000 },
  },
  required: ["startMs", "endMs", "text"],
} as const;
export const VIDEO_RESPONSE_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    visibility: { type: "string", enum: ["clear", "occluded", "uncertain"] },
    observations: { type: "array", maxItems: MAX_ACTIONS, items: actionSchema },
  },
  required: ["visibility", "observations"],
} as const;
export const AUDIO_RESPONSE_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    transcript: { type: "string", maxLength: MAX_TEXT_LENGTH },
    segments: { type: "array", maxItems: MAX_SEGMENTS, items: segmentSchema },
    claims: { type: "array", maxItems: MAX_ACTIONS, items: actionSchema },
  },
  required: ["transcript", "segments", "claims"],
} as const;

function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const object = value as Record<string, unknown>;
  for (const key of Object.keys(object)) if (!keys.includes(key)) throw new Error(`${label} has an unexpected field: ${key}`);
  return object;
}
function text(value: unknown, label: string, max = 2_000, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > max || (!allowEmpty && value.trim().length === 0)) throw new Error(`${label} must be bounded text`);
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value)) throw new Error(`${label} contains invalid Unicode`);
  return value;
}
function integer(value: unknown, label: string, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max) throw new Error(`${label} must be a bounded nonnegative safe integer`);
  return value;
}
function choice<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) throw new Error(`${label} has an invalid enum value`);
  return value as T;
}
function array(value: unknown, max: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label} must be a bounded array`);
  return value;
}
function interval(object: Record<string, unknown>, durationMs: number, label: string) {
  const startMs = integer(object.startMs, `${label}.startMs`, durationMs);
  const endMs = integer(object.endMs, `${label}.endMs`, durationMs);
  if (endMs <= startMs) throw new Error(`${label} requires a nonzero, ordered interval`);
  return { startMs, endMs };
}
function parseAction(value: unknown, durationMs: number, label: string, spec: TaskSpec): ActionObservation {
  const object = record(value, Object.keys(actionProperties), label);
  return {
    action: choice(object.action, ["pickup", "place"], `${label}.action`),
    object: choice(object.object, [spec.object, ...spec.distractors, "other", "unknown"], `${label}.object`),
    target: choice(object.target, [spec.target, "other", "unknown"], `${label}.target`),
    ...interval(object, durationMs, label),
    description: text(object.description, `${label}.description`),
  };
}
function parseSegments(value: unknown, durationMs: number): TranscriptSegment[] {
  const segments = array(value, MAX_SEGMENTS, "segments").map((item, index) => {
    const object = record(item, ["startMs", "endMs", "text"], `segments[${index}]`);
    return { ...interval(object, durationMs, `segments[${index}]`), text: text(object.text, `segments[${index}].text`) };
  });
  for (let index = 1; index < segments.length; index += 1) {
    if (segments[index]!.startMs < segments[index - 1]!.startMs) throw new Error("segments must be in timestamp order");
  }
  return segments;
}
function parseJson(raw: string): unknown {
  text(raw, "model response", MAX_RAW_LENGTH);
  try { return JSON.parse(raw) as unknown; } catch { throw new Error("model response is not strict JSON"); }
}
export function parseVideoResponse(raw: string, durationMs: number, spec: TaskSpec): VideoObservation {
  integer(durationMs, "durationMs");
  const object = record(parseJson(raw), ["visibility", "observations"], "video response");
  return {
    visibility: choice(object.visibility, ["clear", "occluded", "uncertain"], "visibility"),
    observations: array(object.observations, MAX_ACTIONS, "observations").map((item, index) => parseAction(item, durationMs, `observations[${index}]`, spec)),
  };
}

function normalizedWords(value: string): string {
  return (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");
}
function overlaps(left: { startMs: number; endMs: number }, right: { startMs: number; endMs: number }, tolerance = TEMPORAL_TOLERANCE_MS): boolean {
  return left.startMs <= right.endMs + tolerance && right.startMs <= left.endMs + tolerance;
}

function labelPattern(label: string): RegExp {
  const words = label.replaceAll("_", " ").split(/\s+/).map(word => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b${words.join("[ _-]+")}\\b`, "i");
}

/** Conservative English claim extraction; it never infers an action from the task prompt. */
export function audioFromTranscriptSegments(input: TranscriptSegment[], durationMs: number, spec: TaskSpec): AudioObservation {
  integer(durationMs, "durationMs");
  const segments = parseSegments(input, durationMs);
  const transcript = segments.map(segment => segment.text).join(" ");
  text(transcript, "transcript", MAX_TEXT_LENGTH, true);
  const ranges: { start: number; end: number; segment: TranscriptSegment }[] = [];
  let offset = 0;
  for (const segment of segments) {
    ranges.push({ start: offset, end: offset + segment.text.length, segment });
    offset += segment.text.length + 1;
  }
  const actions = [...transcript.matchAll(/\b(pick(?:s|ing|ed)?\s+up|lift(?:s|ing|ed)?|grasp(?:s|ing|ed)?|plac(?:e|es|ed|ing)|put(?:s|ting)?|set(?:s|ting)?(?:\s+down)?)\b/gi)];
  if (actions.length > MAX_ACTIONS) throw new Error("transcript has too many action claims");
  const claims: ActionObservation[] = [];
  let previousObject: ObservedObject = "unknown";
  let previousEndMs = -10_000;
  for (let index = 0; index < actions.length; index += 1) {
    const match = actions[index]!;
    const start = match.index;
    const nextAction = index + 1 < actions.length ? actions[index + 1]!.index : transcript.length;
    const candidateClause = transcript.slice(start, nextAction);
    const sentenceEnd = candidateClause.search(/[.;!?]/);
    const boundedClause = (sentenceEnd >= 0 ? candidateClause.slice(0, sentenceEnd + 1) : candidateClause)
      .replace(/(?:\s+(?:and|then|now|i|we|am|i'm))+\s*$/gi, "");
    const end = start + boundedClause.length;
    const clause = boundedClause.trim();
    const nearbyPrefix = transcript.slice(Math.max(0, start - 35), start);
    const included = ranges.filter(range => range.end > start && range.start < end);
    if (included.length === 0) continue;
    const startMs = included[0]!.segment.startMs;
    const endMs = included[included.length - 1]!.segment.endMs;
    const action: Action = /^(pick|lift|grasp)/i.test(match[0]) ? "pickup" : "place";
    const named = [spec.object, ...spec.distractors].filter(label => labelPattern(label).test(clause));
    const uncertain = /\b(?:not|never|don't|didn't|cannot|can't|maybe|actually|instead|sorry)\b/i.test(`${nearbyPrefix} ${clause}`);
    let object: ObservedObject = named.length === 1 ? named[0]! : "unknown";
    const noun = spec.object.split("_").at(-1)!;
    const reference = new RegExp(`\\b(?:it|(?:that|this) (?:object|${noun}))\\b`, "i");
    if (!named.length && reference.test(clause) && startMs - previousEndMs <= configNumber("VERIFIER_PRONOUN_WINDOW_MS")) object = previousObject;
    let target: Target = "unknown";
    if (action === "place") {
      const destination = labelPattern(spec.target).source.slice(2, -2);
      const relative = spec.steps.some(step => /\bcloser to\b/i.test(step));
      const wrongRelation = new RegExp(`\\b(?:beside|next to|off|away from|near)\\s+(?:the\\s+)?(?:marked\\s+)?${destination}\\b`, "i");
      const containment = spec.steps.some(step => /\b(?:in|into)\b/i.test(step));
      const relation = relative ? "closer to" : containment ? "(?:in|into)" : "(?:on|onto)";
      const correctRelation = new RegExp(`\\b${relation}\\s+(?:the\\s+)?(?:marked\\s+)?${destination}\\b`, "i");
      if (wrongRelation.test(clause)) target = "other";
      else if (correctRelation.test(clause)) target = spec.target;
      else if (/\b(?:on|onto|in|into)\s+(?:the\s+)?(?:table|floor|shelf)\b/i.test(clause) || labelPattern(spec.target).test(clause)) target = "other";
    }
    if (uncertain) { object = "unknown"; target = "unknown"; }
    claims.push({ action, object, target, startMs, endMs, description: clause });
    previousObject = object;
    previousEndMs = endMs;
  }
  return { transcript, segments, claims };
}

export function parseAudioResponse(raw: string, durationMs: number, spec: TaskSpec): AudioObservation {
  integer(durationMs, "durationMs");
  const object = record(parseJson(raw), ["transcript", "segments", "claims"], "audio response");
  const transcript = text(object.transcript, "transcript", MAX_TEXT_LENGTH, true);
  const segments = parseSegments(object.segments, durationMs);
  if (normalizedWords(transcript) !== normalizedWords(segments.map(segment => segment.text).join(" "))) throw new Error("transcript does not agree with its segments");
  const claims = array(object.claims, MAX_ACTIONS, "claims").map((item, index) => parseAction(item, durationMs, `claims[${index}]`, spec));
  const derived = audioFromTranscriptSegments(segments, durationMs, spec).claims;
  for (const claim of claims) {
    if (!derived.some(item => item.action === claim.action && item.object === claim.object && (claim.action === "pickup" || item.target === claim.target) && overlaps(item, claim))) {
      throw new Error("audio claim is not grounded in its transcript segments");
    }
  }
  for (const item of derived) {
    if (!claims.some(claim => item.action === claim.action && item.object === claim.object && (item.action === "pickup" || item.target === claim.target) && overlaps(item, claim))) {
      throw new Error("audio claims omit an action from the transcript segments");
    }
  }
  return { transcript, segments, claims };
}

/** Only this decomposed two-action grammar is implemented. Extra semantics fail closed. */
function criterionOperation(criterion: RubricCriterion, spec: TaskSpec): Action | "narration" | undefined {
  if (spec.steps.length !== 2 || spec.narration?.some(item => normalizedWords(item) !== "narrate each action")) return undefined;
  const object = spec.object.replaceAll("_", " "), target = spec.target.replaceAll("_", " ");
  const pickup = normalizedWords(spec.steps[0]!), placement = normalizedWords(spec.steps[1]!);
  const pickupForms = [`pick up the ${object}`, `pick up ${object}`,
    ...spec.distractors.map(label => `pick up the ${object} not the ${label.replaceAll("_", " ")}`)];
  const placements = ["on", "onto", "in", "into"].flatMap(relation =>
    [`place the ${object} ${relation} the ${target}`, `place the ${object} ${relation} the marked ${target}`]);
  const relativePrefix = `place the ${object} closer to the ${target} that is next to the `;
  const relativeLandmark = placement.startsWith(relativePrefix) ? placement.slice(relativePrefix.length) : "";
  // Extra verbs/requirements cannot silently become supported by matching a prefix.
  const relative = /^[a-z0-9]+$/.test(relativeLandmark) && !/\b(and|then|before|after|while)\b/.test(relativeLandmark);
  if (!pickupForms.includes(pickup) || (!placements.includes(placement) && !relative)) return undefined;
  if (criterion.modality === "visual" && normalizedWords(criterion.description) === normalizedWords(spec.steps[0]!)) return "pickup";
  if (criterion.modality === "temporal" && normalizedWords(criterion.description) === normalizedWords(spec.steps[1]!)) return "place";
  if (criterion.modality === "cross_modal" && normalizedWords(criterion.description) === "narration agrees with visible actions and object") return "narration";
  return undefined;
}
function evidence(modality: "video" | "audio", observation: ActionObservation): Evidence {
  return { modality, startMs: observation.startMs, endMs: observation.endMs, claim: observation.description };
}
function finding(criterionId: string, status: FindingStatus, reason: string, evidenceItems: Evidence[] = []): CriterionFinding {
  return { criterionId, status, reason, evidence: evidenceItems };
}
function comparePickup(video: VideoObservation | undefined, criterionId: string, spec: TaskSpec): CriterionFinding {
  if (!video || video.visibility !== "clear") return finding(criterionId, "unobservable", "The pickup is not clearly observable.");
  const pickups = video.observations.filter(item => item.action === "pickup");
  const wrong = pickups.find(item => item.object !== spec.object && item.object !== "unknown");
  if (wrong) return finding(criterionId, "contradicted", `The visible pickup uses ${wrong.object}, contrary to the required ${spec.object}.`, [evidence("video", wrong)]);
  if (pickups.some(item => item.object === "unknown")) return finding(criterionId, "unobservable", "A pickup has an unresolved object identity.");
  const correct = pickups.find(item => item.object === spec.object);
  return correct
    ? finding(criterionId, "supported", `The ${spec.object} is visibly picked up.`, [evidence("video", correct)])
    : finding(criterionId, "unobservable", `No supported ${spec.object} pickup interval was observed.`);
}
function comparePlacement(video: VideoObservation | undefined, criterionId: string, spec: TaskSpec): CriterionFinding {
  if (!video || video.visibility !== "clear") return finding(criterionId, "unobservable", "The placement sequence is not clearly observable.");
  const placements = video.observations.filter(item => item.action === "place");
  const wrong = placements.find(item => item.object !== spec.object && item.object !== "unknown" || (item.object === spec.object && item.target === "other"));
  if (wrong) return finding(criterionId, "contradicted", "The observed placement uses the wrong object or target.", [evidence("video", wrong)]);
  if (placements.some(item => item.object === "unknown" || item.target === "unknown")) return finding(criterionId, "unobservable", "The placed object or target is unresolved.");
  const placement = placements.find(item => item.object === spec.object && item.target === spec.target);
  const pickup = video.observations.find(item => item.action === "pickup" && item.object === spec.object);
  if (!placement || !pickup) return finding(criterionId, "unobservable", "Both the required pickup and destination placement must be observed.");
  const items = [evidence("video", pickup), evidence("video", placement)];
  if (placement.endMs <= pickup.startMs) return finding(criterionId, "contradicted", "The observed placement precedes the required pickup.", items);
  if (placement.startMs < pickup.endMs) return finding(criterionId, "unobservable", "The action intervals overlap, so their order is uncertain.", items);
  return finding(criterionId, "supported", `The observed sequence satisfies: ${spec.steps.join("; ")}.`, items);
}
function compareNarration(video: VideoObservation | undefined, audio: AudioObservation | undefined, criterionId: string): CriterionFinding {
  if (!video || video.visibility !== "clear" || !audio || audio.claims.length === 0) return finding(criterionId, "unobservable", "Clear visual actions and timestamped narration are both required.");
  if (audio.claims.some(item => item.object === "unknown" || (item.action === "place" && item.target === "unknown"))) return finding(criterionId, "unobservable", "Narrated object or target references are ambiguous.");
  const matched = new Set<Action>();
  const items: Evidence[] = [];
  for (const claim of audio.claims) {
    const candidates = video.observations.filter(item => item.action === claim.action && overlaps(item, claim));
    if (candidates.length === 0) return finding(criterionId, "unobservable", "A narrated action has no visual evidence near its timestamp.", [evidence("audio", claim)]);
    if (candidates.some(item => item.object === "unknown" || (item.action === "place" && item.target === "unknown"))) return finding(criterionId, "unobservable", "Visual evidence near the narration has unresolved identity or target.");
    const matching = candidates.filter(item => item.object === claim.object && (claim.action === "pickup" || item.target === claim.target));
    if (matching.length === 0) return finding(criterionId, "contradicted", "Narration and visible action disagree on the object or placement target.", [evidence("audio", claim), ...candidates.map(item => evidence("video", item))]);
    if (matching.length !== candidates.length) return finding(criterionId, "unobservable", "Several conflicting visual candidates occur near the narrated reference.");
    matched.add(claim.action);
    items.push(evidence("audio", claim), evidence("video", matching[0]!));
  }
  if (!matched.has("pickup") || !matched.has("place")) return finding(criterionId, "unobservable", "Narration must ground both pickup and placement.", items);
  return finding(criterionId, "supported", "Narration agrees with observed objects, actions, targets, and nearby timestamps.", items);
}

function buildScopedReport(input: BuildVerificationReportInput, contentOnly = false): VerificationReport {
  text(input.submissionId, "submissionId", 512);
  text(input.taskVersionId, "taskVersionId", 512);
  if (!/^[0-9a-f]{64}$/.test(input.sourceHash)) throw new Error("sourceHash must be a lowercase SHA-256");
  integer(input.durationMs, "durationMs");
  if (input.criteria.length === 0 || input.criteria.length > 64) throw new Error("rubric requires a bounded, nonempty criteria list");
  const criterionIds = new Set<string>();
  for (const criterion of input.criteria) {
    text(criterion.criterionId, "criterionId", 256);
    text(criterion.description, "criterion description");
    choice(criterion.modality, ["visual", "audio", "cross_modal", "temporal"], "criterion modality");
    if (criterionIds.has(criterion.criterionId)) throw new Error("rubric criterion IDs must be unique");
    criterionIds.add(criterion.criterionId);
  }
  const spec = input.taskSpec ? normalizeTaskSpec(input.taskSpec) : resolveTaskSpec({ criteria: input.criteria });
  // Revalidate typed inputs at this boundary: TypeScript types do not protect runtime callers.
  const video = input.failure === undefined && input.video && spec ? parseVideoResponse(JSON.stringify(input.video), input.durationMs, spec) : undefined;
  const audio = input.failure === undefined && input.audio && spec ? parseAudioResponse(JSON.stringify(input.audio), input.durationMs, spec) : undefined;
  const warnings = array(input.warnings ?? [], 32, "warnings").map((item, index) => text(item, `warnings[${index}]`));
  const runs = array(input.modelRuns, 16, "modelRuns").map((item, index): ModelRun => {
    const object = record(item, ["provider", "model", "promptVersion", "elapsedMs", "inputTokens", "outputTokens"], `modelRuns[${index}]`);
    const run: ModelRun = { provider: text(object.provider, "provider"), model: text(object.model, "model"), promptVersion: text(object.promptVersion, "promptVersion") };
    for (const key of ["elapsedMs", "inputTokens", "outputTokens"] as const) if (object[key] !== undefined) run[key] = integer(object[key], key);
    return run;
  });
  const duplicate = record(input.duplicate, ["status", "matches"], "duplicate");
  const duplicateStatus = choice(duplicate.status, ["not_checked", "clear", "suspected"], "duplicate.status");
  const matches = array(duplicate.matches, 32, "duplicate.matches").map((item, index) => {
    const object = record(item, ["submissionId", "score", "overlapMs"], `duplicate.matches[${index}]`);
    const submissionId = text(object.submissionId, "duplicate submissionId", 512);
    if (submissionId.toLowerCase() === input.submissionId.toLowerCase()) throw new Error("duplicate candidate references the source submission");
    if (typeof object.score !== "number" || !Number.isFinite(object.score) || object.score < 0 || object.score > 1) throw new Error("duplicate score must be between zero and one");
    return { submissionId, score: object.score, overlapMs: integer(object.overlapMs, "duplicate overlapMs", input.durationMs) };
  });
  if ((duplicateStatus === "suspected") !== (matches.length > 0)) throw new Error("duplicate status and matches disagree");
  const mediaText = [audio?.transcript ?? "", ...(video?.observations.map(item => item.description) ?? []), ...(audio?.claims.map(item => item.description) ?? [])].join("\n");
  const unsafeText = instructionLike(mediaText);
  if (unsafeText) warnings.push("Instruction-like media content requires human review; it has no authority.");
  if (!video) warnings.push("Visual analysis is unavailable.");
  if (!audio) warnings.push("Audio analysis is unavailable.");
  if (runs.length === 0) warnings.push("No completed model-run metadata is available.");
  if (input.durationMs === 0) warnings.push("Source duration is unavailable.");
  if (duplicateStatus !== "clear") warnings.push("Duplicate checking is incomplete or requires review.");
  if (input.failure !== undefined) {
    text(input.failure, "failure");
    warnings.push("Analysis did not complete; inspect the job error code before review.");
  }
  const criteria = input.criteria.map((criterion): CriterionFinding => {
    if (input.failure !== undefined || unsafeText) return finding(criterion.criterionId, "unobservable", "Analysis is failed or untrusted; this criterion requires human review.");
    const operation = spec && criterionOperation(criterion, spec);
    if (!operation || !spec) {
      warnings.push(`Unsupported rubric semantics require review: ${criterion.criterionId}`);
      return finding(criterion.criterionId, "unobservable", "This comparator requires a frozen, supported task spec matching this criterion.");
    }
    if (operation === "pickup") return comparePickup(video, criterion.criterionId, spec);
    if (operation === "place") return comparePlacement(video, criterion.criterionId, spec);
    return compareNarration(video, audio, criterion.criterionId);
  });
  const liveness = contentOnly ? null : checkSpokenLiveness(input.liveness, audio, input.durationMs);
  if (liveness?.status === "passed") {
    // An extra evidence line preserves the frozen rubric and legacy report schema.
    const narration = criteria.find(item => input.criteria.some(criterion => criterion.criterionId === item.criterionId && criterion.modality === "cross_modal"));
    if (narration) narration.evidence.push(liveness.evidence);
    else warnings.push("Spoken liveness matched, but the rubric has no narration evidence lane; human review required.");
  } else if (liveness) warnings.push(liveness.warning);
  const hasUnobservable = criteria.some(item => item.status === "unobservable");
  const hasContradiction = criteria.some(item => item.status === "contradicted");
  const needsReview = warnings.length > 0 || hasUnobservable || !video || !audio || input.failure !== undefined;
  const recommendation = needsReview ? "needs_review" : hasContradiction ? "request_correction" : "accept";
  const reportId = input.reportId ?? `${input.submissionId}:${input.taskVersionId}:${input.sourceHash.slice(0, 12)}:task-v2`;
  text(reportId, "reportId", 2_000);
  return {
    schemaVersion: "1.0", reportId, submissionId: input.submissionId, taskVersionId: input.taskVersionId,
    source: { sha256: input.sourceHash, durationMs: input.durationMs },
    pipeline: { version: PIPELINE_VERSION, status: input.failure !== undefined ? "failed" : needsReview ? "needs_review" : "completed", implementation: "inference", modelRuns: runs },
    ...(spec ? { observations: { ...(video ? { video } : {}), ...(audio ? { audio } : {}) } } : {}),
    criteria, duplicate: { status: duplicateStatus, matches }, recommendation,
    warnings: [...new Set(warnings)],
  };
}

/** Ordinary callers always measure the actual capture/liveness gate. */
export function buildVerificationReport(input: BuildVerificationReportInput): VerificationReport {
  return buildScopedReport(input);
}

export const EVALUATION_PROJECTION_VERSION = "prelicensing-advisory-v1";
export const CONTENT_EVALUATION_PROJECTION_VERSION = "content-only-no-liveness-v1";
export const VERIFICATION_ONLY_WARNING = "Verification-only development upload; no training license, dataset sale, or payable may be created.";

/** Evaluation scope is immutable submission metadata, never a model instruction. */
export function validateEvaluationScope(verificationOnly: boolean | undefined, evalRunId: string | undefined): void {
  if (evalRunId === undefined) return;
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(evalRunId)) throw new Error("invalid_eval_run_id");
  if (verificationOnly !== true) throw new Error("evaluation_requires_verification_only");
}

/** Apply the licensing guard after quality comparison; all other evidence is preserved. */
export function applyVerificationOnlyGuard(report: VerificationReport): VerificationReport {
  return { ...report, pipeline: { ...report.pipeline, status: report.pipeline.status === "failed" ? "failed" : "needs_review" },
    recommendation: "needs_review", warnings: [...new Set([...report.warnings, VERIFICATION_ONLY_WARNING])] };
}

/** Narrow, auditable difference for prerecorded content evaluation: add only
 * the genuine untested-liveness warning and verification-only licensing guard.
 * No other warning, criterion, evidence, model run or source binding changes.
 */
export function applyContentEvaluationGuard(report: VerificationReport): VerificationReport {
  return applyVerificationOnlyGuard({ ...report, warnings: [...new Set([...report.warnings, MISSING_LIVENESS_WARNING])] });
}

export function buildVerificationReports(input: BuildVerificationReportInput, scope: {
  verificationOnly?: boolean; evalRunId?: string; evalContentOnly?: true;
}): { report: VerificationReport; qualityReport?: VerificationReport } {
  validateEvaluationScope(scope.verificationOnly, scope.evalRunId);
  if (scope.evalContentOnly && (!scope.verificationOnly || scope.evalRunId === undefined || input.liveness !== undefined)) {
    throw new Error("content_evaluation_requires_unissued_scoped_verification");
  }
  // The quality report intentionally measures only visible/narrated content in
  // this explicit scope. Independently build the full operational report so its
  // actual liveness failure remains visible and cannot become acceptance.
  const qualityReport = buildScopedReport(input, scope.evalContentOnly === true);
  const operationalReport = scope.evalContentOnly ? buildVerificationReport(input) : qualityReport;
  return { report: scope.verificationOnly ? applyVerificationOnlyGuard(operationalReport) : operationalReport,
    ...(scope.verificationOnly && scope.evalRunId !== undefined ? { qualityReport } : {}) };
}
