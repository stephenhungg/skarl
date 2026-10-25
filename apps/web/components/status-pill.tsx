export type EvidenceStatus = "LIVE" | "REPLAYED" | "SIMULATED" | "PLANNED" | "HELD" | "ACCEPTED" | "DUPLICATE" | "REVIEW";

// Accent only for things that ran and passed. Everything else stays in the neutral ramp.
const TONE: Record<EvidenceStatus, string> = {
  LIVE: "bg-accent text-accent-ink",
  ACCEPTED: "bg-accent text-accent-ink",
  REPLAYED: "bg-mist text-slate-700",
  SIMULATED: "bg-mist text-slate-700",
  PLANNED: "bg-mist text-slate-500",
  HELD: "bg-haze text-ink",
  DUPLICATE: "bg-haze text-ink",
  REVIEW: "bg-haze text-ink",
};

export function StatusPill({ status, className = "" }: { status: EvidenceStatus; className?: string }) {
  return <span className={`mono inline-flex items-center rounded-[6px] px-1.5 py-[3px] text-[12px] leading-none ${TONE[status]} ${className}`}>{status}</span>;
}
