"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { formatDuration } from "@/components/evidence-timeline";
import { CheckSheet } from "./check-sheet";
import { StatusPill } from "@/components/status-pill";
import type { CatchCard as CatchCardData } from "../evidence";

function CardArrow() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="11" stroke="rgb(var(--paper))" strokeWidth="1.5" />
      <path d="M12 17V7.5m0 0L8 11.5M12 7.5l4 4" stroke="rgb(var(--paper))" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type Props = {
  card: CatchCardData;
  /** Only the center card is interactive and plays the timeline draw. */
  active: boolean;
  /** Off-screen slots skip the timeline entirely. */
  visible: boolean;
};

// The example clip fills the card; only the centre card plays it.
function ClipBackground({ clip, active }: { clip: CatchCardData["clip"]; active: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (active && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) void v.play().catch(() => {});
    else v.pause();
  }, [active]);
  return (
    <>
      <video
        ref={ref}
        src={clip.src}
        poster={clip.poster}
        muted
        loop
        playsInline
        preload="metadata"
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div aria-hidden="true" className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgb(var(--ink) / .5) 0%, rgb(var(--ink) / .12) 24%, rgb(var(--ink) / .72) 44%, rgb(var(--ink) / .96) 66%)" }} />
    </>
  );
}

export function CatchCard({ card, active, visible }: Props) {
  const inner = (
    <div className="skc-frame">
      {visible && <ClipBackground clip={card.clip} active={active} />}
      <div className="skc-body">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={card.status} />
          <span className="skc-chip mono">{formatDuration(card.report.source.durationMs)}</span>
          <span className="mono ml-auto text-[11px] leading-none text-[rgb(var(--paper)/.5)] max-[809px]:hidden">Example</span>
        </div>
        <p className="skc-title cut-regular">{card.title}</p>
        <div className="mt-auto">
          {visible ? <CheckSheet report={card.report} active={active} result={card.result} provenance={card.provenance} /> : null}
        </div>
      </div>
      {card.href && (
        <div className="skc-arrow" aria-hidden="true">
          <div className="skc-arrow-slide">
            <div className="skc-arrow-turn">
              <CardArrow />
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (card.href) {
    return (
      <Link className="skc-card" data-link="" href={card.href} tabIndex={active ? 0 : -1} aria-hidden={active ? undefined : true} aria-label={`Open this review: ${card.title}`}>
        {inner}
      </Link>
    );
  }
  return (
    <article className="skc-card" aria-hidden={active ? undefined : true} aria-label={active ? card.title : undefined}>
      {inner}
    </article>
  );
}
