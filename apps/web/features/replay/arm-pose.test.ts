import { expect, it } from "vitest";
import type { ArmFrame, ArmTrajectory, JointTargets } from "../../../../convex/lib/armRetarget";
import { armPoseAt } from "./arm-pose";

// Synthetic trajectory frames; the viewer must never show a pose the export does not contain.
const frame = (tMs: number, joints: JointTargets | null): ArmFrame => ({ tMs, handedness: joints ? "Right" : null, handIndex: joints ? 0 : null, target: null, joints,
  ik: joints ? { positionResidualM: 0, approachResidualRad: 0, hingeResidualRad: 0, reachable: true, jointLimited: false, iterations: 1 } : null });
const trajectory = (frames: ArmFrame[]) => ({ sampleFps: 5, frames } as Pick<ArmTrajectory, "sampleFps" | "frames"> as ArmTrajectory);
const a: JointTargets = [0, 0, 0, 0, 0, 0], b: JointTargets = [1, 1, 1, 1, 1, 1];

it("blends between neighbouring saved poses so playback follows the video clock", () => {
  expect(armPoseAt(trajectory([frame(0, a), frame(200, b)]), 50).joints).toEqual([0.25, 0.25, 0.25, 0.25, 0.25, 0.25]);
  expect(armPoseAt(trajectory([frame(0, a), frame(200, b)]), 200).joints).toEqual(b);
});

it("shows no pose across a missing hand or outside the run, instead of inventing one", () => {
  const withGap = trajectory([frame(0, a), frame(200, null), frame(400, b)]);
  expect(armPoseAt(withGap, 220)).toMatchObject({ joints: null, frame: { tMs: 200 } });
  expect(armPoseAt(withGap, 2000)).toEqual({ frame: null, joints: null });
  expect(armPoseAt(trajectory([]), 0)).toEqual({ frame: null, joints: null });
});
