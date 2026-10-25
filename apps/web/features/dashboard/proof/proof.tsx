"use client";
import Link from "next/link";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState, type ReactNode } from "react";
import { StatusMark } from "@/components/glaze/ui/status";
import { cn } from "@/lib/glaze/utils";
import { api, BUYER, useOrderData, useOrderId, type Id } from "../data";
import { formatTime, formatUsdc, humanize, shortHash } from "../format";
import { Amount, Loading, PageHeader, Unavailable } from "../ui";
import { PROOF_SECTIONS, type ProofSlug } from "./sections";

type Summary = FunctionReturnType<typeof api.proof.summary>;
type Mark = "ok" | "warn" | "fail" | "idle" | "waiting";
type Headline = { status: Mark; text: string };

function useProof() {
  const orderId = useOrderId();
  const summary = useQuery(api.proof.summary, orderId ? { demoIdentity: BUYER, orderId } : "skip");
  return { orderId, summary };
}

/** The one-line verdict per proof, shared by the index rows. Deterministic, from stored evidence only. */
function headline(slug: ProofSlug, s: Summary): Headline {
  switch (slug) {
    case "payments": {
      const funded = s.fundingTimeline.rows.find(row => row.steps.some(step => step.stage === "chain" && !step.missing));
      const paid = s.payouts.rows.filter(row => row.status === "paid").length;
      return funded ? { status: "ok", text: `${formatUsdc(funded.amountAtomic)} USDC funded on ${funded.label}${paid ? `, ${paid} paid out` : ""}` }
        : { status: "waiting", text: s.fundingTimeline.missing ?? "No observed funding yet" };
    }
    case "agent": {
      const refusals = s.agentRuns.refusalEvents.length + s.agentRuns.rows.reduce((n, row) => n + row.toolRefusals.length, 0);
      return s.agentRuns.rows.length ? { status: "ok", text: `${s.agentRuns.rows.length} runs, ${refusals ? `${refusals} approval ${refusals === 1 ? "attempt" : "attempts"} refused` : "none tried to approve"}` }
        : { status: "waiting", text: s.agentRuns.missing ?? "No runs yet" };
    }
    case "jury": {
      const scored = s.jury.rows.filter(row => row.agreementFraction !== null);
      if (!scored.length) return { status: "waiting", text: s.jury.rows.find(row => row.missing)?.missing ?? s.jury.missing ?? "No jury yet" };
      const mean = scored.reduce((n, row) => n + (row.agreementFraction ?? 0), 0) / scored.length;
      return { status: "ok", text: `Two models agree on ${Math.round(mean * 100)}% of criteria across ${scored.length} ${scored.length === 1 ? "clip" : "clips"}` };
    }
    case "licenses": {
      const minted = s.solanaLicenses.rows.filter(row => row.status === "minted").length;
      return minted ? { status: "ok", text: `${minted} ${minted === 1 ? "license" : "licenses"} minted on Solana Devnet` } : { status: "waiting", text: s.solanaLicenses.missing ?? "No license yet" };
    }
    case "bank": {
      const bad = s.bank4Way.rows.filter(row => [row.order, row.ledger, row.chain, row.bank].some(c => c.status === "mismatch")).length;
      if (s.bank4Way.missing) return { status: "waiting", text: s.bank4Way.missing };
      return bad ? { status: "fail", text: `${bad} of ${s.bank4Way.rows.length} payments disagree with the bank` } : { status: "ok", text: `Order, ledger, chain and bank agree on ${s.bank4Way.rows.length} ${s.bank4Way.rows.length === 1 ? "payment" : "payments"}` };
    }
    case "attestations": {
      const done = s.attestations.rows.filter(row => row.attestation).length;
      return done ? { status: "ok", text: `${done} of ${s.attestations.rows.length} clips attested on Base Sepolia` } : { status: "waiting", text: s.attestations.rows[0]?.missing ?? s.attestations.missing ?? "No attestation yet" };
    }
    case "guard":
      return { status: "ok", text: `${s.guard.feedExceptionCount} exceptions eligible for Jira. Jira cannot approve money.` };
    case "platform": {
      const ran = s.convexFeatures.crons.filter(row => row.lastRunAt).length;
      return { status: ran ? "ok" : "waiting", text: `${s.convexFeatures.crons.length} crons, ${ran} with a recorded run, ${s.convexFeatures.httpActions.length} HTTP routes` };
    }
    case "tax":
      return { status: "ok", text: "Year-to-date payouts per contributor, with form status" };
  }
}

