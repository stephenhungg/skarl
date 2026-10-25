/** Deterministic, advisory retargeting of browser-estimated human hand keypoints onto a
 * LeRobot SO-101 arm kinematic model. Nothing here was validated on hardware: outputs are
 * joint targets for the published URDF, not commands recorded from or replayed on a robot.
 */
import { configNumber } from "./config.ts";
import type { AnnotationFile } from "./derivedAnnotations";

export type Vec3 = [number, number, number];
export type Mat3 = [Vec3, Vec3, Vec3];
export interface Pose { position: Vec3; rotation: Mat3 }
interface UrdfOrigin { xyz: Vec3; rpy: Vec3 }
interface UrdfJoint extends UrdfOrigin { name: string; lower: number; upper: number }

/** SO-101 kinematic chain copied verbatim from TheRobotStudio SO-ARM100
 * `Simulation/SO101/so101_new_calib.urdf` at commit 385e8d7c68e24945df6c60d9bd68837a4b7411ae
 * (joint origins in metres, rpy and limits in radians; every revolute axis is local +z).
 * Base frame: +x forward at zero pose, +y left, +z up. The joint zero is the URDF's, which is
 * not the calibrated zero of a particular follower arm; real use needs per-robot calibration.
 */
export const SO101_SPEC = {
  robotType: "so101",
  source: "https://github.com/TheRobotStudio/SO-ARM100/blob/385e8d7c68e24945df6c60d9bd68837a4b7411ae/Simulation/SO101/so101_new_calib.urdf",
  joints: [
    { name: "shoulder_pan", xyz: [0.0388353, -8.97657e-09, 0.0624], rpy: [3.14159, 4.18253e-17, -3.14159], lower: -1.91986, upper: 1.91986 },
    { name: "shoulder_lift", xyz: [-0.0303992, -0.0182778, -0.0542], rpy: [-1.5708, -1.5708, 0], lower: -1.74533, upper: 1.74533 },
    { name: "elbow_flex", xyz: [-0.11257, -0.028, 1.73763e-16], rpy: [-3.63608e-16, 8.74301e-16, 1.5708], lower: -1.69, upper: 1.69 },
    { name: "wrist_flex", xyz: [-0.1349, 0.0052, 3.62355e-17], rpy: [4.02456e-15, 8.67362e-16, -1.5708], lower: -1.65806, upper: 1.65806 },
    { name: "wrist_roll", xyz: [5.55112e-17, -0.0611, 0.0181], rpy: [1.5708, 0.0486795, 3.14159], lower: -2.74385, upper: 2.84121 },
  ] satisfies UrdfJoint[],
  /** gripper_frame_joint (fixed, child of gripper_link): tool +z is the approach axis, tool +y the jaw hinge axis. */
  tool: { xyz: [-0.0079, -0.000218121, -0.0981274], rpy: [0, 3.14159, 0] } satisfies UrdfOrigin,
  gripper: { name: "gripper", lower: -0.174533, upper: 1.74533 },
} as const;
export const SO101_JOINT_NAMES = [...SO101_SPEC.joints.map(joint => joint.name), SO101_SPEC.gripper.name];
export type JointTargets = [number, number, number, number, number, number];

