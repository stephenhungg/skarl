import type { ArmFrame, ArmTrajectory } from "../../../../convex/lib/armRetarget";

/** The pose shown at a video time: the nearest saved frame, linearly blended with its neighbour only when both have joints. */
export function armPoseAt(trajectory: ArmTrajectory, tMs: number): { frame: ArmFrame | null; joints: number[] | null } {
  const frames = trajectory.frames, period = 1000 / trajectory.sampleFps;
  if (!frames.length) return { frame: null, joints: null };
  let index = 0;
  while (index + 1 < frames.length && frames[index + 1]!.tMs <= tMs) index++;
  const current = frames[index]!, next = frames[index + 1];
  const nearest = next && Math.abs(next.tMs - tMs) < Math.abs(current.tMs - tMs) ? next : current;
  if (Math.abs(nearest.tMs - tMs) > period) return { frame: null, joints: null };
  if (current.joints && next?.joints && tMs >= current.tMs && next.tMs - current.tMs <= period * 1.5) {
    const alpha = (tMs - current.tMs) / (next.tMs - current.tMs);
    return { frame: nearest, joints: current.joints.map((value, i) => value + (next.joints![i]! - value) * alpha) };
  }
  return { frame: nearest, joints: nearest.joints };
}
