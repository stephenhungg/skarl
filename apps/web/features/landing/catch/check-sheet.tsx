"use client";
import { motion } from "motion/react";
import type { VerificationReport } from "@/components/evidence-timeline";

type Evidence = VerificationReport["criteria"][number]["evidence"][number];
import { formatMs } from "@/components/evidence-timeline";
import { StatusPill, type EvidenceStatus } from "@/components/status-pill";
import { useReducedMotionSafe } from "@/lib/use-reduced-motion";

type Verdict = "pass" | "fail" | "unclear";
type Row = { check: string; video: string; videoAt?: number; said: string; saidAt?: number; verdict: Verdict; note: string };

const CHECKS: Record<string, string> = {
  "red-cup-pickup": "Right object",
  "placed-on-coaster": "Task completed",
};

const NOTE: Record<Verdict, string> = { pass: "Match", fail: "Mismatch", unclear: "Can't see" };

function stripNarration(claim: string) {
  return claim.replace(/^Narration:\s*/, "");
}

function overlaps(a: Evidence, b: Evidence) {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

// One row per rubric check: what the silent video shows next to what the person said at that moment.
function rows(report: VerificationReport): Row[] {
  const allAudio = report.criteria.flatMap(c => c.evidence.filter(e => e.modality === "audio"));
  const out: Row[] = report.criteria
    .filter(c => CHECKS[c.criterionId])
    .map(c => {
      const video = c.evidence.find(e => e.modality === "video");
      const audio = c.evidence.find(e => e.modality === "audio") ?? (video ? allAudio.find(a => overlaps(a, video)) : undefined);
      const verdict: Verdict = c.status === "supported" ? "pass" : c.status === "contradicted" ? "fail" : "unclear";
      return {
        check: CHECKS[c.criterionId]!,
        video: video?.claim.replace(/\.$/, "") ?? "Nothing visible",
        videoAt: video?.startMs,
        said: audio ? stripNarration(audio.claim) : "Nothing said",
        saidAt: audio?.startMs,
        verdict,
        note: NOTE[verdict],
      };
    });
  const dup = report.duplicate.matches[0];
  out.push(
    report.duplicate.status === "suspected" && dup
      ? { check: "Original footage", video: `Same frames as an earlier accepted clip (${Math.round(dup.score * 100)}% match)`, said: "", verdict: "fail", note: "Copy" }
      : { check: "Original footage", video: "No earlier clip matches these frames", said: "", verdict: "pass", note: "Match" },
  );
  return out;
}

function Mark({ verdict }: { verdict: Verdict }) {
  if (verdict === "pass") {
    return (
      <span className="grid size-5 place-items-center rounded-full bg-accent text-accent-ink" aria-label="passes">
        <svg viewBox="0 0 12 12" width="10" height="10" fill="none" aria-hidden="true"><path d="M2.5 6.2 5 8.5l4.5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
    );
  }
  if (verdict === "fail") {
    return (
      <span className="grid size-5 place-items-center rounded-full bg-paper text-ink" aria-label="fails">
        <svg viewBox="0 0 12 12" width="10" height="10" fill="none" aria-hidden="true"><path d="m3.5 3.5 5 5m0-5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </span>
    );
  }
  return <span className="grid size-5 place-items-center rounded-full border border-dashed border-[rgb(var(--paper)/.6)] text-[11px] leading-none text-[rgb(var(--paper)/.8)]" aria-label="unclear">?</span>;
}

function Time({ ms }: { ms?: number }) {
  return ms === undefined ? null : <span className="mono ml-2 text-[11px] text-[rgb(var(--paper)/.45)]">{formatMs(ms)}</span>;
}

type Props = { report: VerificationReport; active: boolean; result: string; provenance: EvidenceStatus };

export function CheckSheet({ report, active, result, provenance }: Props) {
  const reduce = useReducedMotionSafe();
  const animate = active && !reduce;
  const model = report.pipeline.modelRuns[0]?.model;
  return (
    <div className="text-paper">
      <div className="mono grid grid-cols-[20px_minmax(0,1.1fr)_minmax(0,2fr)_minmax(0,1.6fr)_64px] gap-x-4 pb-2 text-[11px] uppercase tracking-[0.04em] text-[rgb(var(--paper)/.45)] max-[809px]:hidden">
        <span />
        <span>Check</span>
        <span>Video shows</span>
        <span>They said</span>
        <span className="text-right">Result</span>
      </div>
      <ul className="m-0 list-none p-0">
        {rows(report).map((row, i) => (
          <motion.li
            key={row.check}
            className="grid grid-cols-[20px_minmax(0,1.1fr)_minmax(0,2fr)_minmax(0,1.6fr)_64px] items-start gap-x-4 border-t border-[rgb(var(--paper)/.12)] py-3 text-[14px] leading-[1.3] max-[809px]:grid-cols-[20px_minmax(0,1fr)_56px] max-[809px]:gap-y-1"
            initial={animate ? { opacity: 0, y: 8 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: animate ? 0.15 + i * 0.12 : 0, duration: 0.45, ease: [0.43, 0.42, 0.37, 0.97] }}
          >
            <Mark verdict={row.verdict} />
            <span className="cut-regular">{row.check}</span>
            <span className="text-[rgb(var(--paper)/.8)] max-[809px]:col-start-2 max-[809px]:row-start-2">{row.video}<Time ms={row.videoAt} /></span>
            <span className={`max-[809px]:col-start-2 max-[809px]:row-start-3 ${row.said ? "text-[rgb(var(--paper)/.8)]" : ""}`}>
              {row.said ? <>{row.said}<Time ms={row.saidAt} /></> : null}
            </span>
            <span className={`mono text-right text-[12px] max-[809px]:col-start-3 max-[809px]:row-start-1 ${row.verdict === "pass" ? "text-accent" : "text-paper"}`}>{row.note}</span>
          </motion.li>
        ))}
      </ul>
      <motion.div
        className="flex flex-wrap items-center justify-between gap-3 border-t border-[rgb(var(--paper)/.12)] pt-3"
        initial={animate ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={{ delay: animate ? 0.6 : 0, duration: 0.45 }}
      >
        <span className="cut-regular text-[16px]">{result}</span>
        <span className="mono flex items-center gap-2 text-[11px] text-[rgb(var(--paper)/.45)]">
          {model && <span>{model}</span>}
          <StatusPill status={provenance} />
        </span>
      </motion.div>
    </div>
  );
}
