import { expect, it } from "vitest";
import { lerobotManifest, rldsJsonManifest, trainingFrames } from "./trainingFormats";

// Synthetic metadata; neither model inference nor media decoding is exercised.
const sample = { submissionId: "accepted123", durationMs: 12000,
  task: { id: "rubric123", languageInstruction: "Place the red cup on the table." },
  media: { url: "https://private.example/video", fps: null, clientReportedFps: 30 },
  license: { version: "demo-consent-v1", scope: "training" },
  usableStartMs: 500, usableEndMs: 3500, qualityScore: 70,
  components: { duplicateClear: { score: 20, maxScore: 20, status: "supported", evidence: "Synthetic clear duplicate check" } },
  sensorTrace: null,
  annotations: [{ kind: "hands" as const,
    model: { name: "Synthetic hand pose", version: "fixture-v1", runtime: "browser-wasm" as const },
    summary: { kind: "hands", frames: 2, durationMs: 1000 }, url: "https://private.example/derived-labels",
    derived: true as const, advisory: true as const }],
};
const manifest = { orderId: "order123", generatedAt: 123, task: sample.task, samples: [sample] };

it("uses the frozen task and acceptance witness while preserving the license and quality breakdown", () => {
  for (const exported of [lerobotManifest(manifest), rldsJsonManifest(manifest)]) {
    expect(exported.episodes[0]).toMatchObject({ ...sample, episode_index: 0, task_index: 0,
      language_instruction: sample.task.languageInstruction, success: true, success_source: "stored_acceptance_decision" });
    expect(exported.episodes[0].annotations).toEqual(sample.annotations);
  }
  const result = lerobotManifest(manifest);
  expect(result.info.features["observation.images.video"]).toMatchObject({ dtype: "video" });
  expect(result.tasks).toEqual([{ task_index: 0, task: sample.task.languageInstruction, task_id: sample.task.id }]);
});

it("does not turn requested camera FPS into observed frame counts or a loadable LeRobot archive", () => {
  const result = lerobotManifest(manifest);
  expect(result.info.fps).toBeNull();
  expect(result.info.total_frames).toBeNull();
  expect(result.episodes[0]).toMatchObject({ fps: null, client_reported_fps: 30, length: null,
    length_source: "unknown_frame_count" });
  expect(result.compatibility.directly_loadable).toBe(false);
  expect(result.info.absent_fields).toMatchObject({ action: false, joint_states: false });
  expect(result.info.features).not.toHaveProperty("action");
});

it("declares only channels with a surviving raw sensor witness and never invents frame alignment", () => {
  const withTrace = { ...sample, submissionId: "withTrace", sensorTrace: { rawTraceExists: true,
    sampleRateHz: 50, sensors: ["accelerometer", "attitude"], rawTraceDownload: null } };
  const lostTrace = { ...withTrace, submissionId: "lostTrace", sensorTrace: { ...withTrace.sensorTrace, rawTraceExists: false } };
  const result = lerobotManifest({ ...manifest, samples: [sample, withTrace, lostTrace] });
  expect(result.episodes[0]!.sensor_features).toEqual({});
  expect(result.episodes[2]!.sensor_features).toEqual({});
  expect(Object.keys(result.episodes[1]!.sensor_features)).toEqual(["observation.imu.accelerometer", "observation.orientation"]);
  expect(result.info.features["observation.orientation"]).toMatchObject({ names: ["alpha", "beta", "gamma"],
    source: "clientReported", frame_aligned: false, metadata_scope: "episode.sensor_features" });
  expect(result.info.features["observation.orientation"]).not.toHaveProperty("sample_rate_hz");
  expect(result.info.features["observation.orientation"]).not.toHaveProperty("download_url");
  expect(result.episodes[1]!.sensor_features["observation.orientation"]).toMatchObject({ sample_rate_hz: 50, download_url: null });
  expect(result.info.features).not.toHaveProperty("observation.imu.gyroscope");
});

it("keeps RLDS steps unmaterialized because a video URL is not a decoded observation or robot transition", () => {
  const result = rldsJsonManifest(manifest);
  expect(result.episodes[0]).toMatchObject({ episode_id: "order123:accepted123", steps: [], steps_status: "not_materialized" });
  expect(result.step_metadata.required_fields).toEqual(["is_first", "is_last"]);
  expect(result.compatibility.directly_loadable).toBe(false);
  for (const field of ["action", "joint_states", "reward", "discount", "is_terminal", "invalid"]) {
    expect(result.episodes[0]).not.toHaveProperty(field);
  }
});

