/** Pure accounting helpers. Storage, authorization, and settlement verification live outside this package. */
export const USDC_SCALE = 1_000_000n;
export const MAX_MICRO_USDC = (1n << 63n) - 1n;

export const ACCOUNTS = {
  "asset:usdc": "debit",
  "liability:customer_prepayments": "credit",
  "liability:contributor_payables": "credit",
  "liability:customer_refunds": "credit",
  "revenue:dataset_sales": "credit",
  "expense:contributor_acquisition": "debit",
} as const;

export type Account = keyof typeof ACCOUNTS;
export type JournalKind = "funding" | "fulfillment" | "payout" | "refund_reserved" | "refund_paid" | "reversal";
export type JournalLine = Readonly<{ account: Account; debit: bigint; credit: bigint }>;
export type Journal = Readonly<{
  eventId: string;
  orderId: string;
  kind: JournalKind;
  description: string;
  contributorId?: string;
  reference?: string;
  reversesEventId?: string;
  lines: readonly JournalLine[];
}>;
export type LedgerState = Readonly<{ journals: readonly Journal[] }>;
type EventInput = { eventId: string; orderId: string };
type AmountInput = EventInput & { amountMicroUsdc: bigint };
type BalanceFilter = { orderId?: string; contributorId?: string };

export const EMPTY_LEDGER: LedgerState = Object.freeze({ journals: Object.freeze([]) });

/** Parse an unsigned decimal string exactly; never round or accept floating-point inputs. */
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

function line(account: Account, side: "debit" | "credit", amount: bigint): JournalLine {
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

export function reverseJournal(original: Journal, eventId: string, reason: string): Journal {
  if (!reason.trim()) throw new Error("A reversal requires a reason");
  return {
    ...original, eventId, kind: "reversal", description: reason, reversesEventId: original.eventId,
    lines: original.lines.map(entry => ({ account: entry.account, debit: entry.credit, credit: entry.debit })),
  };
}

export function assertBalanced(journal: Journal): void {
  if (!journal.eventId.trim() || !journal.orderId.trim() || !journal.description.trim()) throw new Error("Journal identity and description are required");
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
  if (debits !== credits) throw new Error("Journal debits must equal credits");
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
  return JSON.stringify([
    journal.eventId, journal.orderId, journal.kind, journal.description, journal.contributorId ?? null,
    journal.reference ?? null, journal.reversesEventId ?? null,
    journal.lines.map(entry => [entry.account, entry.debit.toString(), entry.credit.toString()]),
  ]);
}

/** Pure replay helper, not a concurrent database transaction or blockchain payment executor. */
export function postJournal(state: LedgerState, journal: Journal): LedgerState {
  assertBalanced(journal);
  const existing = state.journals.find(entry => entry.eventId === journal.eventId);
  if (existing) {
    if (fingerprint(existing) !== fingerprint(journal)) throw new Error("Event ID conflict: existing journal differs");
    return state;
  }
  if (journal.kind === "reversal") {
    const original = state.journals.find(entry => entry.eventId === journal.reversesEventId);
    if (!original || original.kind === "reversal") throw new Error("Reversal must reference an existing original journal");
    if (state.journals.some(entry => entry.reversesEventId === original.eventId)) throw new Error("Journal already reversed");
    if (fingerprint(reverseJournal(original, journal.eventId, journal.description)) !== fingerprint(journal)) throw new Error("Reversal does not match original entries");
  } else if (journal.reversesEventId !== undefined) {
    throw new Error("Only reversal journals may reference a reversed event");
  }
  const saved: Journal = Object.freeze({ ...journal, lines: Object.freeze(journal.lines.map(entry => Object.freeze({ ...entry }))) });
  const next: LedgerState = Object.freeze({ journals: Object.freeze([...state.journals, saved]) });
  for (const account of ["asset:usdc", "liability:customer_prepayments", "liability:contributor_payables", "liability:customer_refunds"] as const) {
    if (accountBalance(next, account, { orderId: journal.orderId }) < 0n) throw new Error(`Insufficient order balance for ${account}`);
  }
  if (journal.contributorId && accountBalance(next, "liability:contributor_payables", { orderId: journal.orderId, contributorId: journal.contributorId }) < 0n) {
    throw new Error("Insufficient contributor payable balance");
  }
  return next;
}
