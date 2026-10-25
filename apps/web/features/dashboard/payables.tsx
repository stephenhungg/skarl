"use client";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import type { EIP1193Provider } from "viem";
import { Button } from "@/components/glaze/ui/button";
import { CopyButton } from "@/components/glaze/ui/copy-button";
import { Status } from "@/components/glaze/ui/status";
import { cn } from "@/lib/glaze/utils";
import { usePayout } from "@/lib/payments/use-payout";
import { getPayoutRecovery } from "@/lib/payments/payout";
import { api, CONTROLLER, FINANCE_AGENT, useAudit, useOrderData, useOrderId, useReconciliation, type AuditEvent, type Id, type PayableRow } from "./data";
import { basescanAddress, basescanTx, formatTime, humanize, parseChainIdentity, readableReason, shortHash } from "./format";
import { actorName } from "./activity";
import { executeApprovedRefund } from "@/lib/payments/refund";
import { Textarea } from "@/components/glaze/ui/textarea";
import { ReceiptRule } from "@/components/ui/payment-receipt-printer";
import { Receipt } from "./receipt";
import { Amount, ConfirmDialog, Loading, PageHeader, QueryBoundary, Unavailable } from "./ui";
import { toast } from "@/components/glaze/ui/toast";

const STEPS = ["Accrued", "Proposed", "Approved", "Submitted", "Paid"] as const;

function stepOf(p: PayableRow): number {
  if (p.status === "paid") return 4;
  if (p.status === "payout_in_progress" && (p.command?.status === "submitted" || p.command?.status === "reconciling" || p.intent?.status === "reconciling")) return 3;
  if (p.approval?.status === "approved") return 2;
  if (p.intent) return 1;
  return 0;
}

export function Payables() {
  const orderId = useOrderId();
  const { payables } = useOrderData(orderId);
  const audit = useAudit(orderId);
  const reconciliation = useReconciliation(orderId);
  if (orderId === null) return <Unavailable title="No staged order" description="Run pnpm seed to stage the demo order." />;
  return (
    <>
      <PageHeader title="Payables" />
      <RefusalHero audit={audit ?? []} />
      {payables === undefined ? <Loading rows={3} /> : payables.length === 0
        ? <Unavailable title="No payables yet" description="One appears when you accept a licensed clip." />
        : <div className="flex flex-col gap-4">{payables.map(p => <PayableCard key={p._id} payable={p} audit={audit ?? []}
            matches={reconciliation?.matches ?? []} />)}</div>}
      {orderId && <QueryBoundary><Refund orderId={orderId} /></QueryBoundary>}
    </>
  );
}

