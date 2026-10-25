"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { CSS, DEFS, esc, frame, slits } from "./kit";
import type { IsoApi, IsoFigureDef } from "./types";

const SVGNS = "http://www.w3.org/2000/svg";
const ASPECT = 14 / 11;

// Shared tokens, classes and gradients go in once per page. Gradients live in one hidden svg that
// carries the tokens, so every figure resolves url(#rw-*) to the same defs.
function installShared() {
  if (!document.getElementById("iso-lumen-css")) {
    const el = document.createElement("style");
    el.id = "iso-lumen-css";
    el.textContent = CSS;
    document.head.appendChild(el);
  }
  if (!document.getElementById("iso-lumen-defs")) {
    const svg = document.createElementNS(SVGNS, "svg");
    svg.id = "iso-lumen-defs";
    svg.setAttribute("class", "iso-scope");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden");
    svg.innerHTML = `<defs>${DEFS}</defs>`;
    document.body.appendChild(svg);
  }
}

function installFigureCss(fig: IsoFigureDef) {
  if (!fig.css) return;
  const id = `iso-fig-css-${fig.id}`;
  if (document.getElementById(id)) return;
  const el = document.createElement("style");
  el.id = id;
  el.textContent = fig.css;
  document.head.appendChild(el);
}

type Props = { figure: IsoFigureDef; className?: string; label?: string };

export function IsoFigure({ figure, className, label }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    installShared();
    installFigureCss(figure);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timeouts = new Set<number>();
    const intervals = new Set<number>();
    const loops = new Set<(t: number) => void>();
    let visible = false;
    let raf = 0;
    let alive = true;

    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("class", "iso-stage");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label ?? figure.aria);
    svg.dataset.fig = figure.id;
    svg.dataset.paused = "";
    host.replaceChildren(svg);

    const tick = (t: number) => {
      raf = 0;
      if (!alive || !visible) return;
      loops.forEach((fn) => fn(t));
      raf = requestAnimationFrame(tick);
    };
    const start = () => { if (!raf && !reduced && loops.size) raf = requestAnimationFrame(tick); };
    const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };

    const api: IsoApi = {
      iso: { frame: (pts, margin) => frame(pts, margin, ASPECT), slits, esc },
      after: (ms, fn) => {
        const id = window.setTimeout(() => { timeouts.delete(id); if (alive) fn(); }, ms);
        timeouts.add(id);
      },
      every: (ms, fn) => {
        if (reduced) return;
        intervals.add(window.setInterval(() => { if (alive && visible) fn(); }, ms));
      },
      loop: (fn) => {
        if (reduced) {
          requestAnimationFrame((t) => { if (alive) fn(t); });
          return () => {};
        }
        loops.add(fn);
        if (visible) start();
        return () => { loops.delete(fn); };
      },
      flash: (el, ms = 160) => {
        if (!el) return;
        el.classList.add("down", "lit");
        api.after(110, () => el.classList.remove("down"));
        api.after(ms, () => el.classList.remove("lit"));
      },
      replay: (el, cls = "go") => {
        if (!el) return;
        el.classList.remove(cls);
        void el.getBoundingClientRect();
        el.classList.add(cls);
      },
      readout: () => {},
      power: (on) => { host.dataset.power = on ? "on" : "off"; },
      reduced,
    };

    const handle = figure.mount(svg, api) || {};
    if (reduced && handle.demo) handle.demo();

    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible) { delete svg.dataset.paused; start(); }
        else { svg.dataset.paused = ""; stop(); }
      },
      { rootMargin: "80px" },
    );
    io.observe(host);

    return () => {
      alive = false;
      io.disconnect();
      stop();
      timeouts.forEach((id) => clearTimeout(id));
      intervals.forEach((id) => clearInterval(id));
      loops.clear();
      handle.unmount?.();
      svg.remove();
    };
  }, [figure, label]);

  return (
    <div
      ref={hostRef}
      data-power="off"
      className={cn(
        "iso-scope iso-host relative aspect-[14/11] w-full overflow-hidden rounded-[12px] bg-ink",
        className,
      )}
    />
  );
}
