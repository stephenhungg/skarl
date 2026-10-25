import { SectionHeader } from "@/components/section-header";
import { LandingFigure, type LandingFigureName } from "./figures/landing-figure";

const STEPS: { n: string; fig: LandingFigureName; title: string; body: string }[] = [
  { n: "01", fig: "record", title: "Record", body: "A contributor films the task and narrates it." },
  { n: "02", fig: "check", title: "Check", body: "AI compares video with narration and flags copies." },
  { n: "03", fig: "approve", title: "Approve", body: "A person on the team signs off on each payout." },
  { n: "04", fig: "pay", title: "Pay", body: "Test USDC moves on Base Sepolia and the books balance." },
];

// Four lit panels, one per step: a row of four at 1200, two by two on tablet, stacked on mobile.
export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-it-works-title" className="py-[72px] xl:py-[108px]">
      <div className="frame">
        <SectionHeader id="how-it-works-title" eyebrow="How it works" title="From task to payout" />
        <ol className="m-0 mt-8 grid list-none grid-cols-1 gap-3 p-0 min-[810px]:grid-cols-2 min-[1200px]:grid-cols-4">
          {STEPS.map((s) => (
            <li key={s.n} className="flex flex-col gap-3">
              <LandingFigure name={s.fig} />
              <div className="flex flex-col gap-1 px-1">
                <p className="m-0 flex items-baseline gap-2 text-[15px] leading-[1.3] text-deep">
                  <span className="mono text-[12px] leading-none text-slate-500">{s.n}</span>
                  <span className="cut-regular">{s.title}</span>
                </p>
                <p className="cut-book m-0 text-[14px] leading-[1.4] text-slate-500">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