it("handles an empty authorized order without a fake episode or task", () => {
  expect(lerobotManifest({ ...manifest, task: null, samples: [] })).toMatchObject({
    info: { total_episodes: 0, total_frames: 0, total_tasks: 0, fps: null }, tasks: [], episodes: [],
  });
  expect(rldsJsonManifest({ ...manifest, task: null, samples: [] }).episodes).toEqual([]);
});

const aligned = { ...sample, durationMs: 400, media: { ...sample.media, clientReportedFps: 10 },
  trainingInputs: { status: "validated_storage", hands: null, trace: {
    version: 2, durationMs: 600, videoStartOffsetMs: 200, videoStopOffsetMs: 600,
    syncSource: "expo-recording-progress-estimate", syncAccuracy: "approximate",
    sensors: ["accelerometer"], segments: [{ label: "Place cup", startMs: 0, endMs: 400 }],
    context: { mount: "chest" }, device: { cameraFacing: "back", fps: 10 },
    samples: [{ sensor: "accelerometer", timestampMs: 0, x: 99, y: 99, z: 99 },
      { sensor: "accelerometer", timestampMs: 200, x: 1, y: 2, z: 3 },
      { sensor: "accelerometer", timestampMs: 300, x: 4, y: 5, z: 6 }],
  } } };
it("offset alignment uses sensor time = video time + start offset; invocation-time samples cannot shift the first frame", () => {
  const result = trainingFrames(aligned);
  expect(result.frames[0]).toMatchObject({ frame_index: 0, timestamp: 0, "observation.state": [1, 2, 3] });
  expect(result.frames[1]).toMatchObject({ timestamp: 0.1, "observation.state": [4, 5, 6] });
  expect(result.grid).toMatchObject({ source: "client_reported_file_metadata", native_frame_timestamps: false });
  expect(result.sync).toMatchObject({ accuracy: "approximate" });
});
it("missing channels and stale samples never become zero states, while legacy v1 remains unaligned", () => {
  const result = trainingFrames(aligned);
  expect(result.state_names).toEqual(["accelerometer.x", "accelerometer.y", "accelerometer.z"]);
  expect(result.frames[3]!["observation.state"]).toEqual([null, null, null]);
  expect(trainingFrames({ ...aligned, trainingInputs: { ...aligned.trainingInputs,
    trace: { ...aligned.trainingInputs.trace, version: 1 } } }).frames).toEqual([]);
  expect(trainingFrames({ ...aligned, media: { ...aligned.media, clientReportedFps: null } }).frames).toEqual([]);
});
it("both episode formats carry narration, sub-task boundaries, camera/context and aligned state without raw hydration inputs", () => {
  const input = { ...manifest, samples: [{ ...aligned, transcriptSegments: [{ text: "I place the cup." }] }] };
  const le = lerobotManifest(input).episodes[0]!;
  const rlds = rldsJsonManifest(input).episodes[0]!;
  expect(le.language_instruction).toBe(sample.task.languageInstruction + "\n\nI place the cup.");
  expect(le.segments).toEqual(aligned.trainingInputs.trace.segments);
  expect(le.context).toEqual({ mount: "chest" });
  expect(le.camera).toMatchObject({ cameraFacing: "back" });
  expect(le).not.toHaveProperty("trainingInputs");
  expect(rlds.steps[0]).toMatchObject({ is_first: true, is_last: false, observation: { state: [1, 2, 3], video: { timestamp: 0 } } });
  expect(rlds.steps.at(-1)).toMatchObject({ is_last: true });
});
it("saved hand keypoints remain an advisory image-space action proxy with model identity, never a robot command", () => {
  const hands = { schema: "skarl.annotations.v1" as const, kind: "hands" as const, submissionId: sample.submissionId,
    sourceSha256: "a".repeat(64), model: sample.annotations[0]!.model, sampleFps: 10,
    videoWidth: 720, videoHeight: 1280, advisory: true as const, frames: [{ tMs: 0, hands: [] }] };
  const result = trainingFrames({ ...aligned, trainingInputs: { ...aligned.trainingInputs, hands } });
  expect(result.action_proxy).toMatchObject({ advisory: true, robot_control: false, model: hands.model, keyframes: [{ timestamp_ms: 0, hands: [] }] });
  expect(result.frames[0]!.action).toMatchObject({ advisory: true, hands: [] });
  expect(result.frames[1]!.action).toBeNull();
  const handsOnly = trainingFrames({ ...aligned, trainingInputs: { status: "validated_storage", trace: null, hands } });
  expect(handsOnly.frames[0]).toMatchObject({ "observation.state": [], action: { advisory: true, hands: [] } });
  expect(handsOnly.state_names).toEqual([]);
});
