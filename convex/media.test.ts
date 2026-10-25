// @vitest-environment node
import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { chmod, copyFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { frameDHash, prepareMedia } from "./lib/media";

// Observe the permission workaround while still performing real file copies,
// chmod calls and FFmpeg execution. No installed dependency is modified.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, copyFile: vi.fn(actual.copyFile), chmod: vi.fn(actual.chmod), mkdtemp: vi.fn(actual.mkdtemp) };
});

const execute = promisify(execFile);
let directory: string;
let narrated: Buffer;
let silent: Buffer;
let unknownDuration: Buffer;

async function ffmpeg(args: string[]) {
  if (!ffmpegPath) throw new Error("ffmpeg-static binary is unavailable");
  return await execute(ffmpegPath, ["-hide_banner", "-nostdin", "-v", "error", "-threads", "1", ...args], {
    timeout: 20_000, maxBuffer: 512 * 1024, encoding: "buffer",
  });
}

async function metadata(bytes: Uint8Array, name: string) {
  const path = join(directory, name);
  await writeFile(path, bytes);
  if (!ffmpegPath) throw new Error("ffmpeg-static binary is unavailable");
  try {
    await execute(ffmpegPath, ["-hide_banner", "-nostdin", "-i", path], { encoding: "utf8" });
  } catch (error) {
    return (error as { stderr: string }).stderr;
  }
  throw new Error("expected input-only probe to exit without an output");
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "skarl-media-test-"));
  const narratedPath = join(directory, "narrated.mp4");
  const silentPath = join(directory, "silent.webm");
  await ffmpeg([
    "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=12:duration=2,negate=enable='gte(t,1)'",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2",
    "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-preset", "ultrafast", "-threads", "1",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-y", narratedPath,
  ]);
  await ffmpeg([
    "-f", "lavfi", "-i", "testsrc2=size=160x120:rate=12:duration=1",
    "-c:v", "libvpx", "-threads", "1", "-an", "-y", silentPath,
  ]);
  narrated = await readFile(narratedPath);
  silent = await readFile(silentPath);
  // Streaming WebM (as in MediaRecorder) has no seekable duration header.
  unknownDuration = (await ffmpeg([
    "-f", "lavfi", "-i", "testsrc2=size=160x120:rate=12:duration=1.5",
    "-c:v", "libvpx", "-threads", "1", "-an", "-f", "webm", "pipe:1",
  ])).stdout;
}, 30_000);

afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

describe("frame dHash", () => {
  it("encodes exactly 64 horizontal comparisons in row-major order", () => {
    const descending = Uint8Array.from({ length: 72 }, (_, index) => 255 - (index % 9));
    const ascending = Uint8Array.from({ length: 72 }, (_, index) => index % 9);
    const single = new Uint8Array(72);
    single[0] = 1;
    expect(frameDHash(descending)).toBe("ffffffffffffffff");
    expect(frameDHash(ascending)).toBe("0000000000000000");
    expect(frameDHash(single)).toBe("8000000000000000");
    expect(() => frameDHash(new Uint8Array(71))).toThrow("invalid_fingerprint_frame");
  });
});

