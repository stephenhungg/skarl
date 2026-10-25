"use client";
import { NeedsYouList } from "@/features/dashboard/overview";
import { useOrderData, useOrderId } from "@/features/dashboard/data";
import { Loading, PageHeader, RequireConvex } from "@/features/dashboard/ui";

function Inbox() {
  const orderId = useOrderId();
  const { submissions, payables } = useOrderData(orderId);
  return (
    <>
      <PageHeader title="Needs you" />
      {orderId ? <NeedsYouList standalone orderId={orderId} submissions={submissions} payables={payables} /> : <Loading />}
    </>
  );
}

export default function InboxPage() {
  return <RequireConvex><Inbox /></RequireConvex>;
}
