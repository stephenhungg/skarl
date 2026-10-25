"use client";
import { use } from "react";
import dynamic from "next/dynamic";
import { Review } from "@/features/dashboard/review";
import type { Id } from "@/features/dashboard/data";
import { QueryBoundary, RequireConvex } from "@/features/dashboard/ui";

const ReplayStudio = dynamic(() => import("@/features/replay/studio"), {
  ssr: false,
  loading: () => <p className="mt-8 type-body-sm text-text-3">Loading replay studio…</p>,
});

export default function SubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <RequireConvex>
    <div className="mb-3"><a href="#replay-studio-title" className="type-label text-text-2 underline underline-offset-4">Open replay studio</a></div>
    <Review submissionId={id as Id<"submissions">} />
    <QueryBoundary key={id}><ReplayStudio submissionId={id as Id<"submissions">} /></QueryBoundary>
  </RequireConvex>;
}
