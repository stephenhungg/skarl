"use client";
import { Reconciliation } from "@/features/dashboard/reconciliation";
import { RequireConvex } from "@/features/dashboard/ui";

export default function ReconciliationPage() {
  return <RequireConvex><Reconciliation /></RequireConvex>;
}
