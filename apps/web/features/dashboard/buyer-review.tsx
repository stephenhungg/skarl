"use client";
import Link from "next/link";
import { useMutation } from "convex/react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/glaze/ui/button";
import { api, BUYER, useExceptions, useOrderData, useOrderId, type ExceptionItem, type Id } from "./data";
import { formatUsdc, humanize } from "./format";
import { Switch } from "@/components/glaze/ui/switch";
import { StatusMark } from "@/components/glaze/ui/status";
import { toast } from "@/components/glaze/ui/toast";
import { Loading, PageHeader, Unavailable } from "./ui";

type ReviewEvidence = { code: string; detail?: string; message?: string; failures?: string[];
  submissionId?: Id<"submissions">; intentId?: Id<"paymentIntents"> };

export function BuyerReview() {
  const orderId = useOrderId();
  const { summary, submissions, payables } = useOrderData(orderId);
  const exceptions = useExceptions(orderId);
  if (orderId === null) return <Unavailable title="No order to review" description="Post a task and fund it to begin collecting demonstrations." />;
  if (!orderId || !summary || exceptions === undefined) return <><PageHeader title="Exceptions" /><Loading rows={4} /></>;
  const open = exceptions.filter(item => item.disposition?.status !== "resolved");
  const queuedSubmissions = new Set(open.map(item => (item.exception as ReviewEvidence).submissionId).filter(Boolean));
  const queuedIntents = new Set(open.map(item => (item.exception as ReviewEvidence).intentId).filter(Boolean));
  const legacySubmissions = (submissions ?? []).filter(row => !summary.order.autoPay?.enabled && row.status === "needs_review" && !row.verificationOnly && !queuedSubmissions.has(row._id));
  const legacyPayables = (payables ?? []).filter(row => !summary.order.autoPay?.enabled && row.intent?.status === "proposed" && !row.approval && !queuedIntents.has(row.intent._id));
  const count = open.length + legacySubmissions.length + legacyPayables.length;
  return <>
    <PageHeader title="Exceptions"
      actions={<Link href="/orders/new" className="type-label underline underline-offset-4">Post a task</Link>} />
    {count === 0 ? <div className="flex items-center gap-2 rounded-panel border border-line-faint p-4 type-body-sm"><StatusMark status="ok" />Nothing needs you. Clips and payouts within your rule pay automatically.</div> : null}
    <div className="flex flex-col gap-3">
      {open.map(item => <ExceptionCard key={item.exceptionKey} orderId={orderId} item={item} />)}
      {legacySubmissions.map(row => <RowLink key={row._id} href={`/dashboard/submissions/${row._id}`} status="warn" title={`Review clip ${row._id.slice(0, 8)}`}
        detail={row.analysis ? `AI suggests: ${humanize(row.analysis.recommendation).toLowerCase()}` : "AI check unavailable"} action="Review" />)}
      {legacyPayables.map(row => <RowLink key={row._id} href="/dashboard/payables" status="warn" title={`Payout of ${formatUsdc(row.amountAtomic)} USDC`}
        detail="No policy approval recorded" action="Open payables" />)}
    </div>
    <PolicyEditor key={`${orderId}:${summary.order.autoPay?.setAt ?? 0}`} orderId={orderId}
      enabled={summary.order.autoPay?.enabled ?? false}
      cap={String(summary.order.autoPay?.maxPerClipAtomic ?? summary.order.pricePerSampleAtomic)} />
  </>;
}

function RowLink({ href, status, title, detail, action }: { href: string; status: "warn" | "fail"; title: string; detail: string; action: string }) {
  return <Link href={href} className="group flex items-center gap-3 rounded-panel border border-line-faint p-4 hover:bg-hover-row">
    <StatusMark status={status} />
    <span className="min-w-0 flex-1"><span className="block type-label">{title}</span><span className="block type-body-sm text-text-2">{detail}</span></span>
    <span className="shrink-0 type-label-sm text-text-2 group-hover:text-text-1">{action}</span>
  </Link>;
}

/** Decimal USDC text to exact micro-USDC digits, or null. Never goes through a float. */
function toAtomic(text: string): string | null {
  const match = /^(\d+)(?:\.(\d{0,6}))?$/.exec(text.trim().replaceAll(",", ""));
  if (!match) return null;
  const atomic = BigInt(match[1]!) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0") || "0");
  return atomic > 0n ? atomic.toString() : null;
}

function PolicyEditor({ orderId, enabled: initialEnabled, cap: initialCap }: {
  orderId: Id<"orders">; enabled: boolean; cap: string;
}) {
  const setAutoPay = useMutation(api.orders.setAutoPay);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [cap, setCap] = useState(formatUsdc(initialCap));
  const [busy, setBusy] = useState(false);
  const atomic = toAtomic(cap);
  const dirty = enabled !== initialEnabled || atomic !== initialCap;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!atomic) return;
    setBusy(true);
    try {
      await setAutoPay({ demoIdentity: BUYER, orderId, enabled, maxPerClipAtomic: atomic });
      toast.success("Auto-pay rule saved.");
    } catch { toast.fail("Rule change refused. Check the cap and that you own this order."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save} className="mt-8 rounded-panel border border-line-faint">
    <div className="flex items-center gap-3 border-b border-line-faint px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block type-label">Auto-pay</span>
        <span className="block type-body-sm text-text-2">{enabled ? "Clips that pass every check pay out up to the cap without you." : "Every payout waits for you."}</span>
      </span>
      <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Auto-pay" />
    </div>
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <label htmlFor="autopay-cap" className="type-label-sm text-text-2">Cap per clip</label>
      <span className="flex items-center rounded-tag border border-line-control bg-field pe-3 focus-within:border-line-focus">
        <input id="autopay-cap" className="w-28 bg-transparent px-3 py-1.5 type-label outline-none" inputMode="decimal" value={cap}
          onChange={event => setCap(event.target.value)} aria-invalid={!atomic} />
        <span className="type-label-sm text-text-3">USDC</span>
      </span>
      {!atomic && <span className="type-body-sm text-fail-text">Enter an amount above 0, up to 6 decimals.</span>}
      <Button type="submit" size="sm" className="ms-auto" disabled={busy || !atomic || !dirty}>{busy ? "Saving…" : "Save rule"}</Button>
    </div>
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
      if (decision === "resolve") await resolve({ demoIdentity: BUYER, orderId, exceptionKey: item.exceptionKey, reason: reason.trim() });
      else if (evidence.intentId) {
        const result = decision === "approve"
          ? await approve({ demoIdentity: BUYER, intentId: evidence.intentId, reason: reason.trim() })
          : await reject({ demoIdentity: BUYER, intentId: evidence.intentId, reason: reason.trim() });
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
