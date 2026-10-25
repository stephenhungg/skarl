/** Loadable LeRobot v2.1 archive: per-episode Parquet plus meta/ JSON, zipped in memory.
 * Layout follows lerobot v0.3.3 `datasets/utils.py` (DEFAULT_PARQUET_PATH, INFO_PATH, EPISODES_PATH,
 * EPISODES_STATS_PATH, TASKS_PATH). Only the retargeted SO-101 action and the advisory hand keypoints it
 * came from are materialized: no images or video, no recorded robot state, no rewards.
 */
import { strToU8, zipSync } from "fflate";
import { parquetWriteBuffer, type ColumnSource, type SchemaElement } from "hyparquet-writer";
import { retargetHands, SO101_JOINT_NAMES, SO101_SPEC, type ArmTrajectory } from "../../../../convex/lib/armRetarget";
import type { AnnotationFile } from "../../../../convex/lib/derivedAnnotations";
import { actionSpec, type TrainingManifest } from "../../../../convex/lib/trainingFormats";

const CHUNK_SIZE = 1000; // lerobot DEFAULT_CHUNK_SIZE
const DATA_PATH = "data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet";
const LANDMARKS = ["wrist", "thumb_cmc", "thumb_mcp", "thumb_ip", "thumb_tip", "index_finger_mcp", "index_finger_pip", "index_finger_dip", "index_finger_tip",
  "middle_finger_mcp", "middle_finger_pip", "middle_finger_dip", "middle_finger_tip", "ring_finger_mcp", "ring_finger_pip", "ring_finger_dip", "ring_finger_tip",
  "pinky_mcp", "pinky_pip", "pinky_dip", "pinky_tip"];
const KEYPOINT_NAMES = LANDMARKS.flatMap(name => ["x", "y", "z"].map(axis => `${name}.${axis}`));

export type LeRobotSkip = { submissionId: string; reason: "no_saved_hand_run" | "no_confident_hand_frames" | "non_integer_annotation_fps" | "mixed_annotation_fps" };
export type LeRobotV2Result = { ok: true; zip: Uint8Array; files: Record<string, Uint8Array>; episodes: number; frames: number; fps: number; skipped: LeRobotSkip[] }
  | { ok: false; error: "no_retargetable_episodes"; skipped: LeRobotSkip[] };
type Row = { action: number[]; keypoints: number[]; valid: boolean; reachable: boolean; residual: number };

const features = {
  action: { dtype: "float32", shape: [SO101_JOINT_NAMES.length], names: SO101_JOINT_NAMES, units: "rad", robot_type: SO101_SPEC.robotType,
    source: "retargeted_from_human_hand", validated_on_hardware: false, advisory: true, missing: "NaN where action_is_valid is false" },
  "observation.hand_keypoints": { dtype: "float32", shape: [KEYPOINT_NAMES.length], names: KEYPOINT_NAMES, coordinate_system: "normalized_image_xyz",
    source: "browser_hand_landmarker", derived: true, advisory: true, missing: "NaN where action_is_valid is false" },
  action_is_valid: { dtype: "bool", shape: [1], names: null },
  action_is_reachable: { dtype: "bool", shape: [1], names: null },
  action_ik_position_residual_m: { dtype: "float32", shape: [1], names: null, units: "m" },
  timestamp: { dtype: "float32", shape: [1], names: null },
  frame_index: { dtype: "int64", shape: [1], names: null },
  episode_index: { dtype: "int64", shape: [1], names: null },
  index: { dtype: "int64", shape: [1], names: null },
  task_index: { dtype: "int64", shape: [1], names: null },
};

const list = (name: string): SchemaElement[] => [{ name, repetition_type: "REQUIRED", converted_type: "LIST", num_children: 1 },
  { name: "list", repetition_type: "REPEATED", num_children: 1 }, { name: "element", type: "FLOAT", repetition_type: "REQUIRED" }];
const scalar = (name: string, type: "FLOAT" | "INT64" | "BOOLEAN"): SchemaElement => ({ name, type, repetition_type: "REQUIRED" });
const schema: SchemaElement[] = [{ name: "schema", num_children: 10 }, ...list("action"), ...list("observation.hand_keypoints"),
  scalar("action_is_valid", "BOOLEAN"), scalar("action_is_reachable", "BOOLEAN"), scalar("action_ik_position_residual_m", "FLOAT"),
  scalar("timestamp", "FLOAT"), scalar("frame_index", "INT64"), scalar("episode_index", "INT64"), scalar("index", "INT64"), scalar("task_index", "INT64")];

