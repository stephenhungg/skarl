/** Pure accounting helpers. Storage, authorization, and settlement verification live outside this package. */
export const USDC_SCALE = 1_000_000n;
export const MAX_MICRO_USDC = (1n << 63n) - 1n;

export const ACCOUNTS = Object.freeze({
  "asset:usdc": "debit",
  "asset:evidence_usdc": "debit",
  "liability:evidence_receipts": "credit",
  "revenue:evidence_sales": "credit",
  "liability:customer_prepayments": "credit",
  "liability:contributor_payables": "credit",
  "liability:customer_refunds": "credit",
  "revenue:dataset_sales": "credit",
  "expense:contributor_acquisition": "debit",
} as const);

export type Account = keyof typeof ACCOUNTS;
export type JournalKind = "evidence_sale" | "evidence_sale_deferred" | "funding" | "fulfillment" | "payout" | "refund_reserved" | "refund_paid" | "reversal";
export type JournalLine = Readonly<{ account: Account; debit: bigint; credit: bigint }>;
/** Chain evidence that an outgoing transfer did not and cannot settle. A timeout or reason text is not evidence. */
export type TransferFailureEvidence = Readonly<
  | { kind: "transaction_reverted"; transactionHash: string }
  | { kind: "replaced_unlanded"; transactionHash: string; replacedByTransactionHash: string }
>;
export type Journal = Readonly<{
  eventId: string;
  orderId: string;
  kind: JournalKind;
  description: string;
  contributorId?: string;
  recipientAddress?: string;
  reference?: string;
  reversesEventId?: string;
  failureEvidence?: TransferFailureEvidence;
  lines: readonly JournalLine[];
}>;
export type LedgerState = Readonly<{ journals: readonly Journal[] }>;
type EventInput = { eventId: string; orderId: string };
type AmountInput = EventInput & { amountMicroUsdc: bigint };
type BalanceFilter = { orderId?: string; contributorId?: string };
type Side = "debit" | "credit";

export const EMPTY_LEDGER: LedgerState = Object.freeze({ journals: Object.freeze([]) });

/**
 * Required line layout per journal kind, as equal-amount [debit, credit] pairs in order. Balancing alone is not
 * enough: a balanced "funding" journal could otherwise book a prepayment straight to revenue.
 */
const LAYOUTS: Readonly<Record<Exclude<JournalKind, "reversal">, readonly (readonly [Account, Account])[]>> = Object.freeze({
  evidence_sale: [["asset:evidence_usdc", "revenue:evidence_sales"]],
  evidence_sale_deferred: [["asset:evidence_usdc", "liability:evidence_receipts"]],
  funding: [["asset:usdc", "liability:customer_prepayments"]],
  fulfillment: [["liability:customer_prepayments", "revenue:dataset_sales"], ["expense:contributor_acquisition", "liability:contributor_payables"]],
  payout: [["liability:contributor_payables", "asset:usdc"]],
  refund_reserved: [["liability:customer_prepayments", "liability:customer_refunds"]],
  refund_paid: [["liability:customer_refunds", "asset:usdc"]],
});
const CHAIN_TRANSFER_KINDS: readonly JournalKind[] = ["payout", "refund_paid"];
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

/** Parse an unsigned decimal string exactly; never round or accept floating-point inputs. Trailing fractional zeros are allowed. */
export function parseUsdc(value: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) {
    throw new Error("USDC must be an unsigned decimal string with at most six fractional digits");
  }
  const [whole, fraction = ""] = value.split(".");
  if (whole!.length > 13) throw new Error("USDC amount exceeds signed Int64 storage range");
  const amount = BigInt(whole!) * USDC_SCALE + BigInt(fraction.padEnd(6, "0"));
  if (amount > MAX_MICRO_USDC) throw new Error("USDC amount exceeds signed Int64 storage range");
  return amount;
}

