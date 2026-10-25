"use client";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/glaze/ui/badge";
import { Button } from "@/components/glaze/ui/button";
import { Status, type StatusValue } from "@/components/glaze/ui/status";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/glaze/ui/table";
import { Textarea } from "@/components/glaze/ui/textarea";
import { toast } from "@/components/glaze/ui/toast";
import { cn } from "@/lib/glaze/utils";
import { api, CONTROLLER, useExceptions, useOrderId, type ExceptionItem, type Id } from "./data";
import { basescanTx, formatTime, humanize, shortHash } from "./format";
import { Amount, ConfirmDialog, Loading, PageHeader, Section, Unavailable } from "./ui";

type FourWay = FunctionReturnType<typeof api.bankWitness.reconciliation4Way>;
type Row = FourWay["rows"][number];
type Column = Row["order"];
type Match = FourWay["reconciliation"]["matches"][number];

const BASE = "eip155:84532";
const KIND: Record<string, string> = {
  funding: "Funding", contributor_payout: "Payout", refund_paid: "Refund", buyer_refund: "Refund",
  evidence_sale: "Evidence sale", unallocated: "Unallocated",
};

/** "<network>:<tx>:<logIndex>" where the network itself contains one colon (eip155:84532, solana:<ref>). */
function chainRef(identity: string | null | undefined) {
  const parts = identity?.split(":") ?? [];
  if (parts.length < 4) return null;
  const network = parts.slice(0, -2).join(":"), txHash = parts.at(-2)!, logIndex = parts.at(-1)!;
  const solana = network.startsWith("solana:");
  return { network, txHash, logIndex, solana,
    url: solana ? `https://explorer.solana.com/tx/${txHash}?cluster=devnet` : basescanTx(txHash) };
}
const railLabel = (network: string | null) => network === null ? null : network.startsWith("solana:") ? "Solana Devnet" : network === BASE ? "Base Sepolia" : network;

function cellStatus(column: Column): { status: StatusValue; word: string } {
  if (column.status === "match") return { status: "ok", word: "Match" };
  if (column.status === "mismatch") return { status: "fail", word: "Mismatch" };
  if (column.reason === "outside_bank_simulation_scope") return { status: "idle", word: "Not covered" };
  if (column.reason === "bank_not_refreshed_or_stale") return { status: "queued", word: "Pending" };
  return { status: "warn", word: "Missing" };
}
const errorCode = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return message.match(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/)?.[1] ?? "request_failed";
};

export function Reconciliation() {
  const orderId = useOrderId();
  const fourWay = useQuery(api.bankWitness.reconciliation4Way, orderId ? { demoIdentity: CONTROLLER, orderId } : "skip");
  const exceptions = useExceptions(orderId);
  const refresh = useAction(api.chainWitness.refresh);
  const [refreshing, setRefreshing] = useState(false);
  const opened = useRef<string | null>(null);

  // Per the API contract: refresh the CDP SQL snapshot once on opening the view, and on request. Never per render.
  useEffect(() => {
    if (!orderId || opened.current === orderId) return;
    opened.current = orderId;
    refresh({ demoIdentity: CONTROLLER, orderId }).catch(() => { /* the witness strip shows unavailable */ });
  }, [orderId, refresh]);

  async function refreshWitness() {
    if (!orderId) return;
    setRefreshing(true);
    try {
      const { status } = await refresh({ demoIdentity: CONTROLLER, orderId });
      if (status === "available") toast.success("CDP witness refreshed");
      else if (status === "cached_or_rate_limited") toast("CDP witness is recent", { description: "Snapshots are reused for 30 seconds." });
      else toast.warn("CDP witness unavailable", { description: "Order, ledger, chain and bank results above still stand." });
    } catch (error) {
      toast.fail("Refresh failed", { description: humanize(errorCode(error)) });
    } finally { setRefreshing(false); }
  }

  if (orderId === null) return <Unavailable title="No staged order" description="Run pnpm seed to stage the demo order." />;
  return (
    <>
      <PageHeader title="Reconciliation"
        actions={<Button variant="secondary" size="sm" onClick={refreshWitness} pending={refreshing} disabled={!orderId}>Refresh CDP witness</Button>} />
      {fourWay === undefined || !orderId ? <Loading rows={4} /> : (
        <>
          <FourWayTable data={fourWay} />
          <WitnessStrip data={fourWay} />
        </>
      )}
      {orderId && <ExceptionQueue orderId={orderId} items={exceptions} />}
    </>
  );
}

