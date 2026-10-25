"use client";
import { motion, useReducedMotion, type Variants } from "motion/react";
import type { CSSProperties } from "react";
import { StatusPill, type EvidenceStatus } from "./status-pill";

// Mirrors packages/contracts/schemas/verification-report.schema.json (schemaVersion 1.0).
export type EvidenceModality = "video" | "audio" | "text";
export type CriterionStatus = "supported" | "contradicted" | "unobservable";
export type VerificationEvidence = { modality: EvidenceModality; startMs: number; endMs: number; claim: string; sourceId?: string };
export type VerificationCriterion = { criterionId: string; status: CriterionStatus; evidence: VerificationEvidence[]; reason: string };
export type ModelRun = { provider: string; model: string; promptVersion: string; inputTokens?: number; outputTokens?: number; elapsedMs?: number; costUsd?: string };
export type DuplicateMatch = { submissionId: string; score: number; overlapMs: number };
export type VerificationReport = {
  schemaVersion: "1.0";
  reportId: string;
  submissionId: string;
  taskVersionId: string;
  source: { sha256: string; durationMs: number };
  pipeline: { version: string; status: "completed" | "needs_review" | "failed" | "ml_unavailable"; implementation: "scaffold" | "inference"; modelRuns: ModelRun[] };
  criteria: VerificationCriterion[];
  duplicate: { status: "not_checked" | "clear" | "suspected"; matches: DuplicateMatch[] };
  recommendation: "accept" | "request_correction" | "needs_review";
  warnings?: string[];
};

type Props = {
  report: VerificationReport;
  /** true plays the M6 draw; false or undefined renders the finished state without motion. */
  active?: boolean;
  /** When set, every evidence range becomes a button that seeks the clip to its startMs. */
  onSeek?: (ms: number) => void;
  /** "dark" for ink media panels (landing cards), "light" for paper surfaces (dashboard). */
  tone?: "light" | "dark";
  /** Overrides the result line derived from the report. */
  result?: string;
  /** Adds a provenance pill to the footer (LIVE / REPLAYED / SIMULATED). */
  provenance?: EvidenceStatus;
  className?: string;
};

/** 3100 -> "0:03.1" */
export function formatMs(ms: number) {
  const tenths = Math.round(ms / 100);
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  return `${m}:${String(s).padStart(2, "0")}.${tenths % 10}`;
}

/** 14200 -> "0:14" for duration chips. */
export function formatDuration(ms: number) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function resultLine(report: VerificationReport) {
  if (report.duplicate.status === "suspected") return "Duplicate suspected · no second payable";
  if (report.recommendation === "accept") return "Recommends acceptance · payable on approval";
  if (report.recommendation === "request_correction") return "Acceptance held · no payable created";
  return "Sent to a person · no payable yet";
}

const RANK: Record<CriterionStatus, number> = { supported: 0, unobservable: 1, contradicted: 2 };
type Mark = { key: string; lane: "video" | "audio"; startMs: number; endMs: number; status: CriterionStatus; claim: string };

function buildMarks(report: VerificationReport) {
  const marks = new Map<string, Mark>();
  for (const c of report.criteria) {
    for (const e of c.evidence) {
      const lane = e.modality === "video" ? "video" : "audio";
      const key = `${lane}-${e.startMs}-${e.endMs}`;
      const prev = marks.get(key);
      if (!prev || RANK[c.status] > RANK[prev.status]) marks.set(key, { key, lane, startMs: e.startMs, endMs: e.endMs, status: c.status, claim: prev?.claim ?? e.claim });
    }
  }
  return [...marks.values()].sort((a, b) => a.startMs - b.startMs || (a.lane === "video" ? -1 : 1));
}

// A conflict is a contradicted criterion with evidence in both lanes; the bracket spans their union.
function buildConflicts(report: VerificationReport) {
  const spans = new Map<string, { startMs: number; endMs: number }>();
  for (const c of report.criteria) {
    if (c.status !== "contradicted") continue;
    const v = c.evidence.filter(e => e.modality === "video");
    const a = c.evidence.filter(e => e.modality !== "video");
    if (!v.length || !a.length) continue;
    const all = [...v, ...a];
    const startMs = Math.min(...all.map(e => e.startMs));
    const endMs = Math.max(...all.map(e => e.endMs));
    spans.set(`${startMs}-${endMs}`, { startMs, endMs });
  }
  return [...spans.values()];
}

function focalCriterion(report: VerificationReport) {
  const both = (c: VerificationCriterion) => c.evidence.some(e => e.modality === "video") && c.evidence.some(e => e.modality !== "video");
  return (
    report.criteria.find(c => c.status === "contradicted" && both(c)) ??
    report.criteria.find(c => c.status === "unobservable") ??
    report.criteria.find(both) ??
    report.criteria[0]
  );
}