/** Format integer units for display. JSON/API boundaries should transmit the integer as a string. */
export function formatUsdc(amount: bigint): string {
  if (typeof amount !== "bigint") throw new Error("USDC formatting requires bigint micro-units");
  const absolute = amount < 0n ? -amount : amount;
  const fraction = (absolute % USDC_SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return `${amount < 0n ? "-" : ""}${absolute / USDC_SCALE}${fraction ? `.${fraction}` : ""}`;
}

function positiveAmount(amount: bigint): void {
  if (typeof amount !== "bigint" || amount <= 0n || amount > MAX_MICRO_USDC) {
    throw new Error("Journal amounts must be positive bigint micro-USDC within Int64 range");
  }
}

/** IDs are compared byte-for-byte, so " f1" and "f1" would be two events; reject anything outside a strict charset. */
function assertId(value: unknown, label: string): void {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new Error(`${label} must be 1-128 characters of [A-Za-z0-9._:-] starting alphanumeric`);
}

function line(account: Account, side: Side, amount: bigint): JournalLine {
  positiveAmount(amount);
  return { account, debit: side === "debit" ? amount : 0n, credit: side === "credit" ? amount : 0n };
}

export function createFundingJournal(input: AmountInput): Journal {
  return {
    eventId: input.eventId, orderId: input.orderId, kind: "funding",
    description: "Confirmed buyer prepayment; no revenue recognized",
    lines: [line("asset:usdc", "debit", input.amountMicroUsdc), line("liability:customer_prepayments", "credit", input.amountMicroUsdc)],
  };
}

/** Confirmed receipt into the operator revenue wallet, separately from order funding.
 * delivered means the licensed evidence is available to its buyer at confirmation;
 * a quarantined/unavailable resource remains a sale-specific liability.
 */
export function createEvidenceSaleJournal(input: AmountInput & {
  sampleId: string; recipientAddress: string; delivered: boolean;
}): Journal {
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.recipientAddress) || /^0x0{40}$/i.test(input.recipientAddress)) {
    throw new Error("Evidence sale requires a nonzero receiving wallet");
  }
  assertId(input.sampleId, "Sample ID");
  return {
    eventId: input.eventId, orderId: input.orderId,
    kind: input.delivered ? "evidence_sale" : "evidence_sale_deferred",
    reference: input.sampleId, recipientAddress: input.recipientAddress.toLowerCase(),
    description: input.delivered
      ? "Evidence sale received in operator revenue wallet; licensed evidence available"
      : "Evidence-sale inflow in operator revenue wallet; content unavailable, obligation retained",
    lines: [line("asset:evidence_usdc", "debit", input.amountMicroUsdc),
      line(input.delivered ? "revenue:evidence_sales" : "liability:evidence_receipts", "credit", input.amountMicroUsdc)],
  };
}

/** Principal model: invoke only when the accepted sample and license are available to its buyer. */
export function createFulfillmentJournal(input: EventInput & {
  sampleId: string; contributorId: string; priceMicroUsdc: bigint; contributorMicroUsdc: bigint;
}): Journal {
  positiveAmount(input.priceMicroUsdc);
  positiveAmount(input.contributorMicroUsdc);
  if (!input.sampleId || !input.contributorId) throw new Error("Fulfillment requires sample and contributor references");
  return {
    eventId: input.eventId, orderId: input.orderId, kind: "fulfillment", contributorId: input.contributorId,
    reference: input.sampleId, description: "Accepted sample delivered; revenue and contributor obligation accrued",
    lines: [
      line("liability:customer_prepayments", "debit", input.priceMicroUsdc),
      line("revenue:dataset_sales", "credit", input.priceMicroUsdc),
      line("expense:contributor_acquisition", "debit", input.contributorMicroUsdc),
      line("liability:contributor_payables", "credit", input.contributorMicroUsdc),
    ],
  };
}

