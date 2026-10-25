import { PAYMENT_NETWORK, USDC_ADDRESS } from "@skarl/contracts/chain";

export type TransferIdentity = Readonly<{ network: string; txHash: string; logIndex: number }>;
export type ExpectedTransfer = Readonly<{ fromAddress: string; toAddress: string; amountAtomic: bigint }>;
export type TransferObservation = TransferIdentity & ExpectedTransfer & Readonly<{
  tokenAddress: string;
  blockNumber: bigint;
  blockHash: string;
  confirmations: number;
  succeeded: boolean;
  observedAt: number;
}>;
export const REQUIRED_CONFIRMATIONS = 2;
const HASH = /^0x[\da-fA-F]{64}$/;
const ADDRESS = /^0x[\da-fA-F]{40}$/;
const MAX_AMOUNT = (1n << 63n) - 1n;

export function chainIdentity(transfer: TransferIdentity): string {
  if (transfer.network !== PAYMENT_NETWORK || !HASH.test(transfer.txHash) ||
    !Number.isSafeInteger(transfer.logIndex) || transfer.logIndex < 0) throw new Error("invalid_transfer_identity");
  return `${transfer.network}:${transfer.txHash.toLowerCase()}:${transfer.logIndex}`;
}

/** Validate RPC-derived evidence before a financial mutation. Caller must obtain it from a trusted RPC, never a buyer payload. */
export function validateTransfer(observation: TransferObservation, expected: ExpectedTransfer): void {
  if (observation.network !== PAYMENT_NETWORK) throw new Error("wrong_network");
  if (observation.tokenAddress.toLowerCase() !== USDC_ADDRESS.toLowerCase()) throw new Error("wrong_token");
  chainIdentity(observation);
  if (typeof observation.blockNumber !== "bigint" || observation.blockNumber < 0n || !HASH.test(observation.blockHash)) {
    throw new Error("invalid_block_identity");
  }
  if (observation.succeeded !== true) throw new Error("receipt_failed");
  if (!Number.isSafeInteger(observation.confirmations) || observation.confirmations < REQUIRED_CONFIRMATIONS) {
    throw new Error("insufficient_confirmations");
  }
  if (!ADDRESS.test(expected.fromAddress) || !ADDRESS.test(observation.fromAddress) ||
    observation.fromAddress.toLowerCase() !== expected.fromAddress.toLowerCase()) throw new Error("wrong_sender");
  if (!ADDRESS.test(expected.toAddress) || !ADDRESS.test(observation.toAddress) ||
    observation.toAddress.toLowerCase() !== expected.toAddress.toLowerCase()) throw new Error("wrong_recipient");
  if (typeof expected.amountAtomic !== "bigint" || expected.amountAtomic <= 0n || expected.amountAtomic > MAX_AMOUNT ||
    typeof observation.amountAtomic !== "bigint" || observation.amountAtomic !== expected.amountAtomic) throw new Error("wrong_amount");
  if (!Number.isFinite(observation.observedAt) || observation.observedAt < 0) throw new Error("invalid_observation_time");
}

export type PaymentObligation = ExpectedTransfer & Readonly<{
  eventKey: string;
  orderId: string;
  kind: "funding" | "payout";
  deadlineAt?: number;
  transfer?: TransferIdentity;
}>;
export type PaymentJournal = Readonly<{
  eventKey: string;
  orderId: string;
  kind: "funding" | "payout";
  network: string;
  tokenAddress: string;
  transfer?: TransferIdentity;
  lines: readonly Readonly<{ account: string; side: "debit" | "credit"; amountAtomic: bigint }>[];
}>;
export type ReconciliationObservation = TransferObservation & Readonly<{ eventKey?: string; orderId?: string }>;
export type ReconciliationExceptionCode = "wrong_amount" | "unknown_transfer" | "missing_transfer" | "late_settlement" |
  "ledger_mismatch" | "invalid_transfer" | "duplicate_transfer" | "duplicate_obligation";
export type ReconciliationException = {
  code: ReconciliationExceptionCode;
  eventKey?: string;
  orderId?: string;
  chainIdentity?: string;
  detail: string;
};

function identityOrUndefined(value: TransferIdentity | undefined): string | undefined {
  if (!value) return undefined;
  try { return chainIdentity(value); } catch { return undefined; }
}

