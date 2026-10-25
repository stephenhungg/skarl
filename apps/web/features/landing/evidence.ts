import type { EvidenceStatus } from "@/components/status-pill";
import type { VerificationReport } from "@/components/evidence-timeline";
import {
  accountBalance, createFulfillmentJournal, createFundingJournal, createPayoutJournal, createRefundPaidJournal, createRefundReservedJournal,
  EMPTY_LEDGER, parseUsdc, postJournal, type Account, type Journal, type LedgerState,
} from "@skarl/ledger";
import { usdcShort } from "./money/amount";

// Everything the landing claims lives here, so a row flips from SIMULATED to LIVE in one line.

export const DEMO_VIDEO_URL: string | null = null; // set once the 3 minute demo is uploaded

export const SETTLEMENT = {
  status: "PLANNED" as EvidenceStatus,
  label: "Base Sepolia settlement",
  detail: "waiting for a first transfer",
};

export type ProofRow = { date: string; title: string; summary: string; status: EvidenceStatus; href?: string };

export const PROOF_LOG: ProofRow[] = [
  {
    date: "10.25",
    title: "Finance fixture balances in ledger tests",
    summary: "100 prepaid, 7.50 accrued and paid, 90 refunded, 2.50 left. Debits equal credits at every step.",
    status: "SIMULATED",
    href: "https://github.com/stephenhungg/skarl/blob/main/docs/accounting.md",
  },
  {
    date: "10.25",
    title: "Seeded demo backend deployed on Convex",
    summary: "One organization, four demo identities and one unfunded 100 USDC order with a frozen rubric, and seeding again returns identical IDs.",
    status: "LIVE",
    href: "https://github.com/stephenhungg/skarl/blob/main/docs/backend.md#task-1-client-contract",
  },
  {
    date: "10.25",
    title: "Self-approval and agent approval are refused",
    summary: "A payout proposal with a changed requester, recipient or amount is refused too, and every refusal leaves an audit row that Convex tests check.",
    status: "SIMULATED",
    href: "https://github.com/stephenhungg/skarl/blob/main/docs/finance-agent.md",
  },
  {
    date: "10.25",
    title: "A duplicate clip cannot create a second payable",
    summary: "A hash match against accepted work keeps that submission as evidence and posts nothing, though those hashes come from test fixtures for now.",
    status: "SIMULATED",
    href: "https://github.com/stephenhungg/skarl/blob/main/docs/accounting.md",
  },
];

// Designed and not running yet. Shown under the dated rows so the log never implies they happened.
export const PROOF_NEXT: ProofRow[] = [
  {
    date: "next",
    title: "Gemini compares narration with video",
    summary: "Runs in a Convex action on a recorded clip and cites timestamps from its source video.",
    status: "PLANNED",
    href: "https://github.com/stephenhungg/skarl/blob/main/docs/ai-verification.md",
  },
  {
    date: "next",
    title: "Buyer funds an order over x402",
    summary: "Test USDC on Base Sepolia through Coinbase's CDP facilitator.",
    status: "PLANNED",
    href: "https://github.com/stephenhungg/skarl/blob/main/docs/payments.md",
  },
  {
    date: "next",
    title: "Controller-approved payout reconciled by transaction hash",
    summary: "One contributor payout on Base Sepolia, matched against our ledger before it shows as paid.",
    status: "PLANNED",
    href: "https://github.com/stephenhungg/skarl/blob/main/docs/payments.md",
  },
];

export const EVIDENCE_DOCS_URL = "https://github.com/stephenhungg/skarl/tree/main/docs";

export type RoleTile = { role: string; icon: "hand" | "camera" | "eye" | "ledger" | "stamp"; can: string; cannot: string; href: string };

const DOC = "https://github.com/stephenhungg/skarl/blob/main/docs/";

export const ROLES: RoleTile[] = [
  { role: "Buyer", icon: "hand", can: "Fund a frozen task version", cannot: "Download unaccepted samples", href: `${DOC}product.md` },
  { role: "Contributor", icon: "camera", can: "Record, upload, get timestamped feedback", cannot: "See pay as cash before a transfer confirms", href: `${DOC}product.md` },
  { role: "Verifier", icon: "eye", can: "Cite timestamped evidence", cannot: "Approve or pay anything", href: `${DOC}ai-verification.md` },
  { role: "Finance agent", icon: "ledger", can: "Propose payouts and refunds", cannot: "Approve its own proposal", href: `${DOC}finance-agent.md` },
  { role: "Controller", icon: "stamp", can: "Approve exceptions and batches", cannot: "Share an identity with whoever requested it", href: `${DOC}security.md` },
];

