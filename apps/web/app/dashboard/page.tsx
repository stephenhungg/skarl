"use client";
import { Overview } from "@/features/dashboard/overview";
import { RequireConvex } from "@/features/dashboard/ui";

export default function DashboardPage() {
  return <RequireConvex><Overview /></RequireConvex>;
}