/** LeRobot per-episode stats: per-dimension min/max/mean/std over the given rows and count with shape [1]. */
function stats(rows: number[][]) {
  const width = rows[0]?.length ?? 0, count = rows.length;
  const dims = Array.from({ length: width }, (_, d) => rows.map(row => row[d]!));
  const mean = dims.map(values => values.reduce((sum, value) => sum + value, 0) / count);
  return { min: dims.map(values => Math.min(...values)), max: dims.map(values => Math.max(...values)), mean,
    std: dims.map((values, d) => Math.sqrt(values.reduce((sum, value) => sum + (value - mean[d]!) ** 2, 0) / count)), count: [count] };
}

/** Rows on a uniform grid at the annotation sample rate: each grid time takes the nearest saved frame within half a period. */
function episodeRows(hands: AnnotationFile, arm: ArmTrajectory, fps: number): Row[] {
  const last = hands.frames.at(-1)?.tMs ?? 0;
  const length = Math.floor(last * fps / 1000 + 1e-9) + 1;
  const missing = (width: number) => new Array<number>(width).fill(Number.NaN);
  let cursor = 0;
  return Array.from({ length }, (_, frameIndex) => {
    const tMs = frameIndex * 1000 / fps;
    while (cursor + 1 < arm.frames.length && Math.abs(arm.frames[cursor + 1]!.tMs - tMs) < Math.abs(arm.frames[cursor]!.tMs - tMs)) cursor++;
    const frame = arm.frames[cursor];
    const joints = frame && Math.abs(frame.tMs - tMs) <= 500 / fps ? frame.joints : null;
    const hand = joints && frame!.handIndex !== null ? hands.frames[cursor]!.hands![frame!.handIndex] : undefined;
    if (!joints || !hand || !frame!.ik) return { action: missing(SO101_JOINT_NAMES.length), keypoints: missing(KEYPOINT_NAMES.length), valid: false, reachable: false, residual: Number.NaN };
    return { action: [...joints], keypoints: hand.keypoints.flat(), valid: true, reachable: frame!.ik.reachable, residual: frame!.ik.positionResidualM };
  });
}

