"use client";
import { useQuery } from "convex/react";
import Link from "next/link";
import { Status } from "@/components/glaze/ui/status";
import { Badge } from "@/components/glaze/ui/badge";
import { cn } from "@/lib/glaze/utils";
import { api, CONTROLLER, needsYou, useAudit, useExceptions, useOrderData, useOrderId, useReconciliation, type Id, type PayableRow, type SubmissionRow } from "./data";
import { rail, formatMs, basescanTx, formatTime, humanize, parseChainIdentity, readableReason, shortHash } from "./format";
import { Lordicon } from "./lordicon";
import { ActivityFeed } from "./activity";
import { Amount, Loading, PageHeader, Section, Unavailable } from "./ui";

export function Overview() {
  const orderId = useOrderId();
  const { summary, submissions, payables } = useOrderData(orderId);
  if (orderId === null) return <Unavailable title="No staged order" description="The Convex deployment has no seeded demo order yet. Run pnpm seed." />;
  if (!summary) return <><PageHeader title="Overview" /><Loading rows={6} /></>;
  const { order, balances } = summary;
  return (
    <>
      <PageHeader title={order.title}
        description={<>Order <span className="mono">{order.publicId}</span> &middot; {humanize(order.status)} &middot; {order.acceptedCount} of {order.quantityRequested} samples accepted</>} />
      <NeedsYouList orderId={orderId!} submissions={submissions} payables={payables} />
      <Operations orderId={orderId!} />
      <Section title="Money">
        <dl className="grid grid-cols-2 border-y border-line-faint md:grid-cols-4">
          {[
            ["Funded by buyer", order.budgetAtomic],
            ["Cash in treasury", balances["asset:usdc"]],
            ["Owed to contributors", balances["liability:contributor_payables"]],
            ["Revenue recognized", balances["revenue:dataset_sales"]],
          ].map(([label, value], index) => (
            <div key={label} className={cn("flex flex-col gap-1 py-4 md:px-5", index % 2 === 1 && "ps-5", index > 0 && "md:border-s md:border-line-faint", index === 0 && "md:ps-0", index === 1 && "border-s border-line-faint md:border-s")}>
              <dt className="type-label-sm text-text-2">{label}</dt>
              <dd><Amount value={value} className="type-heading" /></dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 type-label-sm text-text-3">Prepaid but undelivered: <Amount value={balances["liability:customer_prepayments"]} /></p>
      </Section>
      <Funding orderId={orderId!} />
      <RecentActivity orderId={orderId!} />
    </>
  );
}

export function NeedsYouList({ orderId, submissions, payables, standalone }: { orderId: Id<"orders">; submissions: SubmissionRow[] | undefined; payables: PayableRow[] | undefined; standalone?: boolean }) {
  const exceptions = useExceptions(orderId);
  const n = needsYou(submissions, payables);
  const open = (exceptions ?? []).filter(item => item.stillDetected && item.disposition?.status !== "resolved");
  const rows = [
    ...n.review.map(s => ({ key: s._id, href: `/dashboard/submissions/${s._id}`, title: `Review clip ${s._id.slice(0, 8)}`,
      detail: s.analysis ? `AI suggests: ${humanize(s.analysis.recommendation).toLowerCase()}` : "Analysis pending", action: "Review" })),
    ...n.approve.map(p => ({ key: p._id, href: "/dashboard/payables", title: <>Approve payout of <Amount value={p.amountAtomic} /></>,
      detail: `Proposed by the finance agent to ${shortHash(p.recipientAddress)}`, action: "Approve" })),
    ...n.sign.map(p => ({ key: `${p._id}:sign`, href: "/dashboard/payables", title: <>Sign approved payout of <Amount value={p.amountAtomic} /></>,
      detail: "Approved. Waiting for your wallet signature.", action: "Sign" })),
    ...open.map(item => ({ key: item.exceptionKey, href: "/dashboard/ledger", title: humanize(item.exception.code),
      detail: item.exception.detail, action: "Resolve" })),
  ];
  const loading = submissions === undefined || payables === undefined;
  return (
    <section className={standalone ? undefined : "mt-2"} aria-label="Needs you">
      {!standalone && <div className="mb-3 flex items-baseline gap-3"><h2 className="type-heading-sm">Needs you</h2>{rows.length > 0 && <Badge>{rows.length}</Badge>}</div>}
      {loading ? <Loading rows={2} /> : rows.length === 0
        ? <div className="flex items-center gap-2 rounded-panel border border-line-faint px-4 py-3 type-body-sm text-text-2"><Lordicon name="check" size={16} trigger="in" />Nothing to do.</div>
        : (
          <ul className="divide-y divide-line-faint rounded-panel border border-line-faint">
            {rows.map(row => (
              <li key={row.key}>
                <Link href={row.href} className="flex min-h-12 items-center gap-3 px-4 py-2 hover:bg-hover-row">
                  <Status status="waiting" className="shrink-0">{""}</Status>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate type-label">{row.title}</span>
                    <span className="block truncate type-body-sm text-text-2">{row.detail}</span>
                  </span>
                  <span className="shrink-0 type-label text-text-1 underline-offset-4 group-hover:underline">{row.action}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      {!loading && n.testUploads.length > 0 && (
        <Link href="/dashboard/submissions" className="mt-2 block type-label-sm text-text-3 underline-offset-4 hover:underline">
          {n.testUploads.length} test {n.testUploads.length === 1 ? "upload" : "uploads"} (cannot be paid)
        </Link>
      )}
    </section>
  );
}

function Funding({ orderId }: { orderId: Id<"orders"> }) {
  const reconciliation = useReconciliation(orderId);
  const funding = reconciliation?.matches.find(match => match.eventKey.startsWith("funding:"));
  const chain = rail(funding?.chainIdentity);
  return (
    <Section title="Funding">
      {reconciliation === undefined ? <Loading rows={1} /> : !funding || !chain
        ? <p className="type-body-sm text-text-2">No reconciled funding transfer yet. Work stays locked until one is observed on chain.</p>
        : (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-panel border border-line-faint px-4 py-3">
            <Status status="ok">Reconciled</Status>
            <Amount value={funding.amountAtomic} className="type-label" />
            <Badge variant="outline">{chain.label}</Badge>
            <a href={chain.href} target="_blank" rel="noreferrer" className="flex items-center gap-1 type-label-sm text-text-2 underline underline-offset-4">
              View on {chain.explorer}
            </a>
          </div>
        )}
    </Section>
  );
}

function RecentActivity({ orderId }: { orderId: Id<"orders"> }) {
  const audit = useAudit(orderId);
  return (
    <Section title="Recent activity" meta={<Link href="/dashboard/audit" className="underline underline-offset-4">Full audit log</Link>}>
      {audit === undefined ? <Loading /> : audit.length === 0 ? <p className="type-body-sm text-text-2">No activity yet.</p> : <ActivityFeed events={audit} limit={4} />}
    </Section>
  );
}

function Operations({ orderId }: { orderId: Id<"orders"> }) {
  const stats = useQuery(api.analytics.overview, { demoIdentity: CONTROLLER, orderId });
  if (!stats) return null;
  const rate = stats.acceptanceRate.basisPoints;
  const p = stats.verificationLatencyMs;
  const items: [string, string, string?][] = [
    ["Licensed clips", stats.submitted, `${stats.accepted} accepted${rate != null ? ` (${(Number(rate) / 100).toFixed(0)}%)` : ""}`],
    ["AI check time", p.p50 != null ? formatMs(p.p50) : "No runs", p.p95 != null ? `p95 ${formatMs(p.p95)} over ${p.sampleCount} runs` : undefined],
    ["Duplicates blocked", stats.duplicatesBlocked],
    ["Refused actions", stats.refusals],
  ];
  return (
    <Section title="Operations">
      <dl className="grid grid-cols-2 border-y border-line-faint md:grid-cols-4">
        {items.map(([label, value, sub], index) => (
          <div key={label} className={cn("flex flex-col gap-0.5 py-4 md:px-5", index % 2 === 1 && "ps-5 border-s border-line-faint", index > 1 && "md:border-s md:border-line-faint", index === 0 && "md:ps-0")}>
            <dt className="type-label-sm text-text-2">{label}</dt>
            <dd className="type-heading tabular-nums">{value}</dd>
            {sub && <dd className="type-label-sm text-text-3">{sub}</dd>}
          </div>
        ))}
      </dl>
    </Section>
  );
}
