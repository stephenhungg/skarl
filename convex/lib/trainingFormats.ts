/** Metadata adapters for licensed human video, not robot teleoperation datasets.
 * LeRobot v2 uses info/episode/task metadata plus per-frame Parquet and videos.
 * RLDS uses nested episodes/steps. These manifests describe conversion inputs;
 * they do not invent decoded frames, robot controls or rewards. V2 sensor grids
 * are explicitly approximate and preserve missing data.
 */
import type { AnnotationFile } from "./derivedAnnotations";

export interface TrainingTrace {
  version: number; durationMs: number; videoStartOffsetMs?: number | null; videoStopOffsetMs?: number | null;
  syncSource?: string; syncAccuracy?: string; sensors: string[];
  samples: { sensor: string; timestampMs: number; x: number; y: number; z: number }[];
  segments?: { label: string; startMs: number; endMs: number }[];
  context?: unknown; device?: unknown;
}
export interface TrainingInputs { trace: TrainingTrace | null; hands: AnnotationFile | null; status: string }
export interface TrainingSample {
  submissionId: string;
  durationMs?: number | null;
  task?: { id: string; languageInstruction?: string };
  transcriptSegments?: { text: string }[];
  trainingInputs?: TrainingInputs;
  media?: { url: string; fps?: number | null; frameCount?: number | null; clientReportedFps?: number | null };
  sensorTrace?: { rawTraceExists: boolean; sensors: string[]; sampleRateHz: number; rawTraceDownload?: null; device?: unknown; context?: unknown;
    segments?: { label: string; startMs: number; endMs: number }[] } | null;
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
  reason: "Human demonstration video; no robot controls, joint states, rewards or discounts were recorded. An advisory image-space hand action proxy may be present; it is not a robot control." } as const;
const videoKey = "observation.images.video";
const sensorColumns: Record<string, { key: string; names: string[]; units: string }> = {
  accelerometer: { key: "observation.imu.accelerometer", names: ["x", "y", "z"], units: "g" },
  gyroscope: { key: "observation.imu.gyroscope", names: ["x", "y", "z"], units: "rad/s" },
  deviceMotion: { key: "observation.imu.linear_acceleration", names: ["x", "y", "z"], units: "m/s^2" },
  gravity: { key: "observation.imu.gravity", names: ["x", "y", "z"], units: "m/s^2" },
  attitude: { key: "observation.orientation", names: ["alpha", "beta", "gamma"], units: "rad" },
  magnetometer: { key: "observation.imu.magnetometer", names: ["x", "y", "z"], units: "µT" },
};

function publicSample<T extends TrainingSample>(sample: T) {
  const { trainingInputs: _inputs, ...publicFields } = sample;
  return publicFields;
}

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
    language_instruction: [sample.task?.languageInstruction ?? manifest.task?.languageInstruction,
      sample.transcriptSegments?.map(segment => segment.text).join(" ").trim()].filter(Boolean).join("\n\n") || null,
    // Only datasets.forOrder's licensed accepted samples enter these adapters.
    success: true, success_source: "stored_acceptance_decision" as const,
    fps, fps_source: fps === null ? "unknown" : "verified_media_metadata",
    client_reported_fps: sample.media?.clientReportedFps ?? null,
    length: frameCount !== null && Number.isInteger(frameCount) ? frameCount : null,
    length_unit: "video_frames" as const, length_source: frameCount !== null && Number.isInteger(frameCount)
      ? "verified_media_metadata" : "unknown_frame_count",
    duration_ms: sample.durationMs ?? null, absent_fields: absent };
}

/** Resample only nearby observations, never extrapolate through unavailable channels or long gaps.
 * The grid is nominal video time; client file FPS and callback-based sync are explicitly approximate.
 */
