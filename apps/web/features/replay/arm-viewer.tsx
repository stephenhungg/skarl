"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Badge } from "@/components/glaze/ui/badge";
import { Status } from "@/components/glaze/ui/status";
import { retargetHands, SO101_JOINT_NAMES, so101ForwardKinematics, type ArmTrajectory, type Vec3 } from "../../../../convex/lib/armRetarget";
import { armPoseAt } from "./arm-pose";
import type { AnnotationFile } from "./annotations";

type Palette = { ink: string; muted: string; ok: string; warn: string };
/** Resolve a CSS colour token to sRGB through a 2D canvas, so any token syntax (oklch, color-mix) reaches three.js. */
function resolveColor(element: Element, token: string): string {
  const value = getComputedStyle(element).getPropertyValue(token).trim();
  const context = document.createElement("canvas").getContext("2d");
  if (!value || !context) return "#808080";
  context.fillStyle = value; context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

// Robot base frame is z-up; three.js is y-up.
const toScene = ([x, y, z]: Vec3) => new THREE.Vector3(x, z, -y);

function Link({ from, to, radius, color }: { from: THREE.Vector3; to: THREE.Vector3; radius: number; color: string }) {
  const length = from.distanceTo(to);
  const middle = from.clone().add(to).multiplyScalar(0.5);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
  if (length < 1e-6) return null;
  return <mesh position={middle} quaternion={quaternion}><cylinderGeometry args={[radius, radius, length, 16]} /><meshStandardMaterial color={color} /></mesh>;
}

function Arm({ joints, target, reachable, palette }: { joints: number[] | null; target: Vec3 | null; reachable: boolean; palette: Palette }) {
  const invalidate = useThree(state => state.invalidate);
  useEffect(() => { invalidate(); }, [joints, target, invalidate]);
  const pose = so101ForwardKinematics(joints ?? [0, 0, 0, 0, 0]);
  const points = [toScene([0, 0, 0]), ...pose.joints.map(joint => toScene(joint.position)), toScene(pose.tool.position)];
  const color = joints ? palette.ink : palette.muted;
  // Jaws: two short fingers either side of the tool along the opening direction (tool x), spread by the gripper angle.
  const gripper = joints?.[5] ?? 0, rotation = pose.tool.rotation;
  const axis = (index: 0 | 1 | 2): Vec3 => [rotation[0][index], rotation[1][index], rotation[2][index]];
  const [open, approach] = [axis(0), axis(2)];
  const spread = 0.012 + 0.02 * Math.sin(Math.max(0, gripper));
  const jaw = (sign: number) => {
    const base: Vec3 = [0, 1, 2].map(i => pose.tool.position[i]! + open[i]! * spread * sign - approach[i]! * 0.03) as Vec3;
    return <Link key={sign} from={toScene(base)} to={toScene([0, 1, 2].map(i => base[i]! + approach[i]! * 0.035) as Vec3)} radius={0.004} color={color} />;
  };
  return <group>
    <mesh position={[0, 0.01, 0]}><cylinderGeometry args={[0.05, 0.055, 0.02, 32]} /><meshStandardMaterial color={palette.muted} /></mesh>
    {points.slice(1).map((point, index) => <Link key={index} from={points[index]!} to={point} radius={index === 0 ? 0.02 : 0.013} color={color} />)}
    {points.slice(1, -1).map((point, index) => <mesh key={index} position={point}><sphereGeometry args={[0.017, 20, 20]} /><meshStandardMaterial color={palette.muted} /></mesh>)}
    {joints && [jaw(1), jaw(-1)]}
    {target && <mesh position={toScene(target)}><sphereGeometry args={[0.009, 16, 16]} /><meshBasicMaterial color={reachable ? palette.ok : palette.warn} wireframe /></mesh>}
  </group>;
}

function Workspace({ trajectory, color }: { trajectory: ArmTrajectory; color: string }) {
  const { xMin, xMax, yHalf, zMin, zMax } = trajectory.config.workspace;
  const center = toScene([(xMin + xMax) / 2, 0, (zMin + zMax) / 2]);
  return <lineSegments position={center}>
    <edgesGeometry args={[new THREE.BoxGeometry(xMax - xMin, zMax - zMin, yHalf * 2)]} />
    <lineBasicMaterial color={color} />
  </lineSegments>;
}

/** Replays the advisory SO-101 trajectory retargeted from a saved hand run, synced to the video clock. */
export function ArmViewer({ file, currentTimeMs }: { file: AnnotationFile | null; currentTimeMs: number }) {
  const host = useRef<HTMLDivElement>(null);
  const [palette, setPalette] = useState<Palette | null>(null);
  const trajectory = useMemo(() => file?.kind === "hands" ? retargetHands(file) : null, [file]);
  useEffect(() => {
    if (!host.current) return;
    const element = host.current;
    setPalette({ ink: resolveColor(element, "--ink"), muted: resolveColor(element, "--ink-32"), ok: resolveColor(element, "--ok"), warn: resolveColor(element, "--warn") });
  }, [trajectory]);
  const pose = trajectory ? armPoseAt(trajectory, currentTimeMs) : null;
  const frame = pose?.frame ?? null;
  const reachable = !!frame?.ik?.reachable;
  return <div className="shell mt-6"><div className="panel p-3" ref={host}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0"><h3 className="type-label">SO-101 arm replay</h3>
        <p className="mt-1 type-caption text-text-3">Joint targets retargeted from the saved hand run onto the SO-101 URDF. Not a recorded robot action.</p></div>
      <Badge variant="warn">Retargeted, not hardware-validated</Badge>
    </div>
    {trajectory ? <>
      <div className="mt-3 aspect-[4/3] w-full overflow-hidden rounded-panel bg-field" role="img"
        aria-label={frame?.joints ? `SO-101 arm pose at ${(currentTimeMs / 1000).toFixed(1)} seconds, ${reachable ? "reachable" : "outside reach"}` : "SO-101 arm at rest: no hand at this time"}>
        {palette && <Canvas frameloop="demand" dpr={[1, 2]} camera={{ position: [0.55, 0.42, 0.5], fov: 40, near: 0.01, far: 10 }}
          onCreated={({ camera }) => camera.lookAt(0.18, 0.12, 0)}>
          <ambientLight intensity={0.7} />
          <directionalLight position={[1, 2, 1]} intensity={1.2} />
          <gridHelper args={[0.8, 16, palette.muted, palette.muted]} />
          <Workspace trajectory={trajectory} color={palette.muted} />
          <Arm joints={pose?.joints ?? null} target={frame?.target?.position ?? null} reachable={reachable} palette={palette} />
        </Canvas>}
      </div>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {!frame?.ik ? <Status status="idle">No confident hand at this time</Status>
          : reachable ? <Status status="ok">Reachable</Status>
          : <Status status="warn">Outside reach by {(frame.ik.positionResidualM * 100).toFixed(1)} cm</Status>}
        {frame?.ik && <span className="type-caption text-text-3">IK error {(frame.ik.positionResidualM * 1000).toFixed(1)} mm · approach {(frame.ik.approachResidualRad * 180 / Math.PI).toFixed(0)}° off{frame.ik.jointLimited ? " · at a joint limit" : ""}</span>}
      </div>
      <p className="mt-2 type-caption text-text-3 tabular-nums">{SO101_JOINT_NAMES.map((name, index) => `${name.replace("_", " ")} ${pose?.joints ? pose.joints[index]!.toFixed(2) : "none"}`).join(" · ")} rad</p>
      <p className="mt-2 type-caption text-text-3">{trajectory.summary.reachableFrames} of {trajectory.summary.handFrames} hand frames reachable · {trajectory.summary.frames} sampled frames · camera assumed overhead tabletop · URDF joint zero, not a calibrated arm</p>
    </> : <p className="mt-3 type-body-sm text-text-3">View a saved hands run above to replay its retargeted SO-101 trajectory beside the clip.</p>}
  </div></div>;
}