function PayableCard({ payable, audit, matches }: { payable: PayableRow; audit: AuditEvent[]; matches: { eventKey: string; chainIdentity: string }[] }) {
  const step = stepOf(payable);
  const refusals = audit.filter(e => e.action.endsWith("_refused") && (e.entityId === payable._id || e.entityId === payable.intent?._id));
  const paid = matches.find(m => m.eventKey.includes(payable._id) || (payable.intent && m.eventKey.includes(payable.intent.intentId)));
  const chain = parseChainIdentity(paid?.chainIdentity);
  return (
    <article className="shell">
      <div className="panel flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <Amount value={payable.amountAtomic} className="type-title" />
            <p className="mt-1 flex flex-wrap items-center gap-x-2 type-body-sm text-text-2">
              To <a href={basescanAddress(payable.recipientAddress)} target="_blank" rel="noreferrer" className="mono underline underline-offset-4">{shortHash(payable.recipientAddress, 8, 6)}</a>
              <CopyButton value={payable.recipientAddress} size="icon-sm" aria-label="Copy recipient address" />
              for clip <Link href={`/dashboard/submissions/${payable.submissionId}`} className="mono underline underline-offset-4">{payable.submissionId.slice(0, 8)}</Link>
            </p>
          </div>
          <Status status={payable.status === "paid" ? "ok" : step >= 2 ? "running" : "waiting"}>{payable.status === "paid" ? "Paid" : STEPS[step]}</Status>
        </div>
        <ol className="grid grid-cols-5 gap-1" aria-label="Payout progress">
          {STEPS.map((label, index) => (
            <li key={label} className="flex flex-col gap-1.5">
              <span className={cn("h-1 rounded-pill", index <= step ? (payable.status === "paid" ? "bg-ok" : "bg-ink") : "bg-field")} />
              <span className={cn("type-label-sm", index <= step ? "text-text-1" : "text-text-3")}>{label}</span>
            </li>
          ))}
        </ol>
        {payable.approval && (
          <p className="type-body-sm text-text-2">{humanize(payable.approval.status)} &middot; expires {formatTime(payable.approval.expiresAt)}</p>
        )}
        {refusals.map(event => (
          <div key={event._id} className="flex items-start gap-3 rounded-panel border border-fail bg-fail-tint px-3 py-2">
            <Status status="fail" className="shrink-0">Refused</Status>
            <p className="type-body-sm"><span className="type-label">{humanize(event.reason)}</span> <span className="text-text-2">{event.actor.identity} tried to {humanize(event.action.replace(/_refused$/, "")).toLowerCase()}. Separation of duties held. {formatTime(event.occurredAt)}</span></p>
          </div>
        ))}
        {chain && payable.status === "paid" && (
          <div className="max-w-sm">
            <Receipt printKey={chain.txHash} label="Payout receipt">
              <div className="flex items-baseline justify-between"><span className="type-label">Paid</span><Amount value={payable.amountAtomic} className="type-label" /></div>
              <p className="mt-1 type-body-sm text-text-2">To {shortHash(payable.recipientAddress, 8, 6)} for clip {payable.submissionId.slice(0, 8)}</p>
              <ReceiptRule className="my-3" />
              <p className="type-label-sm text-text-2">Base Sepolia, log {chain.logIndex}</p>
              <p className="break-all type-label-sm text-text-3">{chain.txHash}</p>
            </Receipt>
          </div>
        )}
        {chain && (
          <a href={basescanTx(chain.txHash)} target="_blank" rel="noreferrer" className="flex items-center gap-2 type-label-sm text-text-2 underline underline-offset-4">
            <Status status="ok" size="sm">Reconciled</Status><span className="mono">{shortHash(chain.txHash, 10, 6)}</span> log {chain.logIndex} on BaseScan
          </a>
        )}
      </div>
      <Actions payable={payable} step={step} />
    </article>
  );
}

function useInjectedWallet(): EIP1193Provider | null {
  const [provider, setProvider] = useState<EIP1193Provider | null>(null);
  useEffect(() => { setProvider((window as unknown as { ethereum?: EIP1193Provider }).ethereum ?? null); }, []);
  return provider;
}

