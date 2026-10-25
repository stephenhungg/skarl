"use client";

import Link from "next/link";
import { Component, useState, type ReactNode, type FormEvent } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { useConvexConfig } from "@/components/convex-provider";
import { LogoMark } from "@/components/logo-mark";
import { AccountMenu } from "@/features/auth/account-menu";
import { Button } from "@/components/glaze/ui/button";
import { DEMO_IDENTITY, formatUsdc, refs, type Decision, type Submission } from "./api";
import { durationLabel, earningsTotals, evidenceTime, payoutDuration, type Earning } from "./earnings";

type Criterion = { criterionId: string; status: string; reason: string;
  evidence: { modality: string; startMs: number; endMs: number; claim?: string }[] };
type ReportResult = {
  status: string; submittedAt?: number; analysisCompletedAt?: number | null; decision?: Decision | null;
  report: { pipeline: { implementation: string; status: string }; recommendation: string; summary: string;
    warnings?: string[]; criteria: Criterion[] } | null;
};
type CoachResult = { status: string; model: string; startedAt: number; completedAt?: number; failureCode?: string;
  explanation: { introduction: string; paymentNotice: string; items: { criterionId: string; explanation: string;
    nextStep: string; uncertain: boolean; citation: { label: string; modality: string } | null }[] } | null } | null;
type Revocation = { status: "requested" | "revoked" | "not_requested" | "consent_missing"; requestedAt: number | null; revokedAt: number | null };
const provenanceRef = makeFunctionReference<"query", { demoIdentity: string; submissionId: string }, { revocation: Revocation; licenseScope: string | null; licenseVersion: string | null; consentTimestamp: number | null }>("provenance:forSubmission");
const revokeRef = makeFunctionReference<"mutation", { demoIdentity: string; submissionId: string; reason: string }, { status: "requested" | "revoked"; requestedAt: number | null; replayed: boolean }>("consent:requestRevocation");
const earningsRef = makeFunctionReference<"query", { demoIdentity: string }, Earning[]>("datasets:contributorEarnings");
const reportRef = makeFunctionReference<"query", { demoIdentity: string; submissionId: string }, ReportResult>("submissions:getReport");
const coachRef = makeFunctionReference<"query", { demoIdentity: string; submissionId: string }, CoachResult>("coachData:forSubmission");
const explainRef = makeFunctionReference<"action", { demoIdentity: string; submissionId: string }, { explanationId: string; replayed: boolean }>("coach:explainOutcome");

const date = (value: number | null | undefined) => value == null ? "Not recorded" : new Date(value).toLocaleString();
const label = (value: string) => value.replaceAll("_", " ");
const panel = "rounded-xl border border-line-faint bg-shell p-5 md:p-6";

function Frame({ children }: { children: ReactNode }) {
  return <div className="glaze skarl-theme min-h-dvh bg-page font-sans text-text-1">
    <header className="border-b border-line-faint bg-page">
      <nav className="mx-auto flex min-h-14 max-w-6xl flex-wrap items-center gap-4 px-4 py-3 md:px-6" aria-label="Contributor navigation">
        <Link href="/" className="flex items-center gap-2 type-label" aria-label="Skarl home"><LogoMark size={12} />Skarl</Link>
        <span className="type-label-sm text-text-3">Contributor</span>
        <Link href="/contribute" className="ms-auto type-label text-text-2 underline underline-offset-4">Record a task</Link>
        <AccountMenu />
      </nav>
    </header>
    <main className="mx-auto max-w-6xl px-4 py-8 md:px-6 md:py-12">
      <div className="mb-7 max-w-2xl"><p className="type-label-sm text-text-3">Your contribution record</p>
        <h1 className="mt-2 type-title">Submissions & earnings</h1>
        <p className="mt-3 type-body text-text-2">See what the evidence says, why a decision was made, and whether a transfer has actually been confirmed.</p>
        <p className="mt-2 type-caption text-text-3">Base Sepolia test USDC. Signed-in accounts use their own roles; signed-out visitors use the public demo contributor when demo mode is enabled.</p>
      </div>
      {children}
    </main>
  </div>;
}

class QueryBoundary extends Component<{ children: ReactNode; title?: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <div className={panel} role="alert"><h2 className="type-heading-sm">{this.props.title ?? "This record is unavailable"}</h2>
      <p className="mt-2 type-body text-text-2">The backend could not provide this record. Reload to retry. No missing result is treated as a decision or a payment.</p></div> : this.props.children;
  }
}

