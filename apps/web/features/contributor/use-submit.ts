"use client";
import { useConvex } from "convex/react";
import { useCallback, useRef, useState } from "react";
import { DEMO_IDENTITY, refs, type CreateSubmissionResult } from "./api";
import { sha256Hex } from "./media";
import type { Clip } from "./use-recorder";

export type SubmitErrorKind = "hash_failed" | "upload_url_failed" | "upload_failed" | "upload_timeout" | "create_failed" | "refused" | "offline";

export type SubmitState =
  | { phase: "idle" }
  | { phase: "hashing" }
  | { phase: "uploading"; progress: number; sha256: string }
  | { phase: "finalizing"; sha256: string; storageId: string }
  | { phase: "queued"; sha256: string; storageId: string; submissionId: string | null; replayed: boolean }
  | { phase: "error"; kind: SubmitErrorKind; retryable: boolean; detail?: string; sha256?: string };

// Convex upload POSTs time out after two minutes server side.
const UPLOAD_TIMEOUT_MS = 120_000;

function uploadWithProgress(url: string, blob: Blob, onProgress: (fraction: number) => void) {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    // Convex storage rejects codec parameters (the comma in "avc1,mp4a"), so send the bare media type.
    xhr.setRequestHeader("Content-Type", blob.type.split(";")[0].trim() || "application/octet-stream");
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded / event.total); };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        let reason = "";
        try { reason = (JSON.parse(xhr.responseText) as { message?: string }).message ?? ""; } catch { reason = xhr.responseText.slice(0, 160); }
        return reject(Object.assign(new Error(`Storage answered ${xhr.status}${reason ? `: ${reason}` : ""}`), { kind: "upload_failed" }));
      }
      try {
        const body = JSON.parse(xhr.responseText) as { storageId?: string };
        if (!body.storageId) throw new Error("no storageId in response");
        resolve(body.storageId);
      } catch (error) {
        reject(Object.assign(error instanceof Error ? error : new Error(String(error)), { kind: "upload_failed" }));
      }
    };
    xhr.onerror = () => reject(Object.assign(new Error("Network error during upload"), { kind: navigator.onLine ? "upload_failed" : "offline" }));
    xhr.ontimeout = () => reject(Object.assign(new Error("Upload took longer than two minutes"), { kind: "upload_timeout" }));
    xhr.send(blob);
  });
}

function message(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  // Strip Convex's request-id prefix so the visible reason is the useful part.
  return text.replace(/^\[Request ID: [^\]]+\]\s*/, "").replace(/^Server Error\s*/, "").split("\n")[0].trim();
}

function normalizeCreate(result: CreateSubmissionResult): { ok: true; submissionId: string | null; replayed: boolean } | { ok: false; code: string } {
  if (typeof result === "string") return { ok: true, submissionId: result, replayed: false };
  if (result && result.ok === false) return { ok: false, code: result.code ?? "refused" };
  const id = typeof result?.submissionId === "string" ? result.submissionId : null;
  return { ok: true, submissionId: id, replayed: Boolean(result?.replayed) };
}

/**
 * Hash, upload straight to Convex storage, then create the submission. The storage id is kept
 * across retries so a failure after upload doesn't re-send the bytes, and the clip's
 * clientRequestId stays fixed so the backend can treat a retried create as a replay.
 */
export function useSubmit(orderId: string | null) {
  const convex = useConvex();
  const [state, setState] = useState<SubmitState>({ phase: "idle" });
  const uploaded = useRef<{ requestId: string; storageId: string; sha256: string } | null>(null);

  const submit = useCallback(async (clip: Clip) => {
    if (!orderId) return;
    let sha256 = uploaded.current?.requestId === clip.clientRequestId ? uploaded.current.sha256 : "";
    let storageId = uploaded.current?.requestId === clip.clientRequestId ? uploaded.current.storageId : "";

    if (!sha256) {
      setState({ phase: "hashing" });
      try {
        sha256 = await sha256Hex(clip.blob);
      } catch (error) {
        return setState({ phase: "error", kind: "hash_failed", retryable: true, detail: message(error) });
      }
    }

    if (!storageId) {
      setState({ phase: "uploading", progress: 0, sha256 });
      let uploadUrl: string;
      try {
        uploadUrl = await convex.mutation(refs.generateUploadUrl, { demoIdentity: DEMO_IDENTITY });
      } catch (error) {
        return setState({ phase: "error", kind: "upload_url_failed", retryable: true, detail: message(error), sha256 });
      }
      try {
        storageId = await uploadWithProgress(uploadUrl, clip.blob, progress => setState({ phase: "uploading", progress, sha256 }));
      } catch (error) {
        const kind = (error as { kind?: SubmitErrorKind }).kind ?? "upload_failed";
        return setState({ phase: "error", kind, retryable: true, detail: message(error), sha256 });
      }
      uploaded.current = { requestId: clip.clientRequestId, storageId, sha256 };
    }

    setState({ phase: "finalizing", sha256, storageId });
    try {
      const result = normalizeCreate(await convex.mutation(refs.createSubmission, {
        demoIdentity: DEMO_IDENTITY, orderId, storageId, clientRequestId: clip.clientRequestId, consentAcknowledged: true,
      }));
      if (!result.ok) return setState({ phase: "error", kind: "refused", retryable: false, detail: result.code, sha256 });
      setState({ phase: "queued", sha256, storageId, submissionId: result.submissionId, replayed: result.replayed });
    } catch (error) {
      setState({ phase: "error", kind: "create_failed", retryable: true, detail: message(error), sha256 });
    }
  }, [convex, orderId]);

  const reset = useCallback(() => {
    uploaded.current = null;
    setState({ phase: "idle" });
  }, []);

  return { state, submit, reset };
}