export function lerobotV2Archive(manifest: TrainingManifest): LeRobotV2Result {
  const skipped: LeRobotSkip[] = [];
  const episodes: { submissionId: string; sourceSha256: string; rows: Row[]; spec: ReturnType<typeof actionSpec> }[] = [];
  let fps: number | null = null;
  for (const sample of manifest.samples) {
    const hands = sample.trainingInputs?.hands;
    if (!hands) { skipped.push({ submissionId: sample.submissionId, reason: "no_saved_hand_run" }); continue; }
    if (!Number.isInteger(hands.sampleFps)) { skipped.push({ submissionId: sample.submissionId, reason: "non_integer_annotation_fps" }); continue; }
    if (fps !== null && hands.sampleFps !== fps) { skipped.push({ submissionId: sample.submissionId, reason: "mixed_annotation_fps" }); continue; }
    const arm = retargetHands(hands), rows = episodeRows(hands, arm, hands.sampleFps);
    if (!rows.some(row => row.valid)) { skipped.push({ submissionId: sample.submissionId, reason: "no_confident_hand_frames" }); continue; }
    fps = hands.sampleFps;
    episodes.push({ submissionId: sample.submissionId, sourceSha256: hands.sourceSha256, rows, spec: actionSpec(arm) });
  }
  if (!episodes.length || fps === null) return { ok: false, error: "no_retargetable_episodes", skipped };
  const task = manifest.task?.languageInstruction?.trim() || "Licensed human demonstration";
  const files: Record<string, Uint8Array> = {};
  const episodeLines: string[] = [], statLines: string[] = [];
  let index = 0;
  episodes.forEach(({ rows }, episodeIndex) => {
    const n = rows.length, start = index;
    index += n;
    const timestamps = rows.map((_, i) => Math.fround(i / fps!));
    const columns: ColumnSource[] = [
      { name: "action", data: rows.map(row => row.action) },
      { name: "observation.hand_keypoints", data: rows.map(row => row.keypoints) },
      { name: "action_is_valid", data: rows.map(row => row.valid) },
      { name: "action_is_reachable", data: rows.map(row => row.reachable) },
      { name: "action_ik_position_residual_m", data: rows.map(row => row.residual) },
      { name: "timestamp", data: timestamps },
      { name: "frame_index", data: rows.map((_, i) => BigInt(i)) },
      { name: "episode_index", data: rows.map(() => BigInt(episodeIndex)) },
      { name: "index", data: rows.map((_, i) => BigInt(start + i)) },
      { name: "task_index", data: rows.map(() => 0n) },
    ];
    // Statistics off: Parquet min/max must not carry the NaN placeholders for missing frames.
    const parquet = parquetWriteBuffer({ columnData: columns, schema, statistics: false, createdBy: "skarl lerobot-v2 export" });
    const chunk = Math.floor(episodeIndex / CHUNK_SIZE);
    files[`data/chunk-${String(chunk).padStart(3, "0")}/episode_${String(episodeIndex).padStart(6, "0")}.parquet`] = new Uint8Array(parquet);
    const valid = rows.filter(row => row.valid);
    episodeLines.push(JSON.stringify({ episode_index: episodeIndex, tasks: [task], length: n }));
    statLines.push(JSON.stringify({ episode_index: episodeIndex, stats: {
      action: stats(valid.map(row => row.action)), "observation.hand_keypoints": stats(valid.map(row => row.keypoints)),
      action_is_valid: stats(rows.map(row => [row.valid ? 1 : 0])), action_is_reachable: stats(rows.map(row => [row.reachable ? 1 : 0])),
      action_ik_position_residual_m: stats(valid.map(row => [row.residual])), timestamp: stats(timestamps.map(value => [value])),
      frame_index: stats(rows.map((_, i) => [i])), episode_index: stats(rows.map(() => [episodeIndex])),
      index: stats(rows.map((_, i) => [start + i])), task_index: stats(rows.map(() => [0])) } }));
  });
  const info = { codebase_version: "v2.1", robot_type: SO101_SPEC.robotType, total_episodes: episodes.length, total_frames: index, total_tasks: 1,
    total_videos: 0, total_chunks: Math.ceil(episodes.length / CHUNK_SIZE), chunks_size: CHUNK_SIZE, fps, splits: { train: `0:${episodes.length}` },
    data_path: DATA_PATH, video_path: null, features };
  const provenance = { schema: "skarl.lerobot-v2-provenance.v1", orderId: manifest.orderId, generatedAt: manifest.generatedAt,
    advisory: true, validated_on_hardware: false, action_source: "retargeted_from_human_hand", kinematics_source: SO101_SPEC.source,
    observations: "Hand keypoints only; no images, video, depth or recorded robot state are included. Video stays behind the authorized dataset endpoint.",
    absent: { recorded_robot_action: false, joint_states: false, reward: false, discount: false },
    grid: { fps, source: "annotation_sample_rate", resampling: "nearest_saved_frame_within_half_period", missing: "NaN with action_is_valid=false" },
    episodes: episodes.map((episode, episodeIndex) => ({ episode_index: episodeIndex, submissionId: episode.submissionId, sourceSha256: episode.sourceSha256,
      action_spec: episode.spec })), skipped };
  files["meta/info.json"] = strToU8(JSON.stringify(info, null, 2));
  files["meta/episodes.jsonl"] = strToU8(episodeLines.join("\n") + "\n");
  files["meta/episodes_stats.jsonl"] = strToU8(statLines.join("\n") + "\n");
  files["meta/tasks.jsonl"] = strToU8(JSON.stringify({ task_index: 0, task }) + "\n");
  files["meta/skarl_provenance.json"] = strToU8(JSON.stringify(provenance, null, 2));
  // Parquet pages are already compressed; a fixed mtime keeps the archive byte-for-byte reproducible.
  const zip = zipSync(Object.fromEntries(Object.entries(files).map(([path, data]) => [path, [data, { level: 0 }]])), { mtime: manifest.generatedAt });
  return { ok: true, zip, files, episodes: episodes.length, frames: index, fps, skipped };
}
