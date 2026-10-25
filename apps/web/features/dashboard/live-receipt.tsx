"use client";
import { useQuery } from "convex/react";
import { AssetReceiptView } from "@/features/receipt/receipt";
import { api, CONTROLLER, useAudit, useOrderData, useOrderId, useReconciliation, type Id } from "./data";
import { toAssetReceipt } from "./asset-receipt";
import { Loading, Unavailable } from "./ui";

/** Silas's asset receipt, filled from this clip's live records instead of the sample data. */
export function LiveReceipt({ submissionId }: { submissionId: Id<"submissions"> }) {
  const orderId = useOrderId();
  const { submissions, payables } = useOrderData(orderId);
  const audit = useAudit(orderId);
  const reconciliation = useReconciliation(orderId);
  const report = useQuery(api.submissions.getReport, { demoIdentity: CONTROLLER, submissionId });
  const media = useQuery(api.media.submissionEvidence, { demoIdentity: CONTROLLER, submissionId });
  const submission = submissions?.find(s => s._id === submissionId);
  if (submissions !== undefined && !submission) return <Unavailable title="Clip not found" description="It is not part of the staged order." />;
  if (!submission || report === undefined || media === undefined || audit === undefined) return <Loading rows={8} />;
  const payable = payables?.find(p => p.submissionId === submissionId);
  const paid = reconciliation?.matches.find(m => payable && (m.eventKey.includes(payable._id) || (payable.intent && m.eventKey.includes(payable.intent.intentId))));
  const receipt = toAssetReceipt({ submission, report, clip: media.clip, audit, payable, paidChainIdentity: paid?.chainIdentity });
  return (
    <div className="-mx-4 md:-mx-6">
      <AssetReceiptView receipt={receipt} path={`/dashboard/submissions/${submissionId}/receipt`} />
    </div>
  );
}
