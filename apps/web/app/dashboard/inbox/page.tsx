"use client";
import { ConsentRevocations } from "@/features/dashboard/consent-revocations";
import { NeedsYouList } from "@/features/dashboard/overview";
import { useOrderData, useOrderId } from "@/features/dashboard/data";
import { Loading, PageHeader, QueryBoundary, RequireConvex } from "@/features/dashboard/ui";

function Inbox() {
  const orderId = useOrderId();
  const { submissions, payables } = useOrderData(orderId);
  return (
    <>
      <PageHeader title="Needs you" description="Reviews, approvals, signatures and reconciliation exceptions that wait on a controller." />
      {orderId ? <NeedsYouList standalone orderId={orderId} submissions={submissions} payables={payables} /> : <Loading />}
      <QueryBoundary><ConsentRevocations /></QueryBoundary>
    </>
  );
}

export default function InboxPage() {
  return <RequireConvex><Inbox /></RequireConvex>;
}
