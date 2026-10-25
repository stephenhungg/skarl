"use client";

import { useConvex, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/glaze/ui/badge";
import { Button } from "@/components/glaze/ui/button";
import { ChartContainer, ChartFrame, ChartPlot, linearPath } from "@/components/glaze/ui/chart";
import { Timeline } from "@/components/glaze/ui/timeline";
import { api, BUYER, type Id } from "@/features/dashboard/data";
import { formatMs, humanize } from "@/features/dashboard/format";
import { cn } from "@/lib/glaze/utils";
import { checkSpokenLiveness } from "../../../../convex/lib/spokenLiveness";
import { motionMagnitudes, readJudges, type MotionPoint } from "./evidence";

type Quality = FunctionReturnType<typeof api.datasets.sampleQuality>;
type Receipt = FunctionReturnType<typeof api.witnessReceipt.forSubmission>;
type Trace = NonNullable<FunctionReturnType<typeof api.media.submissionEvidence>["sensorTrace"]>;

export function ReplayEvidencePanels({ submissionId, currentTimeMs, onSeek, demoIdentity = BUYER, refreshKey = 0 }: {
  submissionId: Id<"submissions">; currentTimeMs: number; onSeek: (tMs: number) => void; demoIdentity?: string; refreshKey?: number;
}) {
  const args = { demoIdentity, submissionId };
  const convex = useConvex();
  const media = useQuery(api.media.submissionEvidence, args);
  const stored = useQuery(api.submissions.getReport, args);
  const [quality, setQuality] = useState<Quality | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [extrasLoading, setExtrasLoading] = useState(true);
  const [extrasError, setExtrasError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    setQuality(null); setReceipt(null); setExtrasLoading(true); setExtrasError(false);
    void Promise.allSettled([
      convex.query(api.datasets.sampleQuality, { demoIdentity, submissionId }),
      convex.query(api.witnessReceipt.forSubmission, { demoIdentity, submissionId }),
    ]).then(([qualityResult, receiptResult]) => {
      if (!alive) return;
      if (qualityResult.status === "fulfilled") setQuality(qualityResult.value);
      if (receiptResult.status === "fulfilled") setReceipt(receiptResult.value);
      setExtrasError(qualityResult.status === "rejected" || receiptResult.status === "rejected");
      setExtrasLoading(false);
    });
    return () => { alive = false; };
  }, [convex, demoIdentity, submissionId, stored?.analysisCompletedAt, refreshKey, retry]);
  const judges = useMemo(() => readJudges(stored?.report, stored?.observations), [stored?.report, stored?.observations]);
  const segments = media?.transcriptSegments ?? [];
  const durationMs: number = media?.clip?.durationMs ?? stored?.report?.source?.durationMs ?? 0;
  const audio = stored?.observations?.audio;
  const audioModels = (stored?.report?.pipeline?.modelRuns ?? []).filter((run: { promptVersion?: string }) => ["audio-only-events-v1", "audio-only-events-v2"].includes(run.promptVersion ?? "")).map((run: { model: string }) => run.model);
  const liveness = checkSpokenLiveness(stored?.liveness, audio, durationMs);
  const livenessWitness = receipt?.witnesses.find(row => row.key === "spoken_liveness");

  return <aside className="flex min-w-0 flex-col gap-6" aria-label="Replay witnesses">
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby="replay-jury-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="replay-jury-title" className="type-heading-sm">Jury evidence</h3><Badge variant="outline">Stored advisory</Badge>
      </div>
      {media === undefined || stored === undefined ? <p className="type-body-sm text-text-2">Loading stored witnesses.</p>
        : judges.length === 0 ? <p className="type-body-sm text-text-2">No completed visual inference is recorded. No agreement is inferred.</p>
        : judges.map((judge, index) => {
          const spans = judge.criteria.flatMap(criterion => criterion.evidence.map((evidence, i) => ({
            id: `${index}:${criterion.criterionId}:${i}`, label: `${humanize(criterion.criterionId)} · ${humanize(criterion.status)}`,
            start: evidence.startMs, end: evidence.endMs,
            status: criterion.status === "contradicted" ? "fail" as const : criterion.status === "unobservable" ? "warn" as const : "ok" as const,
          })));
          const active = spans.find(span => currentTimeMs >= span.start && currentTimeMs < span.end);
          return <div key={`${judge.model}:${index}`} className="flex min-w-0 flex-col gap-2">
            <p className="type-label break-words">{judge.model}</p>
            <p className="type-caption text-text-3 break-words">Pipeline {judge.version}. Stored model ID above; no separate model revision is recorded.</p>
            {judge.failure ? <p className="type-body-sm text-warn-text">{judge.failure}. Missing output is not agreement.</p>
              : spans.length ? <Timeline frame="none" label={`${judge.model} evidence on clip clock`} spans={spans} now={durationMs}
                activeId={active?.id} onSpanClick={span => onSeek(span.start)} maxHeight={216} />
              : <p className="type-body-sm text-text-2">No timestamped criterion evidence.</p>}
            {judge.criteria.map(criterion => <div key={criterion.criterionId} className="flex flex-col gap-1 border-t border-line-faint pt-2">
              <p className="type-label-sm">{humanize(criterion.criterionId)}: {humanize(criterion.status)}</p>
              <p className="type-body-sm text-text-2">{criterion.reason}</p>
              {criterion.evidence.map((evidence, i) => <div key={i} className="flex items-start gap-2">
                <Button size="sm" variant="secondary" onClick={() => onSeek(evidence.startMs)} aria-label={`Seek ${criterion.criterionId} evidence at ${formatMs(evidence.startMs)}`}>{formatMs(evidence.startMs)}</Button>
                <p className="type-caption text-text-2">{humanize(evidence.modality)}: {evidence.claim}</p>
              </div>)}
            </div>)}
          </div>;
        })}
    </section>

    <section className="flex flex-col gap-2" aria-labelledby="replay-transcript-title">
      <h3 id="replay-transcript-title" className="type-heading-sm">Aligned transcript</h3>
      <p className="type-caption text-text-3">Stored audio transcription, untrusted narration. Timing is at segment precision. Model {audioModels.join(", ") || "not recorded"}; pipeline {stored?.report?.pipeline?.version || "version not recorded"}.</p>
      {segments.length ? <ol className="flex max-h-64 flex-col gap-2 overflow-y-auto" aria-label="Transcript segments">
        {segments.map((segment, index) => <li key={index} className={cn("flex items-start gap-2 rounded-tag p-1", currentTimeMs >= segment.startMs && currentTimeMs < segment.endMs && "bg-hover-row")}>
          <Button size="sm" variant="secondary" onClick={() => onSeek(segment.startMs)} aria-label={`Seek transcript at ${formatMs(segment.startMs)}`}>{formatMs(segment.startMs)}</Button>
          <p className="type-body-sm text-text-2">{segment.text}</p>
        </li>)}
      </ol> : <p className="type-body-sm text-text-2">No timestamped transcript is stored.</p>}
    </section>

    <section className="flex flex-col gap-2" aria-labelledby="replay-liveness-title">
      <h3 id="replay-liveness-title" className="type-heading-sm">Spoken liveness</h3>
      {stored?.liveness?.words?.length ? <p className="type-body-sm">Issued words: {stored.liveness.words.join(" · ")}</p> : null}
      <p className="type-body-sm text-text-2">{livenessWitness?.detail ?? (liveness.status === "passed" ? liveness.evidence.claim : liveness.warning)}</p>
      {liveness.status === "passed" && <Button size="sm" variant="secondary" className="self-start" onClick={() => onSeek(liveness.evidence.startMs)}>Seek match at {formatMs(liveness.evidence.startMs)}</Button>}
      <p className="type-caption text-text-3">Deterministic challenge/transcript comparison. Containing segment bounds; no word-level timing or speaker identity is inferred.</p>
    </section>

    <MotionEvidence trace={media?.sensorTrace ?? null} currentTimeMs={currentTimeMs} onSeek={onSeek} />

    <section className="flex min-w-0 flex-col gap-3" aria-labelledby="replay-quality-title">
      <h3 id="replay-quality-title" className="type-heading-sm">Source checks</h3>
      {receipt?.witnesses.filter(row => row.key === "duplicate_check" || row.key === "eas_attestation" || row.key === "detector").map(row => <div key={row.key} className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2"><span className="type-label-sm">{row.key === "duplicate_check" ? "Duplicate heuristic" : row.key === "detector" ? "Browser detector corroboration" : "EAS, Base Sepolia"}</span>
          <Badge variant={row.status === "disagree" ? "fail" : row.status === "agree" ? "ok" : "outline"}>{humanize(row.status)}</Badge></div>
        <p className="type-caption text-text-2">{row.detail}</p>
        {row.evidenceUrl && <a className="type-label-sm text-text-2 underline underline-offset-4" href={row.evidenceUrl} target="_blank" rel="noreferrer">Open attestation witness</a>}
      </div>)}
      {quality && <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2"><span className="type-label">Quality {quality.qualityScore}/100</span><Badge variant="outline">Advisory heuristic</Badge></div>
        <p className="type-caption text-text-3">{quality.method} · {humanize(quality.evidenceBasis)}</p>
        {quality.usableStartMs !== null && quality.usableEndMs !== null && <Button size="sm" variant="secondary" className="self-start" onClick={() => onSeek(quality.usableStartMs!)}>Seek supported bounds {formatMs(quality.usableStartMs)} to {formatMs(quality.usableEndMs)}</Button>}
        {quality.capReasons.length ? <p className="type-caption text-warn-text">Score capped: {quality.capReasons.map(humanize).join(", ")}</p> : null}
        <p className="type-caption text-text-2">Supported bounds do not guarantee continuous useful action. This score changes no verdict or payment.</p>
      </div>}
      {extrasLoading && <p className="type-body-sm text-text-2">Loading quality and source checks.</p>}
      {extrasError && <div className="flex flex-col items-start gap-2"><p role="status" className="type-body-sm text-text-2">Some source checks are unavailable. The optional queries may not be deployed or accessible.</p><Button size="sm" variant="secondary" onClick={() => setRetry(value => value + 1)}>Retry source checks</Button></div>}
    </section>
  </aside>;
}