export const ROLE_INVARIANTS: string[] = [
  "Every journal's debits equal its credits.",
  "Each event ID posts at most once.",
  "One accepted submission creates at most one payable.",
  "A payout proposal cannot be approved by its requester or by an agent.",
];

// Where the money goes: the $100 finance fixture from docs/accounting.md, built with the same
// ledger helpers the tests replay. Amounts are exact micro-USDC; nothing here is a retyped float.

export type MoneyTransfer = {
  label: string;
  amountMicro: bigint;
  status: EvidenceStatus; // chain transfer state, flip to LIVE only with an observed tx
  detail: string;
  txHref: string | null; // explorer link, set only when the transfer is real
};

export type MoneyStep = {
  id: string;
  title: string;
  detail: string;
  journals: Journal[]; // empty when the step posts nothing
  note?: string; // shown on the receipt in place of, or under, the lines
  closing?: boolean; // last step prints the ending balances instead of a journal
  transfer: MoneyTransfer | null;
  idleNote?: string; // what the payment card says when no transfer belongs to the step
  journalStatus: EvidenceStatus; // how the journal itself has been exercised
};

const ORDER = "order-fixture";
const PRICE = parseUsdc("10");
const RATE = parseUsdc("7.5");
const FUNDED = PRICE * 10n;
const REFUND = FUNDED - PRICE;

const funding = createFundingJournal({ eventId: "fund-1", orderId: ORDER, amountMicroUsdc: FUNDED });
const fulfillment = createFulfillmentJournal({ eventId: "fulfil-1", orderId: ORDER, sampleId: "sample-1", contributorId: "contributor-1", priceMicroUsdc: PRICE, contributorMicroUsdc: RATE });
const payout = createPayoutJournal({ eventId: "payout-1", orderId: ORDER, contributorId: "contributor-1", payableId: "sample-1", amountMicroUsdc: RATE });
const refundReserved = createRefundReservedJournal({ eventId: "refund-reserve-1", orderId: ORDER, amountMicroUsdc: REFUND });
const refundPaid = createRefundPaidJournal({ eventId: "refund-paid-1", orderId: ORDER, amountMicroUsdc: REFUND });

/** Replayed through postJournal, so an unbalanced or out-of-order fixture fails at build time, not on stage. */
export const MONEY_LEDGER: LedgerState = [funding, fulfillment, payout, refundReserved, refundPaid].reduce(postJournal, EMPTY_LEDGER);
export const MONEY_CASH_LEFT = accountBalance(MONEY_LEDGER, "asset:usdc");

export const MONEY_SEATS = "A finance agent prepares payouts and refunds, and a person approves each one.";

export const MONEY_ACCOUNT_LABEL: Record<Account, string> = {
  "asset:usdc": "USDC cash",
  "liability:customer_prepayments": "Customer prepayments",
  "liability:contributor_payables": "Contributor payables",
  "liability:customer_refunds": "Refunds payable",
  "revenue:dataset_sales": "Dataset sales revenue",
  "expense:contributor_acquisition": "Contributor expense",
};

export const MONEY_STEPS: MoneyStep[] = [
  {
    id: "prepay",
    title: `Buyer prepays ${usdcShort(FUNDED)} for ten samples`,
    detail: `${usdcShort(FUNDED)} test USDC on Base Sepolia, paid through Coinbase x402 and held as a customer prepayment until work is accepted.`,
    journals: [funding],
    journalStatus: "SIMULATED",
    transfer: { label: "Buyer funding", amountMicro: FUNDED, status: SETTLEMENT.status, detail: "Paid over x402 on Base Sepolia once funding is live", txHref: null },
  },
  {
    id: "accept",
    title: "One sample accepted",
    detail: `${usdcShort(PRICE)} of that prepayment becomes revenue and a ${usdcShort(RATE)} contributor payable accrues.`,
    journals: [fulfillment],
    journalStatus: "SIMULATED",
    transfer: null,
    idleNote: "Revenue and a payable are booked, but no cash moves until a payout is approved and confirmed.",
  },
  {
    id: "approve",
    title: "Agent proposes, controller approves",
    detail: "A finance agent drafts each payout and a person on our team approves it, since agents have no way to approve their own requests.",
    journals: [],
    note: "Approving does not move money, so a payment stays open until its transfer confirms.",
    journalStatus: "SIMULATED",
    transfer: { label: "Contributor payout", amountMicro: RATE, status: "PLANNED", detail: "Proposed by an agent and approved by a controller, waiting on transfer", txHref: null },
  },
  {
    id: "payout",
    title: "Payout confirmed",
    detail: `That ${usdcShort(RATE)} payable clears only when its approved transfer confirms, and a signature shows up here once one is observed.`,
    journals: [payout],
    journalStatus: "SIMULATED",
    transfer: { label: "Contributor payout", amountMicro: RATE, status: SETTLEMENT.status, detail: "Sent on Base Sepolia once payouts are live", txHref: null },
  },
  {
    id: "refund",
    title: `Nine samples cancelled, ${usdcShort(REFUND)} refunded`,
    detail: "Unused 90 is set aside as a refund and clears once its transfer confirms.",
    journals: [refundReserved, refundPaid],
    journalStatus: "SIMULATED",
    transfer: { label: "Buyer refund", amountMicro: REFUND, status: SETTLEMENT.status, detail: "Sent on Base Sepolia once payouts are live", txHref: null },
  },
  {
    id: "close",
    title: `Cash ends at ${usdcShort(MONEY_CASH_LEFT)}`,
    detail: "This is before model, fee and gas costs.",
    journals: [],
    closing: true,
    idleNote: "Cash left on this order after payout and refund.",
    note: "Everything owed has been paid or refunded, and this is before model, fee and gas costs.",
    journalStatus: "SIMULATED",
    transfer: null,
  },
];

