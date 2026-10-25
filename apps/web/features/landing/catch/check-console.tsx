"use client";
import { useEffect, useRef, useState } from "react";
import { formatDuration, formatMs } from "@/components/evidence-timeline";
import { StatusPill } from "@/components/status-pill";
import { useReducedMotionSafe } from "@/lib/use-reduced-motion";
import { CATCH_CARDS } from "../evidence";
import { rows, type Verdict } from "./check-sheet";

const TABS: Record<string, string> = { mismatch: "Held", retake: "Paid", duplicate: "Copy", unobservable: "Review" };

// Timing for one run: the scan line fills, each check ticks in, then the verdict prints.
const SCAN_MS = 900;
const ROW_MS = 650;
const RESOLVE_MS = 380;
const HOLD_MS = 3400;

const NOTE_TONE: Record<Verdict, string> = { pass: "text-accent", fail: "text-[#ffb4a3]", unclear: "text-fog" };

export function CheckConsole() {
  const reduce = useReducedMotionSafe();
  const [tab, setTab] = useState(0);
  const [t, setT] = useState(0); // ms into the current run
  const [inView, setInView] = useState(false);
  const [manual, setManual] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const card = CATCH_CARDS[tab]!;
  const checks = rows(card.report);
  const runMs = SCAN_MS + checks.length * ROW_MS + RESOLVE_MS;

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(!!e?.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Drive the run clock; after the verdict holds, move to the next case unless someone picked one.
  useEffect(() => {
    if (reduce) { setT(Number.MAX_SAFE_INTEGER); return; }
    if (!inView) return;
    let raf = 0;
    const start = performance.now();
    const loop = (now: number) => {
      const elapsed = now - start;
      setT(elapsed);
      if (elapsed > runMs + HOLD_MS) {
        if (!manual) { setTab(i => (i + 1) % CATCH_CARDS.length); return; }
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [tab, inView, reduce, runMs, manual]);

  const scan = Math.min(1, t / SCAN_MS);
  const dots = Math.round(scan * 28);
  const verdictShown = t >= SCAN_MS + checks.length * ROW_MS + RESOLVE_MS;

  return (
    <div ref={root} className="frame">
      <div className="mx-auto max-w-[920px]">
        <div role="tablist" aria-label="Example checks" className="mb-3 flex flex-wrap gap-2">
          {CATCH_CARDS.map((c, i) => (
            <button
              key={c.id}
              role="tab"
              type="button"
              aria-selected={i === tab}
              onClick={() => { setManual(true); setTab(i); setT(0); }}
              className={`cut-regular h-9 rounded-[10px] px-4 text-[14px] leading-none transition-colors duration-300 ${i === tab ? "bg-ink text-paper" : "bg-mist text-slate-700 hover:bg-haze"}`}
            >
              {TABS[c.id] ?? c.title}
            </button>
          ))}
        </div>

        <div className="mono overflow-hidden rounded-[14px] bg-ink text-[13px] leading-[1.4] text-paper" aria-live="polite">
          <div className="flex items-center justify-between gap-3 border-b border-[rgb(var(--paper)/.1)] px-5 py-3 text-[12px] text-[rgb(var(--paper)/.5)]">
            <span>skarl verify · clip {formatDuration(card.report.source.durationMs)} · {card.report.taskVersionId}</span>
            <span className="flex items-center gap-2">{card.report.pipeline.modelRuns[0]?.model}<StatusPill status={card.provenance} /></span>
          </div>

          <div className="px-5 py-5 max-[640px]:px-4">
            <p className="m-0 text-[rgb(var(--paper)/.7)]">
              <span className="text-accent">$</span> checking clip {"·".repeat(dots)}
              <span className="text-[rgb(var(--paper)/.3)]">{"·".repeat(28 - dots)}</span>
              {scan >= 1 && <span className="text-[rgb(var(--paper)/.5)]"> done</span>}
            </p>

            <ul className="m-0 mt-4 list-none p-0">
              {checks.map((row, i) => {
                const startAt = SCAN_MS + i * ROW_MS;
                const shown = t >= startAt;
                const resolved = t >= startAt + RESOLVE_MS;
                return (
                  <li
                    key={row.check}
                    className="grid grid-cols-[18px_minmax(0,1.1fr)_minmax(0,2fr)_minmax(0,1.5fr)_96px] items-baseline gap-x-4 border-t border-[rgb(var(--paper)/.08)] py-3 transition-[opacity,transform] duration-300 max-[760px]:grid-cols-[18px_minmax(0,1fr)_86px] max-[760px]:gap-y-1"
                    style={{ opacity: shown ? 1 : 0, transform: shown ? "none" : "translateY(6px)" }}
                  >
                    <span className="text-accent">›</span>
                    <span className="cut-regular text-[14px]">{row.check}</span>
                    <span className="text-[rgb(var(--paper)/.75)] max-[760px]:col-start-2 max-[760px]:row-start-2">
                      {row.video}{row.videoAt !== undefined && <span className="ml-2 text-[rgb(var(--paper)/.35)]">{formatMs(row.videoAt)}</span>}
                    </span>
                    <span className="text-[rgb(var(--paper)/.75)] max-[760px]:col-start-2 max-[760px]:row-start-3">
                      {row.said && <>{row.said}{row.saidAt !== undefined && <span className="ml-2 text-[rgb(var(--paper)/.35)]">{formatMs(row.saidAt)}</span>}</>}
                    </span>
                    <span className={`text-right uppercase tracking-[0.06em] max-[760px]:col-start-3 max-[760px]:row-start-1 ${resolved ? NOTE_TONE[row.verdict] : "text-[rgb(var(--paper)/.35)]"}`}>
                      {resolved ? row.note : "checking"}
                    </span>
                  </li>
                );
              })}
            </ul>

            <div
              className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-[rgb(var(--paper)/.16)] pt-4 transition-opacity duration-500"
              style={{ opacity: verdictShown ? 1 : 0 }}
            >
              <span className="flex items-center gap-3">
                <StatusPill status={card.status} />
                <span className="cut-regular text-[17px] tracking-normal">{card.result}</span>
              </span>
              <span className="cut-book text-[13px] tracking-normal text-[rgb(var(--paper)/.55)]">{card.title}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
