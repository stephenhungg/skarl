"use client";
import { useQuery } from "convex/react";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/glaze/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/glaze/ui/collapsible";
import { CopyButton } from "@/components/glaze/ui/copy-button";
import { RelativeTime } from "@/components/glaze/ui/relative-time";
import { Status, StatusMark, type StatusValue } from "@/components/glaze/ui/status";
import { toast } from "@/components/glaze/ui/toast";
import { cn } from "@/lib/glaze/utils";
import { api, CONTROLLER, useOrderId, type Id } from "./data";
import { basescanAddress, basescanTx, formatUsdc, humanize } from "./format";
import { Lordicon } from "./lordicon";
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
  { what: "Over the cap", amount: "2000001", detail: "To the allowlisted recipient", correlation: "a5006791aba9be62-IAD" },
  { what: "Off the allowlist", amount: "100000", detail: "To an unapproved recipient", correlation: "a500679519ddbe62-IAD" },
];

const JIRA_URL = "https://one-atlas-hmeq.atlassian.net/browse/SKARL";
const EAS_URL = "https://base-sepolia.easscan.org/attestation/view/0x935c09143c1ddb059ca62429a6623b42b3110dc589cdc45031eaa8c6c5e863e4";

type Discovery = { ok: boolean; tools?: number } | null;

/** The public MCP discovery document, fetched from this browser. null while checking. */
function useDiscovery(): Discovery {
  const [state, setState] = useState<Discovery>(null);
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
  return state;
}