export interface ArmRetargetConfig {
  workspace: { xMin: number; xMax: number; yHalf: number; zMin: number; zMax: number };
  handScaleNear: number; handScaleFar: number; apertureClosed: number; apertureOpen: number;
  gripperClosed: number; gripperOpen: number; minHandScore: number; smoothing: number; smoothingResetMs: number;
  ikIterations: number; ikDamping: number; orientationWeight: number; reachToleranceM: number; approachPitch: number;
}
/** Mapping constants are deployment config (integer mm/permille/mrad), converted to SI units here. */
export function armRetargetConfig(): ArmRetargetConfig {
  const milli = (key: Parameters<typeof configNumber>[0]) => configNumber(key) / 1000;
  const config = {
    workspace: { xMin: milli("SKARL_ARM_WORKSPACE_X_MIN_MM"), xMax: milli("SKARL_ARM_WORKSPACE_X_MAX_MM"), yHalf: milli("SKARL_ARM_WORKSPACE_Y_HALF_MM"),
      zMin: milli("SKARL_ARM_WORKSPACE_Z_MIN_MM"), zMax: milli("SKARL_ARM_WORKSPACE_Z_MAX_MM") },
    handScaleNear: milli("SKARL_ARM_HAND_SCALE_NEAR_PERMILLE"), handScaleFar: milli("SKARL_ARM_HAND_SCALE_FAR_PERMILLE"),
    apertureClosed: milli("SKARL_ARM_APERTURE_CLOSED_PERMILLE"), apertureOpen: milli("SKARL_ARM_APERTURE_OPEN_PERMILLE"),
    gripperClosed: milli("SKARL_ARM_GRIPPER_CLOSED_MRAD"), gripperOpen: milli("SKARL_ARM_GRIPPER_OPEN_MRAD"),
    minHandScore: milli("SKARL_ARM_MIN_HAND_SCORE_PERMILLE"), smoothing: milli("SKARL_ARM_SMOOTHING_PERMILLE"),
    smoothingResetMs: configNumber("SKARL_ARM_SMOOTHING_RESET_MS"), ikIterations: configNumber("SKARL_ARM_IK_ITERATIONS"),
    ikDamping: milli("SKARL_ARM_IK_DAMPING_PERMILLE"), orientationWeight: milli("SKARL_ARM_ORIENTATION_WEIGHT_PERMILLE"),
    reachToleranceM: milli("SKARL_ARM_REACH_TOLERANCE_MM"), approachPitch: milli("SKARL_ARM_APPROACH_PITCH_MRAD"),
  };
  const { workspace: w } = config;
  if (w.xMin >= w.xMax || w.zMin >= w.zMax || config.handScaleNear <= config.handScaleFar || config.apertureClosed >= config.apertureOpen ||
    config.smoothing <= 0 || config.smoothing > 1 || config.gripperClosed < SO101_SPEC.gripper.lower || config.gripperOpen > SO101_SPEC.gripper.upper ||
    config.gripperClosed >= config.gripperOpen) throw new Error("invalid_config:SKARL_ARM_RETARGET");
  return config;
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3) => Math.sqrt(dot(a, a));
const unit = (a: Vec3): Vec3 | null => { const n = norm(a); return n > 1e-9 ? scale(a, 1 / n) : null; };
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function matMul(a: Mat3, b: Mat3): Mat3 {
  const cell = (i: number, j: number) => a[i]![0] * b[0][j]! + a[i]![1] * b[1][j]! + a[i]![2] * b[2][j]!;
  return [[cell(0, 0), cell(0, 1), cell(0, 2)], [cell(1, 0), cell(1, 1), cell(1, 2)], [cell(2, 0), cell(2, 1), cell(2, 2)]];
}
const matVec = (m: Mat3, v: Vec3): Vec3 => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];
const column = (m: Mat3, index: 0 | 1 | 2): Vec3 => [m[0][index], m[1][index], m[2][index]];
function rotZ(angle: number): Mat3 { const c = Math.cos(angle), s = Math.sin(angle); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; }
/** URDF fixed-axis roll/pitch/yaw: R = Rz(yaw) * Ry(pitch) * Rx(roll). */
function rpyMatrix([roll, pitch, yaw]: readonly number[]): Mat3 {
  const [cr, sr, cp, sp, cy, sy] = [Math.cos(roll!), Math.sin(roll!), Math.cos(pitch!), Math.sin(pitch!), Math.cos(yaw!), Math.sin(yaw!)];
  return [[cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr], [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr], [-sp, cp * sr, cp * cr]];
}
const identity: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/** Forward kinematics in the URDF base frame. Returns each joint frame (after its rotation) and the tool frame. */
export function so101ForwardKinematics(q: readonly number[]): { joints: Pose[]; tool: Pose } {
  let position: Vec3 = [0, 0, 0], rotation = identity;
  const joints = SO101_SPEC.joints.map((joint, index) => {
    position = add(position, matVec(rotation, joint.xyz as Vec3));
    rotation = matMul(matMul(rotation, rpyMatrix(joint.rpy)), rotZ(q[index] ?? 0));
    return { position, rotation };
  });
  const tool = { position: add(position, matVec(rotation, SO101_SPEC.tool.xyz as Vec3)), rotation: matMul(rotation, rpyMatrix(SO101_SPEC.tool.rpy)) };
  return { joints, tool };
}

export interface EndEffectorTarget { position: Vec3; approach: Vec3; hinge: Vec3; gripper: number }
export interface IkResult { joints: number[]; positionResidualM: number; approachResidualRad: number; hingeResidualRad: number;
  reachable: boolean; jointLimited: boolean; iterations: number }