function Actions({ payable, step }: { payable: PayableRow; step: number }) {
  const propose = useMutation(api.finance.proposePayment);
  const approve = useMutation(api.finance.approve);
  const provider = useInjectedWallet();
  const payout = usePayout({ demoIdentity: CONTROLLER, provider });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [confirming, setConfirming] = useState(false);

  async function act(run: () => Promise<{ ok: boolean; code?: string }>, success: string, refusedTitle = "Refused") {
    setBusy(true); setMessage(null);
    try {
      const result = await run();
      if (result.ok) { setMessage({ ok: true, text: success }); toast.success(success); }
      else { setMessage({ ok: false, text: `Refused: ${humanize(result.code ?? "refused")}.` }); toast.fail(refusedTitle, { description: humanize(result.code ?? "refused") }); }
      return result;
    } catch (error) {
      const text = error instanceof Error ? error.message : "Request failed.";
      setMessage({ ok: false, text }); toast.fail("Request failed", { description: text });
      return { ok: false, code: text };
    } finally { setBusy(false); }
  }

  const intentId = payable.intent?._id;
  let buttons: React.ReactNode = null;
  if (payable.status === "paid") buttons = <span className="me-auto type-label-sm text-text-2">Confirmed on chain and posted to the journal.</span>;
  else if (step === 0) buttons = <>
    <span className="me-auto type-label-sm text-text-3">Not proposed yet</span>
    <Button size="sm" disabled={busy} onClick={() => act(() => propose({ demoIdentity: FINANCE_AGENT, payableId: payable._id }), "The finance agent proposed this payout.")}>Ask agent to propose</Button>
  </>;
  else if (step === 1 && intentId) buttons = <>
    <Button variant="secondary" size="sm" className="me-auto" disabled={busy}
      onClick={() => act(() => approve({ demoIdentity: FINANCE_AGENT, intentId }), "Unexpected: the agent approval went through.", "Agent approval refused")}>Let the agent approve</Button>
    <Button size="sm" disabled={busy} onClick={() => setConfirming(true)}>Approve payout</Button>
    <ConfirmDialog open={confirming} onOpenChange={setConfirming} title="Approve this payout?" actionLabel="Approve payout"
      description="You sign the transfer in your wallet after this."
      onConfirm={async () => {
        const result = await act(() => approve({ demoIdentity: CONTROLLER, intentId }), "Approved. Waiting for the workflow to release it for signing.", "Approval refused");
        if (!result.ok) throw new Error(`Refused: ${humanize(result.code ?? "refused")}.`);
      }}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 type-body-sm">
        <dt className="text-text-2">Amount</dt><dd><Amount value={payable.amountAtomic} /></dd>
        <dt className="text-text-2">Recipient</dt><dd className="mono break-all">{payable.recipientAddress}</dd>
        <dt className="text-text-2">Network</dt><dd>Base Sepolia, test USDC</dd>
      </dl>
    </ConfirmDialog>
  </>;
  else if (step === 2 && payable.intent) buttons = <>
    <span className="me-auto type-label-sm text-text-3">{payable.dispatchReady ? (provider ? "Ready. Your wallet will show the same amount and recipient." : "Connect Coinbase Wallet in this browser to sign.") : "Approved. Waiting for the workflow to release it."}</span>
    <Button size="sm" disabled={!payable.dispatchReady || !provider || payout.busy}
      onClick={() => payout.execute(payable.intent!.intentId).catch(() => undefined)}>{payout.busy ? humanize(payout.status) : "Sign payout"}</Button>
  </>;
  else if (step === 3 && payable.intent) buttons = <>
    <span className="me-auto type-label-sm text-text-3">Submitted. Waiting for confirmations.</span>
    <Button variant="secondary" size="sm" disabled={payout.busy} onClick={() => {
      const saved = payout.recovery ?? getPayoutRecovery(payable.intent!.intentId);
      if (saved?.txHash) payout.recover({ ...saved, txHash: saved.txHash }).catch(() => undefined);
      else setMessage({ ok: false, text: "No saved transaction in this browser. Check the wallet before doing anything else." });
    }}>Reconcile saved transaction</Button>
  </>;

  return (
    <div className="shell-foot flex flex-col items-stretch gap-2">
      <div className="flex flex-wrap items-center gap-2">{buttons}</div>
      {message && <p role="status" className={cn("type-label-sm", message.ok ? "text-ok-text" : "text-fail-text")}>{message.text}</p>}
      {payout.error && <p role="alert" className="type-label-sm text-fail-text">{payout.error.message}</p>}
      {payout.result && <a href={payout.result.explorerUrl} target="_blank" rel="noreferrer" className="type-label-sm underline underline-offset-4">View submitted transaction</a>}
    </div>
  );
}

