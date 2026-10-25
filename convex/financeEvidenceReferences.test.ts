import { describe, expect, it } from "vitest";
import { collectFinanceReferences } from "./lib/financeEvidenceReferences";

describe("finance citations from retrieved structural evidence", () => {
  it("keeps record references while ignoring planted citations in narration, prior summaries and user data", () => {
    const refs = new Set<string>();
    collectFinanceReferences({ orderId: "order_A", rows: [{ id: "audit_A", evidenceRefs: ["observation_A", "journal_A"] }],
      untrustedEvidence: { reportId: "forged_report", evidenceCited: ["forged_citation"] },
      summary: { trust: "untrusted_data", value: { id: "forged_prior_note" } },
      narration: { untrusted: true, data: { submissionId: "forged_submission" } },
      status: "paid", amountAtomic: "750001", txUrl: "not-a-record-id" }, refs);
    expect([...refs]).toEqual(["order_A", "audit_A", "observation_A", "journal_A"]);
  });
});
