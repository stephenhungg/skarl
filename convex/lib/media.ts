/// <reference types="node" />
"use node";
import { configNumber } from "./config.ts";


import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { chmod, copyFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";

const MAX_INPUT_BYTES = configNumber("SKARL_MEDIA_MAX_INPUT_BYTES");
const MAX_VIDEO_BYTES = configNumber("SKARL_MEDIA_MAX_VIDEO_BYTES");
const MAX_AUDIO_BYTES = configNumber("SKARL_MEDIA_MAX_AUDIO_BYTES");
const MAX_DURATION_MS = configNumber("SKARL_MEDIA_MAX_DURATION_MS");
const MAX_BINARY_BYTES = configNumber("SKARL_MEDIA_MAX_BINARY_BYTES");
const FRAME_BYTES = 9 * 8;
const FRAME_SAMPLES = configNumber("SKARL_MEDIA_FRAME_SAMPLES");
const VISUAL_SAMPLES = configNumber("SKARL_MEDIA_VISUAL_SAMPLES");
const MAX_JPEG_BYTES = configNumber("SKARL_MEDIA_MAX_JPEG_BYTES");
const FFMPEG_TIMEOUT_MS = configNumber("SKARL_MEDIA_FFMPEG_TIMEOUT_MS");

export interface PreparedMedia {
  silentVideo: Uint8Array;
  audio: Uint8Array | null;
  durationMs: number;
  /** Original-clip seek targets; decoded image timing is approximate within one source frame. */
  videoFrames: { timestampMs: number; bytes: Uint8Array; mimeType: "image/jpeg" }[];
  frameDHashes: { timestampMs: number; hash: string }[];
  /** JPEGs of the exact decoded silent-video frames used for dHash, not nearby visual samples. */
  hashFrames: { timestampMs: number; bytes: Uint8Array; mimeType: "image/jpeg"; frameIndex: number; sampleIndex: number }[];
  /** Six ordered 64-bit frame dHashes, not a cryptographic content hash. */
  perceptualHash: string;
  warnings: string[];
}

/** No subprocess stderr, source filename or temporary path escapes this boundary. */
export class MediaPreparationError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "MediaPreparationError";
  }
}

function createFfmpegRunner(executable: string) {
  return async (args: string[], options: { probe?: boolean; maxBuffer?: number } = {}) => await new Promise<{ stdout: Buffer; stderr: string }>((resolve, reject) => {
    execFile(executable, ["-hide_banner", "-nostdin", "-filter_threads", "1", "-filter_complex_threads", "1", ...args], {
      encoding: "buffer", timeout: FFMPEG_TIMEOUT_MS, killSignal: "SIGKILL",
      maxBuffer: options.maxBuffer ?? 256 * 1024,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      // An input-only probe normally exits 1 because no output was requested.
      if (error && !(options.probe && error.code === 1 && !error.killed)) {
        reject(new MediaPreparationError(error.killed ? "media_processing_timeout" : "media_processing_failed"));
        return;
      }
      resolve({ stdout, stderr: stderr.toString("utf8") });
    });
  });
}

/** Horizontal gradient dHash over an exact 9x8, row-major grayscale frame. */
export function frameDHash(frame: Uint8Array): string {
  if (frame.length !== FRAME_BYTES) throw new MediaPreparationError("invalid_fingerprint_frame");
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits = (bits << 1n) | (frame[y * 9 + x]! > frame[y * 9 + x + 1]! ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, "0");
}

function audioDurationMs(wav: Buffer): number {
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new MediaPreparationError("invalid_audio_output");
  }
  let validFormat = false;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const name = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > wav.length) throw new MediaPreparationError("invalid_audio_output");
    if (name === "fmt " && size >= 16) {
      validFormat = wav.readUInt16LE(start) === 1 && wav.readUInt16LE(start + 2) === 1
        && wav.readUInt32LE(start + 4) === 16_000 && wav.readUInt16LE(start + 14) === 16;
    }
    if (name === "data") {
      if (!validFormat || size === 0 || size % 2 !== 0) throw new MediaPreparationError("invalid_audio_output");
      return size / 32;
    }
    offset = start + size + (size % 2);
  }
  throw new MediaPreparationError("invalid_audio_output");
}

async function readBounded(path: string, limit: number): Promise<Buffer> {
  const info = await stat(path);
  if (!info.isFile() || info.size <= 0 || info.size > limit) throw new MediaPreparationError("media_output_size_exceeded");
  return await readFile(path);
}