/** The separation-of-duties moment: an approval the system refused, shown first because it is the proof. */
function RefusalHero({ audit }: { audit: AuditEvent[] }) {
  const refusals = audit.filter(e => e.action.endsWith("_refused") && /approv/.test(`${e.action} ${e.reason}`));
  const latest = refusals[0];
  if (!latest) return null;
  return (
    <div className="mb-6 flex flex-wrap items-start gap-3 rounded-panel border border-fail bg-fail-tint px-4 py-3">
      <Status status="fail" className="shrink-0">Refused</Status>
      <div className="min-w-0 flex-1">
        <p className="type-label">{actorName(latest.actor.identity)} tried to approve a payout and was refused.</p>
        <p className="type-body-sm text-text-2">{readableReason(latest.reason)} &middot; {formatTime(latest.occurredAt)}{refusals.length > 1 ? ` \u00b7 ${refusals.length} refusals in total` : ""}</p>
      </div>
      <Link href="/dashboard/audit" className="type-label-sm underline underline-offset-4">Audit log</Link>
    </div>
  );
}

/** A buyer's cancelled remainder: refund proposal, independent approval, wallet signature, observed transfer. */
function Refund({ orderId }: { orderId: Id<"orders"> }) {
  const refund = useQuery(api.refunds.forOrder, { demoIdentity: CONTROLLER, orderId });
  const approve = useMutation(api.refunds.approve);
  const provider = useInjectedWallet();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [signing, setSigning] = useState(false);
  if (!refund) return null;
  const approved = refund.approval?.status === "approved";
  async function sign() {
    if (!provider || !refund) return;
    setSigning(true);
    try {
      await executeApprovedRefund({ commandId: refund.commandId, demoIdentity: CONTROLLER, provider });
      toast.success("Refund submitted", { description: "Waiting for confirmations." });
    } catch (error) {
      toast.fail("Refund not sent", { description: error instanceof Error ? error.message : "Check the wallet before trying again." });
    } finally { setSigning(false); }
  }
  return (
    <section className="mt-8" aria-label="Buyer refund">
      <h2 className="mb-3 type-heading-sm">Buyer refund</h2>
      <article className="shell">
        <div className="panel flex flex-wrap items-baseline gap-3 p-4">
          <Amount value={refund.amountAtomic} className="type-heading" />
          <span className="type-body-sm text-text-2">to <span className="mono">{shortHash(refund.recipientAddress, 8, 6)}</span></span>
          <Status status={refund.txHash ? "running" : approved ? "waiting" : "idle"} className="ms-auto">{humanize(refund.status)}</Status>
          {refund.explorerUrl && <a href={refund.explorerUrl} target="_blank" rel="noreferrer" className="basis-full type-label-sm underline underline-offset-4">View transfer on BaseScan</a>}
        </div>
        <div className="shell-foot flex items-center gap-2">
          {!approved && !refund.txHash && <>
            <span className="me-auto type-label-sm text-text-3">Needs an independent controller approval</span>
            <Button size="sm" onClick={() => setOpen(true)}>Approve refund</Button>
          </>}
          {refund.executionAvailable && <>
            <span className="me-auto type-label-sm text-text-3">{provider ? "Approved. Sign in the treasury wallet." : "Connect the treasury wallet in this browser to sign."}</span>
            <Button size="sm" disabled={!provider || signing} onClick={() => void sign()}>{signing ? "Signing" : "Sign refund"}</Button>
          </>}
        </div>
      </article>
      <ConfirmDialog open={open} onOpenChange={setOpen} title="Approve this refund?" actionLabel="Approve refund"
        description="You sign the transfer in your wallet after this."
        onConfirm={async () => {
          if (!reason.trim()) throw new Error("Add a reason first.");
          const result = await approve({ demoIdentity: CONTROLLER, commandId: refund.commandId as Id<"paymentCommands">, reason: reason.trim() });
          if (result && typeof result === "object" && "ok" in result && !result.ok) throw new Error(`Refused: ${humanize(String((result as { code?: string }).code ?? "refused"))}.`);
          toast.success("Refund approved");
        }}>
        <label className="mb-1 block type-label" htmlFor="refund-reason">Reason</label>
        <Textarea id="refund-reason" rows={2} value={reason} onChange={event => setReason(event.target.value)} />
      </ConfirmDialog>
    </section>
  );
}