function correctJournal(journal: PaymentJournal, obligation: PaymentObligation, identity: string): boolean {
  const accounts = obligation.kind === "funding"
    ? { debit: "asset:usdc", credit: "liability:customer_prepayments" }
    : { debit: "liability:contributor_payables", credit: "asset:usdc" };
  return journal.orderId === obligation.orderId && journal.kind === obligation.kind &&
    journal.network === PAYMENT_NETWORK && journal.tokenAddress.toLowerCase() === USDC_ADDRESS.toLowerCase() &&
    identityOrUndefined(journal.transfer) === identity && journal.lines.length === 2 &&
    (["debit", "credit"] as const).every(side => journal.lines.filter(line =>
      line.side === side && line.account === accounts[side] && line.amountAtomic === obligation.amountAtomic).length === 1);
}

/** Three-way comparison; matching amounts alone never link a transfer to an obligation or journal. No state is mutated. */
export function reconcilePayments(input: {
  obligations: readonly PaymentObligation[];
  journals: readonly PaymentJournal[];
  observations: readonly ReconciliationObservation[];
  now: number;
}): {
  matches: { eventKey: string; orderId: string; chainIdentity: string; amountAtomic: bigint }[];
  exceptions: ReconciliationException[];
} {
  const matches: { eventKey: string; orderId: string; chainIdentity: string; amountAtomic: bigint }[] = [];
  const exceptions: ReconciliationException[] = [];
  const counts = new Map<string, number>();
  for (const observation of input.observations) {
    const id = identityOrUndefined(observation);
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const knownEvents = new Set(input.obligations.map(obligation => obligation.eventKey));
  for (const observation of input.observations) {
    const id = identityOrUndefined(observation);
    if (!observation.eventKey || !knownEvents.has(observation.eventKey)) {
      exceptions.push({ code: "unknown_transfer", eventKey: observation.eventKey, orderId: observation.orderId,
        chainIdentity: id, detail: "Observed transfer has no stored business obligation." });
    }
  }
  for (const journal of input.journals) {
    if (!knownEvents.has(journal.eventKey)) exceptions.push({ code: "ledger_mismatch", eventKey: journal.eventKey,
      orderId: journal.orderId, detail: "Payment journal has no stored business obligation." });
  }
  for (const obligation of input.obligations) {
    const context = { eventKey: obligation.eventKey, orderId: obligation.orderId };
    const start = exceptions.length;
    if (input.obligations.filter(other => other.eventKey === obligation.eventKey).length !== 1) {
      exceptions.push({ ...context, code: "duplicate_obligation", detail: "Business event is assigned to multiple obligations." });
      continue;
    }
    const observations = input.observations.filter(observation => observation.eventKey === obligation.eventKey);
    const journals = input.journals.filter(journal => journal.eventKey === obligation.eventKey);
    if (observations.length === 0) {
      exceptions.push({ ...context, code: "missing_transfer", detail: "No transfer observation exists for this business event." });
      if (journals.length) exceptions.push({ ...context, code: "ledger_mismatch", detail: "Journal posted without an observed transfer." });
      if (obligation.deadlineAt !== undefined && input.now > obligation.deadlineAt) {
        exceptions.push({ ...context, code: "late_settlement", detail: "Settlement remains unobserved after its deadline; this does not prove failure." });
      }
      continue;
    }
    if (observations.length !== 1) {
      exceptions.push({ ...context, code: "duplicate_transfer", detail: "Multiple observations claim this business event." });
      continue;
    }
    const observation = observations[0]!;
    const id = identityOrUndefined(observation);
    if (id && counts.get(id)! > 1) exceptions.push({ ...context, chainIdentity: id, code: "duplicate_transfer",
      detail: "Chain log is claimed more than once." });
    if (observation.orderId !== obligation.orderId ||
      (obligation.transfer !== undefined && (!id || identityOrUndefined(obligation.transfer) !== id))) {
      exceptions.push({ ...context, chainIdentity: id, code: "unknown_transfer", detail: "Transfer identity or order differs from the stored obligation." });
    }
    try { validateTransfer(observation, obligation); }
    catch (error) {
      const detail = error instanceof Error ? error.message : "invalid_transfer";
      exceptions.push({ ...context, chainIdentity: id, code: detail === "wrong_amount" ? "wrong_amount" : "invalid_transfer", detail });
    }
    if (journals.length !== 1 || !id || !correctJournal(journals[0]!, obligation, id)) {
      exceptions.push({ ...context, chainIdentity: id, code: "ledger_mismatch",
        detail: "Expected one balanced journal with exact accounts, amount, order, asset and chain identity." });
    }
    if (obligation.deadlineAt !== undefined && observation.observedAt > obligation.deadlineAt) {
      exceptions.push({ ...context, chainIdentity: id, code: "late_settlement", detail: "Transfer was first observed after its settlement deadline." });
    }
    if (exceptions.length === start && id) matches.push({ ...context, chainIdentity: id, amountAtomic: obligation.amountAtomic });
  }
  return { matches, exceptions };
}
