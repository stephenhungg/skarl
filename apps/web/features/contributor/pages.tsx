"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Status } from "@/components/glaze/ui/status";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/glaze/ui/table";
import { Amount, Loading, PageHeader, QueryBoundary, RequireConvex, Section, Unavailable } from "@/features/dashboard/ui";
import { basescanTx, formatTime, readableReason, shortHash } from "@/features/dashboard/format";
import { TableToolbar } from "@/features/dashboard/table-tools";
import { cn } from "@/lib/glaze/utils";
import { clipSteps, totals, useClips, type Clip, type EarningRow, type Step } from "./data";
import { TaxProfile } from "./tax-profile";

const EXPO_GO = "https://apps.apple.com/us/app/expo-go/id982107779";

export function ClipStatus({ clip, size }: { clip: Pick<EarningRow, "status" | "payableStatus" | "payout">; size?: "sm" }) {
  const { tone, summary } = clipSteps(clip);
  return <Status status={tone} size={size}>{summary}</Status>;
}

/** Five steps from upload to payout; the current one carries its status word. */
export function StepStrip({ steps }: { steps: Step[] }) {
  return (
    <ol className="grid grid-cols-5 gap-2" aria-label="Clip progress">
      {steps.map(step => (
        <li key={step.label} aria-current={step.state === "current" ? "step" : undefined} className="flex min-w-0 flex-col gap-1.5">
          <span className={cn("h-1 rounded-pill", step.state === "done" ? "bg-ink" : step.state === "current"
            ? (step.tone === "fail" ? "bg-fail" : step.tone === "warn" ? "bg-warn" : step.tone === "ok" ? "bg-ok" : "bg-ink opacity-45") : "bg-ink opacity-10")} />
          <span className={cn("truncate type-label-sm", step.state === "todo" ? "text-text-3" : "text-text-1")}>{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

function EarningsStrip({ rows }: { rows: EarningRow[] }) {
  const { earned, paid, waiting } = totals(rows);
  const cells = [["Earned", earned], ["Paid", paid], ["Waiting for payout", waiting]] as const;
  return (
    <dl className="grid grid-cols-3 border-y border-line-faint">
      {cells.map(([label, value], i) => (
        <div key={label} className={cn("min-w-0 py-4", i > 0 && "border-s border-line-faint ps-4 sm:ps-5")}>
          <dt className="truncate type-label-sm text-text-2">{label}</dt>
          <dd className="type-heading"><Amount value={value} /></dd>
        </div>
      ))}
    </dl>
  );
}

function Overview() {
  const { clips } = useClips();
  const latest = clips?.[0];
  const steps = latest ? clipSteps(latest) : null;
  const reason = latest?.detail?.decision?.reason;
  return (
    <>
      <PageHeader title="Overview" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-8">
          <section>
            <h2 className="mb-3 type-heading-sm">Latest clip</h2>
            {clips === undefined ? <Loading rows={2} /> : !latest || !steps
              ? <p className="type-body-sm text-text-2">No clips yet. Record one in the Skarl app and it shows up here as it is checked.</p>
              : (
                <Link href={`/contribute/clips/${latest.submissionId}`} className="block rounded-panel border border-line-faint p-4 transition-colors hover:bg-hover-row">
                  <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="mono type-label">{latest.submissionId.slice(0, 8)}</span>
                    <ClipStatus clip={latest} />
                    {latest.createdAt && <span className="ms-auto type-label-sm text-text-3">{formatTime(latest.createdAt)}</span>}
                  </div>
                  <StepStrip steps={steps.steps} />
                  {reason && <p className="mt-4 type-body-sm text-text-2">Reviewer: <span className="text-text-1">{readableReason(reason)}</span></p>}
                </Link>
              )}
          </section>
          <section>
            <div className="mb-3 flex items-baseline gap-3">
              <h2 className="type-heading-sm">Earnings</h2>
              <Link href="/contribute/earnings" className="ms-auto type-label-sm text-text-2 underline underline-offset-4">All payouts</Link>
            </div>
            {clips === undefined ? <Loading rows={1} /> : <EarningsStrip rows={clips} />}
          </section>
        </div>
        <CaptureCard />
      </div>
    </>
  );
}

function CaptureCard() {
  return (
    <aside className="shell lg:self-start">
      <div className="panel flex flex-col gap-3 p-4">
        <h2 className="type-heading-sm">Capture with the Skarl app</h2>
        <ol className="flex list-decimal flex-col gap-2 ps-5 type-body-sm text-text-2 marker:text-text-3">
          <li>Install <a href={EXPO_GO} target="_blank" rel="noreferrer" className="text-text-1 underline underline-offset-4">Expo Go</a> on your iPhone.</li>
          <li>Open the Skarl project link your team shares, in Expo Go.</li>
          <li>Read the task and consent. Allow camera, microphone and Motion &amp; Fitness.</li>
          <li>Prop the phone so it stays still, then record the task while narrating what you do.</li>
          <li>Watch the take back and submit. Its progress appears here.</li>
        </ol>
      </div>
      <div className="shell-foot flex items-center">
        <a href={EXPO_GO} target="_blank" rel="noreferrer" className="type-label text-text-2 underline underline-offset-4">Get Expo Go on the App Store</a>
      </div>
    </aside>
  );
}

type View = "all" | "in_progress" | "needs_correction" | "accepted" | "paid" | "rejected";
const VIEWS: { value: View; label: string; match: (clip: Clip) => boolean }[] = [
  { value: "all", label: "All", match: () => true },
  { value: "in_progress", label: "In review", match: c => ["uploading", "queued", "analysing", "needs_review"].includes(c.status) },
  { value: "needs_correction", label: "Retake asked", match: c => c.status === "needs_correction" },
  { value: "accepted", label: "Accepted", match: c => c.status === "accepted" && c.payout.status !== "paid" },
  { value: "paid", label: "Paid", match: c => c.payout.status === "paid" },
  { value: "rejected", label: "Rejected", match: c => c.status === "rejected" },
];

function Clips() {
  const { clips } = useClips();
  const router = useRouter();
  const [view, setView] = useState<View>("all");
  const [query, setQuery] = useState("");
  const all = clips ?? [];
  const match = VIEWS.find(v => v.value === view)!.match;
  const q = query.trim().toLowerCase();
  const rows = all.filter(clip => match(clip) && (!q || clip.submissionId.toLowerCase().includes(q) || clip.status.includes(q)));
  return (
    <>
      <PageHeader title="My clips" />
      {clips === undefined ? <Loading rows={4} /> : all.length === 0
        ? <Unavailable title="No clips yet" description="Record a take in the Skarl app. It appears here once it uploads." />
        : (
          <>
            <TableToolbar views={VIEWS.map(v => ({ value: v.value, label: v.label, count: all.filter(v.match).length }))}
              value={view} onChange={setView} query={query} onQuery={setQuery} placeholder="Search clip ID" />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Clip</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="max-sm:hidden">Uploaded</TableHead>
                  <TableHead numeric>Earned</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0
                  ? <TableRow><TableCell colSpan={4} className="py-6 text-center text-text-2">No clips match. Clear the search or pick another view.</TableCell></TableRow>
                  : rows.map(clip => (
                    <TableRow key={clip.submissionId} className="cursor-pointer" onClick={() => router.push(`/contribute/clips/${clip.submissionId}`)}>
                      <TableCell>
                        <Link href={`/contribute/clips/${clip.submissionId}`} onClick={event => event.stopPropagation()} className="mono underline-offset-4 hover:underline">
                          {clip.submissionId.slice(0, 8)}
                        </Link>
                      </TableCell>
                      <TableCell><ClipStatus clip={clip} /></TableCell>
                      <TableCell className="text-text-2 max-sm:hidden">{formatTime(clip.createdAt)}</TableCell>
                      <TableCell numeric className={clip.payableStatus && clip.payableStatus !== "reversed" ? "" : "text-text-3"}>
                        {clip.payableStatus && clip.payableStatus !== "reversed" ? <Amount value={clip.amountAtomic} /> : "None"}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </>
        )}
    </>
  );
}

function Earnings() {
  const { clips } = useClips();
  if (clips === undefined) return <><PageHeader title="Earnings" /><Loading rows={3} /></>;
  const owed = clips.filter(clip => clip.payableStatus !== null);
  return (
    <>
      <PageHeader title="Earnings" />
      <QueryBoundary><TaxProfile /></QueryBoundary>
      <EarningsStrip rows={clips} />
      <Section title="Payouts">
        {owed.length === 0
          ? <p className="type-body-sm text-text-2">Accepted clips earn USDC. None yet. <Link href="/contribute/clips" className="text-text-1 underline underline-offset-4">See your clips</Link></p>
          : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Clip</TableHead>
                  <TableHead>Payout</TableHead>
                  <TableHead>Transaction</TableHead>
                  <TableHead numeric>Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {owed.map(clip => {
                  const paid = clip.payout.status === "paid";
                  const reversed = clip.payableStatus === "reversed";
                  const txHash: string | null = clip.payout.txHash;
                  const explorer: string | null = clip.payout.explorerUrl;
                  return (
                    <TableRow key={clip.submissionId}>
                      <TableCell>
                        <Link href={`/contribute/clips/${clip.submissionId}`} className="mono underline-offset-4 hover:underline">{clip.submissionId.slice(0, 8)}</Link>
                      </TableCell>
                      <TableCell>
                        <Status status={paid ? "ok" : reversed ? "fail" : "waiting"}>
                          {paid ? "Paid" : reversed ? "Reversed" : clip.payableStatus === "payout_in_progress" ? "Payout in progress" : "Waiting for payout"}
                        </Status>
                      </TableCell>
                      <TableCell>
                        {txHash
                          ? <a href={explorer ?? basescanTx(txHash)} target="_blank" rel="noreferrer" className="mono underline underline-offset-4">{shortHash(txHash)}</a>
                          : <span className="text-text-3">Not sent</span>}
                      </TableCell>
                      <TableCell numeric className={reversed ? "text-text-3 line-through" : ""}><Amount value={clip.amountAtomic} /></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
      </Section>
    </>
  );
}

export const OverviewPage = () => <RequireConvex><Overview /></RequireConvex>;
export const ClipsPage = () => <RequireConvex><Clips /></RequireConvex>;
export const EarningsPage = () => <RequireConvex><Earnings /></RequireConvex>;
