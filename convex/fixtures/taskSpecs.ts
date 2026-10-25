import { digest } from "../lib/finance";
import { normalizeTaskSpec, TASK_SPEC_EXTRACTION_VERSION } from "../lib/taskSpec";
import type { TaskSpec } from "../lib/taskSpec";
export const RED_CUP_TASK_SPEC: TaskSpec = { object: "red_cup", distractors: ["blue_cup"], target: "coaster",
  steps: ["Pick up the red cup, not the blue cup", "Place the red cup on the marked coaster"], narration: ["Narrate each action"] };
export const CAN_TO_HAT_TASK_SPEC: TaskSpec = { object: "can", distractors: [], target: "hat",
  steps: ["Pick up the can", "Place the can closer to the hat that is next to the lamp"], narration: ["Narrate each action"] };

/** Synthetic extraction metadata for tests that replace a frozen task vocabulary. */
export function fixtureTaskSpecFields(taskSpec: TaskSpec, contentHash: string) {
  const version = TASK_SPEC_EXTRACTION_VERSION;
  const normalized = normalizeTaskSpec(taskSpec);
  return { taskSpec: normalized, taskSpecStatus: "ready" as const,
    taskSpecHash: digest({ version, contentHash, taskSpec: normalized }),
    taskSpecExtraction: { version, rubricHash: contentHash, provider: "synthetic",
      model: "synthetic-fixture-extractor", extractedAt: Date.now() } };
}
