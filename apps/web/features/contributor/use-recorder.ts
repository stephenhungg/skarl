"use client";
import { webConfig } from "../../lib/config";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LivenessChallenge } from "./api";
import {
  MAX_BYTES, MAX_SECONDS, VIDEO_BITS_PER_SECOND, classifyGetUserMediaError, pickMimeType, preflight,
  type MediaFailure,
} from "./media";

export type Clip = { blob: Blob; url: string; mimeType: string; durationMs: number; sizeBytes: number; clientRequestId: string;
  livenessChallengeId?: string; livenessExpiresAt?: number };

export type RecorderState =
  | { phase: "idle" }
  | { phase: "requesting" }
  | { phase: "ready" }
  | { phase: "recording"; startedAt: number }
  | { phase: "recorded"; clip: Clip }
  | { phase: "error"; failure: MediaFailure; retryable: boolean };

const CONSTRAINTS: MediaStreamConstraints = {
  video: { width: { ideal: webConfig.captureWidth }, height: { ideal: webConfig.captureHeight }, frameRate: { ideal: webConfig.captureFrameRate, max: webConfig.captureFrameRate } },
  audio: { echoCancellation: true, noiseSuppression: true },
};

function newRequestId() {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Camera + mic preview and a bounded MediaRecorder capture. Auto-stops at MAX_SECONDS.
 * `elapsedMs` ticks while recording; the clip's duration is wall-clock, not a media clock.
 */
export function useRecorder() {
  const [state, setState] = useState<RecorderState>({ phase: "idle" });
  const [elapsedMs, setElapsedMs] = useState(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const clipUrlRef = useRef<string | null>(null);
  const tickRef = useRef<number | null>(null);

  const stopTicker = () => {
    if (tickRef.current !== null) cancelAnimationFrame(tickRef.current);
    tickRef.current = null;
  };

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  const revokeClip = () => {
    if (clipUrlRef.current) URL.revokeObjectURL(clipUrlRef.current);
    clipUrlRef.current = null;
  };

  const start = useCallback(async () => {
    const blocked = preflight();
    if (blocked) {
      setState({ phase: "error", failure: blocked, retryable: false });
      return;
    }
    setState({ phase: "requesting" });
    try {
      const media = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
      if (!media.getVideoTracks().length || !media.getAudioTracks().length) {
        media.getTracks().forEach(track => track.stop());
        setState({ phase: "error", failure: { kind: "no_device" }, retryable: true });
        return;
      }
      streamRef.current = media;
      setStream(media);
      // A track can end on its own (device unplugged, permission revoked mid-session).
      media.getTracks().forEach(track => track.addEventListener("ended", () => {
        if (recorderRef.current?.state === "recording") recorderRef.current.stop();
        releaseStream();
        setState(current => current.phase === "recorded" ? current : { phase: "error", failure: { kind: "device_in_use", detail: "track ended" }, retryable: true });
      }));
      setState({ phase: "ready" });
    } catch (error) {
      const failure = classifyGetUserMediaError(error);
      setState({ phase: "error", failure, retryable: true });
    }
  }, [releaseStream]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  const record = useCallback((challenge?: LivenessChallenge) => {
    const media = streamRef.current;
    if (!media) return;
    const mimeType = pickMimeType();
    if (mimeType === null) {
      setState({ phase: "error", failure: { kind: "unsupported_codec" }, retryable: false });
      return;
    }
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(media, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: VIDEO_BITS_PER_SECOND });
    } catch (error) {
      setState({ phase: "error", failure: { kind: "unsupported_codec", detail: error instanceof Error ? error.message : String(error) }, retryable: false });
      return;
    }
    const chunks: Blob[] = [];
    const startedAt = performance.now();
    let failed = false;
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => { failed = true; };
    recorder.onstop = () => {
      stopTicker();
      const durationMs = Math.min(performance.now() - startedAt, MAX_SECONDS * 1000);
      setElapsedMs(durationMs);
      recorderRef.current = null;
      if (failed || !chunks.length) {
        setState({ phase: "error", failure: { kind: "recorder_failed" }, retryable: true });
        return;
      }
      const type = recorder.mimeType || mimeType || chunks[0].type || "video/webm";
      const blob = new Blob(chunks, { type });
      if (blob.size > MAX_BYTES) {
        setState({ phase: "error", failure: { kind: "too_large" }, retryable: true });
        return;
      }
      revokeClip();
      const url = URL.createObjectURL(blob);
      clipUrlRef.current = url;
      // The camera stays off during review; retake asks again, which also re-checks the device.
      releaseStream();
      setState({ phase: "recorded", clip: { blob, url, mimeType: type, durationMs, sizeBytes: blob.size, clientRequestId: newRequestId(),
        ...(challenge ? { livenessChallengeId: challenge.challengeId, livenessExpiresAt: challenge.expiresAt } : {}) } });
    };
    recorderRef.current = recorder;
    recorder.start(1000);
    setElapsedMs(0);
    setState({ phase: "recording", startedAt });
    const tick = () => {
      const elapsed = performance.now() - startedAt;
      setElapsedMs(Math.min(elapsed, MAX_SECONDS * 1000));
      if (elapsed >= MAX_SECONDS * 1000) {
        if (recorder.state === "recording") recorder.stop();
        return;
      }
      tickRef.current = requestAnimationFrame(tick);
    };
    tickRef.current = requestAnimationFrame(tick);
  }, [releaseStream]);

  /** Discard the clip (or a failed attempt) and reopen the camera. */
  const retake = useCallback(async () => {
    stopTicker();
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
      recorderRef.current = null;
    }
    revokeClip();
    setElapsedMs(0);
    if (streamRef.current) setState({ phase: "ready" });
    else await start();
  }, [start]);

  useEffect(() => () => {
    stopTicker();
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach(track => track.stop());
    revokeClip();
  }, []);

  return { state, stream, elapsedMs, start, record, stop, retake };
}