function residual(q: readonly number[], target: EndEffectorTarget, weight: number) {
  const { tool } = so101ForwardKinematics(q);
  const approach = column(tool.rotation, 2), hinge = column(tool.rotation, 1);
  // The hinge term is sign-agnostic: a pinch is symmetric under a 180 degree wrist roll.
  return [...sub(target.position, tool.position), ...scale(sub(target.approach, approach), weight), ...scale(cross(hinge, target.hinge), weight)];
}
const cost = (values: number[]) => values.reduce((sum, value) => sum + value * value, 0);
/** Solve the 5x5 normal equations (J^T J + lambda^2 I) dq = J^T e by Gaussian elimination with partial pivoting. */
function solve(matrix: number[][], vector: number[]): number[] {
  const n = vector.length, a = matrix.map((row, index) => [...row, vector[index]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    for (let row = col + 1; row < n; row++) {
      const factor = a[row]![col]! / a[col]![col]!;
      for (let k = col; k <= n; k++) a[row]![k]! -= factor * a[col]![k]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = a[row]![n]!;
    for (let k = row + 1; k < n; k++) sum -= a[row]![k]! * x[k]!;
    x[row] = sum / a[row]![row]!;
  }
  return x;
}
const limited = (q: number[]) => q.map((value, index) => clamp(value, SO101_SPEC.joints[index]!.lower, SO101_SPEC.joints[index]!.upper));

/** Levenberg-Marquardt (adaptive damped least-squares) IK over the 5 arm joints with a central-difference
 * Jacobian, clamped to URDF limits. A 5-DOF arm cannot match an arbitrary 6-DOF pose: position is weighted
 * over orientation, and orientation residuals are reported rather than hidden. Seeds are tried in order and a
 * reachable solution from the first seed (the previous frame's joints) is kept for temporal continuity.
 */
export function so101InverseKinematics(target: EndEffectorTarget, seeds: number[][], config: ArmRetargetConfig): IkResult {
  const weight = config.orientationWeight, positionCost = (q: number[]) => norm(sub(target.position, so101ForwardKinematics(q).tool.position));
  let best: { q: number[]; cost: number; iterations: number } | null = null;
  for (const seed of seeds) {
    let q = limited(seed), current = cost(residual(q, target, weight)), iterations = 0, damping = config.ikDamping;
    for (; iterations < config.ikIterations && current > 1e-12 && damping < 1e3; iterations++) {
      const e = residual(q, target, weight), step = 1e-6;
      const jacobian = q.map((_, j) => {
        const plus = [...q], minus = [...q]; plus[j]! += step; minus[j]! -= step;
        const ep = residual(plus, target, weight), em = residual(minus, target, weight);
        // residual = target - actual, so d(actual)/dq = -(d residual / dq).
        return ep.map((value, k) => -(value - em[k]!) / (2 * step));
      });
      const gradient = q.map((_, i) => jacobian[i]!.reduce((sum, value, k) => sum + value * e[k]!, 0));
      const normal = q.map((_, i) => q.map((_, j) => jacobian[i]!.reduce((sum, value, k) => sum + value * jacobian[j]![k]!, 0)));
      const next = limited(q.map((value, i) => value + solve(normal.map((row, r) => row.map((cell, c) => cell + (r === c ? damping ** 2 : 0))), gradient)[i]!));
      const nextCost = cost(residual(next, target, weight));
      if (nextCost < current) {
        const converged = current - nextCost < 1e-4 * current;
        q = next; current = nextCost; damping = Math.max(config.ikDamping / 64, damping / 2);
        if (converged) { iterations++; break; }
      }
      else damping *= 4;
    }
    if (!best || current < best.cost - 1e-12) best = { q, cost: current, iterations };
    if (seed === seeds[0] && positionCost(q) <= config.reachToleranceM) break;
  }
  const { tool } = so101ForwardKinematics(best!.q);
  const positionResidualM = norm(sub(target.position, tool.position));
  const approachResidualRad = Math.acos(clamp(dot(column(tool.rotation, 2), target.approach), -1, 1));
  const hingeResidualRad = Math.asin(clamp(norm(cross(column(tool.rotation, 1), target.hinge)), 0, 1));
  const jointLimited = best!.q.some((value, index) => value <= SO101_SPEC.joints[index]!.lower + 1e-6 || value >= SO101_SPEC.joints[index]!.upper - 1e-6);
  return { joints: best!.q, positionResidualM, approachResidualRad, hingeResidualRad,
    reachable: positionResidualM <= config.reachToleranceM, jointLimited, iterations: best!.iterations };
}

type Keypoints = [number, number, number][];
const [WRIST, THUMB_TIP, INDEX_MCP, INDEX_TIP, MIDDLE_MCP, PINKY_MCP] = [0, 4, 5, 8, 9, 17] as const;
/** Image keypoints to isotropic camera units (image-height units, +x right, +y down, +z away).
 * Saved z is MediaPipe wrist-relative depth shifted by +0.5 (same scale as x), so it informs palm
 * orientation only; the wrist's own z carries no absolute depth.
 */
function isotropic(keypoints: Keypoints, aspect: number): Vec3[] {
  return keypoints.map(([x, y, z]) => [x * aspect, y, (z - 0.5) * aspect]);
}
/** Declared camera convention "overhead_tabletop": the camera looks down at the work surface from the
 * demonstrator's side, so image up is away (robot +x), image right is robot -y and camera depth is robot -z.
 * Other mounts violate this assumption; the export names it rather than pretending to calibration.
 */
export const CAMERA_CONVENTION = "overhead_tabletop" as const;
const cameraToRobot = ([x, y, z]: Vec3): Vec3 => [-y, -x, -z];
/** Hand directions are re-expressed relative to a neutral grasp: a flat hand with fingers pointing image-up maps to an
 * approach pitched `approachPitch` below horizontal (rotation about robot +y), so tabletop targets stay reachable.
 */
function pitchDown([x, y, z]: Vec3, pitch: number): Vec3 { const c = Math.cos(pitch), s = Math.sin(pitch); return [c * x + s * z, y, -s * x + c * z]; }

export interface RetargetFrameTarget { position: Vec3; approach: Vec3; hinge: Vec3; gripper: number; handScale: number; aperture: number }
/** One hand frame to a raw (unsmoothed) end-effector target in the declared workspace. */
export function handToTarget(keypoints: Keypoints, aspect: number, config: ArmRetargetConfig): RetargetFrameTarget | null {
  if (keypoints.length !== 21 || !(aspect > 0)) return null;
  const points = isotropic(keypoints, aspect);
  const wrist = points[WRIST]!, indexMcp = points[INDEX_MCP]!, pinkyMcp = points[PINKY_MCP]!, middleMcp = points[MIDDLE_MCP]!;
  const handScale = (norm(sub(middleMcp, wrist)) + norm(sub(pinkyMcp, indexMcp))) / 2;
  const forward = unit(pitchDown(cameraToRobot(sub(middleMcp, wrist)), config.approachPitch));
  const palmNormal = unit(pitchDown(cameraToRobot(cross(sub(indexMcp, wrist), sub(pinkyMcp, wrist))), config.approachPitch));
  if (!(handScale > 1e-6) || !forward || !palmNormal) return null;
  // The hinge must be perpendicular to the approach; project the palm normal into that plane.
  const hinge = unit(sub(palmNormal, scale(forward, dot(palmNormal, forward))));
  if (!hinge) return null;
  const { workspace: w } = config;
  // Apparent hand scale is the only absolute depth cue: a larger hand is nearer the overhead camera, hence higher.
  const height = clamp((handScale - config.handScaleFar) / (config.handScaleNear - config.handScaleFar), 0, 1);
  const [u, v] = [clamp(keypoints[WRIST]![0], 0, 1), clamp(keypoints[WRIST]![1], 0, 1)];
  const position: Vec3 = [lerp(w.xMax, w.xMin, v), lerp(w.yHalf, -w.yHalf, u), lerp(w.zMin, w.zMax, height)];
  const aperture = norm(sub(points[THUMB_TIP]!, points[INDEX_TIP]!)) / norm(sub(middleMcp, wrist));
  const open = clamp((aperture - config.apertureClosed) / (config.apertureOpen - config.apertureClosed), 0, 1);
  return { position, approach: forward, hinge, gripper: lerp(config.gripperClosed, config.gripperOpen, open), handScale, aperture };
}

export interface ArmFrame {
  tMs: number;
  handedness: "Left" | "Right" | null;
  /** Index of the retargeted hand within the annotation frame's `hands`; null when none qualified. */
  handIndex: number | null;
  target: { position: Vec3; approach: Vec3; hinge: Vec3; gripper: number } | null;
  /** Joint targets in SO101_JOINT_NAMES order (radians); null without a usable hand, never zeros. */
  joints: JointTargets | null;
  ik: { positionResidualM: number; approachResidualRad: number; hingeResidualRad: number; reachable: boolean; jointLimited: boolean; iterations: number } | null;
}
export interface ArmTrajectory {
  schema: "skarl.arm-retarget.v1"; robotType: "so101"; kinematicsSource: string; jointNames: string[]; units: "rad";
  source: "retargeted_from_human_hand"; validated_on_hardware: false; advisory: true;
  cameraConvention: typeof CAMERA_CONVENTION; handModel: AnnotationFile["model"]; sampleFps: number; config: ArmRetargetConfig;
  frames: ArmFrame[]; summary: { frames: number; handFrames: number; reachableFrames: number };
}
/** Neutral seeds keep IK deterministic; the previous solution is tried first for temporal continuity. */
const SEEDS = [[0, 0, 0, 0, 0], [0, -0.5, 0.5, 0.8, 0], [0, 0.4, -0.4, 1.2, 0]];
const blend = (previous: Vec3, next: Vec3, alpha: number): Vec3 => add(scale(previous, 1 - alpha), scale(next, alpha));

/** Per saved annotation frame: pick the highest-scoring hand (first listed on ties), map, smooth (EMA, reset across gaps), then solve IK. */
export function retargetHands(file: AnnotationFile, config = armRetargetConfig()): ArmTrajectory {
  const aspect = file.videoWidth / file.videoHeight;
  let smoothed: (RetargetFrameTarget & { tMs: number }) | null = null, previousJoints: number[] | null = null;
  const frames = file.frames.map((frame): ArmFrame => {
    const hands = frame.hands ?? [];
    const handIndex = hands.map((item, index) => ({ score: item.score, index })).filter(item => item.score >= config.minHandScore)
      .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.index ?? null;
    const hand = handIndex === null ? undefined : hands[handIndex];
    const raw = hand ? handToTarget(hand.keypoints, aspect, config) : null;
    if (!hand || !raw) { smoothed = null; previousJoints = null; return { tMs: frame.tMs, handedness: hand?.handedness ?? null, handIndex: null, target: null, joints: null, ik: null }; }
    if (smoothed && frame.tMs - smoothed.tMs <= config.smoothingResetMs) {
      const alpha = config.smoothing, prior: RetargetFrameTarget & { tMs: number } = smoothed;
      const hingeSign = dot(prior.hinge, raw.hinge) < 0 ? -1 : 1;
      const approach = unit(blend(prior.approach, raw.approach, alpha)) ?? raw.approach;
      const hinge = unit(blend(prior.hinge, scale(raw.hinge, hingeSign), alpha)) ?? raw.hinge;
      smoothed = { ...raw, tMs: frame.tMs, position: blend(prior.position, raw.position, alpha), approach,
        hinge: unit(sub(hinge, scale(approach, dot(hinge, approach)))) ?? hinge, gripper: lerp(prior.gripper, raw.gripper, alpha) };
    } else smoothed = { ...raw, tMs: frame.tMs };
    const target = { position: smoothed.position, approach: smoothed.approach, hinge: smoothed.hinge, gripper: smoothed.gripper };
    const ik = so101InverseKinematics(target, previousJoints ? [previousJoints, ...SEEDS] : SEEDS, config);
    previousJoints = ik.joints;
    const { joints, ...status } = ik;
    return { tMs: frame.tMs, handedness: hand.handedness, handIndex, target, joints: [...joints, target.gripper] as JointTargets, ik: status };
  });
  return { schema: "skarl.arm-retarget.v1", robotType: "so101", kinematicsSource: SO101_SPEC.source, jointNames: SO101_JOINT_NAMES,
    units: "rad", source: "retargeted_from_human_hand", validated_on_hardware: false, advisory: true, cameraConvention: CAMERA_CONVENTION, handModel: file.model,
    sampleFps: file.sampleFps, config, frames,
    summary: { frames: frames.length, handFrames: frames.filter(frame => frame.joints).length, reachableFrames: frames.filter(frame => frame.ik?.reachable).length } };
}
