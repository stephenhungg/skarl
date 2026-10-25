"use client";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/glaze/ui/alert";
import { Badge } from "@/components/glaze/ui/badge";
import { Button } from "@/components/glaze/ui/button";
import { Status } from "@/components/glaze/ui/status";
import { Textarea } from "@/components/glaze/ui/textarea";
import { Kbd } from "@/components/glaze/ui/kbd";
import { cn } from "@/lib/glaze/utils";
import { api, CONTROLLER, useOrderData, useOrderId, type Id } from "./data";
import { formatMs, humanize, shortHash } from "./format";
import { SubmissionStatus } from "./submissions";
import { ConfirmDialog, Loading, PageHeader, Unavailable } from "./ui";
import { toast } from "@/components/glaze/ui/toast";

type Evidence = { modality: "video" | "audio" | "text"; startMs: number; endMs: number; claim: string };
type Finding = { criterionId: string; status: "supported" | "contradicted" | "unobservable"; evidence: Evidence[]; reason: string };
type Report = {
  recommendation: "accept" | "request_correction" | "needs_review";
  source?: { durationMs: number; sha256: string };
  pipeline: { status: string; implementation: "scaffold" | "inference"; version: string; modelRuns: { provider: string; model: string; elapsedMs?: number }[] };
  criteria: Finding[];
  duplicate: { status: "not_checked" | "clear" | "suspected"; matches: { submissionId: string; score: number; overlapMs: number }[] };
  warnings?: string[];
};

const FINDING = {
  supported: { status: "ok" as const, label: "Supported", bar: "border-ok bg-ok-tint" },
  contradicted: { status: "fail" as const, label: "Contradicted", bar: "border-fail bg-fail-tint" },
  unobservable: { status: "idle" as const, label: "Unobservable", bar: "border-dashed border-line-strong bg-field" },
};

