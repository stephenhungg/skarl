import type { EvidenceStatus } from "@/components/status-pill";

// Everything the landing claims lives here, so a row flips from SIMULATED to LIVE in one line.

export const DEMO_VIDEO_URL: string | null = null; // set once the 3 minute demo is uploaded

export const SETTLEMENT = {
  status: "PLANNED" as EvidenceStatus,
  label: "Base Sepolia settlement",
  detail: "not yet observed",
};

export type ProofRow = { date: string; title: string; summary: string; status: EvidenceStatus; href?: string };

export const PROOF_LOG: ProofRow[] = [
  {
    date: "10.25",
    title: "Finance fixture balances in the ledger tests",
    summary: "100 prepaid, 7.50 accrued and paid, 90 refunded, 2.50 left. Debits equal credits at every step.",
    status: "SIMULATED",
    href: "https://github.com/stephenhungg/skarl/blob/main/docs/accounting.md",
  },
];
