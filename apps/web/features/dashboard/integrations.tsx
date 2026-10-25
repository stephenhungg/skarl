"use client";
import { useQuery } from "convex/react";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/glaze/ui/badge";
import { Button } from "@/components/glaze/ui/button";
import { CopyButton } from "@/components/glaze/ui/copy-button";
import { RelativeTime } from "@/components/glaze/ui/relative-time";
import { Status } from "@/components/glaze/ui/status";
import { toast } from "@/components/glaze/ui/toast";
import { api, CONTROLLER, useOrderId, type Id } from "./data";
import { basescanAddress, basescanTx, formatUsdc, humanize } from "./format";
import { Loading, PageHeader, QueryBoundary, Section } from "./ui";

const MCP_URL = "https://keen-marmot-986.convex.site/mcp";
const DISCOVERY_URL = "https://keen-marmot-986.convex.site/.well-known/mcp.json";
const AGENT_CARD_URL = "https://keen-marmot-986.convex.site/.well-known/agent-card.json";
const LLMS_URL = "https://keen-marmot-986.convex.site/llms.txt";
const CLAUDE_ADD = `claude mcp add --transport http skarl ${MCP_URL}`;

// Recorded CDP evidence (docs/agent-wallet.md, docs/demo-script.md). Checked October 25, 2026, 03:05 PDT.
const AGENT_ADDRESS = "0x0A9EfDF66c58543538824906aE267B969Ed651c5";
const POLICY_ID = "fa62ac94-e420-4013-bb4f-2dcab18deb7b";
const CAP_ATOMIC = "2000000";
const REJECTIONS = [
  { what: "Over-cap send", amount: "2000001", detail: "To the allowlisted recipient", correlation: "a5006791aba9be62-IAD" },
  { what: "Non-allowlisted send", amount: "100000", detail: "To an unapproved recipient", correlation: "a500679519ddbe62-IAD" },
];

const JIRA_URL = "https://one-atlas-hmeq.atlassian.net/browse/SKARL";

type Level = "live" | "simulated" | "pending" | "unavailable";
function Level({ level, children }: { level: Level; children?: ReactNode }) {
  const variant = level === "live" ? "ok" : level === "pending" ? "warn" : level === "unavailable" ? "fail" : "outline";
  const word = { live: "Live", simulated: "Simulated", pending: "Pending", unavailable: "Unavailable" }[level];
  return <Badge variant={variant}>{children ?? word}</Badge>;
}

function External({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer" className="type-label text-text-1 underline underline-offset-4 hover:text-text-2">{children}</a>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 px-4 py-2.5 sm:grid-cols-[11rem_1fr] sm:items-center">
      <dt className="type-label-sm text-text-3">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-2 type-body-sm text-text-1">{children}</dd>
    </div>
  );
}

