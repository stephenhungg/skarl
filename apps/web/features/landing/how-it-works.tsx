"use client";
import { SectionHeader } from "@/components/section-header";
import { VerticalReel, type VerticalReelItem } from "@/components/react-bits/vertical-reel";

// The four steps in flow order on a curved reel that steps forward on its own.
const STEPS: VerticalReelItem[] = [
  { src: "/how/record.jpg", alt: "Phone on a tripod filming a desk with two cups", title: "Record", subtitle: "A contributor films the task and narrates it." },
  { src: "/how/check.jpg", alt: "Verifier screen with a film strip and a waveform", title: "Check", subtitle: "AI compares video with narration and flags copies." },
  { src: "/how/approve.jpg", alt: "Stamp landing on a signed sheet", title: "Approve", subtitle: "A person on the team signs off on each payout." },
  { src: "/how/pay.jpg", alt: "Coins moving into a chain of blocks", title: "Pay", subtitle: "Test USDC moves on Base Sepolia and the books balance." },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-it-works-title" className="py-[72px] xl:py-[108px]">
      <div className="frame">
        <SectionHeader id="how-it-works-title" eyebrow="How Skarl works" title="From task to payout" />
      </div>
      <div className="mt-6 h-[460px] w-full max-[809px]:h-[380px]">
        <VerticalReel
          items={STEPS}
          aspect={14 / 11}
          size={0.62}
          autoplay="step"
          interval={2.6}
          wheel={false}
          ariaLabel="How Skarl works: record, check, approve, pay"
          className="h-full w-full"
        />
      </div>
    </section>
  );
}