describe("actual bounded FFmpeg preprocessing", () => {
  it("runs concurrent requests with separate executable copies and removes both", async () => {
    const firstCall = vi.mocked(copyFile).mock.calls.length;
    const results = await Promise.all([prepareMedia(silent, "video/webm"), prepareMedia(silent, "video/webm")]);
    expect(results[0].perceptualHash).toBe(results[1].perceptualHash);
    const copies = vi.mocked(copyFile).mock.calls.slice(firstCall);
    expect(copies).toHaveLength(2);
    expect(copies[0]![1]).not.toBe(copies[1]![1]);
    for (const [source, destination] of copies) {
      expect(source).toBe(ffmpegPath);
      expect(String(destination)).toMatch(/skarl-media-[^/]+\/ffmpeg$/);
      expect(vi.mocked(chmod)).toHaveBeenCalledWith(destination, 0o700);
      await expect(stat(destination)).rejects.toMatchObject({ code: "ENOENT" });
    }
  }, 30_000);

  it("strips video audio, extracts mono 16k PCM and samples six real frames", async () => {
    const result = await prepareMedia(narrated, "video/mp4");
    const video = await metadata(result.silentVideo, "prepared.mp4");
    const audio = await metadata(result.audio!, "prepared.wav");
    expect(video).toMatch(/Video: h264/);
    expect(video).toMatch(/480x270/);
    expect(video).toMatch(/6 fps/);
    expect(video).not.toMatch(/Audio:/);
    expect(audio).toMatch(/Audio: pcm_s16le.*16000 Hz, (?:mono|1 channels)/);
    expect(result.durationMs).toBe(2000);
    expect(result.silentVideo.byteLength).toBeLessThanOrEqual(12 * 1024 * 1024);
    expect(result.audio!.byteLength).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(result.warnings).toEqual([]);
    expect(result.videoFrames).toHaveLength(12);
    const timestamps = result.videoFrames.map((frame) => frame.timestampMs);
    expect(timestamps).toEqual(Array.from({ length: 12 }, (_, index) => Math.round((index + 0.5) / 12 * result.durationMs)));
    expect([...timestamps].sort((a, b) => a - b)).toEqual(timestamps);
    for (const frame of result.videoFrames) {
      expect(frame.mimeType).toBe("image/jpeg");
      expect(frame.bytes.byteLength).toBeLessThanOrEqual(100 * 1024);
      expect([...frame.bytes.subarray(0, 2)]).toEqual([0xff, 0xd8]);
      expect([...frame.bytes.subarray(-2)]).toEqual([0xff, 0xd9]);
      expect(frame.timestampMs).toBeGreaterThan(0);
      expect(frame.timestampMs).toBeLessThanOrEqual(result.durationMs);
    }
    expect(new Set(result.videoFrames.map((frame) => Buffer.from(frame.bytes).toString("base64"))).size).toBeGreaterThan(1);
    expect(result.frameDHashes).toHaveLength(6);
    expect(result.perceptualHash).toMatch(/^[0-9a-f]{96}$/);
    expect(new Set(result.frameDHashes.map((frame) => frame.hash)).size).toBeGreaterThan(1);
    for (const frame of result.frameDHashes) {
      expect(frame.hash).toMatch(/^[0-9a-f]{16}$/);
      expect(frame.timestampMs).toBeGreaterThan(0);
      expect(frame.timestampMs).toBeLessThanOrEqual(result.durationMs);
    }
  }, 30_000);

  it("returns no invented audio when the source has no audio stream", async () => {
    const originalBytes = Buffer.from(silent);
    const result = await prepareMedia(silent, "video/webm;codecs=vp8");
    expect(result.audio).toBeNull();
    expect(result.warnings).toEqual(["audio_stream_missing"]);
    expect(result.durationMs).toBe(1000);
    expect(result.videoFrames).toHaveLength(12);
    expect(silent).toEqual(originalBytes);
  }, 30_000);

  it("measures streaming WebM duration without relying on container metadata", async () => {
    expect(await metadata(unknownDuration, "stream.webm")).toMatch(/Duration: N\/A/);
    const result = await prepareMedia(unknownDuration, "video/webm");
    expect(result.durationMs).toBe(1500);
    expect(result.frameDHashes).toHaveLength(6);
  }, 30_000);

  it("keeps a deterministic ordered fingerprint across a benign MP4 re-encode", async () => {
    const reencodedPath = join(directory, "reencoded.mp4");
    await ffmpeg(["-i", join(directory, "narrated.mp4"), "-c:v", "libx264", "-crf", "18", "-threads", "1", "-c:a", "aac", "-y", reencodedPath]);
    const original = await prepareMedia(narrated, "video/mp4");
    const reencoded = await prepareMedia(await readFile(reencodedPath), "video/mp4");
    const repeat = await prepareMedia(narrated, "video/mp4");
    expect(repeat.perceptualHash).toBe(original.perceptualHash);
    const distance = [...original.perceptualHash].reduce((count, digit, index) => {
      const xor = Number.parseInt(digit, 16) ^ Number.parseInt(reencoded.perceptualHash[index]!, 16);
      return count + xor.toString(2).replaceAll("0", "").length;
    }, 0);
    // A measured candidate signal. Equality is deliberately not assumed.
    expect(distance).toBeLessThanOrEqual(20);
  }, 30_000);

  it("rejects oversized, unsupported, empty and malformed input", async () => {
    await expect(prepareMedia(new Uint8Array(25 * 1024 * 1024 + 1), "video/mp4")).rejects.toThrow("media_input_size_exceeded");
    await expect(prepareMedia(narrated, "application/json")).rejects.toThrow("unsupported_media_type");
    await expect(prepareMedia(new Uint8Array(), "video/mp4")).rejects.toThrow("empty_media");
    const cleanupDirectory = await mkdtemp(join(directory, "failed-input-"));
    vi.mocked(mkdtemp).mockResolvedValueOnce(cleanupDirectory);
    await expect(prepareMedia(new Uint8Array([1, 2, 3]), "video/mp4")).rejects.toThrow("missing_video_stream");
    // Other checkouts may preprocess clips concurrently in the same OS temp root.
    // Give this invocation its own real directory and assert only its cleanup.
    await expect(stat(cleanupDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects overlong video even when streaming metadata has no duration", async () => {
    const overlong = (await ffmpeg([
      "-f", "lavfi", "-i", "color=c=red:size=32x32:rate=10:duration=30.5",
      "-c:v", "libvpx", "-threads", "1", "-f", "webm", "pipe:1",
    ])).stdout;
    await expect(prepareMedia(overlong, "video/webm")).rejects.toThrow("media_duration_exceeded");
  }, 30_000);

  it("rejects a substantially longer audio stream instead of silently cutting it to the video", async () => {
    const mismatched = (await ffmpeg([
      "-f", "lavfi", "-i", "color=c=red:size=32x32:rate=10:duration=1",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
      "-c:v", "libvpx", "-threads", "1", "-c:a", "libopus", "-f", "webm", "pipe:1",
    ])).stdout;
    await expect(prepareMedia(mismatched, "video/webm")).rejects.toThrow("audio_video_duration_mismatch");
  }, 30_000);

  it("refuses a network playlist disguised as a browser video", async () => {
    const playlist = Buffer.from("#EXTM3U\n#EXTINF:1,\nhttps://example.invalid/secret.ts\n#EXT-X-ENDLIST\n");
    await expect(prepareMedia(playlist, "video/mp4")).rejects.toThrow("missing_video_stream");
  });

  it("rejects excessive dimensions before decoding the full clip", async () => {
    const path = join(directory, "wide.mp4");
    await ffmpeg([
      "-f", "lavfi", "-i", "color=c=red:size=4100x2:rate=1:duration=1",
      "-c:v", "libx264", "-threads", "1", "-y", path,
    ]);
    await expect(prepareMedia(await readFile(path), "video/mp4")).rejects.toThrow("media_dimensions_exceeded");
  }, 30_000);
});
