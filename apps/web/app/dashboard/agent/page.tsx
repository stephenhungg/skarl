"use client";
import { Agent } from "@/features/dashboard/agent";
import { RequireConvex } from "@/features/dashboard/ui";

export default function AgentPage() {
  return <RequireConvex><Agent /></RequireConvex>;
}
