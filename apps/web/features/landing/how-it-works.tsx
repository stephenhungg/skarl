import { SectionHeader } from "@/components/section-header";
import { LandingFigure, type LandingFigureName } from "./figures/landing-figure";

type Step = { fig: LandingFigureName; title: string; body: string; order: string };

// Reading order around the pane: Record, Check, down to Approve, back across to Pay.
// On one column the order classes put them back in sequence.
const PANES: Step[] = [
  { fig: "record", title: "Record", body: "A contributor films the task and narrates it.", order: "order-1" },
  { fig: "check", title: "Check", body: "AI compares video with narration and flags copies.", order: "order-2" },
  { fig: "pay", title: "Pay", body: "Test USDC moves on Base Sepolia and the books balance.", order: "order-4 min-[640px]:order-3" },
  { fig: "approve", title: "Approve", body: "A person on the team signs off on each payout.", order: "order-3 min-[640px]:order-4" },
];

function Pane({ step }: { step: Step }) {
  return (
    <div className="relative">
      <LandingFigure name={step.fig} className="rounded-none" />
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

// Small arrow badge that sits on a seam between two panes.
function SeamArrow({ left, top, rotate }: { left: string; top: string; rotate: number }) {
  return (
    <span
      aria-hidden="true"
      className="absolute z-10 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-paper text-ink"
      style={{ left, top }}
    >
      <svg viewBox="0 0 12 12" width="11" height="11" fill="none" style={{ transform: `rotate(${rotate}deg)` }}>
        <path d="M2 6h7.5M6.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

// The four steps as one window: four panes with thin bars between them and arrows on the seams.
export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-it-works-title" className="py-[72px] xl:py-[108px]">
      <div className="frame">
        <SectionHeader id="how-it-works-title" eyebrow="How Skarl works" title="From task to payout" />
        <div className="relative mx-auto mt-10 max-w-[760px]">
          <ol className="m-0 grid list-none grid-cols-1 gap-[6px] overflow-hidden rounded-[16px] p-0 min-[640px]:grid-cols-2">
            {PANES.map(step => (
              <li key={step.title} className={step.order}><Pane step={step} /></li>
            ))}
          </ol>
          <div className="hidden min-[640px]:block">
            <SeamArrow left="50%" top="25%" rotate={0} />
            <SeamArrow left="75%" top="50%" rotate={90} />
            <SeamArrow left="50%" top="75%" rotate={180} />
          </div>
        </div>
      </div>
    </section>
  );
}
