"use client";
import { useEffect, useRef } from "react";
import { useReducedMotionSafe } from "@/lib/use-reduced-motion";

// A faint grid of block cells over the hero. Every so often a cell lights up with a short block hash,
// holds for a moment and fades, like new blocks landing on a chain.

const CELL = 64;
const LIFE_MS = 2600;
const SPAWN_MS = 420;

type Lit = { col: number; row: number; born: number; hash: string };

function hex(n: number) {
  let s = "";
  for (let i = 0; i < n; i++) s += "0123456789abcdef"[Math.floor(Math.random() * 16)];
  return s;
}

export function BlockGrid() {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduce = useReducedMotionSafe();

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let w = 0, h = 0, cols = 0, rows = 0, dpr = 1, raf = 0, visible = true, lastSpawn = 0;
    const lit: Lit[] = [];
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width; h = r.height;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      cols = Math.ceil(w / CELL); rows = Math.ceil(h / CELL);
    };
    const draw = (now: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      // grid hairlines
      ctx.strokeStyle = "rgba(233, 246, 221, 0.045)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= cols; x++) { ctx.moveTo(x * CELL + 0.5, 0); ctx.lineTo(x * CELL + 0.5, h); }
      for (let y = 0; y <= rows; y++) { ctx.moveTo(0, y * CELL + 0.5); ctx.lineTo(w, y * CELL + 0.5); }
      ctx.stroke();
      // lit blocks
      ctx.font = "10px var(--font-fono), ui-monospace, monospace";
      for (let i = lit.length - 1; i >= 0; i--) {
        const b = lit[i]!;
        const age = (now - b.born) / LIFE_MS;
        if (age >= 1) { lit.splice(i, 1); continue; }
        const a = age < 0.12 ? age / 0.12 : 1 - (age - 0.12) / 0.88;
        const x = b.col * CELL, y = b.row * CELL;
        ctx.fillStyle = `rgba(199, 241, 142, ${0.07 * a})`;
        ctx.fillRect(x + 1, y + 1, CELL - 1, CELL - 1);
        ctx.strokeStyle = `rgba(199, 241, 142, ${0.55 * a})`;
        ctx.strokeRect(x + 0.5, y + 0.5, CELL, CELL);
        // corner ticks
        ctx.fillStyle = `rgba(199, 241, 142, ${0.9 * a})`;
        ctx.fillRect(x, y, 5, 1); ctx.fillRect(x, y, 1, 5);
        ctx.fillRect(x + CELL - 4, y + CELL, 5, 1); ctx.fillRect(x + CELL, y + CELL - 4, 1, 5);
        ctx.fillStyle = `rgba(233, 246, 221, ${0.7 * a})`;
        ctx.fillText(`0x${b.hash.slice(0, 4)}`, x + 7, y + 18);
        ctx.fillStyle = `rgba(233, 246, 221, ${0.35 * a})`;
        ctx.fillText(b.hash.slice(4, 8), x + 7, y + 31);
      }
    };
    const spawn = (now: number) => {
      // keep blocks away from the centre column where the headline sits
      for (let tries = 0; tries < 8; tries++) {
        const col = Math.floor(Math.random() * cols), row = Math.floor(Math.random() * Math.max(1, rows - 3));
        const cx = (col + 0.5) * CELL / w, cy = (row + 0.5) * CELL / h;
        if (Math.abs(cx - 0.5) < 0.28 && cy > 0.25 && cy < 0.7) continue;
        if (lit.some(b => b.col === col && b.row === row)) continue;
        lit.push({ col, row, born: now, hash: hex(8) });
        return;
      }
    };
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible) return;
      if (now - lastSpawn > SPAWN_MS) { spawn(now); lastSpawn = now; }
      draw(now);
    };
    const ro = new ResizeObserver(() => { resize(); draw(performance.now()); });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; });
    io.observe(canvas);
    resize();
    if (reduce) draw(performance.now());
    else raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
  }, [reduce]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{
        WebkitMaskImage: "linear-gradient(180deg, #000 0%, #000 60%, transparent 90%)",
        maskImage: "linear-gradient(180deg, #000 0%, #000 60%, transparent 90%)",
      }}
    />
  );
}
