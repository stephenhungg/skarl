"use client";

import { useConvex, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/glaze/ui/badge";
import { Button } from "@/components/glaze/ui/button";
import { Switch } from "@/components/glaze/ui/switch";
import { api, BUYER, type Id } from "@/features/dashboard/data";
import { QueryBoundary } from "@/features/dashboard/ui";
import { formatMs } from "@/features/dashboard/format";
import { ReplayEvidencePanels } from "./evidence-panels";
import { objectInHand, frameAt, readAnnotationFile, summarize, type AnnotationFile, type AnnotationFrame, type AnnotationModel, type AnnotationSummary, type LayerKind } from "./annotations";
import { replayProxyUrl } from "./media-url";
import { detectorClassForObject } from "../../../../convex/lib/taskSpec";
import type { Hand, ObjectDetection, Mask } from "./models";

// Explicit references let the web ship before this additive API is deployed.
const runsQuery = makeFunctionReference<"query", { demoIdentity: string; submissionId: Id<"submissions"> }, SavedRun[]>("annotations:forSubmission");
const uploadMutation = makeFunctionReference<"mutation", { demoIdentity: string; submissionId: Id<"submissions"> }, string>("annotations:generateUploadUrl");
const saveMutation = makeFunctionReference<"mutation", { demoIdentity: string; submissionId: Id<"submissions">; storageId: Id<"_storage">; summary: AnnotationSummary }, unknown>("annotations:saveDerived");
type SavedRun = { _id: string; kind: LayerKind; model: AnnotationModel; createdAt: number; createdBy: string; url: string | null; summary: AnnotationSummary };
type Models = typeof import("./models");
type Adapters = { hands?: Awaited<ReturnType<Models["loadHands"]>>; objects?: Awaited<ReturnType<Models["loadObjects"]>>; masks?: Awaited<ReturnType<Models["loadSegmenter"]>> };
type LayerState = { enabled: boolean; loading: boolean; message: string; model?: AnnotationModel };
const initialLayers = (): Record<LayerKind, LayerState> => ({
  hands: { enabled: false, loading: false, message: "MediaPipe Hand Landmarker · model v1 · WASM" },
  objects: { enabled: false, loading: false, message: "MediaPipe EfficientDet-Lite0 · model v1 · WASM" },
  masks: { enabled: false, loading: false, message: "SAM2.1 Hiera Tiny · click a paused frame" },
});
const connections = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];