function MotionEvidence({ trace, currentTimeMs, onSeek }: { trace: Trace | null; currentTimeMs: number; onSeek: (tMs: number) => void }) {
  const [raw, setRaw] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setRaw(null); setError(""); setLoading(!!trace?.url);
    if (!trace?.url) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => { controller.abort(); setLoading(false); setError("Raw sensor trace timed out. Stored summary is still shown."); }, 15_000);
    void fetch(trace.url, { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("Sensor trace could not be read.");
      const body = await response.text();
      if (body.length > 2 * 1024 * 1024) throw new Error("Sensor trace exceeds its size limit.");
      const json: unknown = JSON.parse(body);
      motionMagnitudes(json, "gyroscope", trace.durationMs);
      motionMagnitudes(json, "accelerometer", trace.durationMs);
      if (!controller.signal.aborted) setRaw(json);
    }).catch(() => { if (!controller.signal.aborted) setError("Raw sensor trace unavailable. Stored summary is still shown."); })
      .finally(() => { clearTimeout(timeout); if (!controller.signal.aborted) setLoading(false); });
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [trace?.url, retry]);
  const gyro = useMemo(() => motionMagnitudes(raw, "gyroscope", trace?.durationMs ?? 0), [raw, trace?.durationMs]);
  const accel = useMemo(() => motionMagnitudes(raw, "accelerometer", trace?.durationMs ?? 0), [raw, trace?.durationMs]);
  const summary = trace?.motionSummary;
  return <section className="flex min-w-0 flex-col gap-3" aria-labelledby="replay-motion-title">
    <h3 id="replay-motion-title" className="type-heading-sm">Phone motion</h3>
    <p className="type-caption text-text-3">Client-reported IMU, on the phone callback clock. Alignment with video is approximate; this is not proof of the filmed action.</p>
    {!trace ? <p className="type-body-sm text-text-2">No sensor trace attached. Missing sensors do not mean a steady camera.</p> : <>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 type-body-sm">
        <dt className="text-text-2">Steadiness</dt><dd>{summary?.steadinessRatio == null ? "Unavailable" : `${(summary.steadinessRatio * 100).toFixed(0)}% of gyro samples ≤ 0.15 rad/s`}</dd>
        <dt className="text-text-2">Mean tilt</dt><dd>{summary?.meanTiltDegrees == null ? "Unavailable" : `${summary.meanTiltDegrees.toFixed(1)}° portrait horizon roll`}</dd>
        <dt className="text-text-2">Clock</dt><dd className="break-words">{trace.clock}</dd>
      </dl>
      <MotionPlot title="Gyroscope magnitude over clip time" units="rad/s" points={gyro} durationMs={trace.durationMs} currentTimeMs={currentTimeMs} loading={loading} error={error} onRetry={() => setRetry(value => value + 1)} />
      <MotionPlot title="Acceleration magnitude over clip time" units="g, including gravity" points={accel} durationMs={trace.durationMs} currentTimeMs={currentTimeMs} loading={loading} error={error} onRetry={() => setRetry(value => value + 1)} />
      <div className="flex flex-col gap-2"><p className="type-label-sm">Active-motion intervals, stored threshold heuristic</p>
        {summary?.activeMotionIntervals.length ? <div className="flex flex-wrap gap-2">{summary.activeMotionIntervals.map((interval, index) => <Button key={index} size="sm" variant="secondary" onClick={() => onSeek(interval.startMs)}>{formatMs(interval.startMs)} to {formatMs(interval.endMs)}</Button>)}</div>
          : <p className="type-caption text-text-2">No active intervals recorded. A fixed camera can be appropriate.</p>}
      </div>
    </>}
  </section>;
}

