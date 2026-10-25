"use client";
import { useEffect, useRef } from "react";

// Halftone field on a 10px module. Each cell's darkness picks a dot size (7 steps). Until a hands-only clip
// of a task recording exists, the source is a slow procedural field; swap `sample` for a video read later.
// Every ~3s one column briefly fills with the accent, like a timeline marker.

const CELL = 10;
const STEPS = 7;
const FPS = 30;
const INTRO_MS = 1200;
const MARKER_EVERY_MS = 3000;
const MARKER_MS = 900;

function rgbVar(el: Element, name: string, fallback: string) {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v ? `rgb(${v})` : fallback;
}

// Darkness 0..1 at a cell and time: a few drifting sine bands, roughly what a shot of moving hands reads as at this scale.
function sample(x: number, y: number, t: number) {
  const a = Math.sin(x * 0.11 + t * 0.00035) * Math.cos(y * 0.09 - t * 0.00028);
  const b = Math.sin((x + y) * 0.05 + t * 0.0002);
  const c = Math.cos(Math.hypot(x - 70, y - 40) * 0.07 - t * 0.0004);
  return Math.min(1, Math.max(0, 0.5 + 0.28 * a + 0.18 * b + 0.2 * c));
}

export function DotField({ originY = 0.62 }: { originY?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dot = rgbVar(canvas, "--haze", "rgb(220 224 217)");
    const accent = rgbVar(canvas, "--accent", "rgb(199 241 142)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0, h = 0, cols = 0, rows = 0, dpr = 1;
    let raf = 0, last = 0, visible = true;
    const start = performance.now();
    let markerCol = -1, markerAt = 0;

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width; h = r.height;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      cols = Math.ceil(w / CELL); rows = Math.ceil(h / CELL);
    };

    const draw = (now: number) => {
      const t = now - start;
      const intro = reduced ? 1 : Math.min(1, t / INTRO_MS);
      const ox = cols / 2, oy = rows * originY;
      const reach = Math.hypot(cols, rows) * (0.15 + 0.85 * (1 - Math.pow(1 - intro, 3)));
      if (!reduced && now - markerAt > MARKER_EVERY_MS) { markerAt = now; markerCol = Math.floor(cols * (0.08 + Math.random() * 0.84)); }
      const markerA = markerCol >= 0 ? Math.max(0, 1 - (now - markerAt) / MARKER_MS) : 0;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const d = Math.hypot(x - ox, (y - oy) * 1.4);
          if (d > reach) continue;
          const l = Math.pow(sample(x, y, reduced ? 0 : t), 1.28);
          const step = Math.round(l * STEPS) / STEPS;
          if (step < 0.2) continue; // keep the headline area quiet
          const r = (CELL * step * 0.9) / 2;
          const isMarker = x === markerCol && markerA > 0;
          ctx.globalAlpha = Math.min(1, (reach - d) / 6);
          ctx.fillStyle = isMarker ? accent : dot;
          if (isMarker) ctx.globalAlpha *= 0.35 + 0.65 * markerA;
          ctx.beginPath();
          ctx.arc(x * CELL + CELL / 2, y * CELL + CELL / 2, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || now - last < 1000 / FPS) return;
      last = now;
      draw(now);
    };

    const ro = new ResizeObserver(() => { resize(); draw(performance.now()); });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
    io.observe(canvas);
    resize();
    if (reduced) draw(performance.now());
    else raf = requestAnimationFrame(loop);

    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
  }, [originY]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="block h-full w-full"
      style={{
        WebkitMaskImage: "linear-gradient(180deg, transparent 0%, #000 30%, #000 70%, transparent 95%)",
        maskImage: "linear-gradient(180deg, transparent 0%, #000 30%, #000 70%, transparent 95%)",
      }}
    />
  );
}
