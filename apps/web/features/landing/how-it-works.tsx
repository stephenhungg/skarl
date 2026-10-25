"use client";
import { SectionHeader } from "@/components/section-header";
import { CAROUSEL_CSS } from "./catch-carousel";
import { StoryCarousel } from "./catch/carousel";
import { useEffect, useRef, useState } from "react";

type Step = { id: string; title: string; body: string };

const STEPS: Step[] = [
  { id: "record", title: "Record", body: "A contributor films the task and narrates it." },
  { id: "check", title: "Check", body: "AI compares video with narration and flags copies." },
  { id: "approve", title: "Approve", body: "A person on the team signs off on each payout." },
  { id: "pay", title: "Pay", body: "Test USDC moves on Base Sepolia and the books balance." },
];

// Silent clips for each step, played back to back on a loop; only the centre card plays.
const CLIPS: Record<string, string[]> = {
  record: ["/steps/record.mp4"],
  check: ["/steps/check.mp4"],
  approve: ["/steps/approve.mp4"],
  pay: ["/steps/pay-card.mp4", "/steps/pay.mp4"],
};

function StepClip({ id, active }: { id: string; active: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [part, setPart] = useState(0);
  const sources = CLIPS[id] ?? [];
  const single = sources.length < 2;
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (active && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) void v.play().catch(() => {});
    else v.pause();
  }, [active, part]);
  return (
    <video
      ref={ref}
      src={sources[part]}
      poster={`/steps/${id}.jpg`}
      muted
      loop={single}
      playsInline
      preload="metadata"
      aria-hidden="true"
      onEnded={single ? undefined : () => setPart(p => (p + 1) % sources.length)}
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}

function StepCard({ step, visible, active }: { step: Step; visible: boolean; active: boolean }) {
  return (
    <article className="skc-card">
      <div className="skc-frame">
        {visible && <StepClip id={step.id} active={active} />}
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
      <StoryCarousel items={STEPS} label="How Skarl works" render={(step, s) => <StepCard step={step} visible={s.visible} active={s.active} />} />
    </section>
  );
}
