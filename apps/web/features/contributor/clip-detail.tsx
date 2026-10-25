"use client";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/glaze/ui/badge";
import { Button } from "@/components/glaze/ui/button";
import { Status } from "@/components/glaze/ui/status";
import { toast } from "@/components/glaze/ui/toast";
import { ConfirmDialog, Loading, PageHeader, QueryBoundary, RequireConvex, Unavailable } from "@/features/dashboard/ui";
import { Textarea } from "@/components/glaze/ui/textarea";
import { formatMs, formatTime, humanize, readableReason } from "@/features/dashboard/format";
import { Lordicon } from "@/features/dashboard/lordicon";
import { cn } from "@/lib/glaze/utils";
import { api, CONTRIBUTOR, clipSteps, useClips, type Clip, type Id, type SubmissionRow } from "./data";
import { ClipStatus, StepStrip } from "./pages";

type Evidence = { modality: string; startMs: number; endMs: number; claim: string };
type Finding = { criterionId: string; status: "supported" | "contradicted" | "unobservable"; evidence: Evidence[]; reason: string };
type Report = { recommendation: string; pipeline?: { implementation?: string }; criteria?: Finding[]; warnings?: string[] };

const FINDING = {
  supported: { status: "ok" as const, label: "Supported" },
  contradicted: { status: "fail" as const, label: "Contradicted" },
  unobservable: { status: "idle" as const, label: "Not visible" },
};

type Seek = (startMs: number, endMs?: number) => void;