const TONES: Record<"light" | "dark", CSSProperties> = {
  dark: {
    "--tl-track": "rgb(var(--paper) / .14)",
    "--tl-text": "rgb(var(--paper) / .92)",
    "--tl-muted": "rgb(var(--paper) / .52)",
    "--tl-contra": "rgb(var(--paper))",
    "--tl-unobs": "rgb(var(--fog) / .55)",
    "--tl-dup": "rgb(var(--haze) / .4)",
    "--tl-bracket": "rgb(var(--paper))",
  } as CSSProperties,
  light: {
    "--tl-track": "rgb(var(--haze))",
    "--tl-text": "rgb(var(--ink))",
    "--tl-muted": "rgb(var(--slate-500))",
    "--tl-contra": "rgb(var(--ink))",
    "--tl-unobs": "rgb(var(--slate-300) / .6)",
    "--tl-dup": "rgb(var(--slate-300) / .45)",
    "--tl-bracket": "rgb(var(--ink))",
  } as CSSProperties,
};

const FILL: Record<CriterionStatus, string> = {
  supported: "rgb(var(--accent))",
  contradicted: "var(--tl-contra)",
  unobservable: "repeating-linear-gradient(135deg, var(--tl-unobs) 0 3px, transparent 3px 6px)",
};

const SETTLE = [0.43, 0.42, 0.37, 0.97] as const;
const LANE_DUR = 0.6;
const MARK_START = 0.38;
const MARK_STAGGER = 0.06;

