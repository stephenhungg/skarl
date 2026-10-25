"use client";
import { use } from "react";
import { LiveReceipt } from "@/features/dashboard/live-receipt";
import type { Id } from "@/features/dashboard/data";
import { RequireConvex } from "@/features/dashboard/ui";

export default function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <RequireConvex><LiveReceipt submissionId={id as Id<"submissions">} /></RequireConvex>;
}