/** `payableId` is the sample reference of the fulfillment that accrued the payable. */
export function createPayoutJournal(input: AmountInput & { contributorId: string; payableId: string }): Journal {
  if (!input.contributorId || !input.payableId) throw new Error("Payout requires contributor and payable references");
  return {
    eventId: input.eventId, orderId: input.orderId, kind: "payout", contributorId: input.contributorId,
    reference: input.payableId, description: "Approved contributor transfer confirmed",
    lines: [line("liability:contributor_payables", "debit", input.amountMicroUsdc), line("asset:usdc", "credit", input.amountMicroUsdc)],
  };
}

export function createRefundReservedJournal(input: AmountInput): Journal {
  return {
    eventId: input.eventId, orderId: input.orderId, kind: "refund_reserved", description: "Cancellation approved; unfulfilled balance reserved for refund",
    lines: [line("liability:customer_prepayments", "debit", input.amountMicroUsdc), line("liability:customer_refunds", "credit", input.amountMicroUsdc)],
  };
}

export function createRefundPaidJournal(input: AmountInput): Journal {
  return {
    eventId: input.eventId, orderId: input.orderId, kind: "refund_paid", description: "Approved buyer refund confirmed",
    lines: [line("liability:customer_refunds", "debit", input.amountMicroUsdc), line("asset:usdc", "credit", input.amountMicroUsdc)],
  };
}

/** Reversing a confirmed payout or refund requires chain failure evidence; otherwise a lost response could be paid twice. */
export function reverseJournal(original: Journal, eventId: string, reason: string, failureEvidence?: TransferFailureEvidence): Journal {
  if (!reason.trim()) throw new Error("A reversal requires a reason");
  const { failureEvidence: _originalEvidence, ...rest } = original;
  return {
    ...rest, eventId, kind: "reversal", description: reason, reversesEventId: original.eventId,
    ...(failureEvidence === undefined ? {} : { failureEvidence }),
    lines: original.lines.map(entry => ({ account: entry.account, debit: entry.credit, credit: entry.debit })),
  };
}

function assertTxHash(value: unknown, label: string): void {
  if (typeof value !== "string" || !TX_HASH_PATTERN.test(value)) throw new Error(`${label} must be an EVM transaction hash (0x + 64 hex)`);
}

/**
 * A reverted receipt proves failure. A nonce replaced by a different mined transaction proves the original can never land.
 * A timeout, a dropped RPC response, or a missing receipt proves neither.
 */
function assertFailureEvidence(evidence: TransferFailureEvidence | undefined): void {
  if (evidence === undefined) throw new Error("Reversing a chain transfer requires failure evidence, not only a reason");
  assertTxHash(evidence.transactionHash, "Failure evidence transaction hash");
  if (evidence.kind === "transaction_reverted") return;
  if (evidence.kind !== "replaced_unlanded") throw new Error("Unknown failure evidence kind");
  assertTxHash(evidence.replacedByTransactionHash, "Replacement transaction hash");
  if (evidence.replacedByTransactionHash.toLowerCase() === evidence.transactionHash.toLowerCase()) {
    throw new Error("Replacement evidence must name a different mined transaction");
  }
}

function assertLayout(journal: Journal): void {
  if (journal.kind === "reversal") return;
  if ((journal.kind === "evidence_sale" || journal.kind === "evidence_sale_deferred") &&
    (!journal.reference || !journal.recipientAddress || !/^0x[0-9a-f]{40}$/.test(journal.recipientAddress) || /^0x0{40}$/.test(journal.recipientAddress))) {
    throw new Error("Evidence sale requires sample and receiving wallet references");
  }
  const layout = LAYOUTS[journal.kind];
  if (!layout) throw new Error("Unknown journal kind");
  if (journal.lines.length !== layout.length * 2) throw new Error(`Journal lines do not match the ${journal.kind} layout`);
  layout.forEach(([debitAccount, creditAccount], index) => {
    const debit = journal.lines[index * 2]!;
    const credit = journal.lines[index * 2 + 1]!;
    if (debit.account !== debitAccount || debit.debit === 0n || credit.account !== creditAccount || credit.credit === 0n || debit.debit !== credit.credit) {
      throw new Error(`Journal lines do not match the ${journal.kind} layout`);
    }
  });
}

