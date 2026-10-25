"use client";
import { Ledger } from "@/features/dashboard/ledger";
import { RequireConvex } from "@/features/dashboard/ui";

export default function LedgerPage() {
  return <RequireConvex><Ledger /></RequireConvex>;
}
