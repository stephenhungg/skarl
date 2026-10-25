"use client";

import { useEffect, useRef, type RefObject } from "react";
import { fnv1a } from "./hash";
import styles from "./visuals.module.css";

type Media = "image" | "video" | "audio";

type Point = { x: number; y: number; z: number };

export type FingerprintProps = {
  id: string;
  mode: "pearl" | "filament";
  scanning: boolean;
  /** Receipt content hash; seeds the shape. Falls back to the id. */
  hash?: string;
  media?: Media;
  /** Seconds; only used for video/audio ring density. */
  duration?: number;
  /** Receipt hue (0..360). */
  hue?: number;
  /** The QR canvas the dots converge onto while scanning (see ReceiptQr). */
  codeRef?: RefObject<HTMLCanvasElement | null>;
};

const RINGS_IMAGE = 66;
const SEGMENTS = 168;
// Fixed camera tilt: cos / sin of ~16.04deg about the X axis.
const TILT_COS = 0.9610554383107709;
const TILT_SIN = 0.27635564856411376;
const CAMERA = 4.7;
const SPIN_PER_MS = 11e-5;
const DRAG_PER_PX = 0.009;
const SCAN_MS = 600;
const FRAME_MS = 32;

function buildRings(hashSeed: number, media: Media, duration: number): Point[][] {
  const phase = ((hashSeed % 1e3) / 1e3) * Math.PI * 2;
  const lobes = 3 + (hashSeed % 5);
  const rings =
    media === "image" ? RINGS_IMAGE : Math.min(82, 46 + Math.round(duration / 5));
  const out: Point[][] = [];
  for (let e = 0; e <= rings; e++) {
    const ring: Point[] = [];
    const lat = (e / rings) * Math.PI;
    for (let r = 0; r <= SEGMENTS; r++) {
      const lon = (r / SEGMENTS) * Math.PI * 2;
      if (media === "audio") {
        const t = (e / rings) * Math.PI * 2;
        const tube = 0.29 + 0.09 * Math.sin(lon * lobes + phase);
        const radius = 0.84 + tube * Math.cos(t);
        ring.push({
          x: radius * Math.cos(lon),
          y: radius * Math.sin(lon),
          z: tube * Math.sin(t) + 0.3 * Math.sin(3 * lon + phase),
        });
      } else {
        const radius =
          1 +
          (0.16 + (hashSeed % 9) * 0.018) *
            Math.sin(lobes * lon + 3 * lat + phase) *
            Math.sin(lat) ** 1.5 +
          0.075 * Math.sin(9 * lat + phase);
        const twist = lon + 0.5 * Math.cos(2 * lat + phase);
        ring.push({
          x: radius * Math.sin(lat) * Math.cos(twist),
          y: radius * Math.cos(lat) * (media === "image" ? 0.92 : 1.16),
          z: radius * Math.sin(lat) * Math.sin(twist),
        });
      }
    }
    out.push(ring);
  }
  return out;
}

/** Samples the QR canvas on a 96x96 grid (every 2 css px of 192) and keeps the dark cells. */
function sampleCode(code: HTMLCanvasElement | null | undefined) {
  const targets: { x: number; y: number }[] = [];
  if (!code || !code.width || !code.height) return targets;
  const data = code.getContext("2d")?.getImageData(0, 0, code.width, code.height).data;
  if (!data) return targets;
  for (let row = 1; row < 192; row += 2) {
    for (let col = 1; col < 192; col += 2) {
      const i =
        (Math.floor((row / 192) * code.height) * code.width +
          Math.floor((col / 192) * code.width)) *
        4;
      if (data[i] + data[i + 1] + data[i + 2] < 500) targets.push({ x: col - 96, y: row - 96 });
    }
  }
  return targets;
}