function Summary({ rows }: { rows: Row[] }) {
  const columns = (row: Row) => [row.order, row.ledger, row.chain, row.bank];
  const mismatched = rows.filter(row => columns(row).some(c => c.status === "mismatch")).length;
  const incomplete = rows.filter(row => !columns(row).some(c => c.status === "mismatch") && columns(row).some(c => c.status !== "match")).length;
  if (mismatched) return <Status status="fail">{mismatched} of {rows.length} {rows.length === 1 ? "intent disagrees" : "intents disagree"}</Status>;
  if (incomplete) return <Status status="warn">{rows.length - incomplete} of {rows.length} agree on all four; {incomplete} incomplete</Status>;
  return <Status status="ok">{rows.length === 1 ? "The intent agrees" : `All ${rows.length} intents agree`} across order, ledger, chain and bank</Status>;
}

function FourWayTable({ data }: { data: FourWay }) {
  const identityFor = (intentId: string) => data.reconciliation.matches.find(m => m.eventKey === intentId)?.chainIdentity
    ?? data.reconciliation.exceptions.find(e => e.eventKey === intentId && e.chainIdentity)?.chainIdentity ?? null;
  const bankMeta = data.bankFetchedAt
    ? `Bank fetched ${formatTime(data.bankFetchedAt)}${data.bankAvailable ? "" : ", stale"}`
    : "Bank not fetched yet";
  return (
    <Section title="Order, ledger, chain, bank" meta={bankMeta} className="mt-2">
      {data.rows.length === 0 ? <p className="type-body-sm text-text-2">No payment intents on this order yet. Funding creates the first one.</p> : (
        <>
          <div className="mb-3"><Summary rows={data.rows} /></div>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Intent</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Ledger</TableHead>
                  <TableHead>Chain</TableHead>
                  <TableHead><span className="inline-flex items-center gap-2">Bank <Badge size="sm" variant="outline">Mock bank (Capital One Nessie)</Badge></span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map(row => {
                  const chain = chainRef(identityFor(row.intentId));
                  return (
                    <TableRow key={row.intentId}>
                      <TableCell className="align-top"><IntentLabel row={row} network={chain?.network ?? null} /></TableCell>
                      <TableCell className="align-top"><Cell column={row.order} /></TableCell>
                      <TableCell className="align-top"><Cell column={row.ledger} /></TableCell>
                      <TableCell className="align-top"><Cell column={row.chain} chain={chain} /></TableCell>
                      <TableCell className="align-top"><Cell column={row.bank} /></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <ul className="flex flex-col gap-3 md:hidden">
            {data.rows.map(row => {
              const chain = chainRef(identityFor(row.intentId));
              return (
                <li key={row.intentId} className="rounded-panel border border-line-faint p-3">
                  <IntentLabel row={row} network={chain?.network ?? null} />
                  <dl className="mt-3 grid grid-cols-2 gap-3">
                    {([["Order", row.order, null], ["Ledger", row.ledger, null], ["Chain", row.chain, chain], ["Bank", row.bank, null]] as const).map(([label, column, ref]) => (
                      <div key={label}>
                        <dt className="mb-1 type-label-sm text-text-3">{label === "Bank" ? "Bank (mock, Nessie)" : label}</dt>
                        <dd><Cell column={column} chain={ref} /></dd>
                      </div>
                    ))}
                  </dl>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Section>
  );
}

function IntentLabel({ row, network }: { row: Row; network: string | null }) {
  const rail = railLabel(network ?? (row.kind === "contributor_payout" ? BASE : null));
  const id = row.intentId.includes(":") ? row.intentId.slice(row.intentId.indexOf(":") + 1) : row.intentId;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="type-label">{KIND[row.kind] ?? humanize(row.kind)}</span>
      <span className="mono type-label-sm text-text-3" title={row.intentId}>{shortHash(id, 6, 4)}</span>
      {rail && <Badge size="sm">{rail}</Badge>}
    </div>
  );
}

function Cell({ column, chain }: { column: Column; chain?: ReturnType<typeof chainRef> }) {
  const { status, word } = cellStatus(column);
  return (
    <div className="flex flex-col gap-0.5">
      <Status status={status} size="sm">{word}</Status>
      {column.amountAtomic !== undefined && (
        <Amount value={column.amountAtomic} className={cn("type-body-sm", column.status === "mismatch" && "text-fail-text")} />
      )}
      {column.reason && column.status !== "match" && word !== "Not covered" && (
        <span className={cn("type-label-sm", column.status === "mismatch" ? "text-fail-text" : "text-text-3")}>{humanize(column.reason)}</span>
      )}
      {word === "Not covered" && <span className="type-label-sm text-text-3">Bank mock covers funding and payouts only</span>}
      {chain && (
        <a href={chain.url} target="_blank" rel="noreferrer" className="type-label-sm text-text-2 underline underline-offset-4">
          <span className="mono">{shortHash(chain.txHash, 6, 4)}</span> on {chain.solana ? "Solana Explorer" : "BaseScan"}
        </a>
      )}
    </div>
  );
}

const WITNESS: Record<Match["witness"]["status"], { status: StatusValue; word: string; note?: string }> = {
  match: { status: "ok", word: "CDP agrees" },
  mismatch: { status: "fail", word: "CDP disagrees" },
  missing: { status: "warn", word: "Not in CDP index", note: "May be indexing lag; not proof the transfer failed." },
  witness_unavailable: { status: "idle", word: "Witness unavailable" },
};

function WitnessStrip({ data }: { data: FourWay }) {
  const { matches, witness } = data.reconciliation;
  const meta = witness.status === "available"
    ? `Fetched ${formatTime(witness.fetchedAt)}`
    : witness.reason === "not_refreshed_or_stale" ? "Not refreshed in the last two minutes"
    : `CDP query failed: ${humanize(witness.reason ?? "unknown")}`;
  return (
    <Section title="CDP SQL witness" meta={meta}>
      {matches.length === 0 ? <p className="type-body-sm text-text-2">No reconciled transfers to witness yet.</p> : (
        <ul className="flex flex-col divide-y divide-line-faint rounded-panel border border-line-faint">
          {matches.map(match => {
            const chain = chainRef(match.chainIdentity);
            const state = WITNESS[match.witness.status];
            return (
              <li key={match.chainIdentity} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                <Status status={state.status} size="sm" className="w-44 shrink-0">{state.word}</Status>
                <span className="type-label">{KIND[match.eventKey.split(":")[0]!] ?? humanize(match.eventKey.split(":")[0]!)}</span>
                <Amount value={match.amountAtomic} className="type-body-sm" />
                {chain && (
                  <a href={chain.url} target="_blank" rel="noreferrer" className="type-label-sm text-text-2 underline underline-offset-4">
                    <span className="mono">{shortHash(chain.txHash, 8, 6)}</span> log {chain.logIndex}
                  </a>
                )}
                {state.note && <span className="w-full type-label-sm text-text-3 md:w-auto">{state.note}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function ExceptionQueue({ orderId, items }: { orderId: Id<"orders">; items: ExceptionItem[] | undefined }) {
  const open = (items ?? []).filter(item => item.stillDetected && item.disposition?.status !== "resolved").length;
  return (
    <Section title="Exceptions" meta={items?.length ? `${open} open` : undefined}>
      {items === undefined ? <Loading rows={2} /> : items.length === 0
        ? <p className="type-body-sm text-text-2">No exceptions.</p>
        : (
          <ul className="flex flex-col divide-y divide-line-faint rounded-panel border border-line-faint">
            {items.map(item => <ExceptionRow key={item.exceptionKey} orderId={orderId} item={item} />)}
          </ul>
        )}
    </Section>
  );
}

function ExceptionRow({ orderId, item }: { orderId: Id<"orders">; item: ExceptionItem }) {
  const acknowledge = useMutation(api.exceptions.acknowledge);
  const resolve = useMutation(api.exceptions.resolve);
  const [action, setAction] = useState<"acknowledge" | "resolve" | null>(null);
  const [reason, setReason] = useState("");
  const disposition = item.disposition?.status;
  const resolved = disposition === "resolved";
  const chain = chainRef(item.exception.chainIdentity);
  const bank = item.exception.code === "bank_mismatch";

  async function submit() {
    const text = reason.trim();
    if (!text) throw new Error("Write a reason first.");
    const run = action === "resolve" ? resolve : acknowledge;
    try {
      const result = await run({ demoIdentity: CONTROLLER, orderId, exceptionKey: item.exceptionKey, reason: text });
      toast.success(action === "resolve" ? "Exception resolved" : "Exception acknowledged",
        { description: result.replayed ? "Already recorded with this reason." : humanize(item.exception.code) });
      setReason("");
    } catch (error) {
      const code = errorCode(error);
      toast.fail("Refused", { description: humanize(code) });
      throw new Error(humanize(code));
    }
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-start md:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Status status={resolved ? "ok" : !item.stillDetected ? "idle" : disposition === "acknowledged" ? "warn" : "fail"}>{humanize(item.exception.code)}</Status>
          {bank && <Badge size="sm" variant="outline">Mock bank (Capital One Nessie)</Badge>}
          {chain && <Badge size="sm">{railLabel(chain.network)}</Badge>}
        </div>
        <p className="mt-1 type-body-sm text-text-2">{item.exception.detail}</p>
        <p className="mt-1 flex flex-wrap gap-x-3 type-label-sm text-text-3">
          <span>{item.stillDetected ? "Still detected" : "No longer detected"}</span>
          {item.disposition && <span>{humanize(item.disposition.status)} {formatTime(item.disposition.updatedAt)}: {item.disposition.reason}</span>}
          {chain && (
            <a href={chain.url} target="_blank" rel="noreferrer" className="underline underline-offset-4">
              <span className="mono">{shortHash(chain.txHash, 6, 4)}</span> on {chain.solana ? "Solana Explorer" : "BaseScan"}
            </a>
          )}
        </p>
      </div>
      {!resolved && (
        <div className="flex shrink-0 gap-2">
          {disposition !== "acknowledged" && <Button size="sm" variant="secondary" onClick={() => setAction("acknowledge")}>Acknowledge</Button>}
          <Button size="sm" variant="secondary" onClick={() => setAction("resolve")}>Resolve</Button>
        </div>
      )}
      <ConfirmDialog open={action !== null} onOpenChange={next => { if (!next) setAction(null); }}
        title={action === "resolve" ? "Resolve exception" : "Acknowledge exception"}
        description={action === "resolve"
          ? `Marks ${humanize(item.exception.code).toLowerCase()} as handled. Ledger, intents and chain history do not change, and it stays listed while still detected.`
          : `Records that you have seen ${humanize(item.exception.code).toLowerCase()}. Nothing financial changes.`}
        actionLabel={action === "resolve" ? "Resolve" : "Acknowledge"} onConfirm={submit}>
        <label className="flex flex-col gap-1.5">
          <span className="type-label">Reason</span>
          <Textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={2000} rows={3}
            placeholder={action === "resolve" ? "What fixed it, with a reference" : "What you are doing about it"} />
        </label>
      </ConfirmDialog>
    </li>
  );
}
