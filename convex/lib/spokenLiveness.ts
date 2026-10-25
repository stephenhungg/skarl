/** Server-issued words are evidence to compare, never instructions for a model. */
export interface SpokenLivenessChallenge {
  words: string[];
  issuedAt: number;
  consumedAt: number;
}
interface Segment { startMs: number; endMs: number; text: string }
interface AudioTranscript { transcript: string; segments: Segment[] }
export type SpokenLivenessResult =
  | { status: "passed"; evidence: { modality: "audio"; startMs: number; endMs: number; claim: string } }
  | { status: "missing_challenge" | "invalid_challenge" | "missing_transcript" | "untrusted_narration" | "words_not_found"; warning: string };

export function instructionLike(value: string): boolean {
  return /\bignore\b[\s\S]{0,80}\b(?:instructions?|rules?|rubric|previous|system)\b/i.test(value)
    || /\b(?:mark|set|return|output|declare)\b[\s\S]{0,80}\b(?:accepted|approved|supported|passed)\b/i.test(value)
    || /\b(?:approve|release|send|transfer)\b[\s\S]{0,80}\b(?:payments?|payouts?|funds?|usdc|money)\b/i.test(value)
    || /\b(?:system|developer)\s*:/i.test(value);
}
function tokens(value: string): string[] {
  return value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

export const MISSING_LIVENESS_WARNING = "Spoken liveness: no per-take challenge was supplied; human review required.";

/** Match whole words in chronological transcript order; no model-provided pass flag is read.
 * Timestamps remain the containing ASR segment bounds, not invented word timings.
 */
export function checkSpokenLiveness(
  challenge: SpokenLivenessChallenge | undefined,
  audio: AudioTranscript | undefined,
  durationMs: number,
): SpokenLivenessResult {
  if (!challenge) return { status: "missing_challenge", warning: MISSING_LIVENESS_WARNING };
  if (!Array.isArray(challenge.words) || challenge.words.length !== 3 ||
    challenge.words.some(word => typeof word !== "string" || !/^[a-z]+$/.test(word)) ||
    !Number.isSafeInteger(challenge.issuedAt) || challenge.issuedAt < 0 ||
    !Number.isSafeInteger(challenge.consumedAt) || challenge.consumedAt < challenge.issuedAt ||
    challenge.consumedAt >= challenge.issuedAt + 120_000) {
    return { status: "invalid_challenge", warning: "Spoken liveness: stored challenge timing or words are invalid; human review required." };
  }
  // Recheck the timestamp/text boundary because persistence also calls this helper.
  if (!audio || typeof audio.transcript !== "string" || !Array.isArray(audio.segments) ||
    !Number.isSafeInteger(durationMs) || durationMs <= 0 || audio.segments.length === 0 || audio.segments.length > 256 ||
    audio.segments.some((segment, index) => !segment || typeof segment.text !== "string" ||
      !Number.isSafeInteger(segment.startMs) || !Number.isSafeInteger(segment.endMs) ||
      segment.startMs < 0 || segment.endMs <= segment.startMs || segment.endMs > durationMs ||
      (index > 0 && segment.startMs < audio.segments[index - 1]!.startMs)) ||
    tokens(audio.transcript).join(" ") !== tokens(audio.segments.map(segment => segment.text).join(" ")).join(" ")) {
    return { status: "missing_transcript", warning: "Spoken liveness: a valid timestamped transcript is unavailable; human review required." };
  }
  if (instructionLike(audio.transcript)) return { status: "untrusted_narration", warning: "Spoken liveness: instruction-like narration cannot establish a pass; human review required." };
  let matched = 0, startMs = 0, endMs = 0;
  for (const segment of audio.segments) {
    for (const word of tokens(segment.text)) {
      if (word !== challenge.words[matched]) continue;
      if (matched === 0) startMs = segment.startMs;
      endMs = Math.max(endMs, segment.endMs);
      matched += 1;
      if (matched === challenge.words.length) return { status: "passed", evidence: {
        modality: "audio", startMs, endMs,
        claim: `Spoken liveness matched the issued words in order: ${challenge.words.join(" ")}. Timing uses the containing transcript segments.`,
      } };
    }
  }
  return { status: "words_not_found", warning: "Spoken liveness: the issued words were not found in transcript order; human review required." };
}