function ClipDetail({ submissionId }: { submissionId: Id<"submissions"> }) {
  const { clips } = useClips();
  const clip = clips?.find(row => row.submissionId === submissionId);
  const report = useQuery(api.submissions.getReport, { demoIdentity: CONTRIBUTOR, submissionId });
  const media = useQuery(api.media.submissionEvidence, { demoIdentity: CONTRIBUTOR, submissionId });
  const summary = useQuery(api.dashboard.orderSummary, clip ? { demoIdentity: CONTRIBUTOR, orderId: clip.orderId } : "skip");
  const video = useRef<HTMLVideoElement>(null);
  const stopAt = useRef<number | null>(null);
  const [now, setNow] = useState(0);

  const seek = useCallback<Seek>((startMs, endMs) => {
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

  if (report === undefined || media === undefined || clips === undefined) return <><PageHeader title="Clip" /><Loading rows={8} /></>;
  if (!clip) return <Unavailable title="Clip not found" description={<>It is not one of your clips. <Link href="/contribute/clips" className="underline underline-offset-4">Back to my clips</Link></>} />;

  const parsed = (report.report ?? null) as Report | null;
  const rubric = summary?.rubric?.criteria ?? [];
  const findings = parsed?.criteria ?? [];
  const ids = [...new Set([...rubric.map(c => c.criterionId), ...findings.map(f => f.criterionId)])];
  const decision = clip.detail?.decision ?? null;
  const playable = !!media.clip?.url;

  return (
    <>
      <PageHeader title={<>Clip <span className="mono">{submissionId.slice(0, 8)}</span></>}
        description={<span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
          <ClipStatus clip={clip} />
          {clip.createdAt && <span className="text-text-3">Uploaded {formatTime(clip.createdAt)}</span>}
          {report.verificationOnly && <Badge variant="outline">Test upload, not paid</Badge>}
          <Attestation submissionId={submissionId} />
        </span>}
        actions={<Link href="/contribute/clips" className="type-label text-text-2 underline underline-offset-4">All clips</Link>} />

      <div className="mb-6"><StepStrip steps={clipSteps(clip).steps} /></div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="overflow-hidden rounded-panel border border-line-faint bg-ink">
            {media.clip?.url
              ? <video ref={video} src={media.clip.url} controls playsInline preload="metadata" className="max-h-[70vh] w-full" />
              : <div className="flex aspect-video items-center justify-center p-4 text-center type-body-sm text-text-inverse">No playable video. The original is still uploading, missing or quarantined.</div>}
          </div>
          <Transcript segments={media.transcriptSegments} now={now} onSeek={playable ? seek : null} />
          {media.sensorTrace && <Motion trace={media.sensorTrace} />}
        </div>
        <aside className="flex flex-col gap-4 lg:sticky lg:top-16 lg:self-start">
          <DecisionCard clip={clip} decision={decision} />
          <section className="flex flex-col gap-3">
            <h2 className="type-heading-sm">What the AI found</h2>
            {ids.length === 0 ? <p className="type-body-sm text-text-2">{parsed ? "No criteria in this report." : "The AI check has not finished yet."}</p> : (
              <ol className="flex flex-col divide-y divide-line-faint rounded-panel border border-line-faint">
                {ids.map(id => {
                  const criterion = rubric.find(c => c.criterionId === id);
                  const finding = findings.find(f => f.criterionId === id);
                  const kind = FINDING[finding?.status ?? "unobservable"];
                  return (
                    <li key={id} className="flex flex-col gap-1.5 p-3">
                      <div className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 type-label">{criterion?.description ?? humanize(id)}</span>
                        <Status status={kind.status} size="sm">{finding ? kind.label : "Pending"}</Status>
                      </div>
                      {finding && <p className="type-body-sm text-text-2">{finding.reason}</p>}
                      {playable && finding?.evidence.length ? (
                        <div className="flex flex-wrap gap-1.5">
                          {finding.evidence.map((e, i) => (
                            <button key={i} type="button" onClick={() => seek(e.startMs, e.endMs)} title={e.claim}
                              className="rounded-pill border border-line-control px-2 py-0.5 type-label-sm text-text-2 tabular-nums hover:bg-hover hover:text-text-1">
                              {formatMs(e.startMs)} to {formatMs(e.endMs)}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            )}
            {parsed?.warnings?.length ? <ul className="flex flex-col gap-1">{parsed.warnings.map(w => <li key={w} className="type-body-sm text-text-2">{w}</li>)}</ul> : null}
          </section>
          {parsed && <Coach submissionId={submissionId} onSeek={playable ? seek : null} />}
          <ConsentCard submissionId={submissionId} />
        </aside>
      </div>
    </>
  );
}

function DecisionCard({ clip, decision }: { clip: Clip; decision: SubmissionRow["decision"] | null }) {
  const verdict = decision?.decision;
  const label = verdict === "accepted" ? "Accepted" : verdict === "rejected" ? "Rejected" : verdict === "request_correction" ? "Retake requested" : null;
  return (
    <section className="rounded-panel border border-line-faint p-3">
      <h2 className="mb-1.5 type-heading-sm">Reviewer decision</h2>
      {decision && label ? (
        <>
          <div className="flex items-baseline gap-2">
            <Status status={verdict === "accepted" ? "ok" : verdict === "rejected" ? "fail" : "warn"}>{label}</Status>
            <span className="ms-auto type-label-sm text-text-3">{formatTime(decision.decidedAt)}</span>
          </div>
          {decision.reason && <p className="mt-1.5 type-body-sm text-text-1">{readableReason(decision.reason)}</p>}
          {verdict === "request_correction" && <p className="mt-1.5 type-body-sm text-text-2">Record a new take in the Skarl app with this fixed.</p>}
        </>
      ) : <p className="type-body-sm text-text-2">{clip.status === "needs_review" ? "Waiting for a reviewer." : "No decision yet."}</p>}
    </section>
  );
}

function Attestation({ submissionId }: { submissionId: Id<"submissions"> }) {
  const attestation = useQuery(api.attestations.forSubmission, { submissionId });
  if (!attestation) return null;
  return (
    <a href={attestation.easscanUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 type-label text-text-1 underline underline-offset-4">
      <Lordicon name="check" size={14} />Verify on-chain
    </a>
  );
}

function Transcript({ segments, now, onSeek }: { segments: { startMs: number; endMs: number; text: string }[]; now: number; onSeek: Seek | null }) {
  return (
    <section className="rounded-panel border border-line-faint p-3">
      <h2 className="mb-2 type-label text-text-2">Narration</h2>
      {segments.length === 0 ? <p className="type-body-sm text-text-2">No narration was transcribed.</p> : (
        <p className="type-body leading-7">
          {segments.map((segment, i) => {
            const active = now >= segment.startMs && now < segment.endMs;
            if (!onSeek) return <span key={i}>{segment.text} </span>;
            return (
              <button key={i} type="button" onClick={() => onSeek(segment.startMs)} title={formatMs(segment.startMs)}
                className={cn("rounded-tag px-0.5 text-start", active ? "bg-ink text-text-inverse" : "hover:bg-hover")}>{segment.text} </button>
            );
          })}
        </p>
      )}
    </section>
  );
}

type Trace = NonNullable<FunctionReturnType<typeof api.media.submissionEvidence>["sensorTrace"]>;

function Motion({ trace }: { trace: Trace }) {
  const m = trace.motionSummary;
  const cells: [string, string][] = [
    ["Steady", m.steadinessRatio == null ? "Not measured" : `${Math.round(m.steadinessRatio * 100)}% of the take`],
    ["Tilt", m.meanTiltDegrees == null ? "Not measured" : `${m.meanTiltDegrees.toFixed(1)}° average`],
    ["Samples", trace.sampleCount === 0 ? "No sensors" : `${trace.sampleCount.toLocaleString("en-US")} at ${trace.sampleRateHz} Hz`],
  ];
  return (
    <section className="rounded-panel border border-line-faint p-3">
      <h2 className="mb-2 type-label text-text-2">Phone motion</h2>
      <dl className="grid grid-cols-3 gap-3">
        {cells.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="type-label-sm text-text-3">{label}</dt>
            <dd className="type-label tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Coach({ submissionId, onSeek }: { submissionId: Id<"submissions">; onSeek: Seek | null }) {
  const explain = useAction(api.coach.explainOutcome);
  const record = useQuery(api.coachData.forSubmission, { demoIdentity: CONTRIBUTOR, submissionId });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    setBusy(true); setError(null);
    try { await explain({ demoIdentity: CONTRIBUTOR, submissionId }); }
    catch (cause) {
      const code = (cause as Error).message.match(/([a-z][a-z0-9_]+)\s*$/)?.[1] ?? "coach_unavailable";
      setError(humanize(code));
      toast.fail("Coach could not start", { description: humanize(code) });
    } finally { setBusy(false); }
  }

  const running = record?.status === "running";
  const out = record?.status === "completed" ? record.explanation : null;
  return (
    <section className="shell">
      <div className="panel flex flex-col gap-2 p-3">
        <div className="flex items-baseline gap-2">
          <h2 className="type-heading-sm">Coach</h2>
          {record && <span className="ms-auto type-label-sm text-text-3">{record.model}</span>}
        </div>
        {record === undefined ? <Loading rows={1} />
          : running ? <Status status="running">Writing an explanation</Status>
          : record?.status === "unavailable" ? <p className="type-body-sm text-text-2">The coach could not explain this result ({humanize(record.failureCode ?? "coach_unavailable").toLowerCase()}). The report above still stands.</p>
          : out ? (
            <div className="flex flex-col gap-3">
              <p className="type-body-sm text-text-1">{out.introduction}</p>
              <ol className="flex flex-col gap-3">
                {out.items.map(item => (
                  <li key={item.criterionId} className="flex flex-col gap-1">
                    <div className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 type-label">{humanize(item.criterionId.replace(/-/g, " "))}</span>
                      <Status status={FINDING[item.status].status} size="sm">{FINDING[item.status].label}</Status>
                    </div>
                    <p className="type-body-sm text-text-2">{item.explanation}</p>
                    <p className="type-body-sm text-text-1">Next: {item.nextStep}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      {item.uncertain && <Badge variant="outline" size="sm">Uncertain</Badge>}
                      {item.citation && onSeek && (
                        <button type="button" onClick={() => onSeek(item.citation!.startMs, item.citation!.endMs)}
                          className="rounded-pill border border-line-control px-2 py-0.5 type-label-sm text-text-2 tabular-nums hover:bg-hover hover:text-text-1">
                          {formatMs(item.citation.startMs)} to {formatMs(item.citation.endMs)}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
              {out.warnings.map(w => <p key={w} className="type-body-sm text-warn-text">{w}</p>)}
              <p className="type-body-sm text-text-2">{out.paymentNotice}</p>
            </div>
          )
          : <p className="type-body-sm text-text-2">Get a plain-language read of each finding and what to change next take.</p>}
        {error && <p role="status" className="type-label-sm text-fail-text">{error}</p>}
      </div>
      {!out && !running && (
        <div className="shell-foot flex items-center">
          <Button size="sm" className="ms-auto" pending={busy} disabled={busy} onClick={ask}>
            {record?.status === "unavailable" ? "Try again" : "Explain this result"}
          </Button>
        </div>
      )}
    </section>
  );
}

export function ClipDetailPage({ submissionId }: { submissionId: string }) {
  return <RequireConvex><ClipDetail submissionId={submissionId as Id<"submissions">} /></RequireConvex>;
}

/** The consent recorded with this clip, and the contributor's right to ask for it to be withdrawn. */
function ConsentCard({ submissionId }: { submissionId: Id<"submissions"> }) {
  return <QueryBoundary><ConsentInner submissionId={submissionId} /></QueryBoundary>;
}

function ConsentInner({ submissionId }: { submissionId: Id<"submissions"> }) {
  const provenance = useQuery(api.provenance.forSubmission, { demoIdentity: CONTRIBUTOR, submissionId });
  const request = useMutation(api.consent.requestRevocation);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!provenance) return null;
  const status = provenance.revocation.status;
  return (
    <section className="rounded-panel border border-line-faint p-3" aria-label="Your consent">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="me-auto type-label">Your consent</h2>
        {status === "revoked" && <Status status="ok" size="sm">Withdrawn {formatTime(provenance.revocation.revokedAt)}</Status>}
        {status === "requested" && <Status status="waiting" size="sm">Withdrawal requested {formatTime(provenance.revocation.requestedAt)}</Status>}
      </div>
      {provenance.licenseVersion
        ? <p className="mt-1 type-body-sm text-text-2">{provenance.licenseVersion}{provenance.consentTimestamp ? `, given ${formatTime(provenance.consentTimestamp)}` : ""}{provenance.licenseScope ? `. ${provenance.licenseScope}` : ""}</p>
        : <p className="mt-1 type-body-sm text-text-2">No consent record for this clip.</p>}
      {status === "not_requested" && (
        <>
          <Button variant="secondary" size="sm" className="mt-2" onClick={() => setOpen(true)}>Withdraw consent</Button>
          <ConfirmDialog open={open} onOpenChange={setOpen} title="Withdraw consent for this clip?" actionLabel="Request withdrawal"
            description="A controller reviews the request. Once withdrawn, the clip is excluded from datasets delivered from then on."
            onConfirm={async () => {
              if (!reason.trim()) throw new Error("Add a reason first.");
              await request({ demoIdentity: CONTRIBUTOR, submissionId, reason: reason.trim() });
              toast.success("Withdrawal requested");
            }}>
            <label className="mb-1 block type-label" htmlFor={`reason-${submissionId}`}>Reason</label>
            <Textarea id={`reason-${submissionId}`} rows={3} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} />
          </ConfirmDialog>
        </>
      )}
    </section>
  );
}