export default function ReplayStudio({ submissionId }: { submissionId: Id<"submissions"> }) {
  const convex = useConvex();
  const media = useQuery(api.media.submissionEvidence, { demoIdentity: BUYER, submissionId });
  const report = useQuery(api.submissions.getReport, { demoIdentity: BUYER, submissionId });
  const taskObject = media?.taskSpec?.object;
  const detectorClass = taskObject ? detectorClassForObject(taskObject) : null;
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const adapters = useRef<Adapters>({});
  const mounted = useRef(true);
  const layersRef = useRef(initialLayers());
  const [layers, setLayers] = useState(initialLayers);
  const [now, setNow] = useState(0);
  const [proxied, setProxied] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [segmenting, setSegmenting] = useState(false);
  const segmentingRef = useRef(false);
  const [runs, setRuns] = useState<SavedRun[]>([]);
  const [apiStatus, setApiStatus] = useState<"checking" | "ready" | "unavailable">("checking");
  const [reloadedFrames, setReloadedFrames] = useState<AnnotationFrame[]>([]);
  const reloaded = useRef<AnnotationFrame[]>([]);
  const latest = useRef<{ hands: Hand[]; objects: ObjectDetection[]; mask?: { tMs: number; mask: Mask; surface: HTMLCanvasElement } }>({ hands: [], objects: [] });
  const [counts, setCounts] = useState({ hands: 0, objects: 0, objectOverlap: false });
  const [maskInfo, setMaskInfo] = useState<Mask | null>(null);
  const lastRender = useRef(-1);
  const src = media?.clip?.url ? (proxied ? replayProxyUrl(media.clip.url) : media.clip.url) : undefined;

  const patchLayer = useCallback((kind: LayerKind, patch: Partial<LayerState>) => {
    const next = { ...layersRef.current, [kind]: { ...layersRef.current[kind], ...patch } };
    layersRef.current = next;
    if (mounted.current) setLayers(next);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const adapter of Object.values(adapters.current)) adapter?.close();
    };
  }, []);

  const refreshRuns = useCallback(async () => {
    try {
      const value = await convex.query(runsQuery, { demoIdentity: BUYER, submissionId });
      if (mounted.current) { setRuns(value); setApiStatus("ready"); }
    } catch {
      if (mounted.current) setApiStatus("unavailable");
    }
  }, [convex, submissionId]);
  useEffect(() => { void refreshRuns(); }, [refreshRuns]);

  const ensureLayer = useCallback(async (kind: LayerKind) => {
    if (adapters.current[kind]) return;
    if (layersRef.current[kind].loading) throw new Error("Model is already loading. Wait for it to finish.");
    patchLayer(kind, { loading: true, message: "Loading model…" });
    try {
      const models = await import("./models");
      const progress = (message: string, percent?: number) => patchLayer(kind, { message: `${message}${percent === undefined ? "" : ` ${Math.round(percent)}%`}` });
      if (kind === "hands") adapters.current.hands = await models.loadHands(progress);
      if (kind === "objects") adapters.current.objects = await models.loadObjects(progress);
      if (kind === "masks") adapters.current.masks = await models.loadSegmenter(progress);
      if (!mounted.current) { (adapters.current as Adapters)[kind]?.close(); return; }
      const model = adapters.current[kind]!.model;
      patchLayer(kind, { loading: false, model, message: `${model.name} · ${model.version} · ${model.runtime}` });
    } catch (error) {
      patchLayer(kind, { loading: false, enabled: false, message: `Unavailable: ${friendlyError(error)}` });
      throw error;
    }
  }, [patchLayer]);

  const toggle = async (kind: LayerKind, enabled: boolean) => {
    patchLayer(kind, { enabled });
    if (reloaded.current.length) return;
    if (enabled) {
      try { await ensureLayer(kind); lastRender.current = -1; }
      catch { /* Per-layer message keeps the original and other layers usable. */ }
    }
  };

  const draw = useCallback((tMs: number) => {
    const el = video.current, overlay = canvas.current;
    if (!el || !overlay || !el.videoWidth) return;
    if (overlay.width !== el.videoWidth || overlay.height !== el.videoHeight) {
      overlay.width = el.videoWidth; overlay.height = el.videoHeight;
    }
    const ctx = overlay.getContext("2d");
    if (!ctx) return;
    const width = overlay.width, height = overlay.height;
    ctx.clearRect(0, 0, width, height);
    const style = getComputedStyle(overlay);
    const ink = style.getPropertyValue("--paper").trim() || "Canvas";
    const field = style.getPropertyValue("--ink").trim() || "CanvasText";
    const warning = style.getPropertyValue("--warn").trim() || ink;
    const fontSize = Math.max(14, width / 55);
    ctx.font = `${fontSize}px ${style.fontFamily}`; ctx.lineWidth = Math.max(2, width / 400);
    const label = (text: string, x: number, y: number) => {
      const labelY = Math.max(fontSize + 6, y);
      ctx.fillStyle = field; ctx.fillRect(x, labelY - fontSize - 4, ctx.measureText(text).width + 8, fontSize + 8);
      ctx.fillStyle = ink; ctx.fillText(text, x + 4, labelY);
    };
    const saved = frameAt(reloaded.current, tMs);
    const hands = reloaded.current.length ? saved?.hands ?? [] : latest.current.hands;
    const objects = reloaded.current.length ? saved?.objects ?? [] : latest.current.objects;
    if (layersRef.current.hands.enabled) for (const hand of hands) {
      ctx.strokeStyle = ink; ctx.fillStyle = ink;
      for (const [a,b] of connections) {
        const p = hand.keypoints[a!], q = hand.keypoints[b!];
        if (!p || !q) continue;
        ctx.beginPath(); ctx.moveTo(p[0] * width, p[1] * height); ctx.lineTo(q[0] * width, q[1] * height); ctx.stroke();
      }
      for (const p of hand.keypoints) { ctx.beginPath(); ctx.arc(p[0] * width, p[1] * height, Math.max(2, width / 250), 0, Math.PI * 2); ctx.fill(); }
      const wrist = hand.keypoints[0];
      if (wrist) label(`${hand.handedness} hand ${(hand.score * 100).toFixed(0)}%`, wrist[0] * width, wrist[1] * height);
    }
    if (layersRef.current.objects.enabled) for (const object of objects) {
      const [x,y,w,h] = object.box;
      ctx.strokeStyle = object.label === detectorClass ? warning : ink;
      ctx.strokeRect(x * width, y * height, w * width, h * height);
      label(`${object.label} ${(object.score * 100).toFixed(0)}%`, x * width, y * height);
    }
    const mask = latest.current.mask;
    if (layersRef.current.masks.enabled && mask && Math.abs(mask.tMs - tMs) < 100) {
      ctx.drawImage(mask.surface, 0, 0, width, height);
      const [x,y,w,h] = mask.mask.bbox; ctx.strokeStyle = ink;
      ctx.strokeRect(x * width, y * height, w * width, h * height);
      label(`SAM2.1 region · ${(mask.mask.areaFrac * 100).toFixed(1)}% area`, x * width, y * height);
    }
    for (const savedMask of layersRef.current.masks.enabled ? saved?.masks ?? [] : []) {
      const [x,y,w,h] = savedMask.bbox; ctx.strokeStyle = ink; ctx.strokeRect(x * width, y * height, w * width, h * height);
      if (savedMask.polygon?.length) {
        ctx.beginPath(); savedMask.polygon.forEach(([px,py], i) => i ? ctx.lineTo(px * width, py * height) : ctx.moveTo(px * width, py * height)); ctx.closePath(); ctx.stroke();
      }
      label(`Saved region · ${(savedMask.areaFrac * 100).toFixed(1)}% area`, x * width, y * height);
    }
  }, [detectorClass]);

  // Present the overlay at the decoded frame's media time, including after a seek.
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    let cancelled = false, handle = 0, fallback = 0;
    const update = (tMs: number) => {
      if (cancelled) return;
      if (!savingRef.current && !reloaded.current.length && el.readyState >= 2 && Math.abs(tMs - lastRender.current) >= 160) {
        try {
          if (layersRef.current.hands.enabled && adapters.current.hands) latest.current.hands = adapters.current.hands.detect(el, tMs);
          if (layersRef.current.objects.enabled && adapters.current.objects) latest.current.objects = adapters.current.objects.detect(el, tMs);
          lastRender.current = tMs;
          setCounts({ hands: layersRef.current.hands.enabled ? latest.current.hands.length : 0, objects: layersRef.current.objects.enabled ? latest.current.objects.length : 0, objectOverlap: objectInHand(latest.current.hands, latest.current.objects, taskObject) });
        } catch (error) { setNotice(`Overlay paused: ${friendlyError(error)}`); }
      }
      if (reloaded.current.length) {
        const sample = frameAt(reloaded.current, tMs);
        const hands = layersRef.current.hands.enabled ? sample?.hands ?? [] : [];
        const objects = layersRef.current.objects.enabled ? sample?.objects ?? [] : [];
        const objectOverlap = objectInHand(hands, objects, taskObject);
        setCounts(previous => previous.hands === hands.length && previous.objects === objects.length && previous.objectOverlap === objectOverlap ? previous : { hands: hands.length, objects: objects.length, objectOverlap });
      }
      setNow(previous => Math.abs(previous - tMs) >= 100 ? tMs : previous); draw(tMs);
    };
    const onSeek = () => { lastRender.current = -1; update(el.currentTime * 1000); };
    const frame = (_time: number, metadata: VideoFrameCallbackMetadata) => {
      update(metadata.mediaTime * 1000);
      if (!cancelled) handle = el.requestVideoFrameCallback(frame);
    };
    if (typeof el.requestVideoFrameCallback === "function") handle = el.requestVideoFrameCallback(frame);
    else { const tick = () => { update(el.currentTime * 1000); fallback = requestAnimationFrame(tick); }; fallback = requestAnimationFrame(tick); }
    el.addEventListener("seeked", onSeek); el.addEventListener("loadeddata", onSeek);
    return () => { cancelled = true; if (handle) el.cancelVideoFrameCallback(handle); if (fallback) cancelAnimationFrame(fallback); el.removeEventListener("seeked", onSeek); el.removeEventListener("loadeddata", onSeek); };
  }, [src, draw, taskObject]);
  useEffect(() => {
    lastRender.current = -1;
    const el = video.current;
    if (!el || el.readyState < 2 || savingRef.current) return;
    const tMs = el.currentTime * 1000;
    try {
      if (!reloaded.current.length && el.paused) {
        if (layers.hands.enabled && adapters.current.hands) latest.current.hands = adapters.current.hands.detect(el, tMs);
        if (layers.objects.enabled && adapters.current.objects) latest.current.objects = adapters.current.objects.detect(el, tMs);
      }
      setCounts({ hands: layers.hands.enabled ? latest.current.hands.length : 0, objects: layers.objects.enabled ? latest.current.objects.length : 0, objectOverlap: objectInHand(latest.current.hands, latest.current.objects, taskObject) });
      draw(tMs);
    } catch (error) { setNotice(`Overlay unavailable: ${friendlyError(error)}`); }
  }, [layers, draw, reloadedFrames, taskObject]);

  const seek = (tMs: number) => { if (video.current) video.current.currentTime = Math.max(0, tMs / 1000); };
  const segment = async (prompt: { x: number; y: number }) => {
    const el = video.current;
    if (!el || !el.paused || segmentingRef.current || savingRef.current || !el.videoWidth) { setNotice("Pause the clip before selecting a region."); return; }
    segmentingRef.current = true; setSegmenting(true);
    const tMs = Math.round(el.currentTime * 1000);
    try {
      await ensureLayer("masks");
      const image = document.createElement("canvas"); image.width = el.videoWidth; image.height = el.videoHeight;
      const context = image.getContext("2d"); if (!context) throw new Error("Canvas is unavailable in this browser.");
      context.drawImage(el, 0, 0); context.getImageData(0, 0, 1, 1); // Detect CORS taint before expensive inference.
      const result = await adapters.current.masks!.segment(image, prompt);
      const surface = document.createElement("canvas"); surface.width = result.bitmap.width; surface.height = result.bitmap.height;
      surface.getContext("2d")?.putImageData(result.bitmap, 0, 0);
      latest.current.mask = { tMs, mask: result.mask, surface }; setMaskInfo(result.mask); draw(tMs);
      setNotice("Region estimated locally. Area and bounds are advisory.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "SecurityError" && !proxied) { setProxied(true); setNotice("Using the same-origin media proxy. Pause and select the region again after it loads."); }
      else setNotice(`Segmentation unavailable: ${friendlyError(error)}`);
    } finally { segmentingRef.current = false; if (mounted.current) setSegmenting(false); }
  };

  const persist = async (file: AnnotationFile, summary: AnnotationSummary) => {
    const uploadUrl = await convex.mutation(uploadMutation, { demoIdentity: BUYER, submissionId });
    const response = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(file) });
    if (!response.ok) throw new Error(`Annotation upload failed (${response.status}).`);
    const { storageId } = await response.json() as { storageId: Id<"_storage"> };
    if (!storageId) throw new Error("Annotation storage did not return an ID.");
    await convex.mutation(saveMutation, { demoIdentity: BUYER, submissionId, storageId, summary });
  };

  const saveAnnotations = async () => {
    if (savingRef.current || apiStatus !== "ready" || !media?.clip?.url) return;
    savingRef.current = true; setSaving(true); video.current?.pause();
    let decoder: HTMLVideoElement | undefined;
    try {
      // Recheck deployment before any model downloads or uploads.
      await convex.query(runsQuery, { demoIdentity: BUYER, submissionId });
      const sourceHash = report?.sourceHash;
      if (!sourceHash || !/^[a-f0-9]{64}$/i.test(sourceHash)) throw new Error("The verified source SHA-256 is unavailable. No annotations were saved.");
      await ensureLayer("hands"); await ensureLayer("objects");
      decoder = document.createElement("video"); decoder.crossOrigin = "anonymous"; decoder.muted = true; decoder.playsInline = true; decoder.preload = "auto";
      decoder.src = replayProxyUrl(media.clip.url);
      await waitForMedia(decoder, "loadeddata", () => decoder!.readyState >= 2);
      const durationMs = Math.round(decoder.duration * 1000);
      if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 30_500) throw new Error("A finite clip of up to 30 seconds is required.");
      const frames: AnnotationFrame[] = [];
      for (let tMs = 0; tMs < durationMs; tMs += 200) {
        if (!mounted.current) throw new Error("Replay closed; the annotation scan was cancelled.");
        if (Math.abs(decoder.currentTime - tMs / 1000) > 0.0001) {
          const sought = waitForMedia(decoder, "seeked"); decoder.currentTime = tMs / 1000; await sought;
        }
        const hands = adapters.current.hands!.detect(decoder, tMs), objects = adapters.current.objects!.detect(decoder, tMs);
        frames.push({ tMs, hands, objects });
        setNotice(`Sampling original at 5 fps · ${frames.length} / ${Math.ceil(durationMs / 200)} frames`);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      const base = { schema: "skarl.annotations.v1" as const, submissionId, sourceSha256: sourceHash, sampleFps: 5, videoWidth: decoder.videoWidth, videoHeight: decoder.videoHeight, advisory: true as const };
      for (const kind of ["hands", "objects"] as const) {
        const model = kind === "objects" ? { ...adapters.current.objects!.model, name: "MediaPipe EfficientDet-Lite0 + Hand Landmarker", version: `${adapters.current.objects!.model.version}; hands float16/1; z=clamp(nativeZ+0.5)` } : adapters.current.hands!.model;
        const file: AnnotationFile = { ...base, kind, model, frames: frames.map(frame => kind === "objects" ? frame : { tMs: frame.tMs, hands: frame.hands }) };
        setNotice(`Saving ${kind} annotations…`); await persist(file, summarize(file, frames.at(-1)?.tMs ?? 0, frames));
      }
      setNotice("Annotation runs saved. Browser model output does not change the verdict, acceptance, or payable.");
      await refreshRuns();
    } catch (error) { setNotice(`Save stopped: ${friendlyError(error)} Some earlier runs may already be saved; refresh the list before retrying.`); await refreshRuns(); }
    finally {
      if (decoder) { decoder.removeAttribute("src"); decoder.load(); }
      savingRef.current = false; lastRender.current = -1; if (mounted.current) setSaving(false);
    }
  };

  const showRun = async (run: SavedRun) => {
    try {
      if (!run.url) throw new Error("The saved annotation URL is unavailable. Refresh the run list.");
      const response = await fetch(run.url, { cache: "no-store" });
      if (!response.ok) throw new Error("Saved annotations could not be downloaded.");
      const json = await response.text();
      if (json.length > 8 * 1024 * 1024) throw new Error("Saved annotations exceed the browser replay limit.");
      const file = readAnnotationFile(JSON.parse(json), submissionId, report?.sourceHash);
      reloaded.current = file.frames; setReloadedFrames(file.frames);
      for (const kind of ["hands", "objects", "masks"] as const) patchLayer(kind, { enabled: file.frames.some(frame => frame[kind] !== undefined) });
      seek(file.frames[0]?.tMs ?? 0);
      setNotice(`Showing saved ${run.kind} · ${run.model.name} ${run.model.version}. Sampled frames only.`);
    } catch (error) { setNotice(friendlyError(error)); }
  };

  return <section className="mt-8 border-t border-line-faint pt-6" aria-labelledby="replay-studio-title">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="replay-studio-title" className="type-heading-sm">Replay studio</h2><p className="mt-1 type-body-sm text-text-2">Every claim has a witness. Inspect the original beside stored evidence and local model overlays.</p></div>
      <Badge variant="outline">Advisory only</Badge>
    </div>
    <div className="grid min-w-0 gap-6 xl:grid-cols-2">
      <div className="min-w-0">
        <div className="shell"><div className="panel overflow-hidden p-3">
          <div className="relative overflow-hidden rounded-panel bg-ink" onClick={event => {
            if (!layers.masks.enabled || !video.current?.paused || event.target !== canvas.current) return;
            const bounds = canvas.current.getBoundingClientRect();
            void segment({ x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height });
          }}>
            {src ? <><video ref={video} src={src} crossOrigin="anonymous" controls playsInline preload="metadata" className="block w-full" aria-label="Original submission clip" onError={() => {
              if (!proxied) { setProxied(true); setNotice("Loading the original through the same-origin media proxy."); }
              else setMediaError("The original could not be played. Its storage URL may have expired, or the browser may not support this recording format.");
            }} />
              <canvas ref={canvas} aria-hidden="true" className={`absolute inset-0 h-full w-full ${layers.masks.enabled ? "cursor-crosshair" : "pointer-events-none"}`} />
            </> : <p className="p-6 type-body-sm text-text-inverse">{media === undefined ? "Loading original clip…" : "The original is missing or quarantined."}</p>}
          </div>
          {mediaError && <p className="mt-2 type-body-sm text-fail-text" role="alert">{mediaError}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" disabled={!src || saving} onClick={() => { if (video.current?.paused) void video.current.play().catch(() => setNotice("Playback could not start.")); else video.current?.pause(); }}>Play or pause clip</Button>
            <span className="type-label-sm text-text-3 tabular-nums">{formatMs(now)}</span>
            {reloadedFrames.length > 0 && <Button size="sm" variant="secondary" onClick={() => {
              reloaded.current = []; setReloadedFrames([]); setNotice("Showing live browser overlays.");
              void (async () => { for (const kind of ["hands", "objects", "masks"] as const) if (layersRef.current[kind].enabled) { try { await ensureLayer(kind); } catch { /* Layer reports its own failure. */ } } })();
            }}>Use live overlays</Button>}
          </div>
          <div className="mt-4 divide-y divide-line-faint">
            {(["hands", "objects", "masks"] as const).map(kind => <div className="flex items-start gap-3 py-3" key={kind}>
              <Switch size="sm" aria-label={`Show ${kind} layer`} checked={layers[kind].enabled} disabled={saving || segmenting} pending={layers[kind].loading} onCheckedChange={enabled => void toggle(kind, enabled)} />
              <div className="min-w-0 flex-1"><p className="type-label">{kind === "hands" ? "Hand landmarks" : kind === "objects" ? "Object detections" : "Click to segment"}</p><p className="mt-1 break-words type-caption text-text-3" role="status">{layers[kind].message}</p></div>
            </div>)}
          </div>
          {layers.masks.enabled && <div className="mt-2 flex flex-wrap items-center gap-2"><p className="type-body-sm text-text-2">Pause, then click the region to inspect.</p><Button variant="secondary" size="sm" disabled={segmenting || saving || !src || layers.masks.loading} pending={segmenting} pendingLabel="Segmenting" onClick={() => void segment({ x: 0.5, y: 0.5 })}>Segment center</Button></div>}
          <p className="mt-3 type-body-sm text-text-2">{counts.hands} hands · {counts.objects} objects{counts.objectOverlap && layers.hands.enabled && layers.objects.enabled ? ` · ${taskObject?.replaceAll("_", " ")} overlaps hand bounds (heuristic)` : ""}{!detectorClass ? " · Task-object detector witness: not applicable (no faithful detector class)" : ""}</p>
          {maskInfo && <p className="mt-1 type-caption text-text-3">Selected at {formatMs(latest.current.mask?.tMs ?? 0)} · estimated mask area {(maskInfo.areaFrac * 100).toFixed(1)}% · normalized bounds {maskInfo.bbox.map(value => value.toFixed(3)).join(", ")}</p>}
        </div><div className="shell-foot flex flex-wrap items-center gap-3">
          <p className="me-auto type-caption text-text-3">Client computed. Model downloads start when enabled.</p>
          <Button size="sm" pending={saving} pendingLabel="Sampling clip" disabled={apiStatus !== "ready" || !src || segmenting || Object.values(layers).some(layer => layer.loading)} onClick={() => void saveAnnotations()}>Save annotations</Button>
        </div></div>
        <div className="mt-3 type-body-sm text-text-2" aria-live="polite">{notice}</div>
        {apiStatus !== "ready" && <p className="mt-2 type-caption text-text-3">{apiStatus === "checking" ? "Checking annotations API…" : "Saving is disabled: the annotations API is not deployed or this caller has no access."} <Button variant="secondary" size="sm" onClick={() => void refreshRuns()}>Check availability</Button></p>}
        <p className="mt-2 type-caption text-text-3">Saving samples hands and objects at 5 fps into separate model-labelled JSON runs. Selected masks remain local to this replay. Hand depth uses clamped wrist-relative z + 0.5 for the normalized format. Overlap does not prove a grasp. These annotations never authorize acceptance or payment.</p>
        <div className="mt-6"><div className="flex items-center justify-between gap-2"><h3 className="type-label">Saved annotation runs</h3><Button variant="secondary" size="sm" onClick={() => void refreshRuns()}>Refresh runs</Button></div>
          {runs.length ? <ol className="mt-2 divide-y divide-line-faint">{runs.map(run => <li key={run._id} className="flex flex-wrap items-start gap-2 py-3"><div className="min-w-0 flex-1"><p className="type-label">{run.model.name} · {run.kind}</p><p className="mt-1 break-words type-caption text-text-3">{run.model.version} · {run.model.runtime} · {run.summary.frames} frames · {new Date(run.createdAt).toLocaleString()} · {run.createdBy}</p></div><Button variant="secondary" size="sm" disabled={!run.url || saving} onClick={() => void showRun(run)}>View run</Button></li>)}</ol> : <p className="mt-2 type-body-sm text-text-3">{apiStatus === "ready" ? "No saved runs for this submission." : "Saved runs are unavailable until the annotations API can be read."}</p>}
        </div>
      </div>
      <QueryBoundary><ReplayEvidencePanels submissionId={submissionId} currentTimeMs={now} onSeek={seek} refreshKey={runs[0]?.createdAt ?? 0} /></QueryBoundary>
    </div>
  </section>;
}

function friendlyError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.slice(0, 240);
  return "This browser or model is unavailable. The original evidence remains unchanged.";
}

function waitForMedia(video: HTMLVideoElement, event: "loadeddata" | "seeked", ready?: () => boolean): Promise<void> {
  if (ready?.()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("Timed out decoding the original video.")), 20_000);
    const success = () => finish();
    const failure = () => finish(new Error("The original video could not be decoded."));
    function finish(error?: Error) { clearTimeout(timer); video.removeEventListener(event, success); video.removeEventListener("error", failure); if (error) reject(error); else resolve(); }
    video.addEventListener(event, success, { once: true }); video.addEventListener("error", failure, { once: true });
  });
}