function External({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return <a href={href} target="_blank" rel="noreferrer" className={cn("type-label-sm text-text-2 underline underline-offset-4 hover:text-text-1", className)}>{children}</a>;
}

/** Secondary facts behind one quiet toggle. */
function Details({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <Collapsible className="mt-2">
      <CollapsibleTrigger size="sm" summary={summary}>Details</CollapsibleTrigger>
      <CollapsibleContent>
        <dl className="mt-2 flex flex-col gap-2 border-s border-line-faint ps-4">{children}</dl>
      </CollapsibleContent>
    </Collapsible>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <dt className="type-label-sm text-text-3">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 type-body-sm text-text-1">{children}</dd>
    </div>
  );
}

function Anchor({ id, children }: { id: string; children: ReactNode }) {
  return <div id={id} className="scroll-mt-16">{children}</div>;
}

export function Integrations() {
  const orderId = useOrderId();
  const discovery = useDiscovery();
  return (
    <>
      <PageHeader title="Integrations" />
      <ProofStrip discovery={discovery} />
      <Anchor id="connect"><ConnectAgent discovery={discovery} /></Anchor>
      <Anchor id="wallet"><AgentWallet /></Anchor>
      <Anchor id="inventory"><Inventory /></Anchor>
      <Anchor id="convex">
        {orderId === undefined ? <Section title="Convex jobs"><Loading rows={3} /></Section>
          : <QueryBoundary><ConvexSystem orderId={orderId} /></QueryBoundary>}
      </Anchor>
      <Anchor id="dataset">
        {orderId === undefined ? <Section title="Dataset export"><Loading rows={1} /></Section>
          : orderId === null ? <Section title="Dataset export"><p className="type-body-sm text-text-2">No staged order. Run pnpm seed to stage the demo order.</p></Section>
          : <QueryBoundary><DatasetExport orderId={orderId} /></QueryBoundary>}
      </Anchor>
      <Atlassian />
    </>
  );
}

/** The four strongest witnessed facts, each a jump to its evidence below. */
function ProofStrip({ discovery }: { discovery: Discovery }) {
  const live = INVENTORY.filter(i => i.level === "live").length;
  const simulated = INVENTORY.filter(i => i.level === "simulated").length;
  const cells: { href: string; status: StatusValue; label: string; value: ReactNode; sub: ReactNode }[] = [
    { href: "#connect", status: discovery === null ? "running" : discovery.ok ? "ok" : "fail", label: "Agents connect over MCP",
      value: discovery === null ? "Checking" : discovery.ok ? "Live" : "Unreachable",
      sub: discovery?.ok ? `${discovery.tools ?? 0} keyless tools` : discovery === null ? "Reading discovery" : "Discovery did not answer" },
    { href: "#wallet", status: "ok", label: "Spend policy enforced",
      value: <>{REJECTIONS.length} <span className="type-heading-sm text-text-2">sends refused</span></>,
      sub: "Over cap and off allowlist, by CDP" },
    { href: "#inventory", status: "ok", label: "On-chain proof", value: "EAS + Base Sepolia", sub: "Attestations and 2 x402 fundings" },
    { href: "#inventory", status: "ok", label: "Real vs simulated",
      value: <>{live} <span className="type-heading-sm text-text-2">live</span> {simulated} <span className="type-heading-sm text-text-2">simulated</span></>,
      sub: "Labelled item by item" },
  ];
  return (
    <nav aria-label="Proof" className="grid grid-cols-1 border-y border-line-faint sm:grid-cols-2 lg:grid-cols-4">
      {cells.map((cell, index) => (
        <a key={cell.label} href={cell.href}
          className={cn("group flex min-w-0 flex-col gap-1 px-1 py-4 hover:bg-hover-row focus-visible:focus-ring-inset sm:px-4",
            index > 0 && "border-t border-line-faint",
            index === 1 && "sm:border-t-0 sm:border-s",
            index === 2 && "lg:border-t-0 lg:border-s",
            index === 3 && "sm:border-s")}>
          <span className="flex items-center gap-1.5 type-label-sm text-text-2"><StatusMark status={cell.status} className={cell.status === "ok" ? "text-ok-text" : cell.status === "fail" ? "text-fail-text" : "text-text-3"} />{cell.label}</span>
          <span className="type-title tabular-nums">{cell.value}</span>
          <span className="type-label-sm text-text-3 group-hover:text-text-2">{cell.sub}</span>
        </a>
      ))}
    </nav>
  );
}

/** Coinbase agent-native and Anthropic: one command connects an agent to the public MCP endpoint. */
function ConnectAgent({ discovery }: { discovery: Discovery }) {
  return (
    <Section title="Connect your agent" meta={
      discovery === null ? <Status status="running" size="sm">Checking</Status>
        : discovery.ok ? <Status status="ok" size="sm">{`Live · ${discovery.tools ?? 0} tools`}</Status>
        : <Status status="fail" size="sm">Unreachable</Status>}>
      <div className="shell">
        <div className="panel flex items-center gap-2 p-3">
          <pre className="mono min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all type-body text-text-1">{CLAUDE_ADD}</pre>
          <CopyButton value={CLAUDE_ADD} aria-label="Copy Claude Code command" onCopy={() => toast.success("Command copied")} />
        </div>
        <div className="shell-foot whitespace-normal type-label-sm text-text-3">Then run /mcp in Claude Code. Agents read, propose and pay capped purchases; they never approve or sign payouts.</div>
      </div>
      <Details summary="Endpoint and discovery">
        <Fact label="Endpoint">
          <span className="mono min-w-0 break-all type-body-sm">{MCP_URL}</span>
          <CopyButton value={MCP_URL} size="icon-sm" aria-label="Copy MCP URL" onCopy={() => toast.success("MCP URL copied")} />
        </Fact>
        <Fact label="Discovery">
          <External href={DISCOVERY_URL}>mcp.json</External>
          <External href={AGENT_CARD_URL}>Agent card</External>
          <External href={LLMS_URL}>llms.txt</External>
        </Fact>
      </Details>
    </Section>
  );
}

/** Coinbase CDP Policy Engine: recorded live enforcement, not a payout. */
function AgentWallet() {
  return (
    <Section title="Agent spend policy" meta={<Status status="ok" size="sm">Enforced</Status>}>
      <div className="shell">
        <div className="panel grid divide-y divide-line-faint sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          {REJECTIONS.map(r => (
            <div key={r.correlation} className="flex min-w-0 flex-col gap-1 p-4">
              <Status status="fail">Refused · {r.what}</Status>
              <span className="type-heading tabular-nums">{formatUsdc(r.amount)} <span className="type-label text-text-3">USDC</span></span>
              <span className="type-label-sm text-text-3">{r.detail} · HTTP 403</span>
            </div>
          ))}
        </div>
        <div className="shell-foot flex flex-wrap gap-x-4 gap-y-1 whitespace-normal type-label-sm text-text-2">
          <span className="tabular-nums">Cap {formatUsdc(CAP_ATOMIC)} USDC per transfer</span>
          <span>1 allowlisted recipient</span>
          <span className="text-text-3">Live CDP calls, Oct 25 03:05 PDT. No transaction; balance stayed 3 test USDC.</span>
        </div>
      </div>
      <Details summary="Account, policy, executor">
        <Fact label="Account">
          <span className="type-label">skarl-finance-agent</span>
          <a href={basescanAddress(AGENT_ADDRESS)} target="_blank" rel="noreferrer" className="mono min-w-0 break-all type-body-sm text-text-1 underline underline-offset-4 hover:text-text-2">{AGENT_ADDRESS}</a>
          <CopyButton value={AGENT_ADDRESS} size="icon-sm" aria-label="Copy agent address" onCopy={() => toast.success("Address copied")} />
        </Fact>
        <Fact label="Policy">
          <span className="mono min-w-0 break-all type-body-sm">{POLICY_ID}</span>
          <CopyButton value={POLICY_ID} size="icon-sm" aria-label="Copy policy ID" onCopy={() => toast.success("Policy ID copied")} />
        </Fact>
        <Fact label="Executor">
          <span>Controller wallet signs payouts (default)</span>
          <span className="text-text-3">CDP agent executor built, not run</span>
        </Fact>
        {REJECTIONS.map(r => (
          <Fact key={r.correlation} label={`${r.what}, correlation`}>
            <span className="mono type-body-sm">{r.correlation}</span>
            <CopyButton value={r.correlation} size="icon-sm" aria-label={`Copy ${r.what} correlation ID`} onCopy={() => toast.success("Correlation ID copied")} />
          </Fact>
        ))}
      </Details>
    </Section>
  );
}

