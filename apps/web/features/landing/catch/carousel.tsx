"use client";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { CATCH_CARDS } from "../evidence";
import { CatchCard } from "./catch-card";

// Ported from the measured Kled-style stories carousel. Cards are spaced by exactly one card width;
// the 0.95 side scale opens the visible gap. Slots at +/-2 wait off screen at opacity 0.
const SIDE_SCALE = 0.95;
// After a move the middle card ignores the pointer for this long, so its hover cannot fire mid slide.
const HOVER_DELAY_MS = 400;
const OFFSETS = [-2, -1, 0, 1, 2] as const;
const SWIPE_PX = 40;

export function CatchCarousel() {
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const [inView, setInView] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const downX = useRef<number | null>(null);
  const n = CATCH_CARDS.length;
  const at = (i: number) => ((i % n) + n) % n;

  useEffect(() => {
    const t = setTimeout(() => setReady(true), HOVER_DELAY_MS);
    return () => clearTimeout(t);
  }, [index]);

  // The first draw waits until the carousel is on screen.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) {
        setInView(true);
        io.disconnect();
      }
    }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const go = (next: number) => {
    setReady(false);
    setIndex(next);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") { e.preventDefault(); go(index + 1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); go(index - 1); }
  };
  const onDown = (e: PointerEvent) => { downX.current = e.clientX; };
  const onUp = (e: PointerEvent) => {
    if (downX.current === null) return;
    const dx = e.clientX - downX.current;
    downX.current = null;
    if (Math.abs(dx) > SWIPE_PX) go(index + (dx < 0 ? 1 : -1));
  };

  const current = CATCH_CARDS[at(index)]!;

  return (
    <div ref={rootRef} className="flex w-full flex-col items-center gap-6">
      <div
        className="skc-track"
        role="region"
        aria-roledescription="carousel"
        aria-label="Example reviews"
        tabIndex={0}
        onKeyDown={onKey}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerCancel={() => { downX.current = null; }}
      >
        <div className="skc-rail">
          {OFFSETS.map(offset => {
            const slot = index + offset;
            const card = CATCH_CARDS[at(slot)]!;
            const center = offset === 0;
            const side = offset === -1 || offset === 1;
            return (
              <div
                key={slot}
                className="skc-slot"
                data-pos={center ? "center" : side ? "side" : "off"}
                role={side ? "button" : undefined}
                tabIndex={side ? -1 : undefined}
                aria-label={side ? `Show: ${card.title}` : undefined}
                aria-hidden={center || side ? undefined : true}
                onClick={side ? () => go(slot) : undefined}
                style={{ "--skc-o": offset, "--skc-s": center ? 1 : SIDE_SCALE } as CSSProperties}
              >
                <div className="skc-slot-inner" style={{ pointerEvents: center && ready ? "auto" : "none" }}>
                  <CatchCard card={card} active={center && inView} visible={center || side} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button type="button" className="skc-nav" aria-label="Previous example" onClick={() => go(index - 1)}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <div className="flex items-center gap-1.5" aria-hidden="true">
          {CATCH_CARDS.map((c, i) => (
            <span key={c.id} className="h-[3px] rounded-full transition-[width,background-color] duration-500 ease-[var(--ease-slide)]" style={{ width: i === at(index) ? 24 : 8, background: i === at(index) ? "rgb(var(--deep))" : "rgb(var(--haze))" }} />
          ))}
        </div>
        <button type="button" className="skc-nav" aria-label="Next example" onClick={() => go(index + 1)}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      <p className="sr-only" aria-live="polite">{`Showing ${at(index) + 1} of ${n}: ${current.title}`}</p>
    </div>
  );
}
