"use client";
import { ScenarioLab } from "@/features/dashboard/scenario-lab";
import { RequireConvex } from "@/features/dashboard/ui";

export default function ScenariosPage() {
  return <RequireConvex><ScenarioLab /></RequireConvex>;
}