function MotionPlot({ title, units, points, durationMs, currentTimeMs, loading, error, onRetry }: {
  title: string; units: string; points: MotionPoint[]; durationMs: number; currentTimeMs: number; loading: boolean; error: string; onRetry: () => void;
}) {
  const values = points.flatMap(point => point.magnitude === null ? [] : [point.magnitude]);
  const config = { magnitude: { label: units } };
  return <ChartContainer config={config} xKey="tMs">
    <ChartFrame title={title} description={`${units}. Browser-derived 100 ms mean magnitude; missing bins remain gaps. Cursor ${formatMs(currentTimeMs)}.`}
      frame="plain" height={128} loading={loading} error={error || undefined} onRetry={onRetry} empty={values.length ? undefined : "No raw samples for this channel."}>
      <ChartPlot data={points} config={config} xKey="tMs" series={["magnitude"]} mode="point" extent={[0, Math.max(0.01, ...values)]} height={128} label={title}
        xFormat={value => formatMs(typeof value === "number" ? value : 0)} valueFormat={value => value.toFixed(2)}>
        {scale => {
          const groups: { x: number; y: number }[][] = [[]];
          points.forEach((point, index) => {
            if (point.magnitude === null) { if (groups[groups.length - 1]!.length) groups.push([]); }
            else groups[groups.length - 1]!.push({ x: scale.x(index), y: scale.y(point.magnitude) });
          });
          const cursor = scale.plot.left + Math.min(1, Math.max(0, currentTimeMs / Math.max(1, durationMs))) * (scale.plot.right - scale.plot.left);
          return <>
            {groups.filter(group => group.length).map((group, index) => <path key={index} d={linearPath(group)} fill="none" className="stroke-ink" strokeWidth={1.5} />)}
            <line x1={cursor} x2={cursor} y1={scale.plot.top} y2={scale.plot.bottom} className="stroke-ink" strokeDasharray="3 3" />
          </>;
        }}
      </ChartPlot>
    </ChartFrame>
  </ChartContainer>;
}
