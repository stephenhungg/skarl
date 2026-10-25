import { strFromU8, unzipSync } from "fflate";
import { expect, it } from "vitest";
import { lerobotV2Archive } from "./lerobot-v2";

// Synthetic hand runs; the archive was separately loaded with pyarrow and lerobot 0.3.3 (see docs/datasets.md).
type Point = [number, number, number];
function keypoints(u: number): Point[] {
  const at = (dx: number, dy: number): Point => [u + dx * 0.15, 0.6 + dy * 0.15, 0.5];
  const points: Point[] = Array.from({ length: 21 }, () => at(0, -0.5));
  points[0] = at(0, 0); points[5] = at(-0.35, -0.9); points[9] = at(0, -1); points[17] = at(0.35, -0.85); points[4] = at(-0.7, -1.3); points[8] = at(-0.5, -1.3);
  return points;
}
function hands(submissionId: string, sampleFps: number, detected: boolean[]) {
  return { schema: "skarl.annotations.v1" as const, submissionId, sourceSha256: "b".repeat(64), kind: "hands" as const,
    model: { name: "Synthetic hand pose", version: "fixture-v1", runtime: "browser-wasm" as const }, sampleFps, videoWidth: 720, videoHeight: 1280, advisory: true as const,
    frames: detected.map((hit, i) => ({ tMs: i * 1000 / sampleFps, hands: hit ? [{ handedness: "Right" as const, score: 0.9, keypoints: keypoints(0.3 + i * 0.02) }] : [] })) };
}
const sample = (submissionId: string, run: ReturnType<typeof hands> | null) => ({ submissionId, trainingInputs: { trace: null, hands: run, status: "validated_storage" } });
const manifest = (samples: ReturnType<typeof sample>[]) => ({ orderId: "order123", generatedAt: Date.UTC(2026, 9, 25), task: { id: "task123", languageInstruction: "Place the cup." }, samples });
const json = (files: Record<string, Uint8Array>, path: string) => JSON.parse(strFromU8(files[path]!));
const lines = (files: Record<string, Uint8Array>, path: string) => strFromU8(files[path]!).trim().split("\n").map(line => JSON.parse(line));

it("writes the LeRobot v2.1 directory layout that LeRobotDataset expects, with contiguous episode indexes", () => {
  const result = lerobotV2Archive(manifest([sample("a", hands("a", 5, [true, true, false, true])), sample("skipped", null), sample("b", hands("b", 5, [true, true]))]));
  if (!result.ok) throw new Error("expected archive");
  const files = unzipSync(result.zip);
  expect(Object.keys(files).sort()).toEqual(["data/chunk-000/episode_000000.parquet", "data/chunk-000/episode_000001.parquet", "meta/episodes.jsonl",
    "meta/episodes_stats.jsonl", "meta/info.json", "meta/skarl_provenance.json", "meta/tasks.jsonl"]);
  for (const path of Object.keys(files).filter(path => path.endsWith(".parquet"))) {
    expect(strFromU8(files[path]!.slice(0, 4))).toBe("PAR1"); expect(strFromU8(files[path]!.slice(-4))).toBe("PAR1");
  }
  expect(json(files, "meta/info.json")).toMatchObject({ codebase_version: "v2.1", robot_type: "so101", total_episodes: 2, total_frames: 6, total_tasks: 1,
    total_videos: 0, total_chunks: 1, chunks_size: 1000, fps: 5, splits: { train: "0:2" }, video_path: null,
    data_path: "data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet" });
  expect(lines(files, "meta/episodes.jsonl")).toEqual([{ episode_index: 0, tasks: ["Place the cup."], length: 4 }, { episode_index: 1, tasks: ["Place the cup."], length: 2 }]);
  expect(lines(files, "meta/tasks.jsonl")).toEqual([{ task_index: 0, task: "Place the cup." }]);
  expect(result.skipped).toEqual([{ submissionId: "skipped", reason: "no_saved_hand_run" }]);
});

it("labels the action as retargeted and hardware-unvalidated, and keeps missing hands out of the statistics", () => {
  const result = lerobotV2Archive(manifest([sample("a", hands("a", 5, [true, true, false, true]))]));
  if (!result.ok) throw new Error("expected archive");
  const files = unzipSync(result.zip);
  expect(json(files, "meta/info.json").features.action).toMatchObject({ dtype: "float32", shape: [6], units: "rad", source: "retargeted_from_human_hand",
    validated_on_hardware: false, advisory: true, names: ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"] });
  const [episode] = lines(files, "meta/episodes_stats.jsonl");
  // The no-hand frame is NaN in Parquet with action_is_valid=false; stats count only the three real targets.
  expect(episode.stats.action.count).toEqual([3]);
  expect(episode.stats.action_is_valid).toMatchObject({ count: [4], mean: [0.75] });
  expect(episode.stats.action.mean.every(Number.isFinite)).toBe(true);
  expect(json(files, "meta/skarl_provenance.json")).toMatchObject({ validated_on_hardware: false, advisory: true,
    absent: { recorded_robot_action: false }, episodes: [{ episode_index: 0, submissionId: "a", action_spec: { validated_on_hardware: false } }] });
});

it("is reproducible byte-for-byte for the same authorized snapshot", () => {
  const input = manifest([sample("a", hands("a", 5, [true, true]))]);
  const [first, second] = [lerobotV2Archive(input), lerobotV2Archive(input)];
  if (!first.ok || !second.ok) throw new Error("expected archive");
  expect(Buffer.from(first.zip).equals(Buffer.from(second.zip))).toBe(true);
});

it("refuses to fabricate an archive when no episode has a confident hand, and skips mixed sample rates", () => {
  expect(lerobotV2Archive(manifest([sample("none", hands("none", 5, [false, false])), sample("missing", null)]))).toEqual({ ok: false,
    error: "no_retargetable_episodes", skipped: [{ submissionId: "none", reason: "no_confident_hand_frames" }, { submissionId: "missing", reason: "no_saved_hand_run" }] });
  const mixed = lerobotV2Archive(manifest([sample("a", hands("a", 5, [true])), sample("b", hands("b", 10, [true])), sample("c", hands("c", 2.5, [true]))]));
  expect(mixed).toMatchObject({ ok: true, episodes: 1, skipped: [{ submissionId: "b", reason: "mixed_annotation_fps" }, { submissionId: "c", reason: "non_integer_annotation_fps" }] });
});
