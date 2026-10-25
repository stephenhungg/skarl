/** Dated external observations, never current production configuration. */
export const evidenceSource = "https://github.com/stephenhungg/skarl/blob/main/docs/status.md#live-retry-after-recovery-deployment--october-25-2026-0305-pdt";

/** Dated external evidence, not a claim about today's wallet balance or policy. */
export const recordedWalletEvidence = {
  recordedAt: "2026-10-25T03:05:00-07:00", sourceUrl: evidenceSource,
  address: "0x0A9EfDF66c58543538824906aE267B969Ed651c5",
  policyId: "fa62ac94-e420-4013-bb4f-2dcab18deb7b", capAtomic: "2000000",
  rejections: [
    { kind: "over_cap", amountAtomic: "2000001", status: 403, code: "policy_violation", correlationId: "a5006791aba9be62-IAD" },
    { kind: "non_allowlisted_recipient", amountAtomic: "100000", status: 403, code: "policy_violation", correlationId: "a500679519ddbe62-IAD" },
  ],
};