function Coach({ submissionId, hasReport }: { submissionId: string; hasReport: boolean }) {
  const explanation = useQuery(coachRef, hasReport ? { demoIdentity: DEMO_IDENTITY, submissionId } : "skip");
  const explain = useAction(explainRef);
  const [pending, setPending] = useState(false), [failed, setFailed] = useState(false);
  async function requestExplanation() {
    setPending(true); setFailed(false);
    try { await explain({ demoIdentity: DEMO_IDENTITY, submissionId }); }
    catch { setFailed(true); }
    finally { setPending(false); }
  }
  return <section className="mt-5 border-t border-line-faint pt-5" aria-label="Contributor coach">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="type-heading-sm">Explain this evidence</h3>
      {hasReport && explanation?.status !== "completed" ? <Button size="sm" pending={pending || explanation?.status === "running"} disabled={pending || explanation?.status === "running"}
        onClick={() => void requestExplanation()}>{explanation?.status === "running" ? "Explaining…" : "Ask the coach"}</Button> : null}</div>
    <p className="mt-2 type-caption text-text-3">Claude explains the stored evidence. It has not watched your recording, cannot change the decision, and cannot authorize or promise payment.</p>
    {!hasReport ? <p className="mt-3 type-body text-text-2">Coaching will be available when a verification report exists.</p> : null}
    {failed || explanation?.status === "unavailable" ? <p className="mt-3 type-body text-text-2" role="status">The coach is unavailable. Your evidence and decision below remain the source of truth. You can retry.</p> : null}
    {explanation?.explanation ? <div className="mt-4 space-y-4">
      <p className="type-body text-text-2">{explanation.explanation.introduction}</p>
      {explanation.explanation.items.map(item => <div key={item.criterionId} className="rounded-lg bg-page p-4">
        <p className="type-label">{item.criterionId}{item.uncertain ? " · uncertain" : ""}</p><p className="mt-2 type-body">{item.explanation}</p>
        <p className="mt-2 type-body text-text-2">{item.nextStep}</p><p className="mt-2 type-caption font-mono text-text-3">{item.citation ? `${item.citation.modality} · ${item.citation.label}` : "No timestamped evidence"}</p>
      </div>)}
      <p className="type-caption text-text-3">{explanation.explanation.paymentNotice} Generated {date(explanation.completedAt)} · {explanation.model} · advisory</p>
    </div> : null}
  </section>;
}

function ConsentRequest({ submissionId }: { submissionId: string }) {
  const provenance = useQuery(provenanceRef, { demoIdentity: DEMO_IDENTITY, submissionId });
  const request = useMutation(revokeRef);
  const [reason, setReason] = useState(""), [pending, setPending] = useState(false), [failed, setFailed] = useState(false);
  const status = provenance?.revocation.status;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setFailed(false);
    try { await request({ demoIdentity: DEMO_IDENTITY, submissionId, reason: reason.trim() }); }
    catch { setFailed(true); }
    finally { setPending(false); }
  }
  return <section className="mt-5 border-t border-line-faint pt-5" aria-label="Consent and revocation">
    <h3 className="type-heading-sm">Your consent</h3>
    {provenance?.licenseVersion ? <div className="mt-3 rounded-lg bg-page p-4">
      <p className="type-label">Recorded license · {provenance.licenseVersion}</p>
      <p className="mt-2 whitespace-pre-wrap type-body text-text-2">{provenance.licenseScope ?? "Scope not recorded."}</p>
      <p className="mt-2 type-caption text-text-3">Stored acknowledgement · {date(provenance.consentTimestamp)}. This records the terms acknowledged at submission; it does not attest to downstream use.</p>
    </div> : null}
    <p className="mt-2 type-body text-text-2">You can ask a controller to review revocation of this sample. A request is not a completed revocation or a promise to recall copies already delivered. Financial journals stay intact to preserve what was owed and paid.</p>
    {status === "requested" || status === "revoked" ? <p className="mt-3 type-label" role="status">{status === "revoked" ? `Revoked · ${date(provenance?.revocation.revokedAt ?? undefined)}` : `Revocation requested · ${date(provenance?.revocation.requestedAt ?? undefined)}`}</p> : null}
    {status === "consent_missing" ? <p className="mt-3 type-caption text-text-2">No consent record is available. Ask the controller to investigate this sample.</p> : null}
    {status === "not_requested" ? <form onSubmit={event => void submit(event)} className="mt-4 space-y-3">
      <label className="block type-label" htmlFor={`reason-${submissionId}`}>Reason for requesting revocation</label>
      <textarea id={`reason-${submissionId}`} value={reason} onChange={event => setReason(event.target.value)} required maxLength={1000} rows={3}
        className="block w-full resize-y rounded-lg border border-line-control bg-page p-3 type-body" />
      <Button variant="secondary" size="sm" type="submit" pending={pending} disabled={pending || !reason.trim()}>Request revocation review</Button>
    </form> : null}
    {failed ? <p className="mt-3 type-caption text-text-2" role="alert">The request could not be confirmed. Check the status here before retrying; a retry will reuse the existing request.</p> : null}
  </section>;
}

