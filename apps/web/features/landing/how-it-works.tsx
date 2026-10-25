import { SectionHeader } from "@/components/section-header";
import { LandingFigure, type LandingFigureName } from "./figures/landing-figure";

type Step = { fig: LandingFigureName; title: string; body: string };

const RECORD: Step = { fig: "record", title: "Record", body: "A contributor films the task and narrates it." };
const CHECK: Step = { fig: "check", title: "Check", body: "AI compares video with narration and flags copies." };
const APPROVE: Step = { fig: "approve", title: "Approve", body: "A person on the team signs off on each payout." };
const PAY: Step = { fig: "pay", title: "Pay", body: "Test USDC moves on Base Sepolia and the books balance." };

const GAP = 88; // room between panels for the arrows

function Panel({ step }: { step: Step }) {
  return (
    <div className="flex flex-col gap-3">
      <LandingFigure name={step.fig} />
      <div className="flex flex-col gap-1 px-1">
        <span className="cut-regular text-[17px] leading-[1.3] text-deep">{step.title}</span>
        <span className="cut-book text-[15px] leading-[1.4] text-slate-500">{step.body}</span>
      </div>
    </div>
  );
}

// A flowing arrow. `dir` picks the direction; the dash of light runs along it.
function Arrow({ dir }: { dir: "right" | "left" | "down" }) {
  const vertical = dir === "down";
  const len = vertical ? 64 : GAP - 16;
  const line = vertical ? `M10 2 V${len - 4}` : dir === "right" ? `M2 10 H${len - 4}` : `M${len - 2} 10 H6`;
  const head = vertical
    ? `M5 ${len - 9} L10 ${len - 3} L15 ${len - 9}`
    : dir === "right"
      ? `M${len - 9} 5 L${len - 3} 10 L${len - 9} 15`
      : `M9 5 L3 10 L9 15`;
  return (
    <svg viewBox={vertical ? `0 0 20 ${len}` : `0 0 ${len} 20`} width={vertical ? 20 : len} height={vertical ? len : 20} fill="none" aria-hidden="true">
      <path d={line} stroke="rgb(var(--haze))" strokeWidth="1.5" />
      <path d={line} stroke="rgb(var(--slate-700))" strokeWidth="1.5" strokeDasharray="8 40" className="hw-flow" />
      <path d={head} stroke="rgb(var(--slate-700))" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Arrow laid over a panel row at the vertical middle of the panel art. Padding percentages resolve against
// the row's width, and the art is 14:11, so its middle sits at (row - gap) / 2 * 11 / 28.
function RowArrow({ dir }: { dir: "right" | "left" }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 hidden min-[810px]:block" style={{ paddingTop: `calc((100% - ${GAP}px) * 11 / 56 - 10px)` }}>
      <div className="flex justify-center"><Arrow dir={dir} /></div>
    </div>
  );
}

// The four steps as a two by two flowchart: Record to Check, down to Approve, across to Pay,
// with a loop from Check back to Record for clips that fail the check.
export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-it-works-title" className="py-[72px] xl:py-[108px]">
      <style>{`
        .hw-flow { animation: hw-flow 1.8s linear infinite; }
        @keyframes hw-flow { from { stroke-dashoffset: 48; } to { stroke-dashoffset: 0; } }
        .hw-chart { --panel-w: calc((100% - ${GAP}px) / 2); }
        @media (prefers-reduced-motion: reduce) { .hw-flow { animation: none; } }
      `}</style>
      <div className="frame">
        <SectionHeader id="how-it-works-title" eyebrow="How Skarl works" title="From task to payout" />

        <div className="hw-chart relative mx-auto mt-16 max-w-[900px]">
          {/* loop back from Check to Record, arcing over the top row */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 -top-10 hidden h-10 min-[810px]:block">
            <div
              className="absolute bottom-0 h-7 rounded-t-[12px] border-x border-t border-dashed border-slate-300"
              style={{ left: "calc(var(--panel-w) / 2)", width: `calc(var(--panel-w) + ${GAP}px)` }}
            />
            <svg viewBox="0 0 12 10" width="12" height="10" fill="none" className="absolute -bottom-[3px]" style={{ left: "calc(var(--panel-w) / 2 - 6px)" }}>
              <path d="M1 2 L6 8 L11 2" stroke="rgb(var(--slate-500))" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="cut-book absolute top-[3px] -translate-x-1/2 bg-paper px-3 text-[13px] leading-none text-slate-500" style={{ left: "50%" }}>
              Doesn&apos;t match, record again
            </span>
          </div>

          <div className="grid grid-cols-1 gap-y-8 min-[810px]:gap-y-0" style={{ gridTemplateColumns: undefined }}>
            <div className="relative grid grid-cols-1 gap-8 min-[810px]:grid-cols-[1fr_88px_1fr] min-[810px]:gap-0">
              <Panel step={RECORD} />
              <div className="hidden min-[810px]:block" />
              <Panel step={CHECK} />
              <RowArrow dir="right" />
            </div>

            <div aria-hidden="true" className="hidden min-[810px]:grid min-[810px]:grid-cols-[1fr_88px_1fr]">
              <div />
              <div />
              <div className="flex justify-center py-3"><Arrow dir="down" /></div>
            </div>

            <div className="relative grid grid-cols-1 gap-8 min-[810px]:grid-cols-[1fr_88px_1fr] min-[810px]:gap-0">
              <div className="order-2 min-[810px]:order-1"><Panel step={PAY} /></div>
              <div className="hidden min-[810px]:order-2 min-[810px]:block" />
              <div className="order-1 min-[810px]:order-3"><Panel step={APPROVE} /></div>
              <RowArrow dir="left" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