export function EvidenceTimeline({ report, active, onSeek, tone = "light", result, provenance, className = "" }: Props) {
  const reduced = useReducedMotion();
  const play = active === true && !reduced;
  const dur = Math.max(report.source.durationMs, 1);
  const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / dur) * 100))}%`;

  const marks = buildMarks(report);
  const conflicts = buildConflicts(report);
  const focus = focalCriterion(report);
  const match = report.duplicate.matches[0];
  const lanes: { id: "dup" | "video" | "audio"; label: string }[] = [
    ...(match ? [{ id: "dup" as const, label: "Earlier clip" }] : []),
    { id: "video", label: "Silent video" },
    { id: "audio", label: "Narration" },
  ];
  const bracketAt = MARK_START + (marks.length + (match ? 1 : 0)) * MARK_STAGGER + 0.12;
  const resultAt = bracketAt + (conflicts.length ? 0.32 : 0.05);

  const lane: Variants = { hidden: { scaleX: 0 }, shown: (i: number) => ({ scaleX: 1, transition: { duration: LANE_DUR, ease: SETTLE, delay: i * 0.08 } }) };
  const mark: Variants = { hidden: { opacity: 0, scaleX: 0.4 }, shown: (i: number) => ({ opacity: 1, scaleX: 1, transition: { duration: 0.35, ease: SETTLE, delay: MARK_START + i * MARK_STAGGER } }) };
  const bracket: Variants = { hidden: { opacity: 0, scaleY: 0.6 }, shown: { opacity: 1, scaleY: 1, transition: { duration: 0.4, ease: SETTLE, delay: bracketAt } } };
  const fade: Variants = { hidden: { opacity: 0, y: 4, filter: "blur(4px)" }, shown: (d: number) => ({ opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.45, ease: SETTLE, delay: d } }) };

  const models = report.pipeline.modelRuns.filter(r => r.provider !== "local").map(r => r.model);
  const latency = report.pipeline.modelRuns.find(r => r.elapsedMs !== undefined)?.elapsedMs;
  const ticks = Array.from({ length: Math.floor(dur / 1000) + 1 }, (_, s) => s * 1000);

  let markIndex = 0;

  return (
    <motion.div
      key={play ? "play" : "still"}
      initial={play ? "hidden" : false}
      animate="shown"
      style={TONES[tone]}
      className={`flex w-full flex-col gap-4 text-[color:var(--tl-text)] ${className}`}
    >
      <div className="relative grid grid-cols-[68px_1fr] gap-x-3 gap-y-2 min-[810px]:grid-cols-[88px_1fr]">
        {lanes.map((l, li) => (
          <div key={l.id} className="contents">
            <span className="mono self-center text-[11px] leading-none text-[color:var(--tl-muted)] min-[810px]:text-[12px]">{l.label}</span>
            <div className="relative h-7 min-[810px]:h-9">
              <motion.span variants={lane} custom={li} className="absolute inset-x-0 top-1/2 h-px origin-left bg-[color:var(--tl-track)]" />
              {l.id === "dup" && match && (
                <motion.span
                  variants={mark}
                  custom={markIndex++}
                  title={`Matches ${match.submissionId} over ${formatMs(match.overlapMs)}`}
                  className="absolute top-1/2 h-3.5 origin-left -translate-y-1/2 rounded-[4px]"
                  style={{ left: 0, width: pct(match.overlapMs), background: "repeating-linear-gradient(90deg, var(--tl-dup) 0 2px, transparent 2px 5px)" }}
                />
              )}
              {marks.filter(m => m.lane === l.id).map(m => {
                const style: CSSProperties = { left: pct(m.startMs), width: pct(m.endMs - m.startMs), background: FILL[m.status] };
                const label = `${formatMs(m.startMs)} to ${formatMs(m.endMs)}: ${m.claim}`;
                const cls = "absolute top-1/2 h-3.5 min-[810px]:h-4 min-w-1 origin-left -translate-y-1/2 rounded-[4px]";
                const i = markIndex++;
                return onSeek ? (
                  <motion.button key={m.key} type="button" variants={mark} custom={i} title={label} aria-label={`Seek to ${label}`} onClick={() => onSeek(m.startMs)} className={`${cls} cursor-pointer`} style={style} />
                ) : (
                  <motion.span key={m.key} variants={mark} custom={i} title={label} className={cls} style={style} />
                );
              })}
            </div>
          </div>
        ))}

        {/* Conflict brackets span the video and narration lanes (the last two rows). */}
        <div className="pointer-events-none absolute bottom-6 right-0 left-[80px] h-16 min-[810px]:left-[100px] min-[810px]:h-20">
          {conflicts.map(c => (
            <motion.div key={`${c.startMs}-${c.endMs}`} variants={bracket} className="absolute -inset-y-1" style={{ left: `calc(${pct(c.startMs)} - 5px)`, width: `calc(${pct(c.endMs - c.startMs)} + 10px)` }}>
              <svg className="absolute inset-y-0 left-0 h-full w-[6px]" viewBox="0 0 6 100" preserveAspectRatio="none" aria-hidden="true">
                <path d="M6 1H1v98h5" fill="none" stroke="var(--tl-bracket)" vectorEffect="non-scaling-stroke" />
              </svg>
              <svg className="absolute inset-y-0 right-0 h-full w-[6px]" viewBox="0 0 6 100" preserveAspectRatio="none" aria-hidden="true">
                <path d="M0 1h5v98H0" fill="none" stroke="var(--tl-bracket)" vectorEffect="non-scaling-stroke" />
              </svg>
              <span className="mono absolute left-full top-1/2 ml-2 -translate-y-1/2 whitespace-nowrap text-[11px] leading-none text-[color:var(--tl-text)]">Conflict</span>
            </motion.div>
          ))}
        </div>

        {/* Axis */}
        <span />
        <motion.div variants={fade} custom={0.3} className="relative h-4" aria-hidden="true">
          {ticks.map((t, i) => (
            <span key={t} className="absolute top-0 flex flex-col items-center" style={{ left: pct(t), transform: "translateX(-50%)" }}>
              <span className="h-1 w-px bg-[color:var(--tl-track)]" />
              {i % 2 === 0 && (
                <span className={`mono mt-1 text-[10px] leading-none text-[color:var(--tl-muted)] ${i % 4 !== 0 ? "max-[809px]:hidden" : ""}`}>{i}s</span>
              )}
            </span>
          ))}
        </motion.div>
      </div>

      {(focus || match) && (
        <motion.ul variants={fade} custom={resultAt - 0.1} className="m-0 flex list-none flex-col gap-1.5 p-0">
          {match && (
            <li className="flex items-baseline gap-3 text-[13px] leading-[1.3] min-[810px]:text-[14px]">
              <span className="mono w-[52px] flex-none text-[12px] text-[color:var(--tl-muted)]">{formatMs(0)}</span>
              <span className="min-w-0 line-clamp-2">Frames match {match.submissionId} over {formatMs(match.overlapMs)} of footage.</span>
            </li>
          )}
          {focus?.evidence.slice(0, match ? 1 : 2).map(e => (
            <li key={`${e.modality}-${e.startMs}`} className="flex items-baseline gap-3 text-[13px] leading-[1.3] min-[810px]:text-[14px]">
              <span className="mono w-[52px] flex-none text-[12px] text-[color:var(--tl-muted)]">{formatMs(e.startMs)}</span>
              <span className="min-w-0 line-clamp-2">{e.claim}</span>
            </li>
          ))}
        </motion.ul>
      )}

      <motion.p variants={fade} custom={resultAt} className="cut-regular m-0 text-[14px] leading-[1.2] tracking-[0.01em] min-[810px]:text-[16px]">
        {result ?? resultLine(report)}
      </motion.p>

      <motion.div variants={fade} custom={resultAt + 0.08} className="mono flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-none text-[color:var(--tl-muted)]">
        <span>{models.join(", ") || "no model run"}</span>
        <span aria-hidden="true">·</span>
        <span>{report.pipeline.version}</span>
        <span aria-hidden="true">·</span>
        <span>latency {latency !== undefined ? `${(latency / 1000).toFixed(1)}s` : "not recorded"}</span>
        {provenance && <StatusPill status={provenance} className="ml-1 !text-[11px]" />}
      </motion.div>
    </motion.div>
  );
}
