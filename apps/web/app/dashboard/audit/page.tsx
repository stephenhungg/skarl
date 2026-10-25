"use client";
import { Audit } from "@/features/dashboard/audit";
import { RequireConvex } from "@/features/dashboard/ui";

export default function AuditPage() {
  return <RequireConvex><Audit /></RequireConvex>;
}