function SubmissionEvidence({ submissionId, fallback }: { submissionId: string; fallback?: Submission }) {
  const record = useQuery(reportRef, { demoIdentity: DEMO_IDENTITY, submissionId });
  if (!record) return <p className="mt-4 type-body text-text-2" role="status">Loading evidence…</p>;
  const report = record.report, decision = record.decision ?? fallback?.decision;
  return <div className="mt-5 border-t border-line-faint pt-5">
    <dl className="grid gap-4 type-caption sm:grid-cols-3"><div><dt className="text-text-3">Submitted</dt><dd className="mt-1">{date(record.submittedAt ?? fallback?._creationTime)}</dd></div>
      <div><dt className="text-text-3">Analysis completed</dt><dd className="mt-1">{date(record.analysisCompletedAt ?? fallback?.analysis?.completedAt)}</dd></div>
      <div><dt className="text-text-3">Decision recorded</dt><dd className="mt-1">{date(decision?.decidedAt)}</dd></div></dl>
    <section className="mt-5" aria-label="Recorded decision"><h3 className="type-heading-sm">Recorded verdict</h3>
      <p className="mt-2 type-body">{decision ? `${label(decision.decision)}: ${decision.reason}` : "No controller decision recorded yet."}</p>
      {report ? <p className="mt-2 type-caption text-text-3">AI recommendation: {label(report.recommendation)} · {report.pipeline.implementation} · {label(report.pipeline.status)}. This is evidence, not payment authority.</p> : null}
    </section>
    <section className="mt-5" aria-label="Criterion evidence"><h3 className="type-heading-sm">Criterion findings</h3>
      <p className="mt-1 type-caption text-text-3">Contradicted or unobservable findings explain the evidence gap; the recorded controller reason above explains a rejection.</p>
      {report?.criteria.length ? <div className="mt-3 space-y-3">{report.criteria.map(criterion => <div key={criterion.criterionId} className="rounded-lg bg-page p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="type-label">{criterion.criterionId}</h4><span className="type-caption text-text-2">{label(criterion.status)}</span></div>
        <p className="mt-2 type-body text-text-2">{criterion.reason}</p>
        {criterion.evidence.length ? <ul className="mt-3 space-y-2">{criterion.evidence.map((evidence, index) => <li key={index} className="type-caption text-text-2">
          <span className="font-mono">{evidence.modality} · {evidenceTime(evidence.startMs)}–{evidenceTime(evidence.endMs)}</span>{evidence.claim ? <span className="mt-1 block">{evidence.claim}</span> : null}
        </li>)}</ul> : <p className="mt-2 type-caption text-text-3">No timestamped evidence recorded. Missing evidence is not a pass.</p>}
      </div>)}</div> : <p className="mt-3 type-body text-text-2">No criterion report is available yet.</p>}
      {report?.warnings?.length ? <ul className="mt-3 space-y-1 type-caption text-text-2">{report.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}
    </section>
    <QueryBoundary title="The coach is unavailable"><Coach submissionId={submissionId} hasReport={!!report} /></QueryBoundary>
    <QueryBoundary title="Consent status is unavailable"><ConsentRequest submissionId={submissionId} /></QueryBoundary>
  </div>;
}

function SubmissionReceipt({ row, submission }: { row: Earning; submission?: Submission }) {
  const [expanded, setExpanded] = useState(false);
  const duration = payoutDuration(row);
  return <article className={panel}>
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="type-caption font-mono text-text-3 break-all">{row.submissionId}</p>
      <h2 className="mt-2 type-heading-sm">{label(row.status)}</h2></div>
      <span className={`rounded-md px-2 py-1 type-caption ${row.payout.status === "paid" ? "bg-[rgb(199_241_142)] text-[rgb(22_32_12)]" : "bg-page text-text-2"}`}>{row.payout.status === "paid" ? "Transfer confirmed" : row.payout.status === "not_payable" ? "No earned payable" : "Payout pending"}</span>
    </div>
    <dl className="mt-5 grid gap-4 sm:grid-cols-3"><div><dt className="type-caption text-text-3">Earned obligation</dt><dd className="mt-1 type-label font-mono">{formatUsdc(row.amountAtomic)} test USDC</dd></div>
      <div><dt className="type-caption text-text-3">Payout stage</dt><dd className="mt-1 type-label">{row.payableStatus ? label(row.payableStatus) : "Not payable"}</dd></div>
      <div><dt className="type-caption text-text-3">Time to payout</dt><dd className="mt-1 type-label">{duration !== null ? durationLabel(duration) : row.payout.status === "paid" ? "Timing unavailable" : row.payout.status === "not_payable" ? "Not payable" : "Awaiting confirmed transfer"}</dd></div></dl>
    {duration !== null ? <p className="mt-3 type-caption text-text-3">Derived from acceptance to observed transfer reconciliation, not the block timestamp.</p> : null}
    {row.payout.status === "paid" && row.payout.explorerUrl ? <a href={row.payout.explorerUrl} target="_blank" rel="noreferrer" className="mt-4 inline-block break-all type-caption underline underline-offset-4">View confirmed transfer on BaseScan ↗</a> : null}
    {row.payout.status === "pending" ? <p className="mt-3 type-caption text-text-2">Approval or a broadcast transaction does not mean paid. Payment is shown only after reconciliation verifies the transfer.</p> : null}
    <div className="mt-4"><Button variant="secondary" size="sm" aria-expanded={expanded} aria-controls={`evidence-${row.submissionId}`} onClick={() => setExpanded(value => !value)}>{expanded ? "Hide evidence & explanation" : "View evidence & explanation"}</Button></div>
    {expanded ? <div id={`evidence-${row.submissionId}`}><QueryBoundary><SubmissionEvidence submissionId={row.submissionId} fallback={submission} /></QueryBoundary></div> : null}
  </article>;
}

function OrderReceipts({ orderId, rows }: { orderId: string; rows: Earning[] }) {
  const submissions = useQuery(refs.submissions, { demoIdentity: DEMO_IDENTITY, orderId });
  const byId = new Map((submissions ?? []).map(submission => [submission._id, submission]));
  return <div className="space-y-4">{rows.map(row => <SubmissionReceipt key={row.submissionId} row={row} submission={byId.get(row.submissionId)} />)}</div>;
}

function LiveEarnings() {
  const rows = useQuery(earningsRef, { demoIdentity: DEMO_IDENTITY });
  if (rows === undefined) return <div className={panel} role="status">Loading your live contribution records…</div>;
  const totals = earningsTotals(rows);
  const byOrder = new Map<string, Earning[]>();
  for (const row of rows) { const group = byOrder.get(row.orderId) ?? []; group.push(row); byOrder.set(row.orderId, group); }
  return <>
    <section className="mb-6 grid gap-3 sm:grid-cols-3" aria-label="Earnings totals">
      {[['Submissions', String(rows.length)], ['Earned obligations', `${formatUsdc(totals.earned.toString())} test USDC`], ['Confirmed paid', `${formatUsdc(totals.paid.toString())} test USDC`]].map(([title, value]) => <div className={panel} key={title}><h2 className="type-caption text-text-3">{title}</h2><p className="mt-2 type-heading-sm font-mono">{value}</p></div>)}
    </section>
    {!rows.length ? <section className={panel}><h2 className="type-heading-sm">No submissions yet</h2><p className="mt-2 type-body text-text-2">Your real submission receipts will appear here after uploading. No sample data is used.</p><Link href="/contribute" className="mt-4 inline-block type-label underline underline-offset-4">Record your first task</Link></section> : <div className="space-y-4">{[...byOrder].map(([orderId, group]) => <QueryBoundary key={orderId}><OrderReceipts orderId={orderId} rows={group} /></QueryBoundary>)}</div>}
  </>;
}

export function ContributorEarnings() {
  const config = useConvexConfig();
  return <Frame>{config.status === "ready" ? <QueryBoundary title="Your earnings are unavailable"><LiveEarnings /></QueryBoundary> : <section className={panel}><h2 className="type-heading-sm">Live contribution records are unavailable</h2><p className="mt-2 type-body text-text-2">This build is not connected to a working backend. There are no earnings or outcomes to display.</p></section>}</Frame>;
}
