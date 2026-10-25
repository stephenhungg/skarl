"use client";
import Link from "next/link";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { Button } from "@/components/button";
import { ContourTide } from "@/components/react-bits/contour-tide";
import { BuiltOn } from "./built-on";
import { DEMO_VIDEO_URL } from "./evidence";

const SETTLE = [0.43, 0.42, 0.37, 0.97] as const;

function Rise({ delay, duration, children, className }: { delay: number; duration: number; children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration, ease: SETTLE }}>
      {children}
    </motion.div>
  );
}

export function Hero() {
  return (
    <section id="hero" className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-clip bg-ink pb-[180px] pt-24" aria-labelledby="hero-title">
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.25, duration: 0.65, ease: SETTLE }}
        style={{
          filter: "blur(0.6px)",
          WebkitMaskImage: "linear-gradient(180deg, #000 0%, #000 55%, transparent 88%)",
          maskImage: "linear-gradient(180deg, #000 0%, #000 55%, transparent 88%)",
        }}
      >
        <ContourTide className="h-full w-full" colors={["#7d8c76", "#eef8e3"]} backgroundColor="#10120e" horizon={0.12} interactive={false} clickRipples={false} />
      </motion.div>

      <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(60% 40% at 50% 45%, rgb(var(--ink) / .4), transparent 75%)" }} />

      <div className="pointer-events-none relative z-10 flex w-full max-w-[800px] flex-col items-center px-[18px] text-center [&_a]:pointer-events-auto">
        <Rise delay={0.25} duration={0.6}>
          <h1 id="hero-title" className="cut-regular text-[32px] leading-[1.2] tracking-[-0.015em] text-paper md:text-[42px] xl:text-[48px]">
            Get paid to record short task videos for AI teams.
          </h1>
        </Rise>
        <Rise delay={0.35} duration={0.5} className="mt-4 max-w-[600px]">
          <p className="text-[14px] leading-[1.2] tracking-[0.01em] text-fog md:text-[18px]">
            On Skarl, AI teams post tasks they need recorded, you film yourself doing one while you talk through it, and once a reviewer signs off you get paid in test USDC on Base Sepolia.
          </p>
        </Rise>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-[18px]">
          <Rise delay={0.5} duration={0.5}><Button href="/contribute" onDark>Record a demonstration</Button></Rise>
          <Rise delay={0.6} duration={0.5}><Button href="/dashboard" variant="secondary" onDark>Fund a request</Button></Rise>
        </div>
        {DEMO_VIDEO_URL && (
          <Rise delay={0.65} duration={0.5} className="mt-4">
            <Link href={DEMO_VIDEO_URL} target="_blank" rel="noopener noreferrer" className="text-[14px] text-fog underline decoration-slate-500 underline-offset-4 hover:text-paper">Watch a 3 min demo</Link>
          </Rise>
        )}
      </div>

      <div className="absolute inset-x-0 bottom-0 z-10">
        <BuiltOn onDark />
      </div>
    </section>
  );
}