// Built-on strip. LIVE only when it runs now; everything else is PLANNED until it does.
export type BuiltOnItem = { name: string; role: string; status: EvidenceStatus; logo?: { src: string; ratio: number; scale?: number }; showName?: boolean; label?: string };

export const BUILT_ON: BuiltOnItem[] = [
  { name: "Convex", role: "ledger and live state", status: "LIVE", logo: { src: "/logos/convex.svg", ratio: 128 / 24, scale: 0.85 } },
  { name: "Gemini", role: "evidence", status: "PLANNED", logo: { src: "/logos/gemini.svg", ratio: 344 / 127, scale: 1.35 } },
  { name: "x402", role: "funding", status: "PLANNED", logo: { src: "/logos/x402.svg", ratio: 486.3 / 187.4 } },
  { name: "Coinbase Wallet MCP", label: "Wallet MCP", role: "agent payments", status: "PLANNED", logo: { src: "/logos/coinbase.svg", ratio: 1101.64 / 230 } },
  { name: "Base Sepolia", role: "settlement in test USDC", status: "PLANNED", logo: { src: "/logos/base.svg", ratio: 1280 / 323.84 } },
];

// The catch. Every report below is illustrative, not model output, so every card is SIMULATED.
// The mismatch report is the appendix report in docs/design.md; the others are derived from it.
const ILLUSTRATIVE_WARNING = "Illustrative example for page copy. Not a model inference result.";
const MODEL_RUNS: VerificationReport["pipeline"]["modelRuns"] = [
  { provider: "google", model: "gemini-3.8-flash", promptVersion: "silent-video-v1" },
  { provider: "local", model: "faster-whisper base.en int8", promptVersion: "asr-v1" },
];

export const CATCH_REPORT_MISMATCH: VerificationReport = {
  schemaVersion: "1.0",
  reportId: "illustrative-report-catch-001",
  submissionId: "illustrative-submission-001",
  taskVersionId: "red-cup-v1",
  source: { sha256: "9f2c1e7a4b0d5e8f3a6c9b2d1e0f7a4c8b5d2e9f6a3c0b7d4e1f8a5c2b9d6e3f", durationMs: 14200 },
  pipeline: { version: "pipeline-0.1.0", status: "completed", implementation: "inference", modelRuns: MODEL_RUNS },
  criteria: [
    {
      criterionId: "red-cup-pickup",
      status: "contradicted",
      evidence: [
        { modality: "video", startMs: 3100, endMs: 4400, claim: "Right hand grasps and lifts blue cup while red cup stays in place." },
        { modality: "audio", startMs: 2900, endMs: 4600, claim: "Narration: \"I'm picking up red cup.\"" },
      ],
      reason: "Spoken object (red cup) conflicts with object seen in silent video (blue cup).",
    },
    {
      criterionId: "placed-on-coaster",
      status: "supported",
      evidence: [{ modality: "video", startMs: 7800, endMs: 9100, claim: "A cup is set down fully inside marked coaster." }],
      reason: "Placement on marked target is visible.",
    },
    {
      criterionId: "narration-alignment",
      status: "contradicted",
      evidence: [
        { modality: "audio", startMs: 2900, endMs: 4600, claim: "Narration names red cup." },
        { modality: "video", startMs: 3100, endMs: 4400, claim: "Blue cup is what moves." },
      ],
      reason: "Narration does not match what happens on video.",
    },
  ],
  duplicate: { status: "clear", matches: [] },
  recommendation: "request_correction",
  warnings: [ILLUSTRATIVE_WARNING],
};