/** Bounded Node action preprocessing. The original upload must remain privately stored. */
export async function prepareMedia(bytes: Uint8Array, mimeType: string): Promise<PreparedMedia> {
  if (bytes.byteLength === 0) throw new MediaPreparationError("empty_media");
  if (bytes.byteLength > MAX_INPUT_BYTES) throw new MediaPreparationError("media_input_size_exceeded");
  if (!["video/webm", "video/mp4", "video/quicktime", "video/ogg", "video/x-matroska"].includes(mimeType.split(";")[0]!.trim().toLowerCase())) {
    throw new MediaPreparationError("unsupported_media_type");
  }
  const declaredMime = mimeType.split(";")[0]!.trim().toLowerCase();
  const inputFormat = declaredMime === "video/mp4" || declaredMime === "video/quicktime" ? "mov"
    : declaredMime === "video/ogg" ? "ogg" : "matroska";
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), "skarl-media-"));
    if (!ffmpegPath) throw new MediaPreparationError("ffmpeg_unavailable");
    const binaryInfo = await stat(ffmpegPath);
    if (!binaryInfo.isFile() || binaryInfo.size <= 0 || binaryInfo.size > MAX_BINARY_BYTES) {
      throw new MediaPreparationError("ffmpeg_unavailable");
    }
    // External-package artifacts may lose executable permissions. The package
    // path is read-only: use a private, bounded copy scoped to this invocation.
    const executable = join(directory, "ffmpeg");
    await copyFile(ffmpegPath, executable);
    await chmod(executable, 0o700);
    const runFfmpeg = createFfmpegRunner(executable);
    const input = join(directory, "input");
    const videoPath = join(directory, "silent.mp4");
    const audioPath = join(directory, "audio.wav");
    await writeFile(input, bytes);
    // Force a media demuxer: an uploaded playlist must not become an arbitrary
    // network/local-file fetch. Never permit HTTP/TCP input protocols.
    const source = ["-protocol_whitelist", "file,pipe", "-f", inputFormat, "-i", input];
    const probe = await runFfmpeg(source, { probe: true });
    const videoLine = probe.stderr.split("\n").find((line) => /Stream #0:\d.*Video:/.test(line));
    const dimensions = videoLine?.match(/(?:^|,\s)(\d{1,5})x(\d{1,5})(?=[\s,])/);
    if (!dimensions) throw new MediaPreparationError("missing_video_stream");
    const width = Number(dimensions[1]);
    const height = Number(dimensions[2]);
    if (width < 2 || height < 2 || width > 4096 || height > 4096 || width * height > 3840 * 2160) {
      throw new MediaPreparationError("media_dimensions_exceeded");
    }
    const declaredDuration = probe.stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (declaredDuration) {
      const milliseconds = (Number(declaredDuration[1]) * 3600 + Number(declaredDuration[2]) * 60 + Number(declaredDuration[3])) * 1000;
      if (milliseconds > MAX_DURATION_MS + 1) throw new MediaPreparationError("media_duration_exceeded");
    }
    const hasAudio = /Stream #0:\d.*Audio:/.test(probe.stderr);
    // Browser WebM often has Duration: N/A. Decode through a 30.2s sentinel;
    // never infer duration from a transcode that was silently cut at 30s.
    const scan = await runFfmpeg([
      "-v", "info", "-xerror", "-threads", "1", ...source,
      "-map", "0:v:0", "-an", "-sn", "-dn", "-t", "30.2",
      "-vf", "showinfo=checksum=0", "-fps_mode", "passthrough", "-nostats", "-f", "null", "-",
    ], { maxBuffer: 2 * 1024 * 1024 });
    // Progress out_time omits the last frame's display duration. showinfo
    // exposes decoded timestamps and durations, including variable-rate WebM.
    const decodedFrames = [...scan.stderr.matchAll(/pts_time:([\d.e+-]+)\s+duration:\s*\d+\s+duration_time:([\d.e+-]+)/g)]
      .map((match) => ({ startMs: Number(match[1]) * 1000, durationMs: Number(match[2]) * 1000 }));
    const times = decodedFrames.map((frame) => frame.startMs + frame.durationMs);
    const durationMs = Math.round(Math.max(0, ...times));
    if (!Number.isFinite(durationMs) || durationMs <= 0) throw new MediaPreparationError("invalid_media_duration");
    if (durationMs > MAX_DURATION_MS + 1) throw new MediaPreparationError("media_duration_exceeded");

    const common = ["-v", "error", "-xerror", "-threads", "1", ...source];
    await runFfmpeg([
      ...common, "-map", "0:v:0", "-an", "-sn", "-dn", "-map_metadata", "-1", "-map_chapters", "-1",
      "-vf", "scale=w='min(480,iw)':h='min(480,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,fps=6",
      "-t", "30.2", "-c:v", "libx264", "-threads", "1", "-preset", "ultrafast", "-crf", "25",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-fs", String(MAX_VIDEO_BYTES + 1), "-y", videoPath,
    ]);
    const silentVideo = await readBounded(videoPath, MAX_VIDEO_BYTES);
    let audio: Buffer | null = null;
    if (hasAudio) {
      await runFfmpeg([
        ...common, "-map", "0:a:0", "-vn", "-sn", "-dn", "-map_metadata", "-1", "-t", "30.2",
        "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-fs", String(MAX_AUDIO_BYTES + 1), "-y", audioPath,
      ]);
      audio = await readBounded(audioPath, MAX_AUDIO_BYTES);
      const audioMs = audioDurationMs(audio);
      if (audioMs > MAX_DURATION_MS + 1) throw new MediaPreparationError("media_duration_exceeded");
      if (audioMs > durationMs + 500) throw new MediaPreparationError("audio_video_duration_mismatch");
    }

    const videoFrames: PreparedMedia["videoFrames"] = [];
    for (let index = 0; index < VISUAL_SAMPLES; index++) {
      const timestampMs = Math.max(1, Math.min(durationMs, Math.round((index + 0.5) / VISUAL_SAMPLES * durationMs)));
      const extract = async (seekMs: number) => await runFfmpeg([
        "-v", "error", "-xerror", "-threads", "1", "-ss", (seekMs / 1000).toFixed(6), ...source,
        "-map", "0:v:0", "-an", "-sn", "-dn", "-map_metadata", "-1", "-frames:v", "1",
        "-vf", "scale=w='min(320,iw)':h='min(320,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
        "-c:v", "mjpeg", "-threads", "1", "-q:v", "5", "-f", "image2pipe", "pipe:1",
      ], { maxBuffer: MAX_JPEG_BYTES });
      let jpeg = (await extract(timestampMs)).stdout;
      // Accurate seeking can discard a final frame whose presentation started
      // before the requested time. Retry from the decoded covering frame; the
      // public timestamp remains the requested original-clip observation point.
      if (jpeg.length === 0) {
        const covering = decodedFrames.slice().reverse().find((frame) => frame.startMs <= timestampMs && frame.startMs + frame.durationMs + 1 >= timestampMs);
        if (!covering) throw new MediaPreparationError("missing_visual_sample");
        jpeg = (await extract(Math.max(0, covering.startMs - 1))).stdout;
      }
      if (jpeg.length < 4 || jpeg.length > MAX_JPEG_BYTES || jpeg[0] !== 0xff || jpeg[1] !== 0xd8
        || jpeg[jpeg.length - 2] !== 0xff || jpeg[jpeg.length - 1] !== 0xd9) {
        throw new MediaPreparationError("invalid_visual_sample");
      }
      videoFrames.push({ timestampMs, bytes: jpeg, mimeType: "image/jpeg" });
    }

    // At most 182 tiny frames (~13 KB); selecting from one decode also works
    // for very short clips, where several samples legitimately share a frame.
    const raw = await runFfmpeg([
      "-v", "error", "-xerror", "-threads", "1", "-protocol_whitelist", "file,pipe", "-f", "mov", "-i", videoPath, "-map", "0:v:0", "-an",
      "-vf", "scale=9:8:flags=area,format=gray", "-fps_mode", "passthrough", "-f", "rawvideo", "pipe:1",
    ], { maxBuffer: 32 * 1024 });
    const frameCount = raw.stdout.length / FRAME_BYTES;
    if (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > 182) throw new MediaPreparationError("invalid_fingerprint_output");
    const hashFrames: PreparedMedia["hashFrames"] = [];
    const frameDHashes = Array.from({ length: FRAME_SAMPLES }, (_, index) => {
      const relative = (index + 0.5) / FRAME_SAMPLES;
      const frameIndex = Math.min(frameCount - 1, Math.floor(relative * frameCount));
      return {
        timestampMs: Math.max(1, Math.min(durationMs, Math.round(relative * durationMs))),
        hash: frameDHash(raw.stdout.subarray(frameIndex * FRAME_BYTES, (frameIndex + 1) * FRAME_BYTES)),
      };
    });
    for (let sampleIndex = 0; sampleIndex < FRAME_SAMPLES; sampleIndex++) {
      const frameIndex = Math.min(frameCount - 1, Math.floor((sampleIndex + 0.5) / FRAME_SAMPLES * frameCount));
      const jpeg = (await runFfmpeg([
        "-v", "error", "-threads", "1", "-protocol_whitelist", "file,pipe", "-f", "mov", "-i", videoPath,
        "-vf", `select=eq(n\\,${frameIndex})`, "-frames:v", "1", "-an", "-c:v", "mjpeg", "-q:v", "5", "-f", "image2pipe", "pipe:1",
      ], { maxBuffer: MAX_JPEG_BYTES })).stdout;
      if (jpeg.length < 4 || jpeg[0] !== 255 || jpeg[1] !== 216 || jpeg[jpeg.length - 2] !== 255 || jpeg[jpeg.length - 1] !== 217) throw new MediaPreparationError("invalid_fingerprint_frame_image");
      hashFrames.push({ timestampMs: frameDHashes[sampleIndex]!.timestampMs, bytes: jpeg, mimeType: "image/jpeg", frameIndex, sampleIndex });
    }
    return {
      silentVideo, audio, durationMs, videoFrames, frameDHashes, hashFrames,
      perceptualHash: frameDHashes.map((frame) => frame.hash).join(""),
      warnings: hasAudio ? [] : ["audio_stream_missing"],
    };
  } catch (error) {
    if (error instanceof MediaPreparationError) throw error;
    throw new MediaPreparationError("media_processing_failed");
  } finally {
    if (directory) {
      try { await rm(directory, { recursive: true, force: true }); }
      catch { throw new MediaPreparationError("media_cleanup_failed"); }
    }
  }
}