export function assertBalanced(journal: Journal): void {
  if (!journal.description.trim()) throw new Error("Journal identity and description are required");
  assertId(journal.eventId, "Event ID");
  assertId(journal.orderId, "Order ID");
  for (const [value, label] of [[journal.contributorId, "Contributor ID"], [journal.reference, "Reference"], [journal.reversesEventId, "Reversed event ID"]] as const) {
    if (value !== undefined) assertId(value, label);
  }
  if (journal.lines.length < 2) throw new Error("A journal needs at least two lines");
  let debits = 0n;
  let credits = 0n;
  for (const entry of journal.lines) {
    if (!Object.hasOwn(ACCOUNTS, entry.account)) throw new Error("Unknown ledger account");
    if (typeof entry.debit !== "bigint" || typeof entry.credit !== "bigint" || entry.debit < 0n || entry.credit < 0n) throw new Error("Journal lines require non-negative bigint amounts");
    if ((entry.debit === 0n) === (entry.credit === 0n)) throw new Error("Each journal line must have exactly one positive side");
    positiveAmount(entry.debit || entry.credit);
    debits += entry.debit;
    credits += entry.credit;
  }
  if (debits > MAX_MICRO_USDC || credits > MAX_MICRO_USDC) throw new Error("Journal totals exceed signed Int64 storage range");
  if (debits !== credits) throw new Error("Journal debits must equal credits");
  assertLayout(journal);
}

/** Positive balances follow each account's normal side. */
export function accountBalance(state: LedgerState, account: Account, filter: BalanceFilter = {}): bigint {
  let balance = 0n;
  for (const journal of state.journals) {
    if (filter.orderId !== undefined && journal.orderId !== filter.orderId) continue;
    if (filter.contributorId !== undefined && journal.contributorId !== filter.contributorId) continue;
    for (const entry of journal.lines) {
      if (entry.account === account) balance += ACCOUNTS[account] === "debit" ? entry.debit - entry.credit : entry.credit - entry.debit;
    }
  }
  return balance;
}

function fingerprint(journal: Journal): string {
  const evidence = journal.failureEvidence;
  return JSON.stringify([
    journal.eventId, journal.orderId, journal.kind, journal.description, journal.contributorId ?? null,
    journal.reference ?? null, journal.reversesEventId ?? null, journal.recipientAddress ?? null,
    evidence === undefined ? null : Object.entries(evidence).map(([key, value]) => [key, String(value)]),
    journal.lines.map(entry => [entry.account, entry.debit.toString(), entry.credit.toString()]),
  ]);
}

function touchesPayables(journal: Journal): boolean {
  return journal.lines.some(entry => entry.account === "liability:contributor_payables");
}

/** Journals that are still in effect: not reversals and not reversed. */
function activeJournals(state: LedgerState): Journal[] {
  const reversed = new Set(state.journals.flatMap(entry => entry.reversesEventId === undefined ? [] : [entry.reversesEventId]));
  return state.journals.filter(entry => entry.kind !== "reversal" && !reversed.has(entry.eventId));
}

function payableAmount(journal: Journal): bigint {
  return journal.lines.find(entry => entry.account === "liability:contributor_payables")!.credit;
}

