import { expect, it } from "vitest";
import { armRetargetConfig, handToTarget, retargetHands, SO101_JOINT_NAMES, SO101_SPEC, so101ForwardKinematics, so101InverseKinematics, type Vec3 } from "./armRetarget";
import type { AnnotationFile } from "./derivedAnnotations";

// Synthetic MediaPipe-shaped hands; no model inference, robot or hardware is exercised.
const config = armRetargetConfig();
type Point = [number, number, number];
/** A flat right hand: fingers point image-up, palm faces the camera, thumb/index tips `aperture` hand-lengths apart. */
function hand(u: number, v: number, size: number, aperture: number): Point[] {
  const at = (dx: number, dy: number): Point => [u + dx * size, v + dy * size, 0.5];
  const points: Point[] = Array.from({ length: 21 }, () => at(0, -0.5));
  points[0] = at(0, 0); points[5] = at(-0.35, -0.9); points[9] = at(0, -1); points[13] = at(0.18, -0.95); points[17] = at(0.35, -0.85);
  points[4] = at(-0.6 - aperture / 2, -1.3); points[8] = at(-0.6 + aperture / 2, -1.3);
  return points;
}
const file = (frames: AnnotationFile["frames"]): AnnotationFile => ({ schema: "skarl.annotations.v1", submissionId: "s1", sourceSha256: "a".repeat(64), kind: "hands",
  model: { name: "Synthetic hand pose", version: "fixture-v1", runtime: "browser-wasm" }, sampleFps: 5, videoWidth: 1000, videoHeight: 1000, advisory: true, frames });
const right = (keypoints: Point[], score = 0.9) => ({ handedness: "Right" as const, score, keypoints });
const column = (m: number[][], i: number): Vec3 => [m[0]![i]!, m[1]![i]!, m[2]![i]!];

it("forward kinematics reproduces the cited SO-101 URDF chain, so exported joint values mean what the URDF means", () => {
  // Zero pose from so101_new_calib.urdf: arm outstretched along +x, tool roughly 0.39 m out and 0.23 m up.
  const { tool, joints } = so101ForwardKinematics([0, 0, 0, 0, 0]);
  expect(tool.position[0]).toBeCloseTo(0.3914, 3); expect(tool.position[1]).toBeCloseTo(0, 3); expect(tool.position[2]).toBeCloseTo(0.2265, 3);
  expect(column(tool.rotation, 2)[0]).toBeCloseTo(1, 3); // approach axis points forward at zero
  expect(joints[1]!.position[2]).toBeCloseTo(0.1166, 4); // shoulder_lift height
  expect(SO101_JOINT_NAMES).toEqual(["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"]);
  expect(SO101_SPEC.source).toMatch(/SO-ARM100\/blob\/[0-9a-f]{40}\/Simulation\/SO101\/so101_new_calib\.urdf$/);
});

it("IK recovers the position of poses the arm can actually reach, within joint limits", () => {
  for (const q of [[0.3, -0.4, 0.6, 0.5, 0.2], [-0.8, 0.2, -0.3, 1.0, -1.0], [1.2, -1.0, 1.2, 0.2, 2.0]]) {
    const { tool } = so101ForwardKinematics(q);
    const result = so101InverseKinematics({ position: tool.position, approach: column(tool.rotation, 2), hinge: column(tool.rotation, 1), gripper: 0 },
      [[0, 0, 0, 0, 0], [0, -0.5, 0.5, 0.8, 0]], config);
    expect(result.positionResidualM).toBeLessThan(0.002);
    // The hinge is sign-agnostic, so a roll flipped by ~pi is an accepted branch; the wrist-roll axis is
    // tilted 0.0487 rad from the approach in the URDF, leaving a small approach residual on that branch.
    expect(result.approachResidualRad).toBeLessThan(0.1);
    expect(result.reachable).toBe(true);
    result.joints.forEach((value, index) => { expect(value).toBeGreaterThanOrEqual(SO101_SPEC.joints[index]!.lower); expect(value).toBeLessThanOrEqual(SO101_SPEC.joints[index]!.upper); });
  }
});