type Level = "live" | "simulated" | "pending";
const INVENTORY: { item: string; note?: string; level: Level; href?: string; external?: boolean }[] = [
  { item: "x402 funding", note: "10 USDC", level: "live", external: true,
    href: basescanTx("0x28b3f88d593c02a669cb95f4bdc6a23ab3d24bb5d1260e6c4ae54554155cd757") },
  { item: "x402 via CDP", note: "0.01 USDC, signed webhook", level: "live", external: true,
    href: basescanTx("0x20c9252f7d67a2dac87be839ad82b83465686157478645354838ac0f7239390d") },
  { item: "EAS attestations", note: "no media", level: "live", external: true, href: EAS_URL },
  { item: "CDP Policy Engine", note: "2 refusals", level: "live", href: "#wallet" },
  { item: "Gemini jury and transcription", note: "accuracy unmeasured", level: "live", href: "/dashboard/submissions" },
  { item: "Claude and Gemini finance agents", note: "read-only", level: "live", href: "/dashboard/agent" },
  { item: "Capital One Nessie", note: "mock bank, no fiat", level: "simulated" },
  { item: "Scenario lab", note: "isolated lab orders", level: "simulated", href: "/dashboard/scenarios" },
  { item: "Copy witness on trimmed clips", note: "fixtures", level: "simulated" },
  { item: "Demo identities", note: "not authentication", level: "simulated" },
  { item: "Contributor payout", note: "needs an accepted, licensed clip and independent approval", level: "pending" },
];

function Chip({ row }: { row: typeof INVENTORY[number] }) {
  const body = <>
    <span className="type-label text-text-1">{row.item}</span>
    {row.note && <span className="type-label-sm text-text-3">{row.note}</span>}
    {row.external && <Lordicon name="arrow-out-square" size={14} />}
  </>;
  const base = "inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-1.5 rounded-pill border border-line-faint px-3 py-1";
  if (!row.href) return <span className={base}>{body}</span>;
  const linked = cn(base, "text-text-2 hover:bg-hover hover:border-line focus-visible:focus-ring");
  if (row.external) return <a href={row.href} target="_blank" rel="noreferrer" className={linked}>{body}</a>;
  if (row.href.startsWith("#")) return <a href={row.href} className={linked}>{body}</a>;
  return <Link href={row.href} className={linked}>{body}</Link>;
}

/** All tracks: the witness table from docs/thesis.md (October 25, 2026, 04:40 PDT). */
function Inventory() {
  const column = (level: Level, status: StatusValue, title: string) => {
    const rows = INVENTORY.filter(r => r.level === level);
    return (
      <div className="flex min-w-0 flex-col gap-2">
        <Status status={status}>{`${title} · ${rows.length}`}</Status>
        <div className="flex flex-wrap gap-2">{rows.map(row => <Chip key={row.item} row={row} />)}</div>
      </div>
    );
  };
  const pending = INVENTORY.filter(r => r.level === "pending");
  return (
    <Section title="Real vs simulated" meta="As of Oct 25, 04:40 PDT">
      <div className="grid gap-6 md:grid-cols-2">
        {column("live", "ok", "Live")}
        {column("simulated", "idle", "Simulated")}
      </div>
      {pending.map(row => (
        <p key={row.item} className="mt-4 flex flex-wrap items-baseline gap-x-2 type-body-sm">
          <Status status="waiting">Pending</Status>
          <span className="type-label">{row.item}</span>
          <span className="text-text-3">{row.note}</span>
        </p>
      ))}
    </Section>
  );
}

