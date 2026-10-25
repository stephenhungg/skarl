import { v } from "convex/values";

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
export const RED_CUP_TASK_SPEC: TaskSpec = { object: "red_cup", distractors: ["blue_cup"], target: "coaster",
  steps: ["Pick up the red cup, not the blue cup", "Place the red cup on the marked coaster"], narration: ["Narrate each action"] };
export const CAN_TO_HAT_TASK_SPEC: TaskSpec = { object: "can", distractors: [], target: "hat",
  steps: ["Pick up the can", "Place the can closer to the hat that is next to the lamp"], narration: ["Narrate each action"] };

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

interface RubricShape { taskSpec?: TaskSpec; taskPrompt?: string;
  criteria?: { criterionId: string; description: string; modality: string }[] }
const LEGACY_CRITERIA = [
  { criterionId: "red-cup-pickup", description: "Pick up the red cup, not the blue cup", modality: "visual" },
  { criterionId: "coaster-placement", description: "Place the red cup on the marked coaster", modality: "temporal" },
  { criterionId: "narration-alignment", description: "Narration agrees with visible actions and object", modality: "cross_modal" },
];
/** Only the exact legacy rubric has an implicit default; arbitrary new orders abstain. */
export function resolveTaskSpec(rubric: RubricShape): TaskSpec | undefined {
  if (rubric.taskSpec !== undefined) return normalizeTaskSpec(rubric.taskSpec);
  if (rubric.criteria?.length === LEGACY_CRITERIA.length && LEGACY_CRITERIA.every(expected =>
    rubric.criteria!.some(actual => actual.criterionId === expected.criterionId && actual.description === expected.description && actual.modality === expected.modality))) {
    return normalizeTaskSpec(RED_CUP_TASK_SPEC);
  }
  return undefined;
}

/** COCO names only; never approximate cans as bottles or cups. Color remains a VLM check. */
export function detectorClassForObject(object: string): string | null {
  if (object === "red_cup" || object === "blue_cup") return "cup";
  const faithful = new Set(["person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat", "traffic_light",
    "fire_hydrant", "stop_sign", "parking_meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear",
    "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports_ball",
    "kite", "baseball_bat", "baseball_glove", "skateboard", "surfboard", "tennis_racket", "bottle", "wine_glass", "cup", "fork",
    "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange", "broccoli", "carrot", "hot_dog", "pizza", "donut", "cake",
    "chair", "couch", "potted_plant", "bed", "dining_table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard", "cell_phone",
    "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors", "teddy_bear", "hair_drier", "toothbrush"]);
  return faithful.has(object) ? object.replaceAll("_", " ") : null;
}
