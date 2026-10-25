"use client";
import { useEffect, useRef } from "react";
import { COVER, ORBIT_COLS, ORBIT_FPS, ORBIT_PALETTE, ORBIT_ROWS, createOrbit } from "./orbit-scene";

// Smallest cell in CSS px, so narrow screens crop columns instead of shrinking
// the globe to a sliver.
const MIN_CELL = 4;
// Where the clock starts, so the first frame already has requests in flight.
const T0 = 8.5;

/**
 * The orbit scene as a halftone of filled circles. `bottomRow` is the scene
 * row that sits on the canvas's bottom edge, so rows below it are cropped and
 * the limb can be lifted or lowered to clear the content above it.
 */
export function OrbitCanvas({ className, bottomRow = ORBIT_ROWS }: { className?: string; bottomRow?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const N = ORBIT_COLS * ORBIT_ROWS;
    const steps = new Uint8Array(N);
    const colors = new Uint8Array(N);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let scene: ReturnType<typeof createOrbit> | null = null;
    let raf = 0;
    let visible = false;
    let last = 0; // performance.now() of the last drawn frame
    let t = T0; // scene time, which only advances while running
    let cell = 0, col0 = 0, row0 = 0, cols = 0, rows = 0, ox = 0, oy = 0;

    const layout = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cell = Math.max(MIN_CELL, w / ORBIT_COLS);
      // columns centred, rows anchored to the bottom so the limb always shows
      cols = Math.min(ORBIT_COLS, Math.ceil(w / cell));
      col0 = Math.floor((ORBIT_COLS - cols) / 2);
      ox = (w - cols * cell) / 2;
      rows = Math.min(bottomRow, Math.ceil(h / cell));
      row0 = bottomRow - rows;
      oy = h - rows * cell;
    };

    const draw = () => {
      if (!scene) return;
      scene.frame(t, steps, colors);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // one path per palette colour, so the fill state changes 27 times a frame, not 20000
      for (let c = 0; c < ORBIT_PALETTE.length; c++) {
        let any = false;
        for (let r = 0; r < rows; r++) {
          const base = (row0 + r) * ORBIT_COLS + col0;
          const cy = oy + (r + 0.5) * cell;
          for (let x = 0; x < cols; x++) {
            const k = base + x;
            const s = steps[k];
            if (!s || colors[k] !== c) continue;
            if (!any) ctx.beginPath(), (any = true);
            const cx = ox + (x + 0.5) * cell, rad = (COVER[s] * cell) / 2;
            ctx.moveTo(cx + rad, cy);
            ctx.arc(cx, cy, rad, 0, Math.PI * 2);
          }
        }
        if (any) {
          ctx.fillStyle = ORBIT_PALETTE[c];
          ctx.fill();
        }
      }
    };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = now - last;
      if (dt < 1000 / ORBIT_FPS - 2) return;
      // advance by the real gap, capped so a stall does not jump the scene
      t += Math.min(dt, 250) / 1000;
      last = now;
      draw();
    };

    const sync = () => {
      const run = !!scene && !reduced && visible && !document.hidden;
      if (run && !raf) {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      } else if (!run && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    io.observe(canvas);
    const ro = new ResizeObserver(() => {
      layout();
      draw();
    });
    ro.observe(canvas);
    document.addEventListener("visibilitychange", sync);

    // The maps take a moment to build, so do it once the page is idle.
    const build = () => {
      scene = createOrbit();
      layout();
      draw();
      canvas.style.opacity = "1";
      sync();
    };
    const ric = "requestIdleCallback" in window;
    const idle = ric ? window.requestIdleCallback(build, { timeout: 1500 }) : window.setTimeout(build, 200);

    return () => {
      if (ric) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", sync);
      scene = null;
    };
  }, [bottomRow]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className={className}
      style={{ opacity: 0, transition: "opacity 900ms var(--ease-settle)" }}
    />
  );
}