const Testnet = ({ children = "Testnet" }: { children?: ReactNode }) =>
  <span className="rounded-pill border border-line-control px-2 py-0.5 type-label-sm text-text-2">{children}</span>;

function Missing({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return <p className="flex items-center gap-2 type-body-sm text-text-2"><StatusMark status="waiting" />Not yet: {text}</p>;
}

function Block({ title, meta, children }: { title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-panel border border-line-faint">
      <div className="flex items-baseline gap-3 border-b border-line-faint px-4 py-2.5">
        <h2 className="me-auto type-label">{title}</h2>
        {meta && <span className="type-label-sm text-text-3">{meta}</span>}
      </div>
      <div className="flex flex-col gap-2 px-4 py-3">{children}</div>
    </section>
  );
}

function Ext({ href, children }: { href: string | null | undefined; children: ReactNode }) {
  if (!href) return null;
  return <a href={href} target="_blank" rel="noopener noreferrer" className="type-label-sm underline underline-offset-4 hover:text-text-1">{children}</a>;
}

/** Index: is the demo ready, then one row per proof with its verdict. */
export function ProofIndex() {
  const { orderId, summary } = useProof();
  if (orderId === null) return <Unavailable title="No order" description="Post and fund a task to collect proof." />;
  return (
    <>
      <PageHeader title="Proof" />
      <HealthStrip />
      {summary === undefined ? <Loading rows={6} /> : (
        <ul className="mt-6 flex flex-col divide-y divide-line-faint rounded-panel border border-line-faint">
          {PROOF_SECTIONS.map(section => {
            const line = headline(section.slug, summary);
            return (
              <li key={section.slug}>
                <Link href={`/dashboard/proof/${section.slug}`} className="flex items-center gap-3 px-4 py-3 hover:bg-hover-row">
                  <StatusMark status={line.status} />
                  <span className="w-36 shrink-0">
                    <span className="block type-label">{section.title}</span>
                    <span className="block type-label-sm text-text-3">{section.sponsor}</span>
                  </span>
                  <span className="min-w-0 flex-1 truncate type-body-sm text-text-2">{line.text}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function HealthStrip() {
  const health = useQuery(api.health.integrations, {});
  const [open, setOpen] = useState(false);
  if (!health) return null;
  const failing = health.items.filter(item => item.status !== "ok");
  const ok = health.items.length - failing.length;
  return (
    <div className="rounded-panel border border-line-faint">
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} disabled={!failing.length}
        className="flex w-full items-center gap-3 px-4 py-3 text-start enabled:hover:bg-hover-row">
        <StatusMark status={health.demoReady ? "ok" : "warn"} />
        <span className="type-label">{health.demoReady ? "Demo ready" : "Not demo ready"}</span>
        <span className="type-body-sm text-text-2">{ok} of {health.items.length} checks pass</span>
        {failing.length > 0 && <span className="ms-auto type-label-sm text-text-2 underline underline-offset-4">{open ? "Hide" : `Show ${failing.length} failing`}</span>}
      </button>
      {open && (
        <ul className="flex flex-col gap-2 border-t border-line-faint px-4 py-3">
          {failing.map(item => (
            <li key={item.id} className="flex items-start gap-2 type-body-sm">
              <StatusMark status={item.status === "missing" ? "fail" : "warn"} className="mt-0.5" />
              <span><span className="type-label">{humanize(item.id.replace(/^env\./, "").replace(/\./g, " "))}</span> <span className="text-text-2">{item.reason}. Fix: {item.fix}.</span></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One proof, focused: the headline big, the evidence below, honest "not yet" rows. */
export function ProofSection({ slug }: { slug: ProofSlug }) {
  const { orderId, summary } = useProof();
  const index = PROOF_SECTIONS.findIndex(section => section.slug === slug);
  const section = PROOF_SECTIONS[index]!, next = PROOF_SECTIONS[(index + 1) % PROOF_SECTIONS.length]!;
  if (orderId === null) return <Unavailable title="No order" description="Post and fund a task to collect proof." />;
  if (!orderId || summary === undefined) return <><PageHeader title={section.title} /><Loading rows={5} /></>;
  const line = headline(slug, summary);
  return (
    <>
      <div className="mb-6">
        <p className="mb-1 type-label-sm text-text-3">{section.sponsor}</p>
        <h1 className="type-title">{section.title}</h1>
        <p className="mt-3 flex items-center gap-2 type-heading-sm"><StatusMark status={line.status} />{line.text}</p>
      </div>
      <div className="flex flex-col gap-4">
        {slug === "payments" && <Payments s={summary} orderId={orderId} />}
        {slug === "agent" && <Agent s={summary} orderId={orderId} />}
        {slug === "jury" && <Jury s={summary} />}
        {slug === "licenses" && <Licenses s={summary} />}
        {slug === "bank" && <Bank s={summary} />}
        {slug === "attestations" && <Attestations s={summary} />}
        {slug === "guard" && <Guard s={summary} />}
        {slug === "platform" && <Platform s={summary} />}
        {slug === "tax" && <Tax orderId={orderId} />}
      </div>
      <Link href={`/dashboard/proof/${next.slug}`} className="mt-8 flex items-center justify-end gap-2 type-label text-text-2 hover:text-text-1">
        Next: {next.title}
      </Link>
    </>
  );
}

const STAGE: Record<string, string> = { "402": "402 challenge", signed: "Buyer signed", settled: "Facilitator settled", webhook: "CDP webhook", chain: "On chain" };

function Payments({ s, orderId }: { s: Summary; orderId: Id<"orders"> }) {
  const { summary } = useOrderData(orderId);
  const autoPay = summary?.order.autoPay;
  const wallet = s.agentWallet;
  const address = wallet.address ?? wallet.recorded.address;
  return (
    <>
      <Block title="Funding through x402" meta={<Testnet />}>
        {s.fundingTimeline.rows.length ? s.fundingTimeline.rows.map(row => (
          <div key={row.intentId} className="flex flex-col gap-2">
            <p className="type-body-sm"><Amount value={row.amountAtomic} /> on {row.label}{row.simulated ? " (simulated)" : ""}</p>
            <ol className="grid gap-2 sm:grid-cols-5">
              {row.steps.map(step => (
                <li key={step.stage} className="flex flex-col gap-1 rounded-tag bg-field/60 p-2">
                  <span className="flex items-center gap-1.5 type-label-sm"><StatusMark status={step.missing ? "waiting" : "ok"} />{STAGE[step.stage] ?? humanize(step.stage)}</span>
                  {step.timestamp ? <span className="type-label-sm text-text-3">{formatTime(step.timestamp)}</span>
                    : step.missing ? <span className="type-label-sm text-text-3">{step.missing}</span> : null}
                  {step.stage === "chain" && row.observations[0] && <Ext href={row.observations[0].explorerUrl}>BaseScan</Ext>}
                </li>
              ))}
            </ol>
          </div>
        )) : <Missing text={s.fundingTimeline.missing} />}
      </Block>

      <Block title="Payouts" meta={autoPay?.enabled ? <>Auto-pay up to <Amount value={autoPay.maxPerClipAtomic} /> per clip</> : "Auto-pay off. You approve each payout."}>
        {s.payouts.rows.length ? s.payouts.rows.map(row => {
          const approval = s.agentRuns.approvals.find(a => a.status === "approved");
          return (
            <div key={row.intentId} className="flex flex-wrap items-center gap-x-3 gap-y-1 type-body-sm">
              <StatusMark status={row.status === "paid" ? "ok" : row.chainObserved ? "ok" : "waiting"} />
              <Amount value={row.amountAtomic} />
              <span className="text-text-2">{humanize(row.status)}</span>
              {approval?.policyEngine && <span className="text-text-2">Your signed rule approved, the agent executed</span>}
              <span className="ms-auto"><Ext href={row.explorerUrl}>BaseScan</Ext></span>
            </div>
          );
        }) : <Missing text={s.payouts.missing} />}
      </Block>

      <Block title="Agent wallet (CDP)" meta={<Testnet />}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 type-body-sm">
          <span className="mono">{shortHash(address, 6, 4)}</span>
          <Ext href={wallet.explorerUrl ?? `https://sepolia.basescan.org/address/${address}`}>BaseScan</Ext>
          <span className="text-text-2">Cap <Amount value={wallet.capAtomic ?? wallet.recorded.capAtomic} /> per payout, enforced by CDP</span>
          <span className="text-text-2">Sends from {wallet.executorMode === "cdp_agent" ? "the CDP agent wallet" : "the buyer wallet"}</span>
        </div>
        <p className="mt-1 type-label-sm text-text-3">Sends CDP refused (recorded {new Date(wallet.recorded.recordedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })})</p>
        {wallet.recordedRejections.map(row => (
          <p key={row.correlationId} className="flex items-center gap-2 type-body-sm">
            <StatusMark status="fail" />{row.kind === "over_cap" ? <>Over the cap: <Amount value={row.amountAtomic} /></> : <>Recipient not on the allowlist: <Amount value={row.amountAtomic} /></>}
            <span className="text-text-3">{row.status} {humanize(row.code)}</span>
          </p>
        ))}
      </Block>

      <Block title="Connect your agent">
        <p className="type-body-sm text-text-2">Point any MCP agent at Skarl. It can onboard, check its wallet and request test USDC. It cannot approve payouts.</p>
        <div className="flex flex-wrap items-center gap-2">
          <a href="/skill.md" target="_blank" rel="noopener noreferrer" className="rounded-tag border border-line-control px-2.5 py-1 type-label-sm hover:bg-hover">Open skill.md</a>
          {["skarl_onboard", "skarl_wallet_status", "skarl_request_testnet_usdc"].map(tool => <code key={tool} className="rounded-tag bg-field px-2 py-1 type-label-sm">{tool}</code>)}
          <Link href="/dashboard/integrations" className="ms-auto type-label-sm underline underline-offset-4">Setup command</Link>
        </div>
      </Block>
    </>
  );
}

function Agent({ s, orderId }: { s: Summary; orderId: Id<"orders"> }) {
  const notes = useQuery(api.financeAnalyst.notesFor, { demoIdentity: BUYER, orderId });
  const refusals = [...s.agentRuns.refusalEvents.map(row => ({ key: row.id, text: humanize(row.action), when: row.occurredAt })),
    ...s.agentRuns.rows.flatMap(run => run.toolRefusals.map(row => ({ key: `${run.id}:${row.index}`, text: `${row.tool ?? "Tool"} refused: ${humanize(row.code)}`, when: run.startedAt })))];
  return (
    <>
      <Block title="Agents can never approve payouts" meta={`${refusals.length} refused`}>
        {refusals.length ? refusals.slice(0, 5).map(row => (
          <p key={row.key} className="flex items-center gap-2 type-body-sm"><StatusMark status="fail" />{row.text}<span className="ms-auto text-text-3">{formatTime(row.when)}</span></p>
        )) : <Missing text={s.agentRuns.refusalMissing} />}
        <p className="flex items-center gap-2 type-body-sm"><StatusMark status={s.agentRuns.policyApprovalMissing ? "waiting" : "ok"} />
          {s.agentRuns.policyApprovalMissing ? `Not yet: ${s.agentRuns.policyApprovalMissing}` : "Approvals come only from your signed rule or from you"}</p>
      </Block>
      <Block title="Runs" meta={<Link href="/dashboard/agent" className="underline underline-offset-4">Open chat</Link>}>
        {s.agentRuns.rows.length ? s.agentRuns.rows.slice(0, 6).map(run => (
          <div key={run.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 type-body-sm">
            <StatusMark status={run.status === "failed" ? "fail" : run.status === "running" ? "waiting" : "ok"} />
            <span className="rounded-pill bg-field px-2 py-0.5 type-label-sm">{humanize(run.provider)} · {run.model}</span>
            <span className="text-text-2">{humanize(run.status)}</span>
            {BigInt(run.proposedAtomic) > 0n && <span className="text-text-2">proposed <Amount value={run.proposedAtomic} /></span>}
            <span className="ms-auto text-text-3">{formatTime(run.startedAt)}</span>
          </div>
        )) : <Missing text={s.agentRuns.missing} />}
      </Block>
      <Block title="Analyst notes" meta="Advisory">
        {notes !== undefined && notes.some(note => note.status !== "completed") && (
          <p className="flex items-center gap-2 type-body-sm text-text-2"><StatusMark status="waiting" />{notes.filter(note => note.status === "queued" || note.status === "running").length} queued, {notes.filter(note => note.status === "provider_error").length} failed</p>
        )}
        {notes === undefined ? <Loading rows={2} /> : notes.some(note => note.status === "completed") ? notes.filter(note => note.status === "completed").slice(0, 5).map(note => (
          <div key={note._id} className="flex flex-col gap-0.5 type-body-sm">
            <span className="flex items-center gap-2"><StatusMark status="ok" />
              <span className="type-label">{humanize(note.kind)}</span>
              <span className="text-text-2">suggests {humanize(note.recommendation).toLowerCase()}</span>
              <span className="ms-auto text-text-3">{humanize(note.provider)} · {note.model}</span></span>
            <span className="ps-6 text-text-2">{note.summary}</span>
          </div>
        )) : <Missing text="No completed analyst note yet" />}
      </Block>
    </>
  );
}

const VERDICT: Record<string, Mark> = { supported: "ok", contradicted: "fail", unobservable: "warn" };
function Jury({ s }: { s: Summary }) {
  if (!s.jury.rows.length) return <Missing text={s.jury.missing} />;
  const judged = s.jury.rows.filter(row => row.judges.length), pending = s.jury.rows.filter(row => !row.judges.length);
  return (
    <>
      {pending.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 type-body-sm text-text-2"><StatusMark status="waiting" />
          {pending.length} {pending.length === 1 ? "clip has" : "clips have"} no two-model jury yet:
          {pending.map(row => <Link key={row.submissionId} href={`/dashboard/submissions/${row.submissionId}`} className="underline underline-offset-4 hover:text-text-1">{row.submissionId.slice(0, 8)}</Link>)}
        </p>
      )}
      {judged.map(row => (
        <Block key={row.submissionId} title={`Clip ${row.submissionId.slice(0, 8)}`}
          meta={row.agreementFraction !== null ? `${Math.round(row.agreementFraction * 100)}% agreement · advisory` : "advisory"}>
          {row.judges.length ? (
            <div className="overflow-x-auto">
              <table className="w-full type-body-sm">
                <thead><tr className="text-start type-label-sm text-text-3">
                  <th className="py-1 pe-3 text-start font-normal">Criterion</th>
                  {row.judges.map((judge, i) => <th key={i} className="py-1 pe-3 text-start font-normal">{judge.model ?? "Judge"}{judge.latencyMs ? ` · ${(judge.latencyMs / 1000).toFixed(1)}s` : ""}</th>)}
                </tr></thead>
                <tbody>
                  {row.criteria.map(c => (
                    <tr key={c.criterionId} className="border-t border-line-faint">
                      <td className="py-1.5 pe-3">{humanize((c.criterionId ?? "criterion").replace(/-/g, " "))}</td>
                      {c.verdicts.map((v, i) => <td key={i} className="py-1.5 pe-3"><span className="flex items-center gap-1.5"><StatusMark status={VERDICT[v.verdict ?? ""] ?? "idle"} />{v.verdict ? humanize(v.verdict) : "None"}</span></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <Missing text={row.missing} />
          <Link href={`/dashboard/submissions/${row.submissionId}`} className="type-label-sm underline underline-offset-4">Open clip</Link>
        </Block>
      ))}
    </>
  );
}

function Licenses({ s }: { s: Summary }) {
  return (
    <Block title="License per accepted clip" meta={<Testnet>Token-2022 · supply 1 · mint authority revoked · Devnet</Testnet>}>
      {s.solanaLicenses.rows.length ? s.solanaLicenses.rows.map(row => (
        <div key={row.deliveryId} className="flex flex-wrap items-center gap-x-3 gap-y-1 type-body-sm">
          <StatusMark status={row.status === "minted" ? "ok" : row.lastError ? "fail" : "waiting"} />
          <span className="type-label">{humanize(row.status)}</span>
          {row.mintAddress && <span className="mono text-text-2">{shortHash(row.mintAddress, 6, 4)}</span>}
          <span className="text-text-3" title={row.licenseDigest}>digest {shortHash(row.licenseDigest, 8, 4)}</span>
          <span className="ms-auto flex gap-3"><Ext href={row.tokenUrl}>Token</Ext><Ext href={row.transactionUrl}>Transaction</Ext></span>
          {row.lastError && <span className="w-full ps-6 text-fail-text">{row.lastError}</span>}
        </div>
      )) : <Missing text={s.solanaLicenses.missing} />}
    </Block>
  );
}

const COL: Record<string, Mark> = { match: "ok", mismatch: "fail", missing: "idle" };
function Bank({ s }: { s: Summary }) {
  const b = s.bank4Way;
  return (
    <>
      <Block title="Four-way match" meta={<Testnet>Mock bank (Capital One Nessie)</Testnet>}>
        {b.rows.length ? (
          <table className="w-full type-body-sm">
            <thead><tr className="type-label-sm text-text-3">{["Payment", "Order", "Ledger", "Chain", "Bank"].map(h => <th key={h} className="py-1 pe-3 text-start font-normal">{h}</th>)}</tr></thead>
            <tbody>
              {b.rows.map(row => (
                <tr key={row.intentId} className="border-t border-line-faint">
                  <td className="py-1.5 pe-3">{humanize(row.kind)}</td>
                  {[row.order, row.ledger, row.chain, row.bank].map((c, i) => (
                    <td key={i} className="py-1.5 pe-3"><span className="flex items-center gap-1.5" title={c.reason}><StatusMark status={COL[c.status] ?? "idle"} />{c.amountAtomic ? <Amount value={c.amountAtomic} /> : humanize(c.status)}</span></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <Missing text={b.missing} />
        <Link href="/dashboard/reconciliation" className="type-label-sm underline underline-offset-4">Open reconciliation</Link>
      </Block>
      {b.bankExceptions.length > 0 && (
        <Block title="Bank exceptions" meta={`${b.bankExceptions.length}`}>
          {b.bankExceptions.map((row, i) => <p key={i} className="flex items-center gap-2 type-body-sm"><StatusMark status="fail" />{humanize(row.code)}</p>)}
        </Block>
      )}
    </>
  );
}

function Attestations({ s }: { s: Summary }) {
  return (
    <Block title="One attestation per verified clip" meta={<Testnet>Base Sepolia</Testnet>}>
      {s.attestations.rows.length ? s.attestations.rows.map(row => (
        <div key={row.submissionId} className="flex flex-wrap items-center gap-x-3 gap-y-1 type-body-sm">
          <StatusMark status={row.attestation ? "ok" : "waiting"} />
          <Link href={`/dashboard/submissions/${row.submissionId}`} className="type-label hover:underline">Clip {row.submissionId.slice(0, 8)}</Link>
          {row.attestation ? <span className="ms-auto flex gap-3"><Ext href={row.attestation.easscanUrl}>EASScan</Ext><Ext href={row.attestation.basescanUrl}>BaseScan</Ext></span>
            : <span className="text-text-2">{row.missing}</span>}
        </div>
      )) : <Missing text={s.attestations.missing} />}
    </Block>
  );
}

function Guard({ s }: { s: Summary }) {
  const g = s.guard;
  return (
    <Block title="Skarl Guard" meta={<a href={g.projectUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">Open {g.projectKey} board</a>}>
      <p className="type-body-sm"><span className="type-heading-sm">{g.feedExceptionCount}</span> <span className="text-text-2">reconciliation exceptions eligible for the Jira feed</span></p>
      <p className="flex items-center gap-2 type-body-sm"><StatusMark status="ok" />Jira can comment and track. It cannot grant financial authority.</p>
      <Missing text={g.missing} />
    </Block>
  );
}

function Platform({ s }: { s: Summary }) {
  const f = s.convexFeatures;
  return (
    <>
      <Block title="Scheduled jobs" meta={`${f.crons.length} crons`}>
        {f.crons.map(cron => (
          <div key={cron.name} className="flex flex-wrap items-center gap-x-3 type-body-sm">
            <StatusMark status={cron.lastRunAt ? (cron.lastStatus === "failed" ? "fail" : "ok") : "waiting"} />
            <span className="type-label">{humanize(cron.name)}</span>
            <span className="ms-auto text-text-3">{cron.lastRunAt ? `ran ${formatTime(cron.lastRunAt)}` : "no run recorded"}</span>
          </div>
        ))}
      </Block>
      <Block title="Also running on Convex">
        <p className="flex items-center gap-2 type-body-sm"><StatusMark status={f.workflow.missing ? "waiting" : "ok"} />Durable workflow waits on approval: {f.workflow.approvalWaitCount} payouts</p>
        <p className="flex items-center gap-2 type-body-sm"><StatusMark status={f.storage.missing ? "waiting" : "ok"} />File storage: {f.storage.assetCount} private media files</p>
        <p className="flex items-center gap-2 type-body-sm"><StatusMark status="ok" />{f.nodeActions.length} Node actions: verifier, finance agent, wallet, attestations</p>
        <p className="flex items-center gap-2 type-body-sm"><StatusMark status="ok" />{f.httpActions.length} HTTP routes, including MCP and health</p>
        <p className="flex items-center gap-2 type-body-sm"><StatusMark status="ok" />Every page on this dashboard updates live by subscription</p>
      </Block>
    </>
  );
}

function Tax({ orderId }: { orderId: Id<"orders"> }) {
  const tax = useQuery(api.tax.summary, { demoIdentity: BUYER, orderId });
  if (tax === undefined) return <Loading rows={3} />;
  const csv = `data:text/csv;charset=utf-8,${encodeURIComponent(tax.csv)}`;
  return (
    <Block title={`${tax.year} payouts per contributor`} meta={tax.label.replace(/\s*[—–]\s*(\w)/g, (_, c: string) => `. ${c.toUpperCase()}`)}>
      {tax.rows.length ? (
        <table className="w-full type-body-sm">
          <thead><tr className="type-label-sm text-text-3">{["Contributor", "Country", "Form", "Year to date", "Flags"].map(h => <th key={h} className="py-1 pe-3 text-start font-normal">{h}</th>)}</tr></thead>
          <tbody>
            {tax.rows.map(row => (
              <tr key={row.contributorId} className="border-t border-line-faint">
                <td className="py-1.5 pe-3">{row.contributorId.slice(0, 8)}</td>
                <td className="py-1.5 pe-3">{row.country ?? "None"}</td>
                <td className="py-1.5 pe-3">{row.taxForm === "none" ? "None" : humanize(row.taxForm)}</td>
                <td className="py-1.5 pe-3"><Amount value={row.ytdMicroUsd} /></td>
                <td className="py-1.5 pe-3">{row.flags.length ? <span className="flex flex-wrap gap-1">{row.flags.map(flag => (
                  <span key={flag} className={cn("rounded-pill px-2 py-0.5 type-label-sm", flag === "tax_form_missing" ? "bg-warn-text/10 text-warn-text" : "bg-field")}>
                    {flag === "tax_form_missing" ? "Form missing, payouts held" : flag === "info_return_needed" ? `Over ${formatUsdc(tax.thresholdMicroUsd)} threshold` : humanize(flag)}</span>))}</span> : "None"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <Missing text="No contributor on this order yet" />}
      <a href={csv} download={`skarl-tax-${tax.year}.csv`} className="type-label-sm underline underline-offset-4">Download CSV</a>
    </Block>
  );
}
