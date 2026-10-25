/** Metadata adapters for licensed human video, not robot teleoperation datasets.
 * LeRobot v2 uses info/episode/task metadata plus per-frame Parquet and videos.
 * RLDS uses nested episodes/steps. These manifests describe conversion inputs;
 * they do not invent decoded frames, synchronized sensors, actions or rewards.
 */
export interface TrainingSample {
  submissionId: string;
  durationMs?: number | null;
  task?: { id: string; languageInstruction?: string };
  media?: { url: string; fps?: number | null; frameCount?: number | null; clientReportedFps?: number | null };
  sensorTrace?: { rawTraceExists: boolean; sensors: string[]; sampleRateHz: number; rawTraceDownload?: null } | null;
  annotations?: { kind: "hands" | "objects" | "masks";
    model: { name: string; version: string; runtime: "browser-wasm" | "browser-webgpu" };
    summary: unknown; url: string | null; derived: true; advisory: true }[];
}
export interface TrainingManifest {
  orderId: string;
  generatedAt: number;
  task: { id: string; languageInstruction?: string } | null;
  samples: TrainingSample[];
}

const absent = { action: false, joint_states: false, reward: false, discount: false,
  reason: "Human demonstration video; no robot controls, joint states, rewards or discounts were recorded." } as const;
const videoKey = "observation.images.video";
const sensorColumns: Record<string, { key: string; names: string[]; units: string }> = {
  accelerometer: { key: "observation.imu.accelerometer", names: ["x", "y", "z"], units: "g" },
  gyroscope: { key: "observation.imu.gyroscope", names: ["x", "y", "z"], units: "rad/s" },
  deviceMotion: { key: "observation.imu.linear_acceleration", names: ["x", "y", "z"], units: "m/s^2" },
  gravity: { key: "observation.imu.gravity", names: ["x", "y", "z"], units: "m/s^2" },
  attitude: { key: "observation.orientation", names: ["alpha", "beta", "gamma"], units: "rad" },
};

function sensorFeatures(sample: TrainingSample) {
  const features: Record<string, unknown> = {};
  if (!sample.sensorTrace?.rawTraceExists) return features;
  for (const sensor of sample.sensorTrace.sensors) {
    const column = sensorColumns[sensor];
    if (!column) continue;
    features[column.key] = { dtype: "float64", shape: [3], names: column.names, units: column.units,
      source: "clientReported", available_in_raw_trace: true, frame_aligned: false,
      sample_rate_hz: sample.sensorTrace.sampleRateHz, download_url: sample.sensorTrace.rawTraceDownload ?? null };
  }
  return features;
}

function positive(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function episodeMetadata(manifest: TrainingManifest, sample: TrainingSample, episodeIndex: number) {
  const fps = positive(sample.media?.fps);
  const frameCount = positive(sample.media?.frameCount);
  return { episode_index: episodeIndex, task_index: 0,
    language_instruction: sample.task?.languageInstruction ?? manifest.task?.languageInstruction ?? null,
    // Only datasets.forOrder's licensed accepted samples enter these adapters.
    success: true, success_source: "stored_acceptance_decision" as const,
    fps, fps_source: fps === null ? "unknown" : "verified_media_metadata",
    client_reported_fps: sample.media?.clientReportedFps ?? null,
    length: frameCount !== null && Number.isInteger(frameCount) ? frameCount : null,
    length_unit: "video_frames" as const, length_source: frameCount !== null && Number.isInteger(frameCount)
      ? "verified_media_metadata" : "unknown_frame_count",
    duration_ms: sample.durationMs ?? null, absent_fields: absent };
}

/** A LeRobot-v2-style episode manifest, not a directly loadable Parquet archive. */
export function lerobotManifest<T extends TrainingManifest>(manifest: T) {
  const episodes = manifest.samples.map((sample, episodeIndex) => ({ ...sample,
    ...episodeMetadata(manifest, sample, episodeIndex),
    videos: { [videoKey]: { url: sample.media?.url ?? null, shape: null,
      shape_source: "unknown_dimensions", decoded: false } },
    sensor_features: sensorFeatures(sample),
  }));
  const rates = [...new Set(episodes.map(episode => episode.fps))];
  const features: Record<string, unknown> = {
    [videoKey]: { dtype: "video", shape: null, names: ["channel", "height", "width"],
      shape_source: "unknown_dimensions" },
    episode_index: { dtype: "int64", shape: [1], names: null },
    task_index: { dtype: "int64", shape: [1], names: null },
    language_instruction: { dtype: "string", shape: [1], names: null },
    success: { dtype: "bool", shape: [1], names: null },
  };
  for (const episode of episodes) for (const [key, feature] of Object.entries(episode.sensor_features)) {
    // A union schema cannot assign one episode's asynchronous sample rate or
    // download availability to every other episode with that channel.
    const { sample_rate_hz: _rate, download_url: _url, ...column } = feature as Record<string, unknown>;
    features[key] = { ...column, metadata_scope: "episode.sensor_features" };
  }
  const lengthsKnown = episodes.every(episode => episode.length !== null);
  return { schema: "skarl.lerobot-v2-manifest.v1" as const, orderId: manifest.orderId, generatedAt: manifest.generatedAt,
    compatibility: { target: "LeRobot v2", directly_loadable: false,
      reason: "Metadata and private video references only. Decode media, verify FPS/dimensions/frame counts, and write per-frame Parquet before LeRobot loading. Sensor channels are asynchronous client reports; no frame alignment is claimed." },
    info: { codebase_version: "v2.1", robot_type: "human_video", total_episodes: episodes.length,
      total_frames: lengthsKnown ? episodes.reduce((sum, episode) => sum + episode.length!, 0) : null,
      total_tasks: manifest.task ? 1 : 0, fps: rates.length === 1 ? rates[0] : null,
      fps_source: rates.length === 1 && rates[0] !== null ? "verified_media_metadata" : "unknown_or_mixed",
      features, absent_fields: absent,
      sensor_features_scope: "Union of available raw-trace channels; consult each episode.sensor_features for presence. Not materialized per-frame columns." },
    tasks: manifest.task ? [{ task_index: 0, task: manifest.task.languageInstruction ?? null, task_id: manifest.task.id }] : [],
    episodes };
}

/** RLDS-style JSON conversion metadata; no fabricated frame/transition records. */
export function rldsJsonManifest<T extends TrainingManifest>(manifest: T) {
  return { schema: "skarl.rlds-json.v1" as const, orderId: manifest.orderId, generatedAt: manifest.generatedAt,
    compatibility: { target: "RLDS", directly_loadable: false,
      reason: "JSON episode/step metadata, not TFDS. Decode videos and populate observation-only steps; actions, rewards and discounts are absent. Acceptance success is not an environment terminal signal." },
    step_metadata: { materialized: false, required_fields: ["is_first", "is_last"],
      observation: { video_key: videoKey, source: "episode.video.url", frame_timestamp_unit: "seconds" },
      language_instruction: "episode.language_instruction", absent_fields: absent,
      sensor_alignment: "Asynchronous client-reported traces; no video-frame alignment established." },
    episodes: manifest.samples.map((sample, episodeIndex) => ({ ...sample,
      ...episodeMetadata(manifest, sample, episodeIndex), episode_id: `${manifest.orderId}:${sample.submissionId}`,
      video: { key: videoKey, url: sample.media?.url ?? null }, sensor_features: sensorFeatures(sample),
      steps: [], steps_status: "not_materialized",
    })) };
}