function Rows({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-line-faint rounded-panel border border-line-faint">{children}</dl>;
}

export function Integrations() {
  const orderId = useOrderId();
  return (
    <>
      <PageHeader title="Integrations" />
      <div id="connect" className="scroll-mt-16"><ConnectAgent /></div>
      <AgentWallet />
      {orderId === undefined ? <Section title="Convex system"><Loading rows={4} /></Section>
        : <QueryBoundary><ConvexSystem orderId={orderId} /></QueryBoundary>}
      <Inventory />
      {orderId === undefined ? <Section title="Dataset export"><Loading rows={2} /></Section>
        : orderId === null ? <Section title="Dataset export"><p className="type-body-sm text-text-2">No staged order. Run pnpm seed to stage the demo order.</p></Section>
        : <QueryBoundary><DatasetExport orderId={orderId} /></QueryBoundary>}
      <Atlassian />
    </>
  );
}

/** Coinbase agent-native and Anthropic: the public MCP endpoint, checked from this browser. */
function ConnectAgent() {
  const [state, setState] = useState<{ ok: boolean; tools?: number } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(DISCOVERY_URL, { cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error(String(response.status));
        const body = await response.json() as { servers?: { url?: string; guestTools?: string[] }[] };
        const server = body.servers?.find(s => s.url === MCP_URL);
        if (alive) setState({ ok: Boolean(server), tools: server?.guestTools?.length });
      })
      .catch(() => { if (alive) setState({ ok: false }); });
    return () => { alive = false; };
  }, []);
  return (
    <Section title="Connect your agent" meta={
      state === null ? "Checking" : state.ok ? <Level level="live">{`Live · ${state.tools ?? 0} keyless tools`}</Level> : <Level level="unavailable" />}>
      <div className="flex flex-col gap-3">
        <Rows>
          <Row label="MCP endpoint">
            <span className="mono min-w-0 break-all">{MCP_URL}</span>
            <CopyButton value={MCP_URL} size="icon-sm" aria-label="Copy MCP URL" onCopy={() => toast.success("MCP URL copied")} />
          </Row>
          <Row label="Discovery">
            <External href={DISCOVERY_URL}>mcp.json</External>
            <External href={AGENT_CARD_URL}>Agent card</External>
            <External href={LLMS_URL}>llms.txt</External>
          </Row>
          <Row label="Authority">Agents read, propose and pay for capped purchases. They never approve, accept work or sign payouts.</Row>
        </Rows>
        <div className="shell">
          <div className="panel flex items-start gap-2 p-3">
            <pre className="mono min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all type-body-sm text-text-1">{CLAUDE_ADD}</pre>
            <CopyButton value={CLAUDE_ADD} size="icon-sm" aria-label="Copy Claude Code command" onCopy={() => toast.success("Command copied")} />
          </div>
          <div className="shell-foot type-label-sm text-text-3">Run in a terminal, then check the connection with /mcp in Claude Code.</div>
        </div>
      </div>
    </Section>
  );
}

/** Coinbase CDP Policy Engine: recorded live enforcement, not a payout. */
function AgentWallet() {
  return (
    <Section title="Agent wallet and spend policy" meta={<Level level="live">Policy live</Level>}>
      <div className="flex flex-col gap-3">
        <Rows>
          <Row label="CDP account">
            <span className="type-label">skarl-finance-agent</span>
            <a href={basescanAddress(AGENT_ADDRESS)} target="_blank" rel="noreferrer" className="mono min-w-0 break-all text-text-1 underline underline-offset-4 hover:text-text-2">{AGENT_ADDRESS}</a>
            <CopyButton value={AGENT_ADDRESS} size="icon-sm" aria-label="Copy agent address" />
          </Row>
          <Row label="Policy">
            <span className="mono min-w-0 break-all">{POLICY_ID}</span>
            <CopyButton value={POLICY_ID} size="icon-sm" aria-label="Copy policy ID" />
          </Row>
          <Row label="Per-payout cap"><span className="tabular-nums">{formatUsdc(CAP_ATOMIC)} USDC per transfer</span></Row>
          <Row label="Recipient allowlist"><span className="tabular-nums">1 verified contributor</span></Row>
          <Row label="Payout executor">
            <span className="mono">controller_wallet</span><span className="text-text-2">default: the controller signs in Coinbase Wallet.</span>
            <span className="mono">cdp_agent</span><span className="text-text-2">implemented, no agent payout has run.</span>
          </Row>
        </Rows>
        <ul className="divide-y divide-line-faint rounded-panel border border-line-faint">
          {REJECTIONS.map(r => (
            <li key={r.correlation} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
              <Status status="fail" className="w-24 shrink-0">Refused</Status>
              <span className="type-label">{r.what}</span>
              <span className="type-body-sm text-text-2 tabular-nums">{formatUsdc(r.amount)} USDC · {r.detail}</span>
              <span className="type-label-sm text-text-3">HTTP 403 policy_violation</span>
              <span className="ms-auto flex items-center gap-1 type-label-sm text-text-3"><span className="mono">{r.correlation}</span>
                <CopyButton value={r.correlation} size="icon-sm" aria-label="Copy correlation ID" /></span>
            </li>
          ))}
        </ul>
        <p className="type-label-sm text-text-3">Real CDP send calls on October 25, 2026 at 03:05 PDT. No transaction hash returned; the account kept its 3 test USDC.</p>
      </div>
    </Section>
  );
}

const JOB: Record<string, { label: string; every: string }> = {
  reconciliation: { label: "Reconciliation", every: "every 2 minutes" },
  finance: { label: "Finance agent", every: "every 10 minutes" },
  observation: { label: "Chain observation", every: "on new transfers" },
  job: { label: "Job", every: "scheduled" },
};

