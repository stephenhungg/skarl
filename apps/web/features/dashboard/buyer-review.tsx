"use client";
import Link from "next/link";
import { useMutation } from "convex/react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/glaze/ui/button";
import { api, CONTROLLER, useExceptions, useOrderData, useOrderId, type ExceptionItem, type Id } from "./data";
import { humanize } from "./format";
import { Loading, PageHeader, Unavailable } from "./ui";

type ReviewEvidence = { code: string; detail?: string; message?: string; failures?: string[];
  submissionId?: Id<"submissions">; intentId?: Id<"paymentIntents"> };

export function BuyerReview() {
  const orderId = useOrderId();
  const { summary, submissions, payables } = useOrderData(orderId);
  const exceptions = useExceptions(orderId);
  if (orderId === null) return <Unavailable title="No order to review" description="Post a task and fund it to begin collecting demonstrations." />;
  if (!orderId || !summary || exceptions === undefined) return <><PageHeader title="Review" /><Loading rows={4} /></>;
  const open = exceptions.filter(item => item.disposition?.status !== "resolved");
  const queuedSubmissions = new Set(open.map(item => (item.exception as ReviewEvidence).submissionId).filter(Boolean));
  const queuedIntents = new Set(open.map(item => (item.exception as ReviewEvidence).intentId).filter(Boolean));
  const legacySubmissions = (submissions ?? []).filter(row => !summary.order.autoPay?.enabled && row.status === "needs_review" && !row.verificationOnly && !queuedSubmissions.has(row._id));
  const legacyPayables = (payables ?? []).filter(row => !summary.order.autoPay?.enabled && row.intent?.status === "proposed" && !row.approval && !queuedIntents.has(row.intent._id));
  const count = open.length + legacySubmissions.length + legacyPayables.length;
  return <>
    <PageHeader title="Review" description="Only exceptions need you. Agents propose; the rule you signed approves. The AI never approves itself."
      actions={<Link href="/orders/new" className="type-label underline underline-offset-4">Post a task</Link>} />
    <PolicyEditor key={`${orderId}:${summary.order.autoPay?.setAt ?? 0}`} orderId={orderId}
      enabled={summary.order.autoPay?.enabled ?? false}
      cap={String(summary.order.autoPay?.maxPerClipAtomic ?? summary.order.pricePerSampleAtomic)} />
    <h2 className="mb-3 mt-8 type-heading-sm">Exceptions{count ? ` (${count})` : ""}</h2>
    {count === 0 ? <p className="rounded-panel border border-line-faint p-4 type-body-sm text-text-2">Nothing needs review. Eligible clips and payouts follow your rule automatically.</p> : null}
    <div className="flex flex-col gap-3">
      {open.map(item => <ExceptionCard key={item.exceptionKey} orderId={orderId} item={item} />)}
      {legacySubmissions.map(row => <Link key={row._id} href={`/dashboard/submissions/${row._id}`} className="rounded-panel border border-line-faint p-4 type-body-sm underline underline-offset-4">Review clip {row._id.slice(0, 8)} — {row.analysis ? humanize(row.analysis.recommendation) : "Analysis unavailable"}</Link>)}
      {legacyPayables.map(row => <Link key={row._id} href="/dashboard/payables" className="rounded-panel border border-line-faint p-4 type-body-sm underline underline-offset-4">Review payout — no policy approval recorded</Link>)}
    </div>
  </>;
}

function PolicyEditor({ orderId, enabled: initialEnabled, cap: initialCap }: {
  orderId: Id<"orders">; enabled: boolean; cap: string;
}) {
  const setAutoPay = useMutation(api.orders.setAutoPay);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [cap, setCap] = useState(initialCap);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      await setAutoPay({ demoIdentity: CONTROLLER, orderId, enabled, maxPerClipAtomic: cap });
      setMessage("Rule saved in the audit trail.");
    } catch { setMessage("Rule change refused. Check the cap and that you own this order."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save} className="flex flex-wrap items-end gap-4 rounded-panel border border-line-faint p-4">
    <label className="flex items-center gap-2 py-2 type-label"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />Auto-pay enabled</label>
    <label className="flex flex-col gap-1 type-label-sm">Cap per clip, micro-USDC
      <input className="mono rounded-tag border border-line-control bg-field px-3 py-2" inputMode="numeric" pattern="[1-9][0-9]*" required value={cap} onChange={event => setCap(event.target.value)} />
    </label>
    <Button type="submit" size="sm" disabled={busy}>{busy ? "Saving…" : "Save rule"}</Button>
    <p className="w-full type-body-sm text-text-2">Every evidence check is required. 1 USDC = 1,000,000 micro-USDC. Changes apply to future approvals.</p>
    {message ? <p role="status" className="w-full type-body-sm">{message}</p> : null}
  </form>;
}

function ExceptionCard({ orderId, item }: { orderId: Id<"orders">; item: ExceptionItem }) {
  const approve = useMutation(api.finance.approve);
  const reject = useMutation(api.finance.reject);
  const resolve = useMutation(api.exceptions.resolve);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const evidence = item.exception as ReviewEvidence;
  async function act(decision: "approve" | "reject" | "resolve") {
    if (!reason.trim()) { setMessage("Write a reason for the audit trail."); return; }
    setBusy(true); setMessage("");
    try {
      if (decision === "resolve") await resolve({ demoIdentity: CONTROLLER, orderId, exceptionKey: item.exceptionKey, reason: reason.trim() });
      else if (evidence.intentId) {
        const result = decision === "approve"
          ? await approve({ demoIdentity: CONTROLLER, intentId: evidence.intentId, reason: reason.trim() })
          : await reject({ demoIdentity: CONTROLLER, intentId: evidence.intentId, reason: reason.trim() });
        if (!result.ok) { setMessage(`Refused: ${humanize("code" in result ? String(result.code) : "review_refused")}.`); return; }
      }
      setMessage(decision === "approve" ? "Approved for execution; payment still requires observed settlement." : decision === "reject" ? "Payout rejected." : "Review recorded; detected discrepancies remain visible in reconciliation.");
    } catch { setMessage("Review action refused. Refresh the evidence and try again."); }
    finally { setBusy(false); }
  }
  return <article className="rounded-panel border border-line-faint p-4">
    <h3 className="type-label">{humanize(evidence.code)}</h3>
    <p className="mt-1 type-body-sm text-text-2">{evidence.message ?? evidence.detail}</p>
    {evidence.failures?.length ? <ul className="mt-2 list-inside list-disc type-body-sm">{evidence.failures.map(check => <li key={check}>{humanize(check)}</li>)}</ul> : null}
    {evidence.submissionId && !evidence.intentId ? <Link href={`/dashboard/submissions/${evidence.submissionId}`} className="mt-3 inline-block type-label underline underline-offset-4">Review evidence and accept or reject clip</Link> : <div className="mt-3 flex flex-wrap items-center gap-2">
      <label className="flex min-w-48 flex-1 flex-col gap-1 type-label-sm">Review reason
        <input value={reason} onChange={event => setReason(event.target.value)} maxLength={2000} className="rounded-tag border border-line-control bg-field px-3 py-2" />
      </label>
      {evidence.intentId ? <>
        <Button size="sm" disabled={busy} onClick={() => void act("approve")}>Approve exception</Button>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void act("reject")}>Reject payout</Button>
      </> : <Button size="sm" disabled={busy} onClick={() => void act("resolve")}>Record review disposition</Button>}
    </div>}
    {message ? <p role="status" className="mt-2 type-body-sm">{message}</p> : null}
  </article>;
}
