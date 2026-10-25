export const MIN_SECONDS = 10;
export const MAX_SECONDS = 30;
/** Application cap from docs/deployment.md: 30 s, 720p, 25 MB. */
export const MAX_BYTES = 25 * 1024 * 1024;
export const VIDEO_BITS_PER_SECOND = 2_500_000;

// Prefer H.264 in MP4 (Safari and recent Chromium), then WebM. The recorder's actual mimeType is what we persist.
const CANDIDATES = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4;codecs=avc1,mp4a",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

export function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  if (typeof MediaRecorder.isTypeSupported !== "function") return "";
  return CANDIDATES.find(type => MediaRecorder.isTypeSupported(type)) ?? null;
}

export type MediaErrorKind =
  | "insecure_context"
  | "unsupported_browser"
  | "unsupported_codec"
  | "permission_denied"
  | "no_device"
  | "device_in_use"
  | "recorder_failed"
  | "too_large"
  | "unknown";

export type MediaFailure = { kind: MediaErrorKind; detail?: string };

export const MEDIA_ERROR_COPY: Record<MediaErrorKind, { title: string; body: string }> = {
  insecure_context: {
    title: "Camera needs a secure page",
    body: "Browsers only share the camera on HTTPS or localhost. On a phone or LAN address, run the web app with pnpm dev:https or open the deployed HTTPS site.",
  },
  unsupported_browser: {
    title: "This browser can't record here",
    body: "It doesn't offer camera capture or MediaRecorder, so try a current Chrome, Safari or Firefox.",
  },
  unsupported_codec: {
    title: "No supported recording format",
    body: "This browser can't record MP4 (H.264) or WebM, so try a current Chrome, Safari or Firefox.",
  },
  permission_denied: {
    title: "Camera or microphone access was blocked",
    body: "Allow both in the site settings next to the address bar and try again, since narration is part of the evidence and the mic is required.",
  },
  no_device: {
    title: "No camera or microphone found",
    body: "Connect a camera and a microphone, then try again.",
  },
  device_in_use: {
    title: "The camera is busy",
    body: "Another app or tab is using it, so close video calls or other recorders and try again.",
  },
  recorder_failed: {
    title: "Recording stopped unexpectedly",
    body: "The browser's recorder reported an error, so retake the clip.",
  },
  too_large: {
    title: "Clip is over 25 MB",
    body: "Retake it. Shorter clips or a steadier scene keep the file under the cap.",
  },
  unknown: {
    title: "Couldn't start the camera",
    body: "Something unexpected went wrong, so try again or reload the page.",
  },
};

export function classifyGetUserMediaError(error: unknown): MediaFailure {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  const detail = error instanceof Error ? error.message : String(error);
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return { kind: "permission_denied", detail };
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return { kind: "no_device", detail };
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return { kind: "device_in_use", detail };
    default:
      return { kind: "unknown", detail };
  }
}

/** Checks that must pass before asking for the camera at all. */
export function preflight(): MediaFailure | null {
  if (typeof window === "undefined") return null;
  if (!window.isSecureContext) return { kind: "insecure_context" };
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return { kind: "unsupported_browser" };
  if (pickMimeType() === null) return { kind: "unsupported_codec" };
  return null;
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function formatClock(ms: number, tenths = true) {
  const total = Math.max(0, ms) / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = Math.floor(total % 60);
  const base = `${minutes}:${String(seconds).padStart(2, "0")}`;
  return tenths ? `${base}.${Math.floor((total * 10) % 10)}` : base;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
