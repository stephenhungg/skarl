"use client";
import { use } from "react";
import { Review } from "@/features/dashboard/review";
import type { Id } from "@/features/dashboard/data";
import { RequireConvex } from "@/features/dashboard/ui";

export default function SubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <RequireConvex><Review submissionId={id as Id<"submissions">} /></RequireConvex>;
}