const JOB: Record<string, { label: string; every: string }> = {
  reconciliation: { label: "Reconciliation", every: "every 2 min" },
  finance: { label: "Finance agent", every: "every 10 min" },
  observation: { label: "Chain observation", every: "on new transfers" },
  job: { label: "Job", every: "scheduled" },
};

const FEATURES: { name: string; use: string; href: string; page: string }[] = [
  { name: "Live queries", use: "every row updates without refresh", href: "/dashboard/scenarios", page: "Scenario lab" },
  { name: "Workflow", use: "payout approval waits durably", href: "/dashboard/payables", page: "Payables" },
  { name: "Crons", use: "reconcile 2m, attest 2m, bank 2m, finance 10m", href: "/dashboard/agent", page: "Finance agent" },
  { name: "Scheduler", use: "verification, approval dispatch, agent runs", href: "/dashboard/submissions", page: "Submissions" },
  { name: "File storage", use: "private recordings, dataset media grants", href: "/dashboard/submissions", page: "Submissions" },
  { name: "Node actions", use: "Gemini and Claude, EAS, CDP", href: "/dashboard/agent", page: "Finance agent" },
  { name: "HTTP actions", use: "/mcp, discovery, /jira/feed", href: "#connect", page: "Connect" },
];

/** Convex: scheduled job checkpoints for the order in view, plus the platform features in use. */
function ConvexSystem({ orderId }: { orderId: Id<"orders"> | null }) {
  const rows = useQuery(api.scheduledData.snapshots, orderId ? { demoIdentity: CONTROLLER, orderId } : "skip");
  return (
    <Section title="Convex jobs">
      {orderId === null ? <p className="type-body-sm text-text-2">No staged order, so no job checkpoints.</p>
        : rows === undefined ? <Loading rows={2} />
        : rows.length === 0 ? <p className="type-body-sm text-text-2">No job has checkpointed this order yet.</p>
        : (
          <ul className="divide-y divide-line-faint border-y border-line-faint">
            {rows.map(row => (
              <li key={row._id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                <Status status={row.status === "failed" ? "fail" : row.status === "running" ? "running" : "ok"} className="w-24 shrink-0">{humanize(row.status)}</Status>
                <span className="type-label">{JOB[row.kind]?.label ?? humanize(row.kind)}</span>
                <span className="type-label-sm text-text-3">{JOB[row.kind]?.every ?? "scheduled"}</span>
                {row.lastErrorCode && <span className="type-label-sm text-fail-text">{humanize(row.lastErrorCode)}</span>}
                <span className="ms-auto type-label-sm text-text-3">ran <RelativeTime date={row.updatedAt} /></span>
              </li>
            ))}
          </ul>
        )}
      <Details summary={`${FEATURES.length} Convex features in use`}>
        {FEATURES.map(f => (
          <Fact key={f.name} label={f.name}>
            <span className="text-text-2">{f.use}</span>
            {f.href.startsWith("#") ? <a href={f.href} className="type-label-sm text-text-2 underline underline-offset-4 hover:text-text-1">{f.page}</a>
              : <Link href={f.href} className="type-label-sm text-text-2 underline underline-offset-4 hover:text-text-1">{f.page}</Link>}
          </Fact>
        ))}
      </Details>
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
  const base = `skarl-dataset-${orderId}`;
  const disabled = !dataset || count === 0;
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
    <Section title="Dataset export" meta={dataset?.schema}>
      {dataset === undefined ? <Loading rows={1} /> : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="me-auto min-w-0 type-body-sm text-text-2">
            <span className="type-label tabular-nums text-text-1">{count} {count === 1 ? "delivered sample" : "delivered samples"}</span>
            {" · "}{count === 0 ? "Samples appear after a clip is accepted and delivered." : "Consent, provenance, criteria and expiring media links."}
          </p>
          <Button size="sm" variant="secondary" disabled={disabled} onClick={jsonl}>Download JSONL</Button>
          <Button size="sm" disabled={disabled} onClick={json}>Download JSON</Button>
        </div>
      )}
    </Section>
  );
}

/** Atlassian: Skarl Guard runs inside Jira; this links there. */
function Atlassian() {
  return (
    <Section title="Atlassian" meta={<Status status="ok" size="sm">Live</Status>}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="me-auto min-w-0 type-body-sm text-text-2">Skarl Guard mirrors exceptions into Jira, where a guarded Claude agent triages with per-action audit and revert.</p>
        <External href={JIRA_URL} className="type-label text-text-1">Open SKARL in Jira</External>
      </div>
    </Section>
  );
}