it("an out-of-reach target is reported as unreachable with its residual, never silently snapped", () => {
  const result = so101InverseKinematics({ position: [1.5, 0, 0.2], approach: [1, 0, 0], hinge: [0, 0, 1], gripper: 0 }, [[0, 0, 0, 0, 0]], config);
  expect(result.reachable).toBe(false);
  expect(result.positionResidualM).toBeGreaterThan(1);
});

it("maps image motion, apparent hand size and pinch aperture into the declared workspace and gripper range", () => {
  const center = handToTarget(hand(0.5, 0.6, 0.2, 0.2), 1, config)!;
  const right = handToTarget(hand(0.7, 0.6, 0.2, 0.2), 1, config)!;
  const higherInImage = handToTarget(hand(0.5, 0.4, 0.2, 0.2), 1, config)!;
  const nearerCamera = handToTarget(hand(0.5, 0.6, 0.28, 0.2), 1, config)!;
  const open = handToTarget(hand(0.5, 0.6, 0.2, 1.2), 1, config)!;
  expect(right.position[1]).toBeLessThan(center.position[1]); // image right -> robot -y
  expect(higherInImage.position[0]).toBeGreaterThan(center.position[0]); // image up -> farther from base
  expect(nearerCamera.position[2]).toBeGreaterThan(center.position[2]); // bigger hand -> higher
  expect(open.gripper).toBeGreaterThan(center.gripper);
  expect(open.gripper).toBeCloseTo(config.gripperOpen, 6);
  // Fingers image-up -> forward approach, pitched down by the declared neutral-grasp angle.
  expect(center.approach[0]).toBeCloseTo(Math.cos(config.approachPitch), 6); expect(center.approach[2]).toBeCloseTo(-Math.sin(config.approachPitch), 6);
  for (const target of [center, right, higherInImage, nearerCamera, open]) {
    expect(target.position[0]).toBeGreaterThanOrEqual(config.workspace.xMin); expect(target.position[0]).toBeLessThanOrEqual(config.workspace.xMax);
    expect(Math.abs(target.position[1])).toBeLessThanOrEqual(config.workspace.yHalf);
  }
});

it("frames without a confident hand stay null rather than zero joints, and smoothing restarts after the gap", () => {
  const trajectory = retargetHands(file([
    { tMs: 0, hands: [right(hand(0.4, 0.6, 0.2, 0.2))] },
    { tMs: 200, hands: [] },
    { tMs: 400, hands: [right(hand(0.6, 0.6, 0.2, 0.2), 0.1)] },
    { tMs: 600, hands: [right(hand(0.6, 0.6, 0.2, 0.2))] },
  ]));
  expect(trajectory.frames.map(frame => frame.joints === null)).toEqual([false, true, true, false]);
  expect(trajectory.frames[1]).toMatchObject({ target: null, joints: null, ik: null });
  // After a gap the target is the raw new observation, not a blend with the old one.
  expect(trajectory.frames[3]!.target!.position).toEqual(handToTarget(hand(0.6, 0.6, 0.2, 0.2), 1, config)!.position);
  expect(trajectory.frames[0]!.joints).toHaveLength(6);
  expect(trajectory.summary).toMatchObject({ frames: 4, handFrames: 2 });
});

it("smooths consecutive frames, is deterministic, and labels the result as advisory and hardware-unvalidated", () => {
  const input = file([{ tMs: 0, hands: [right(hand(0.4, 0.6, 0.2, 0.2))] }, { tMs: 200, hands: [right(hand(0.6, 0.6, 0.2, 0.2))] }]);
  const trajectory = retargetHands(input);
  const raw = handToTarget(hand(0.6, 0.6, 0.2, 0.2), 1, config)!.position[1], first = trajectory.frames[0]!.target!.position[1];
  expect(trajectory.frames[1]!.target!.position[1]).toBeCloseTo(first + (raw - first) * config.smoothing, 9);
  expect(retargetHands(input)).toEqual(trajectory);
  expect(trajectory).toMatchObject({ robotType: "so101", units: "rad", source: "retargeted_from_human_hand", validated_on_hardware: false, advisory: true,
    cameraConvention: "overhead_tabletop", jointNames: SO101_JOINT_NAMES });
  for (const frame of trajectory.frames) expect(frame.ik!.reachable).toBe(true);
});