// Same task, retaken: all three criteria supported. An accept report carries no warnings by schema.
export const CATCH_REPORT_RETAKE: VerificationReport = {
  ...CATCH_REPORT_MISMATCH,
  reportId: "illustrative-report-catch-002",
  submissionId: "illustrative-submission-002",
  source: { sha256: "4b8e0d2a6c1f9e3b7d5a0c8f2e6b4d1a9c7e3f5b0d8a2c6e4f1b9d7a3c5e0f82", durationMs: 13600 },
  criteria: [
    {
      criterionId: "red-cup-pickup",
      status: "supported",
      evidence: [
        { modality: "video", startMs: 2600, endMs: 3900, claim: "Right hand grasps and lifts red cup." },
        { modality: "audio", startMs: 2400, endMs: 4100, claim: "Narration: \"I'm picking up red cup.\"" },
      ],
      reason: "Spoken object matches what is lifted in silent video.",
    },
    {
      criterionId: "placed-on-coaster",
      status: "supported",
      evidence: [{ modality: "video", startMs: 7200, endMs: 8500, claim: "Red cup is set down fully inside marked coaster." }],
      reason: "Placement on marked target is visible.",
    },
    {
      criterionId: "narration-alignment",
      status: "supported",
      evidence: [
        { modality: "audio", startMs: 6900, endMs: 8700, claim: "Narration: \"Setting it on a coaster.\"" },
        { modality: "video", startMs: 7200, endMs: 8500, claim: "Red cup moves onto coaster." },
      ],
      reason: "Narration matches what happens on video.",
    },
  ],
  duplicate: { status: "clear", matches: [] },
  recommendation: "accept",
  warnings: [],
};

// A cropped re-upload of the retake. The criteria still pass, so only the duplicate check stops it.
export const CATCH_REPORT_DUPLICATE: VerificationReport = {
  ...CATCH_REPORT_RETAKE,
  reportId: "illustrative-report-catch-003",
  submissionId: "illustrative-submission-003",
  source: { sha256: "c3a91f5e7b2d0a8c4e6f1b9d3a5c7e0f2b4d6a8c1e3f5b7d9a0c2e4f6b8d1a3c", durationMs: 13600 },
  duplicate: { status: "suspected", matches: [{ submissionId: "illustrative-submission-002", score: 0.96, overlapMs: 13600 }] },
  recommendation: "needs_review",
  warnings: [ILLUSTRATIVE_WARNING],
};

// The hand hides the set-down, so placement cannot be judged either way and a person decides.
export const CATCH_REPORT_UNOBSERVABLE: VerificationReport = {
  ...CATCH_REPORT_RETAKE,
  reportId: "illustrative-report-catch-004",
  submissionId: "illustrative-submission-004",
  source: { sha256: "7e1d5b9f3a0c6e2b8d4f1a7c5e9b3d0f6a2c8e4b1d7f3a9c5e0b6d2f8a4c1e7b", durationMs: 12400 },
  pipeline: { ...CATCH_REPORT_MISMATCH.pipeline, status: "needs_review" },
  criteria: [
    CATCH_REPORT_RETAKE.criteria[0]!,
    {
      criterionId: "placed-on-coaster",
      status: "unobservable",
      evidence: [{ modality: "video", startMs: 6800, endMs: 8600, claim: "Left hand covers coaster while cup is set down." }],
      reason: "Target is hidden at moment of placement.",
    },
    {
      criterionId: "narration-alignment",
      status: "supported",
      evidence: [
        { modality: "audio", startMs: 6500, endMs: 8400, claim: "Narration: \"Setting it on a coaster.\"" },
        { modality: "video", startMs: 6800, endMs: 8600, claim: "Red cup moves toward coaster." },
      ],
      reason: "Narration matches visible motion.",
    },
  ],
  recommendation: "needs_review",
  warnings: [ILLUSTRATIVE_WARNING],
};

export type CatchCard = {
  id: string;
  status: EvidenceStatus;
  title: string;
  result: string;
  report: VerificationReport;
  provenance: EvidenceStatus;
  href?: string; // set once the dashboard review view exists
};

export const CATCH_CARDS: CatchCard[] = [
  { id: "mismatch", status: "HELD", title: "If narration and video disagree, payment is held", result: "Held for a retake", report: CATCH_REPORT_MISMATCH, provenance: "SIMULATED" },
  { id: "retake", status: "ACCEPTED", title: "If everything matches, contributor gets paid", result: "Paid 7.50 after approval", report: CATCH_REPORT_RETAKE, provenance: "SIMULATED" },
  { id: "duplicate", status: "DUPLICATE", title: "Reused footage gets flagged as a copy", result: "Flagged, no second payment", report: CATCH_REPORT_DUPLICATE, provenance: "SIMULATED" },
  { id: "unobservable", status: "REVIEW", title: "Human review required if AI can't verify a clip", result: "Sent to human review", report: CATCH_REPORT_UNOBSERVABLE, provenance: "SIMULATED" },
];
