"use client";
import { useEffect, useRef, useState } from "react";
import { SectionHeader } from "@/components/section-header";
import { useReducedMotionSafe } from "@/lib/use-reduced-motion";
import { LandingFigure, type LandingFigureName } from "./figures/landing-figure";

type Step = { fig: LandingFigureName; title: string; body: string };

// Grid positions: Record and Check on top, Pay and Approve below, so the focus travels around the square.
// `step` is the place in the flow; `order` puts a single column back in sequence.
const PANES: (Step & { step: number; order: string })[] = [
  { fig: "record", title: "Record", body: "A contributor films the task and narrates it.", order: "order-1", step: 0 },
  { fig: "check", title: "Check", body: "AI compares video with narration and flags copies.", order: "order-2", step: 1 },
  { fig: "pay", title: "Pay", body: "Test USDC moves on Base Sepolia and the books balance.", order: "order-4 min-[640px]:order-3", step: 3 },
  { fig: "approve", title: "Approve", body: "A person on the team signs off on each payout.", order: "order-3 min-[640px]:order-4", step: 2 },
];

const STEP_MS = 2600;

function Pane({ step, out }: { step: Step; out: boolean }) {
  return (
    <div
      className="relative overflow-hidden rounded-[12px] transition-[filter,opacity,transform] duration-700"
      style={{
        filter: out ? "blur(2px) brightness(.8)" : "none",
        opacity: out ? 0.7 : 1,
        transform: out ? "scale(.985)" : "none",
        transitionTimingFunction: "cubic-bezier(.43,.42,.37,.97)",
      }}
    >
      <LandingFigure name={step.fig} />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-1 px-5 pb-4 pt-12"
        style={{ background: "linear-gradient(180deg, transparent, rgb(var(--ink) / .85) 55%)" }}
      >
        <span className="cut-regular text-[16px] leading-[1.25] text-paper">{step.title}</span>
        <span className="cut-book text-[13px] leading-[1.35] text-fog">{step.body}</span>
      </div>
    </div>
  );
}

// The four steps as a tight two by two grid. One panel is in focus at a time and the focus walks the flow
// every few seconds; hovering a panel takes over until the pointer leaves.
export function HowItWorks() {
  const reduce = useReducedMotionSafe();
  const [active, setActive] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [visible, setVisible] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (reduce || !visible || hover !== null) return;
    const id = setInterval(() => setActive(a => (a + 1) % PANES.length), STEP_MS);
    return () => clearInterval(id);
  }, [reduce, visible, hover]);

  const focus = hover ?? active;

  return (
    <section id="how-it-works" aria-labelledby="how-it-works-title" className="py-[72px] xl:py-[108px]">
      <div className="frame">
        <SectionHeader id="how-it-works-title" eyebrow="How Skarl works" title="From task to payout" />
        <div ref={root} className="mx-auto mt-10 max-w-[760px]" onMouseLeave={() => setHover(null)}>
          <ol className="m-0 grid list-none grid-cols-1 gap-[10px] p-0 min-[640px]:grid-cols-2">
            {PANES.map(p => (
              <li key={p.title} className={p.order} onMouseEnter={() => setHover(p.step)} aria-current={focus === p.step ? "step" : undefined}>
                <Pane step={p} out={!reduce && focus !== p.step} />
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