function assertPayableReferences(state: LedgerState, journal: Journal): void {
  const active = activeJournals(state);
  if (journal.kind === "fulfillment") {
    if (active.some(entry => entry.kind === "fulfillment" && entry.orderId === journal.orderId && entry.reference === journal.reference)) {
      throw new Error("Sample already fulfilled for this order; reverse the original before re-posting");
    }
  }
  if (journal.kind === "payout") {
    const accrual = active.find(entry => entry.kind === "fulfillment" && entry.orderId === journal.orderId && entry.reference === journal.reference);
    if (!accrual) throw new Error("Payout must reference an active fulfillment payable in the same order");
    if (accrual.contributorId !== journal.contributorId) throw new Error("Insufficient contributor payable balance: payable belongs to another contributor");
    const alreadyPaid = active
      .filter(entry => entry.kind === "payout" && entry.orderId === journal.orderId && entry.reference === journal.reference)
      .reduce((sum, entry) => sum + entry.lines[0]!.debit, 0n);
    if (alreadyPaid + journal.lines[0]!.debit > payableAmount(accrual)) throw new Error("Payout exceeds the remaining amount of its payable");
  }
}

function assertBalancesInRange(state: LedgerState, orderId: string): void {
  for (const account of Object.keys(ACCOUNTS) as Account[]) {
    for (const balance of [accountBalance(state, account), accountBalance(state, account, { orderId })]) {
      if (balance > MAX_MICRO_USDC || balance < -MAX_MICRO_USDC) throw new Error(`Balance for ${account} exceeds signed Int64 storage range`);
    }
  }
}

/** Pure replay helper, not a concurrent database transaction or blockchain payment executor. */
export function postJournal(state: LedgerState, journal: Journal): LedgerState {
  assertBalanced(journal);
  const existing = state.journals.find(entry => entry.eventId === journal.eventId);
  if (existing) {
    if (fingerprint(existing) !== fingerprint(journal)) throw new Error("Event ID conflict: existing journal differs");
    return state;
  }
  if (touchesPayables(journal) && journal.contributorId === undefined) throw new Error("Journals touching contributor payables require a contributor ID");
  if ((journal.kind === "fulfillment" || journal.kind === "payout") && journal.reference === undefined) throw new Error(`A ${journal.kind} journal requires a reference`);
  if (journal.kind === "reversal") {
    const original = state.journals.find(entry => entry.eventId === journal.reversesEventId);
    if (!original || original.kind === "reversal") throw new Error("Reversal must reference an existing original journal");
    if (state.journals.some(entry => entry.reversesEventId === original.eventId)) throw new Error("Journal already reversed");
    if (CHAIN_TRANSFER_KINDS.includes(original.kind)) assertFailureEvidence(journal.failureEvidence);
    else if (journal.failureEvidence !== undefined) throw new Error("Failure evidence applies only to chain transfer reversals");
    if (fingerprint(reverseJournal(original, journal.eventId, journal.description, journal.failureEvidence)) !== fingerprint(journal)) throw new Error("Reversal does not match original entries");
  } else {
    if (journal.reversesEventId !== undefined) throw new Error("Only reversal journals may reference a reversed event");
    if (journal.failureEvidence !== undefined) throw new Error("Only reversal journals may carry failure evidence");
    assertPayableReferences(state, journal);
  }
  const saved: Journal = Object.freeze({ ...journal, lines: Object.freeze(journal.lines.map(entry => Object.freeze({ ...entry }))) });
  const next: LedgerState = Object.freeze({ journals: Object.freeze([...state.journals, saved]) });
  for (const account of ["asset:usdc", "asset:evidence_usdc", "liability:evidence_receipts", "liability:customer_prepayments", "liability:contributor_payables", "liability:customer_refunds"] as const) {
    if (accountBalance(next, account, { orderId: journal.orderId }) < 0n) throw new Error(`Insufficient order balance for ${account}`);
  }
  if (journal.contributorId && accountBalance(next, "liability:contributor_payables", { orderId: journal.orderId, contributorId: journal.contributorId }) < 0n) {
    throw new Error("Insufficient contributor payable balance");
  }
  assertBalancesInRange(next, journal.orderId);
  return next;
}
