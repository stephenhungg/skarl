"use client";
import { SectionHeader } from "@/components/section-header";
import { CAROUSEL_CSS } from "./catch-carousel";
import { StoryCarousel } from "./catch/carousel";
import { LandingFigure, type LandingFigureName } from "./figures/landing-figure";

type Step = { id: string; fig: LandingFigureName; title: string; body: string };

const STEPS: Step[] = [
  { id: "record", fig: "record", title: "Record", body: "A contributor films the task and narrates it." },
  { id: "check", fig: "check", title: "Check", body: "AI compares video with narration and flags copies." },
  { id: "approve", fig: "approve", title: "Approve", body: "A person on the team signs off on each payout." },
  { id: "pay", fig: "pay", title: "Pay", body: "Test USDC moves on Base Sepolia and the books balance." },
];

function StepCard({ step, visible }: { step: Step; visible: boolean }) {
  return (
    <article className="skc-card">
      <div className="skc-frame">
        {visible && <LandingFigure name={step.fig} className="absolute inset-0 !aspect-auto h-full rounded-none" />}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-2 p-8 pt-20 max-[809px]:p-5"
          style={{ background: "linear-gradient(180deg, transparent, rgb(var(--ink) / .88) 60%)" }}
        >
          <p className="skc-title cut-regular">{step.title}</p>
          <p className="cut-book m-0 max-w-[460px] text-[16px] leading-[1.35] text-fog max-[809px]:text-[14px]">{step.body}</p>
        </div>
      </div>
    </article>
  );
}

// Same carousel as the verification examples: one step in front, its neighbours scaled back.
export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-it-works-title" className="skc-root relative flex w-full flex-col items-center gap-8 overflow-x-clip py-[72px] xl:py-[108px]">
      <style>{CAROUSEL_CSS}</style>
      <div className="frame">
        <SectionHeader id="how-it-works-title" eyebrow="How Skarl works" title="From task to payout" />
      </div>
      <StoryCarousel items={STEPS} label="How Skarl works" render={(step, s) => <StepCard step={step} visible={s.visible} />} />
    </section>
  );
}