export function Review({ submissionId }: { submissionId: Id<"submissions"> }) {
  const orderId = useOrderId();
  const { summary, submissions } = useOrderData(orderId);
  const report = useQuery(api.submissions.getReport, { demoIdentity: CONTROLLER, submissionId });
  const media = useQuery(api.media.submissionEvidence, { demoIdentity: CONTROLLER, submissionId });
  const attestation = useQuery(api.attestations.forSubmission, { submissionId });
  const submission = submissions?.find(s => s._id === submissionId);
  const video = useRef<HTMLVideoElement>(null);
  const stopAt = useRef<number | null>(null);
  const [now, setNow] = useState(0);
  const [focus, setFocus] = useState<string | null>(null);

  const parsed = (report?.report ?? null) as Report | null;
  const durationMs = media?.clip?.durationMs ?? parsed?.source?.durationMs ?? 0;
  const segments = media?.transcriptSegments ?? [];

  const seek = useCallback((startMs: number, endMs?: number) => {
    const el = video.current;
    if (!el) return;
    el.currentTime = startMs / 1000;
    stopAt.current = endMs ?? null;
    void el.play().catch(() => undefined);
  }, []);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const onTime = () => {
      const ms = el.currentTime * 1000;
      setNow(ms);
      if (stopAt.current !== null && ms >= stopAt.current) { el.pause(); stopAt.current = null; }
    };
    el.addEventListener("timeupdate", onTime);
    return () => el.removeEventListener("timeupdate", onTime);
  }, [media?.clip?.url]);

  const criteria = useMemo(() => {
    const rubric = summary?.rubric?.criteria ?? [];
    const findings = parsed?.criteria ?? [];
    const ids = [...new Set([...rubric.map(c => c.criterionId), ...findings.map(f => f.criterionId)])];
    return ids.map(id => ({ id, rubric: rubric.find(c => c.criterionId === id), finding: findings.find(f => f.criterionId === id) }));
  }, [summary?.rubric, parsed?.criteria]);

  if (report === undefined || media === undefined) return <><PageHeader title="Evidence review" /><Loading rows={8} /></>;

  return (
    <>
      <PageHeader title={<>Clip <span className="mono">{submissionId.slice(0, 8)}</span></>}
        description={<span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
          <SubmissionStatus value={report.status} />
          {report.verificationOnly && <Badge variant="outline">Test upload, not licensed</Badge>}
          {parsed && parsed.recommendation !== "needs_review" && <span>AI recommends {humanize(parsed.recommendation).toLowerCase()}</span>}
          {parsed?.pipeline.modelRuns.map(run => <span key={run.model} className="text-text-3">{run.model}{run.elapsedMs ? ` ${formatMs(run.elapsedMs)}` : ""}</span>)}
        </span>}
        actions={<>
          {attestation && <a href={attestation.easscanUrl} target="_blank" rel="noreferrer" className="type-label text-text-2 underline underline-offset-4">Verify on-chain</a>}
          <Link href={`/dashboard/submissions/${submissionId}/receipt`} className="type-label text-text-2 underline underline-offset-4">Receipt</Link>
          <Link href="/dashboard/submissions" className="type-label text-text-2 underline underline-offset-4">All submissions</Link>
        </>} />

      {parsed?.duplicate.status === "suspected" && <DuplicateCompare submissionId={submissionId} matches={parsed.duplicate.matches} />}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="overflow-hidden rounded-panel border border-line-faint bg-ink">
            {media.clip?.url
              ? <video ref={video} src={media.clip.url} controls playsInline preload="metadata" className="aspect-video w-full" />
              : <div className="flex aspect-video items-center justify-center type-body-sm text-text-inverse">No playable clip. The original is missing or quarantined.</div>}
          </div>
          <EvidenceTrack criteria={criteria.map(c => c.finding).filter((f): f is Finding => !!f)} durationMs={durationMs} now={now}
            focus={focus} onFocus={setFocus} onSeek={seek} motion={media.sensorTrace?.motionSummary?.bins ?? null} />
          <Transcript segments={segments} now={now} onSeek={seek} />
          <Capture trace={media.sensorTrace} liveness={submission?.liveness ?? null}
            livenessPassed={!!parsed?.criteria.some(c => c.evidence.some(e => e.claim.startsWith("Spoken liveness matched")))} />
          {!report.verificationOnly && parsed?.warnings?.length ? <ul className="flex flex-col gap-1">{parsed.warnings.map(w => <li key={w} className="type-body-sm text-text-2">{w}</li>)}</ul> : null}
        </div>
        <aside className="flex flex-col gap-3 lg:sticky lg:top-16 lg:self-start">
          <h2 className="type-heading-sm">Criteria</h2>
          {criteria.length === 0 ? <p className="type-body-sm text-text-2">No rubric or findings for this clip.</p> : (
            <ol className="flex flex-col divide-y divide-line-faint rounded-panel border border-line-faint">
              {criteria.map(({ id, rubric, finding }) => {
                const kind = FINDING[finding?.status ?? "unobservable"];
                return (
                  <li key={id} className={cn("flex flex-col gap-1.5 p-3", focus === id && "bg-hover-row")}
                    onMouseEnter={() => setFocus(id)} onMouseLeave={() => setFocus(null)}>
                    <div className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 type-label">{rubric?.description ?? humanize(id)}</span>
                      <Status status={kind.status} size="sm">{finding ? kind.label : "No finding"}</Status>
                    </div>
                    {finding && <p className="type-body-sm text-text-2">{finding.reason}</p>}
                    {finding?.evidence.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {finding.evidence.map((e, i) => (
                          <button key={i} type="button" onClick={() => seek(e.startMs, e.endMs)} title={e.claim}
                            className="rounded-pill border border-line-control px-2 py-0.5 type-label-sm text-text-2 tabular-nums hover:bg-hover hover:text-text-1">
                            {humanize(e.modality)} {formatMs(e.startMs)} to {formatMs(e.endMs)}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
          <Decision submissionId={submissionId} status={report.status} report={parsed} verificationOnly={report.verificationOnly} />
        </aside>
      </div>
    </>
  );
}

type MotionBin = { startMs: number; endMs: number; gyroRmsRadPerSec: number | null; active: boolean };

function EvidenceTrack({ criteria, durationMs, now, focus, onFocus, onSeek, motion }: {
  criteria: Finding[]; durationMs: number; now: number; focus: string | null; onFocus: (id: string | null) => void; onSeek: (start: number, end?: number) => void;
  motion: MotionBin[] | null;
}) {
  if (!durationMs) return null;
  const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / durationMs) * 100))}%`;
  const lanes = (["video", "audio"] as const).map(modality => ({
    modality, items: criteria.flatMap(f => f.evidence.filter(e => e.modality === modality).map(e => ({ ...e, finding: f }))),
  }));
  return (
    <div className="rounded-panel border border-line-faint p-3" aria-label="Evidence timeline">
      <div className="mb-2 flex items-baseline justify-between type-label-sm text-text-3">
        <span className="ms-auto tabular-nums">{formatMs(now)} / {formatMs(durationMs)}</span>
      </div>
      <div className="relative flex flex-col gap-2">
        {lanes.map(lane => (
          <div key={lane.modality} className="flex items-center gap-3">
            <span className="w-12 shrink-0 type-label-sm text-text-2">{humanize(lane.modality)}</span>
            <div className="relative h-6 flex-1 rounded-tag bg-field">
              {lane.items.length === 0 && <span className="absolute inset-0 flex items-center px-2 type-label-sm text-text-3">No {lane.modality} evidence</span>}
              {lane.items.map((item, i) => (
                <button key={i} type="button" title={`${item.finding.criterionId}: ${item.claim}`}
                  onClick={() => onSeek(item.startMs, item.endMs)} onMouseEnter={() => onFocus(item.finding.criterionId)} onMouseLeave={() => onFocus(null)}
                  className={cn("absolute inset-y-0.5 min-w-1.5 rounded-tag border", FINDING[item.finding.status].bar, focus === item.finding.criterionId && "ring-1 ring-ink")}
                  style={{ left: pct(item.startMs), width: `max(6px, calc(${pct(item.endMs)} - ${pct(item.startMs)}))` }} />
              ))}
              <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-px bg-ink" style={{ left: pct(now) }} />
            </div>
          </div>
        ))}
        {motion && motion.length > 0 && (() => {
          const peak = Math.max(...motion.map(b => b.gyroRmsRadPerSec ?? 0), 0.01);
          return (
            <div className="flex items-center gap-3">
              <span className="w-12 shrink-0 type-label-sm text-text-2">Motion</span>
              <div className="relative h-6 flex-1 overflow-hidden rounded-tag bg-field">
                {motion.map(bin => (
                  <button key={bin.startMs} type="button" onClick={() => onSeek(bin.startMs)} title={`${formatMs(bin.startMs)}: ${bin.gyroRmsRadPerSec?.toFixed(2) ?? "no data"} rad/s${bin.active ? ", moving" : ""}`}
                    className={cn("absolute bottom-0", bin.active ? "bg-ink" : "bg-line-strong")}
                    style={{ left: pct(bin.startMs), width: `calc(${pct(bin.endMs)} - ${pct(bin.startMs)})`, height: `${Math.max(6, ((bin.gyroRmsRadPerSec ?? 0) / peak) * 100)}%` }} />
                ))}
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-px bg-ink" style={{ left: pct(now) }} />
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

type Trace = { sampleRateHz: number; sampleCount: number; sensors: string[]; device: { model: string; os: string; osVersion: string; appVersion: string };
  motionSummary?: { steadinessRatio?: number | null; meanTiltDegrees?: number | null } } | null | undefined;

/** What the phone recorded alongside the video. Client-reported; it never changes acceptance on its own. */
function Capture({ trace, liveness, livenessPassed }: { trace: Trace; liveness: { words: string[] } | null; livenessPassed: boolean }) {
  if (!trace && !liveness) return null;
  const rows: [string, React.ReactNode][] = [];
  if (trace) {
    rows.push(["Device", `${trace.device.model} \u00b7 ${trace.device.os} ${trace.device.osVersion}`]);
    rows.push(["Sensors", `${trace.sensors.length} channels at ${Math.round(trace.sampleRateHz)} Hz`]);
    if (trace.motionSummary?.steadinessRatio != null) rows.push(["Steady", `${Math.round(trace.motionSummary.steadinessRatio * 100)}% of the take`]);
    if (trace.motionSummary?.meanTiltDegrees != null) rows.push(["Tilt", `${trace.motionSummary.meanTiltDegrees.toFixed(1)}\u00b0`]);
  }
  if (liveness) rows.push(["Spoken words", <span key="l" className="flex flex-wrap items-baseline gap-2">
    <Status status={livenessPassed ? "ok" : "warn"} size="sm">{livenessPassed ? "Matched" : "Not matched"}</Status>
    <span className="text-text-2">{liveness.words.join(" ")}</span></span>]);
  return (
    <div className="rounded-panel border border-line-faint p-3">
      <p className="mb-2 type-label-sm text-text-3">Capture</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 type-body-sm">
        {rows.map(([label, value]) => <Fragment key={label}><dt className="text-text-2">{label}</dt><dd>{value}</dd></Fragment>)}
      </dl>
    </div>
  );
}

function Transcript({ segments, now, onSeek }: { segments: { startMs: number; endMs: number; text: string }[]; now: number; onSeek: (start: number) => void }) {
  return (
    <div className="rounded-panel border border-line-faint p-3">
      <p className="mb-2 type-label-sm text-text-3">Narration</p>
      {segments.length === 0 ? <p className="type-body-sm text-text-2">No narration was transcribed.</p> : (
        <p className="type-body leading-7">
          {segments.map((segment, i) => {
            const active = now >= segment.startMs && now < segment.endMs;
            return (
              <button key={i} type="button" onClick={() => onSeek(segment.startMs)} title={formatMs(segment.startMs)}
                className={cn("rounded-tag px-0.5 text-start", active ? "bg-ink text-text-inverse" : "hover:bg-hover")}>{segment.text} </button>
            );
          })}
        </p>
      )}
    </div>
  );
}

function DuplicateCompare({ submissionId, matches }: { submissionId: Id<"submissions">; matches: Report["duplicate"]["matches"] }) {
  const top = matches[0];
  const pair = useQuery(api.media.duplicatePair, top ? { demoIdentity: CONTROLLER, submissionId, matchingSubmissionId: top.submissionId as Id<"submissions"> } : "skip");
  if (!top) return null;
  const frames = (pair?.matchedFrames ?? []).filter(f => f.leftFrame?.url && f.rightFrame?.url).slice(0, 4);
  return (
    <Alert status="fail" className="mb-6">
      <AlertTitle>Suspected copy of clip {top.submissionId.slice(0, 8)}</AlertTitle>
      <AlertDescription>
        <p>Similarity {(top.score * 100).toFixed(0)}% over {formatMs(top.overlapMs)} of footage{pair?.exactSourceMatch ? ", identical source bytes" : ""}. No payable can be created while this stands. This is evidence for review, not a fraud verdict.</p>
        {frames.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {frames.map((frame, i) => (
              <figure key={i} className="flex flex-col gap-1">
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-tag">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={frame.leftFrame!.url!} alt={`This clip at ${formatMs(frame.leftTimestampMs)}`} className="aspect-square w-full object-cover" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={frame.rightFrame!.url!} alt={`Matched clip at ${formatMs(frame.rightTimestampMs)}`} className="aspect-square w-full object-cover" />
                </div>
                <figcaption className="type-label-sm text-text-3 tabular-nums">{formatMs(frame.leftTimestampMs)} vs {formatMs(frame.rightTimestampMs)}, distance {frame.distance}</figcaption>
              </figure>
            ))}
          </div>
        )}
        <Link href={`/dashboard/submissions/${top.submissionId}`} className="mt-2 inline-block underline underline-offset-4">Open matched clip</Link>
      </AlertDescription>
    </Alert>
  );
}

const REASON = { accept: "evidence_supports_rubric", request_correction: "correction_requested", reject: "evidence_contradicts_rubric" } as const;

function Decision({ submissionId, status, report, verificationOnly }: { submissionId: Id<"submissions">; status: string; report: Report | null; verificationOnly: boolean }) {
  const review = useMutation(api.review.reviewSubmission);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<keyof typeof REASON | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const reviewable = status === "needs_review" || status === "needs_correction";
  const acceptBlock = verificationOnly ? "Test uploads are not licensed, so they cannot be accepted or paid."
    : !report ? "There is no analysis report to accept against."
    : report.pipeline.implementation === "scaffold" ? "Scaffold analysis cannot support an acceptance."
    : report.duplicate.status === "suspected" ? "A suspected copy blocks acceptance until it is resolved."
    : null;

  const [confirming, setConfirming] = useState(false);

  /** Sends one decision. Throws on refusal so a confirm dialog can stay open with the reason. */
  async function send(decision: keyof typeof REASON) {
    const response = await review({ demoIdentity: CONTROLLER, submissionId, decision, reasonCode: REASON[decision], note: note.trim() });
    if (!response.ok) {
      const text = `Refused: ${humanize(response.code)}.`;
      setResult({ ok: false, text });
      toast.fail("Decision refused", { description: humanize(response.code) });
      throw new Error(text);
    }
    const text = decision === "accept"
      ? ("payableId" in response && response.payableId ? "Accepted. A payable and a balanced journal entry were posted." : "Accepted and recorded.")
      : decision === "reject" ? "Rejected. No payable was created." : "Retake requested. No payable was created.";
    setResult({ ok: true, text });
    toast.success(decision === "accept" ? "Clip accepted" : decision === "reject" ? "Clip rejected" : "Retake requested", { description: text });
  }

  async function decide(decision: keyof typeof REASON) {
    if (!note.trim()) { setResult({ ok: false, text: "Write a note first. Every decision is stored with its reason." }); document.getElementById("decision-note")?.focus(); return; }
    if (decision === "accept") { setConfirming(true); return; }
    setBusy(decision); setResult(null);
    try { await send(decision); } catch { /* shown inline and as a toast */ } finally { setBusy(null); }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest("input, textarea")) return;
      if (event.key === "c") document.getElementById("decision-note")?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!reviewable) return <p className="rounded-panel border border-line-faint p-3 type-body-sm text-text-2">This clip is {humanize(status).toLowerCase()}. It is not waiting on a review.</p>;
  return (
    <div className="shell">
      <div className="panel flex flex-col gap-2 p-3">
        <label htmlFor="decision-note" className="flex items-center justify-between type-label">Decision note <Kbd keys="c" /></label>
        <Textarea id="decision-note" value={note} onChange={event => setNote(event.target.value)} rows={2} placeholder="What you saw, in a sentence" />
        {acceptBlock && <p className="type-label-sm text-text-2">{acceptBlock}</p>}
        {result && <p role="status" className={cn("type-label-sm", result.ok ? "text-ok-text" : "text-fail-text")}>{result.text}</p>}
      </div>
      <div className="shell-foot flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" className="me-auto" disabled={!!busy} onClick={() => decide("reject")}>Reject</Button>
        <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => decide("request_correction")}>Request correction</Button>
        <Button size="sm" disabled={!!busy || !!acceptBlock} onClick={() => decide("accept")}>Accept</Button>
      </div>
      <ConfirmDialog open={confirming} onOpenChange={setConfirming} title="Accept this clip?" actionLabel="Accept and create payable"
        description="This delivers the sample to the buyer and creates what the contributor is owed."
        onConfirm={() => send("accept")}>
        <p className="type-body-sm text-text-2">Your note: <span className="text-text-1">{note.trim()}</span></p>
      </ConfirmDialog>
    </div>
  );
}
