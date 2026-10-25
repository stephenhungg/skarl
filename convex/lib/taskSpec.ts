import { detectorClasses } from "./config.ts";
import { v } from "convex/values";
import { digest } from "./canonical.ts";

export const TASK_SPEC_EXTRACTION_VERSION = "rubric-task-spec-v1";

/** Trusted, frozen task vocabulary. Media can supply evidence, never edit these labels. */
export interface TaskSpec {
  object: string;
  distractors: string[];
  target: string;
  steps: string[];
  narration?: string[];
}
export const taskSpecValidator = v.object({ object: v.string(), distractors: v.array(v.string()),
  target: v.string(), steps: v.array(v.string()), narration: v.optional(v.array(v.string())) });

export function normalizeTaskSpec(input: TaskSpec): TaskSpec {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
    Object.keys(input).some(key => !["object", "distractors", "target", "steps", "narration"].includes(key))) throw new Error("invalid_task_spec");
  const label = (value: unknown): string => {
    if (typeof value !== "string" || !/^[a-z][a-z0-9_]{0,79}$/.test(value) || ["other", "unknown"].includes(value)) throw new Error("invalid_task_spec_label");
    return value;
  };
  const phrases = (value: unknown, required: boolean): string[] => {
    if (!Array.isArray(value) || value.length > 16 || (required && value.length === 0) ||
      value.some(item => typeof item !== "string" || !item.trim() || item.length > 2000)) throw new Error("invalid_task_spec_steps");
    return value.map(item => item.trim());
  };
  const object = label(input.object), target = label(input.target);
  if (!Array.isArray(input.distractors) || input.distractors.length > 16) throw new Error("invalid_task_spec_distractors");
  const distractors = input.distractors.map(label).sort();
  if (new Set([object, ...distractors]).size !== distractors.length + 1 || distractors.includes(target)) throw new Error("invalid_task_spec_distractors");
  return { object, distractors, target, steps: phrases(input.steps, true),
    ...(input.narration === undefined ? {} : { narration: phrases(input.narration, false) }) };
}

interface RubricShape { taskSpec?: TaskSpec; taskPrompt?: string; taskSpecStatus?: string;
  contentHash?: string; taskSpecHash?: string; taskSpecExtraction?: { version: string; rubricHash: string };
  criteria?: { criterionId: string; description: string; modality: string }[] }
/** Missing or pending extraction always abstains, including historical demo rubrics. */
export function resolveTaskSpec(rubric: RubricShape): TaskSpec | undefined {
  if (rubric.taskSpecStatus !== "ready" || rubric.taskSpec === undefined || !rubric.contentHash ||
    rubric.taskSpecExtraction?.version !== TASK_SPEC_EXTRACTION_VERSION ||
    rubric.taskSpecExtraction.rubricHash !== rubric.contentHash) return undefined;
  try {
    const taskSpec = normalizeTaskSpec(rubric.taskSpec);
    return rubric.taskSpecHash === digest({ version: TASK_SPEC_EXTRACTION_VERSION, contentHash: rubric.contentHash, taskSpec })
      ? taskSpec : undefined;
  } catch { return undefined; }
}

/** COCO names only; never approximate cans as bottles or cups. Color remains a VLM check. */
export function detectorClassForObject(object: string): string | null {
  const faithful = new Set(detectorClasses());
  const match = [...faithful].sort((a, b) => b.length - a.length)
    .find(label => object === label || object.endsWith(`_${label}`));
  return match ? match.replaceAll("_", " ") : null;
}