const FEATURES: { name: string; use: string; href?: string; page?: string }[] = [
  { name: "Live queries", use: "Every dashboard row updates without refresh.", href: "/dashboard/scenarios", page: "Scenario lab" },
  { name: "Workflow component", use: "Payout approval waits durably, then dispatches.", href: "/dashboard/payables", page: "Payables" },
  { name: "Crons", use: "Reconcile 2m, attest 2m, bank sweep 2m, finance 10m.", href: "/dashboard/agent", page: "Finance agent" },
  { name: "Scheduler", use: "Verification after upload, approval dispatch, agent runs.", href: "/dashboard/submissions", page: "Submissions" },
  { name: "File storage", use: "Private contributor recordings and dataset media grants.", href: "/dashboard/submissions", page: "Submissions" },
  { name: "Node actions", use: "Gemini and Claude inference, EAS attestation, CDP calls.", href: "/dashboard/agent", page: "Finance agent" },
  { name: "HTTP actions", use: "/mcp, discovery documents and the authenticated /jira/feed.", href: "#connect", page: "Connect your agent" },
];

/** Convex: scheduled job checkpoints for the order in view, plus the platform features in use. */
function ConvexSystem({ orderId }: { orderId: Id<"orders"> | null }) {
  const rows = useQuery(api.scheduledData.snapshots, orderId ? { demoIdentity: CONTROLLER, orderId } : "skip");
  return (
    <Section title="Convex system">
      <div className="flex flex-col gap-3">
        {orderId === null ? <p className="type-body-sm text-text-2">No staged order, so no job checkpoints to show.</p>
          : rows === undefined ? <Loading rows={2} />
          : rows.length === 0 ? <p className="type-body-sm text-text-2">No job has checkpointed this order yet.</p>
          : (
            <ul className="divide-y divide-line-faint rounded-panel border border-line-faint">
              {rows.map(row => (
                <li key={row._id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
                  <Status status={row.status === "failed" ? "fail" : row.status === "running" ? "running" : "ok"} className="w-28 shrink-0">{humanize(row.status)}</Status>
                  <span className="type-label">{JOB[row.kind]?.label ?? humanize(row.kind)}</span>
                  <span className="type-body-sm text-text-2">{JOB[row.kind]?.every ?? "on a schedule"}</span>
                  {row.lastErrorCode && <span className="type-label-sm text-fail-text">{humanize(row.lastErrorCode)}</span>}
                  <span className="ms-auto type-label-sm text-text-3">last ran <RelativeTime date={row.updatedAt} /></span>
                </li>
              ))}
            </ul>
          )}
        <ul className="divide-y divide-line-faint rounded-panel border border-line-faint">
          {FEATURES.map(f => (
            <li key={f.name} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[11rem_1fr_auto] sm:items-baseline sm:gap-3">
              <span className="type-label">{f.name}</span>
              <span className="type-body-sm text-text-2">{f.use}</span>
              {f.href && <Link href={f.href} className="type-label-sm text-text-2 underline underline-offset-4 hover:text-text-1">{f.page}</Link>}
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

const INVENTORY: { item: string; detail: string; level: Level; link?: { href: string; label: string } }[] = [
  { item: "x402 funding, public facilitator", detail: "10 test USDC on Base Sepolia, reconciled to the ledger.", level: "live",
    link: { href: basescanTx("0x28b3f88d593c02a669cb95f4bdc6a23ab3d24bb5d1260e6c4ae54554155cd757"), label: "BaseScan" } },
  { item: "x402 funding via CDP", detail: "0.01 test USDC with a signed CDP webhook and balanced journal.", level: "live",
    link: { href: basescanTx("0x20c9252f7d67a2dac87be839ad82b83465686157478645354838ac0f7239390d"), label: "BaseScan" } },
  { item: "EAS attestations", detail: "Verification reports attested by cron, without original media.", level: "live",
    link: { href: "https://base-sepolia.easscan.org/attestation/view/0x935c09143c1ddb059ca62429a6623b42b3110dc589cdc45031eaa8c6c5e863e4", label: "EASScan" } },
  { item: "Gemini vision jury and transcription", detail: "Stored inference runs. Accuracy unmeasured.", level: "live" },
  { item: "Claude and Gemini finance agents", detail: "Read-only tool loops. Neither proposed nor paid.", level: "live" },
  { item: "CDP Policy Engine", detail: "Over-cap and non-allowlisted sends refused with 403.", level: "live" },
  { item: "Capital One Nessie bank", detail: "Mock bank API. No fiat moves.", level: "simulated" },
  { item: "Scenario lab", detail: "Injected failures on isolated lab orders.", level: "simulated" },
  { item: "Copy witness on trimmed clips", detail: "Regression fixtures only.", level: "simulated" },
  { item: "Demo identities", detail: "Impersonable role selectors, not authentication.", level: "simulated" },
  { item: "Contributor payout", detail: "Needs an accepted, licensed submission and independent approval.", level: "pending" },
];

/** All tracks: the witness table from docs/thesis.md (October 25, 2026, 04:40 PDT). */
function Inventory() {
  return (
    <Section title="Real and simulated" meta="As of October 25, 2026, 04:40 PDT">
      <ul className="divide-y divide-line-faint rounded-panel border border-line-faint">
        {INVENTORY.map(row => (
          <li key={row.item} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[6.5rem_15rem_1fr_auto] sm:items-baseline sm:gap-3">
            <span><Level level={row.level} /></span>
            <span className="type-label">{row.item}</span>
            <span className="type-body-sm text-text-2">{row.detail}</span>
            {row.link ? <External href={row.link.href}>{row.link.label}</External> : <span />}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Buyers: the licensed dataset for the order in view, exactly as datasets.forOrder returns it. */
function DatasetExport({ orderId }: { orderId: Id<"orders"> }) {
  const dataset = useQuery(api.datasets.forOrder, { demoIdentity: CONTROLLER, orderId });
  const count = dataset?.samples.length ?? 0;
  const reason = dataset === undefined ? undefined : count === 0 ? "No delivered samples on this order yet. Samples appear after a clip is accepted and delivered." : undefined;
  const base = `skarl-dataset-${orderId}`;
  function json() {
    if (!dataset) return;
    download(`${base}.json`, JSON.stringify(dataset, null, 2), "application/json");
    toast.success(`Downloaded ${count} ${count === 1 ? "sample" : "samples"} as JSON`);
  }
  function jsonl() {
    if (!dataset) return;
    download(`${base}.jsonl`, dataset.samples.map(s => JSON.stringify(s)).join("\n") + "\n", "application/x-ndjson");
    toast.success(`Downloaded ${count} ${count === 1 ? "sample" : "samples"} as JSONL`);
  }
  return (
    <Section title="Dataset export" meta={dataset ? <span className="mono">{dataset.schema}</span> : undefined}>
      <div className="shell">
        <div className="panel flex flex-wrap items-baseline gap-x-3 gap-y-1 p-4">
          {dataset === undefined ? <Loading rows={1} /> : <>
            <span className="type-heading-sm tabular-nums">{count}</span>
            <span className="type-body-sm text-text-2">{count === 1 ? "delivered sample" : "delivered samples"}</span>
            {dataset.task && <span className="type-label-sm text-text-3">task version {dataset.task.version}</span>}
          </>}
        </div>
        <div className="shell-foot flex flex-wrap items-center gap-2">
          <span className="me-auto min-w-0 basis-full whitespace-normal type-label-sm text-text-3 sm:basis-0 sm:flex-1">{reason ?? "Includes consent, provenance, criteria and expiring media links."}</span>
          <Button size="sm" variant="secondary" disabled={!dataset || count === 0} onClick={jsonl}>Download JSONL</Button>
          <Button size="sm" disabled={!dataset || count === 0} onClick={json}>Download JSON</Button>
        </div>
      </div>
    </Section>
  );
}

/** Atlassian: Skarl Guard runs inside Jira; this links there. */
function Atlassian() {
  return (
    <Section title="Atlassian" meta={<Level level="live" />}>
      <Rows>
        <Row label="Jira project">
          <External href={JIRA_URL}>SKARL on one-atlas-hmeq</External>
        </Row>
        <Row label="Skarl Guard">Exceptions sync from Convex into Jira issues. A guarded Claude triage agent acts within policy, with per-action audit and revert.</Row>
      </Rows>
    </Section>
  );
}