export function trainingFrames(sample: TrainingSample) {
  const trace = sample.trainingInputs?.trace;
  const fps = positive(sample.media?.fps) ?? positive(sample.media?.clientReportedFps);
  const offset = trace?.videoStartOffsetMs;
  const durationMs = positive(sample.durationMs);
  const canAlignImu = !!trace && trace.version >= 2 && typeof offset === "number" && Number.isFinite(offset);
  const channels = canAlignImu ? trace!.sensors.filter(name => sensorColumns[name]) : [];
  const stateNames = channels.flatMap(name => sensorColumns[name]!.names.map(axis => `${name}.${axis}`));
  const units = channels.flatMap(name => sensorColumns[name]!.names.map(() => sensorColumns[name]!.units));
  const hands = sample.trainingInputs?.hands;
  const base = { state_names: stateNames, state_units: units, camera: trace?.device ?? sample.sensorTrace?.device ?? null,
    context: trace?.context ?? sample.sensorTrace?.context ?? null, segments: trace?.segments ?? sample.sensorTrace?.segments ?? [],
    sync: trace ? { videoStartOffsetMs: offset ?? null, videoStopOffsetMs: trace.videoStopOffsetMs ?? null,
      source: trace.syncSource ?? "legacy_unaligned", accuracy: trace.syncAccuracy ?? "unknown" } : null,
    action_proxy: hands ? { kind: "hand_keypoints", advisory: true, derived: true, model: hands.model,
      sample_fps: hands.sampleFps, keyframes: hands.frames.map(frame => ({ timestamp_ms: frame.tMs, hands: frame.hands ?? [] })), coordinate_system: "normalized_image_xyz", robot_control: false } : null,
    grid: { fps, source: positive(sample.media?.fps) ? "verified_media_metadata" : fps ? "client_reported_file_metadata" : "unavailable",
      native_frame_timestamps: false, resampling: "nearest_sample_within_100ms", max_gap_ms: 100 } };
  if (!fps || fps > 240 || !durationMs || durationMs > 31_000 || (!canAlignImu && !hands)) return { ...base, frames: [], status: "unavailable_sync_or_fps" };
  const byChannel = new Map(channels.map(name => [name, trace!.samples.filter(row => row.sensor === name)]));
  const cursors = new Map<string, number>();
  let handCursor = 0;
  const frames = Array.from({ length: Math.ceil(durationMs * fps / 1000) }, (_, frameIndex) => {
    const timestampMs = frameIndex * 1000 / fps, sensorTime = timestampMs + (offset ?? 0);
    const state = channels.flatMap(name => {
      const samples = byChannel.get(name)!;
      let index = cursors.get(name) ?? 0;
      while (index + 1 < samples.length && Math.abs(samples[index + 1]!.timestampMs - sensorTime) < Math.abs(samples[index]!.timestampMs - sensorTime)) index++;
      cursors.set(name, index);
      const value = samples[index];
      return value && Math.abs(value.timestampMs - sensorTime) <= 100 &&
        (trace?.videoStopOffsetMs == null || sensorTime <= trace.videoStopOffsetMs)
        ? [value.x, value.y, value.z] : [null, null, null];
    });
    const annotations = hands?.frames ?? [];
    while (handCursor + 1 < annotations.length && Math.abs(annotations[handCursor + 1]!.tMs - timestampMs) < Math.abs(annotations[handCursor]!.tMs - timestampMs)) handCursor++;
    const handFrame = annotations[handCursor];
    const action = hands && handFrame && Math.abs(handFrame.tMs - timestampMs) <= Math.min(250, 500 / hands.sampleFps)
      ? { kind: "hand_keypoints" as const, advisory: true as const, hands: handFrame.hands ?? [], source_timestamp_ms: handFrame.tMs } : null;
    return { frame_index: frameIndex, timestamp: timestampMs / 1000, "observation.state": state,
      ...(hands ? { action } : {}) };
  });
  return { ...base, frames, status: "nominal_frame_grid" };
}

