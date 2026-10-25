import { expect, it } from "vitest";
import { lerobotManifest, rldsJsonManifest } from "./trainingFormats";

// Synthetic metadata; neither model inference nor media decoding is exercised.
const sample = { submissionId: "accepted123", durationMs: 12000,
  task: { id: "rubric123", languageInstruction: "Place the red cup on the table." },
  media: { url: "https://private.example/video", fps: null, clientReportedFps: 30 },
  license: { version: "demo-consent-v1", scope: "training" },
  usableStartMs: 500, usableEndMs: 3500, qualityScore: 70,
  components: { duplicateClear: { score: 20, maxScore: 20, status: "supported", evidence: "Synthetic clear duplicate check" } },
  sensorTrace: null,
};
const manifest = { orderId: "order123", generatedAt: 123, task: sample.task, samples: [sample] };

it("uses the frozen task and acceptance witness while preserving the license and quality breakdown", () => {
  for (const exported of [lerobotManifest(manifest), rldsJsonManifest(manifest)]) {
    expect(exported.episodes[0]).toMatchObject({ ...sample, episode_index: 0, task_index: 0,
      language_instruction: sample.task.languageInstruction, success: true, success_source: "stored_acceptance_decision" });
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
