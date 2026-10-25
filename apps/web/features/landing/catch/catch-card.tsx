import Link from "next/link";
import { EvidenceTimeline, formatDuration } from "@/components/evidence-timeline";
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

export function CatchCard({ card, active, visible }: Props) {
  const inner = (
    <div className="skc-frame">
      <div className="skc-body">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={card.status} />
          <span className="skc-chip mono">{formatDuration(card.report.source.durationMs)}</span>
          <span className="mono ml-auto text-[11px] leading-none text-[rgb(var(--paper)/.5)] max-[809px]:hidden">Example report written by hand</span>
        </div>
        <p className="skc-title cut-regular">{card.title}</p>
        <div className="mt-auto">
          {visible ? <EvidenceTimeline report={card.report} active={active} tone="dark" result={card.result} provenance={card.provenance} /> : null}
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