export function Fingerprint({
  id,
  mode,
  scanning,
  hash,
  media = "image",
  duration = 0,
  hue = 100,
  codeRef,
}: FingerprintProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef({ active: false, x: 0 });
  const angle = useRef(0);
  const scan = useRef(0);
  const filament = mode === "filament";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const rings = buildRings(fnv1a(hash ?? id), media, duration);
    const targets = sampleCode(codeRef?.current);
    const points = rings.flat();

    let raf = 0;
    let visible = true;
    let last = 0;
    let lastDraw = 0;

    const frame = (now: number) => {
      const dt = last ? Math.min(now - last, 64) : 0;
      const goal = scanning ? 1 : 0;
      if (reduced.matches) scan.current = goal;
      else
        scan.current +=
          Math.sign(goal - scan.current) * Math.min(Math.abs(goal - scan.current), dt / SCAN_MS);
      const s = scan.current;
      const ease = s * s * (3 - 2 * s);
      const animating = !scanning || s < 1;
      if (last && !reduced.matches && !drag.current.active && !document.hidden) {
        angle.current += SPIN_PER_MS * dt * (1 - ease);
      }
      last = now;
      const a = angle.current;

      // Throttle drawing to ~30fps while keeping the clock running.
      if (now - lastDraw < FRAME_MS && visible && !document.hidden && !reduced.matches && animating) {
        raf = requestAnimationFrame(frame);
        return;
      }
      lastDraw = now;

      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const scale = Math.min(0.32 * w, 0.32 * h);
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const project = (p: Point) => {
        const x = p.x * cos + p.z * sin;
        const z0 = -p.x * sin + p.z * cos;
        const y = TILT_COS * p.y - TILT_SIN * z0;
        const z = TILT_SIN * p.y + TILT_COS * z0;
        const k = CAMERA / (CAMERA - z);
        return { x: w / 2 + x * scale * k, y: h / 2 + y * scale * k, z };
      };

      if (filament && ease === 0) {
        ctx.strokeStyle = `hsla(${hue},43%,29%,.54)`;
        ctx.lineWidth = 0.8;
        for (const ring of rings) {
          ctx.beginPath();
          ring.forEach((p, i) => {
            const q = project(p);
            if (i) ctx.lineTo(q.x, q.y);
            else ctx.moveTo(q.x, q.y);
          });
          ctx.stroke();
        }
      } else {
        const projected = points
          .map((p, index) => ({ ...project(p), index }))
          .sort((m, n) => m.z - n.z);
        for (const p of projected) {
          const depth = Math.max(0, Math.min(1, (p.z + 1.5) / 3));
          const light = (22 + 32 * depth) * (1 - ease) + 23 * ease;
          ctx.fillStyle = `hsla(${hue + (p.y / h - 0.5) * 65},${37 + 15 * depth}%,${light}%,${0.5 + 0.5 * depth})`;
          const target = targets[p.index % targets.length];
          const x = target ? p.x * (1 - ease) + (w / 2 + target.x) * ease : p.x;
          const y = target ? p.y * (1 - ease) + (h / 2 + target.y) * ease : p.y;
          const size = (0.7 + 1.1 * depth) * (1 - ease) + 2 * ease;
          ctx.fillRect(x, y, size, size);
        }
      }

      if (visible && !document.hidden && !reduced.matches && animating) {
        raf = requestAnimationFrame(frame);
      }
    };

    const restart = () => {
      cancelAnimationFrame(raf);
      last = 0;
      lastDraw = 0;
      raf = requestAnimationFrame(frame);
    };

    const resize = new ResizeObserver(restart);
    resize.observe(canvas);
    const intersect = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      cancelAnimationFrame(raf);
      if (visible) restart();
    });
    intersect.observe(canvas);

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "touch" || scanning) return;
      drag.current.active = true;
      drag.current.x = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!drag.current.active) return;
      angle.current += (e.clientX - drag.current.x) * DRAG_PER_PX;
      drag.current.x = e.clientX;
      restart();
    };
    const onUp = () => {
      drag.current.active = false;
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    document.addEventListener("visibilitychange", restart);
    reduced.addEventListener("change", restart);
    restart();

    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      intersect.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      document.removeEventListener("visibilitychange", restart);
      reduced.removeEventListener("change", restart);
    };
  }, [id, hash, media, duration, hue, filament, scanning, codeRef]);

  return (
    <canvas
      ref={canvasRef}
      className={styles.fingerprint}
      role="img"
      aria-hidden={scanning}
      aria-label={`${media} fingerprint generated from receipt ${id}`}
    />
  );
}
