import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes, bytesToHex } from "@noble/hashes/utils.js";
import { assertBalanced, postJournal, type Journal, type LedgerState } from "../../packages/ledger/src/index";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "../../packages/contracts/src/chain";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { DemoPrincipal } from "./demoAuth";

export function canonical(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
export const digest = (value: unknown) => bytesToHex(sha256(utf8ToBytes(canonical(value))));

export function requireTenant(principal: DemoPrincipal, resource: { organizationId: Id<"organizations"> }) {
  if (principal.organizationId !== resource.organizationId) throw new Error("cross_organization_access");
}
export const actorFor = (member: DemoPrincipal) => ({
  kind: member.roles.includes("finance-agent") ? "service" as const : "human" as const,
  identity: member.tokenIdentifier,
});

export async function audit(ctx: MutationCtx, input: {
  organizationId: Id<"organizations">; eventKey: string; actor: Doc<"auditEvents">["actor"];
  action: string; entityType: string; entityId: string; reason: string; evidenceReferences?: string[];
}) {
  const existing = await ctx.db.query("auditEvents").withIndex("by_event_key", q =>
    q.eq("organizationId", input.organizationId).eq("eventKey", input.eventKey)).unique();
  if (existing) return existing._id;
  return ctx.db.insert("auditEvents", { ...input, evidenceReferences: input.evidenceReferences ?? [], occurredAt: Date.now() });
}

export async function loadLedger(ctx: Pick<QueryCtx | MutationCtx, "db">, organizationId: Id<"organizations">): Promise<LedgerState> {
  const entries = await ctx.db.query("journalEntries").withIndex("by_org", q => q.eq("organizationId", organizationId)).collect();
  const journals: Journal[] = [];
  for (const entry of entries) {
    const lines = await ctx.db.query("journalLines").withIndex("by_entry", q => q.eq("journalEntryId", entry._id)).collect();
    journals.push({
      eventId: entry.eventKey, orderId: entry.orderId, kind: entry.kind, description: entry.memo,
      ...(entry.contributorTokenIdentifier ? { contributorId: entry.contributorTokenIdentifier } : {}),
      ...(entry.reference ? { reference: entry.reference } : {}),
      lines: lines.map(line => ({ account: line.account, debit: line.side === "debit" ? line.amountAtomic : 0n,
        credit: line.side === "credit" ? line.amountAtomic : 0n })),
    });
  }
  return { journals };
}

/** Atomic adapter for the audited pure ledger. No external side effects occur here. */
export async function recordJournal(ctx: MutationCtx, organizationId: Id<"organizations">, journal: Journal) {
  if (journal.kind === "reversal") throw new Error("reversal_persistence_not_implemented");
  assertBalanced(journal);
  const fingerprint = digest(journal);
  const existing = await ctx.db.query("journalEntries").withIndex("by_event_key", q =>
    q.eq("organizationId", organizationId).eq("eventKey", journal.eventId)).unique();
  if (existing) {
    if (existing.fingerprint !== fingerprint) throw new Error("journal_event_conflict");
    return existing._id;
  }
  postJournal(await loadLedger(ctx, organizationId), journal);
  const now = Date.now();
  const journalEntryId = await ctx.db.insert("journalEntries", {
    organizationId, network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS,
    orderId: journal.orderId as Id<"orders">, eventKey: journal.eventId, kind: journal.kind,
    status: "posted", memo: journal.description, sourceReference: journal.reference ?? journal.orderId,
    ...(journal.reference ? { reference: journal.reference } : {}),
    ...(journal.contributorId ? { contributorTokenIdentifier: journal.contributorId } : {}),
    fingerprint, effectiveAt: now, recordedAt: now,
  });
  for (const [lineNumber, line] of journal.lines.entries()) {
    await ctx.db.insert("journalLines", { organizationId, journalEntryId, account: line.account,
      side: line.debit > 0n ? "debit" : "credit", amountAtomic: line.debit || line.credit, lineNumber });
  }
  return journalEntryId;
}

export function normalizeAddress(value: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error("invalid_evm_address");
  return value.toLowerCase();
}
export const paymentBinding = (command: Pick<Doc<"paymentCommands">,
  "organizationId" | "orderId" | "payableId" | "network" | "tokenAddress" | "recipientAddress" | "amountAtomic" | "sourceVersion" | "requesterTokenIdentifier">) => digest({
    organizationId: command.organizationId, orderId: command.orderId, payableId: command.payableId,
    network: command.network, tokenAddress: command.tokenAddress, recipientAddress: command.recipientAddress,
    amountAtomic: command.amountAtomic, sourceVersion: command.sourceVersion,
    requesterTokenIdentifier: command.requesterTokenIdentifier,
  });

export const sourceVersion = (payable: Doc<"payables">) => digest({
  payableId: payable._id, orderId: payable.orderId, submissionId: payable.submissionId, decisionId: payable.decisionId,
  contributor: payable.contributorTokenIdentifier, recipientAddress: normalizeAddress(payable.recipientAddress),
  amountAtomic: payable.amountAtomic, network: payable.network, tokenAddress: payable.tokenAddress, createdAt: payable.createdAt,
});
