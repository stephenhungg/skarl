"use client";
import Link from "next/link";
import { Status } from "@/components/glaze/ui/status";
import { buttonVariants } from "@/components/glaze/ui/button";
import { PageHeader, Loading, RequireConvex } from "@/features/dashboard/ui";
import { formatUsdc } from "./api";
import { useContributorData } from "./contributor-shell";
import { ClipList, clipStatus } from "./studio";

function Clips() {
  const { history, payables } = useContributorData();
  return (
    <>
      <PageHeader title="My clips" actions={<Link href="/contribute" className={buttonVariants({ size: "sm" })}>Record a clip</Link>} />
      {history === undefined ? <Loading rows={4} /> : <ClipList history={history} payables={payables} />}
    </>
  );
}

function Earnings() {
  const { history, payables } = useContributorData();
  if (payables === undefined || history === undefined) return <><PageHeader title="Earnings" /><Loading rows={3} /></>;
  const sum = (rows: typeof payables) => rows.reduce((total, p) => total + BigInt(p.amountAtomic), 0n).toString();
  const paid = payables.filter(p => p.status === "paid");
  const pending = payables.filter(p => p.status !== "paid" && p.status !== "reversed");
  return (
    <>
      <PageHeader title="Earnings" />
      <dl className="grid grid-cols-3 border-y border-line-faint">
        {([["Earned", sum(payables.filter(p => p.status !== "reversed"))], ["Paid", sum(paid)], ["Waiting for payout", sum(pending)]] as const).map(([label, value], i) => (
          <div key={label} className={i > 0 ? "border-s border-line-faint py-4 ps-5" : "py-4"}>
            <dt className="type-label-sm text-text-2">{label}</dt>
            <dd className="type-heading tabular-nums">{formatUsdc(value)} <span className="type-label-sm text-text-3">USDC</span></dd>
          </div>
        ))}
      </dl>
      <section className="mt-8">
        <h2 className="mb-3 type-heading-sm">Payouts</h2>
        {payables.length === 0
          ? <p className="type-body-sm text-text-2">Accepted clips earn {"—"} none yet. <Link href="/contribute/clips" className="underline underline-offset-4">See your clips</Link>.</p>
          : (
            <ul className="divide-y divide-line-faint rounded-panel border border-line-faint">
              {[...payables].sort((a, b) => b.createdAt - a.createdAt).map(payable => {
                const clip = history.find(s => s._id === payable.submissionId);
                const view = clip ? clipStatus(clip, payable) : null;
                return (
                  <li key={payable._id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
                    <Status status={payable.status === "paid" ? "ok" : "waiting"} className="w-36 shrink-0">{payable.status === "paid" ? "Paid" : "Waiting for payout"}</Status>
                    <span className="type-label tabular-nums">{formatUsdc(payable.amountAtomic)} USDC</span>
                    <span className="min-w-0 flex-1 type-body-sm text-text-2">{view?.note}</span>
                    <span className="type-label-sm text-text-3">{new Date(payable.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                  </li>
                );
              })}
            </ul>
          )}
      </section>
    </>
  );
}

export const ClipsPage = () => <RequireConvex><Clips /></RequireConvex>;
export const EarningsPage = () => <RequireConvex><Earnings /></RequireConvex>;
