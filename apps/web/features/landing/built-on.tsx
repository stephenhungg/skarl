"use client";
import { useEffect, useRef, useState } from "react";
import { BUILT_ON, type BuiltOnItem } from "./evidence";

// M7: the set repeats until it overfills the track, then slides left at 25px/s and wraps after
// one set width plus one gap. Hover eases the speed to 0.15x over 0.4s. Paused while offscreen.
const VELOCITY = 25;
const GAP = 72;
const HOVER_RATE = 0.15;
const RATE_MS = 400;

const LOGO_H = 26;

// Logos only, through a CSS mask so every mark takes the same ink colour.
function Item({ item }: { item: BuiltOnItem }) {
  if (!item.logo) return null;
  const wide = item.logo.ratio > 1.5;
  const h = (wide ? LOGO_H : LOGO_H * 1.15) * (item.logo.scale ?? 1);
  return (
    <span
      role="img"
      aria-label={item.name}
      title={item.name}
      className="inline-block flex-none bg-ink"
      style={{
        width: h * item.logo.ratio,
        height: h,
        WebkitMaskImage: `url(${item.logo.src})`,
        maskImage: `url(${item.logo.src})`,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  );
}

export function BuiltOn() {
  const trackRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const setRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<Animation | null>(null);
  const rateRaf = useRef(0);
  const [copies, setCopies] = useState(2);
  const [still, setStill] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setStill(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    const row = rowRef.current;
    const first = setRef.current;
    if (still || !track || !row || !first) return;
    let visible = true;
    const measure = () => {
      const w = first.getBoundingClientRect().width;
      const tw = track.getBoundingClientRect().width;
      if (!w) return;
      setCopies(Math.max(2, Math.ceil(tw / (w + GAP)) + 1));
      const distance = w + GAP;
      const rate = animRef.current?.playbackRate ?? 1;
      animRef.current?.cancel();
      const anim = row.animate([{ transform: "translateX(0)" }, { transform: `translateX(${-distance}px)` }], { duration: (distance / VELOCITY) * 1000, iterations: Infinity, easing: "linear" });
      anim.playbackRate = rate;
      if (!visible) anim.pause();
      animRef.current = anim;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    ro.observe(first);
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      if (visible) animRef.current?.play();
      else animRef.current?.pause();
    });
    io.observe(track);
    return () => {
      ro.disconnect();
      io.disconnect();
      cancelAnimationFrame(rateRaf.current);
      animRef.current?.cancel();
      animRef.current = null;
    };
  }, [still]);

  const easeRate = (to: number) => {
    const anim = animRef.current;
    if (!anim) return;
    cancelAnimationFrame(rateRaf.current);
    const from = anim.playbackRate;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / RATE_MS);
      const e = 1 - Math.pow(1 - p, 3);
      anim.playbackRate = from + (to - from) * e;
      if (p < 1) rateRaf.current = requestAnimationFrame(step);
    };
    rateRaf.current = requestAnimationFrame(step);
  };

  return (
    <section className="flex w-full flex-col items-center gap-6 py-12" aria-labelledby="built-on-title">
      <p id="built-on-title" className="cut-book m-0 text-[14px] leading-[1.2] tracking-[0.01em] text-slate-300">Skarl is built on</p>
      {still ? (
        <ul className="frame m-0 flex list-none flex-wrap items-center justify-center gap-x-12 gap-y-4 p-0">
          {BUILT_ON.map(item => (
            <li key={item.name}><Item item={item} /></li>
          ))}
        </ul>
      ) : (
        <div
          ref={trackRef}
          className="relative w-full max-w-[1200px] overflow-x-clip py-1"
          style={{ maskImage: "linear-gradient(90deg, transparent 0%, #000 12%, #000 88%, transparent 100%)", WebkitMaskImage: "linear-gradient(90deg, transparent 0%, #000 12%, #000 88%, transparent 100%)" }}
          onPointerEnter={() => easeRate(HOVER_RATE)}
          onPointerLeave={() => easeRate(1)}
        >
          <div ref={rowRef} className="flex w-max items-center will-change-transform" style={{ gap: GAP }}>
            {Array.from({ length: copies }, (_, c) => (
              <div key={c} ref={c === 0 ? setRef : undefined} aria-hidden={c > 0 ? true : undefined} className="flex flex-none items-center" style={{ gap: GAP }}>
                {c === 0 ? (
                  <ul className="m-0 flex list-none items-center p-0" style={{ gap: GAP }}>
                    {BUILT_ON.map(item => <li key={item.name}><Item item={item} /></li>)}
                  </ul>
                ) : (
                  BUILT_ON.map(item => <Item key={item.name} item={item} />)
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