/** A LeRobot-v2-style episode manifest, not a directly loadable Parquet archive. */
export function lerobotManifest<T extends TrainingManifest>(manifest: T) {
  const episodes = manifest.samples.map((sample, episodeIndex) => ({ ...publicSample(sample),
    ...episodeMetadata(manifest, sample, episodeIndex),
    ...trainingFrames(sample),
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
  if (episodes.some(episode => episode.frames.length)) features["observation.state"] = { dtype: "float64", shape: null,
    names: null, nullable: true, metadata_scope: "episode.state_names/state_units", source: "clientReported" };
  if (episodes.some(episode => episode.action_proxy)) features.action = { dtype: "advisory_hand_keypoints", robot_control: false, advisory: true };
  const lengthsKnown = episodes.every(episode => episode.length !== null);
  return { schema: "skarl.lerobot-v2-manifest.v1" as const, orderId: manifest.orderId, generatedAt: manifest.generatedAt,
    compatibility: { target: "LeRobot v2", directly_loadable: false,
      reason: "Metadata and private video references only. Decode media, verify FPS/dimensions/frame counts, and write per-frame Parquet before LeRobot loading. Sensor grids use explicit sync and file FPS when available; native frame timestamps remain unverified." },
    info: { codebase_version: "v2.1", robot_type: "human_video", total_episodes: episodes.length,
      total_frames: lengthsKnown ? episodes.reduce((sum, episode) => sum + episode.length!, 0) : null,
      total_tasks: manifest.task ? 1 : 0, fps: rates.length === 1 ? rates[0] : null,
      fps_source: rates.length === 1 && rates[0] !== null ? "verified_media_metadata" : "unknown_or_mixed",
      features, absent_fields: absent,
      sensor_features_scope: "Union of available raw-trace channels; consult each episode.sensor_features for presence and state_names for materialized state order." },
    tasks: manifest.task ? [{ task_index: 0, task: manifest.task.languageInstruction ?? null, task_id: manifest.task.id }] : [],
    episodes };
}

/** RLDS-style JSON conversion metadata; no fabricated frame/transition records. */
export function rldsJsonManifest<T extends TrainingManifest>(manifest: T) {
  return { schema: "skarl.rlds-json.v1" as const, orderId: manifest.orderId, generatedAt: manifest.generatedAt,
    compatibility: { target: "RLDS", directly_loadable: false,
      reason: "JSON temporal references, not TFDS or decoded video. Robot controls, rewards and discounts are absent; saved image-space hand proxies are advisory. Acceptance success is not an environment terminal signal." },
    step_metadata: { materialized: false, materialization_scope: "Video pixels are not decoded; episode.steps may contain temporal references, real resampled state and advisory hand proxies.", required_fields: ["is_first", "is_last"],
      observation: { video_key: videoKey, source: "episode.video.url", frame_timestamp_unit: "seconds" },
      language_instruction: "episode.language_instruction", absent_fields: absent,
      sensor_alignment: "Episode grid and sync describe approximate nominal-frame resampling; native frame PTS are not recorded." },
    episodes: manifest.samples.map((sample, episodeIndex) => {
      const { frames, ...training } = trainingFrames(sample);
      return ({ ...publicSample(sample),
      ...episodeMetadata(manifest, sample, episodeIndex), episode_id: `${manifest.orderId}:${sample.submissionId}`,
      video: { key: videoKey, url: sample.media?.url ?? null }, sensor_features: sensorFeatures(sample),
      ...training,
      steps: frames.map((frame, index) => ({ is_first: index === 0, is_last: index === frames.length - 1,
        timestamp: frame.timestamp, observation: { state: frame["observation.state"], video: { url: sample.media?.url ?? null, timestamp: frame.timestamp } },
        ...(training.action_proxy ? { action: frame.action } : {}) })),
      steps_status: frames.length ? "temporal_references_not_decoded" : "not_materialized",
    }); }) };
}
