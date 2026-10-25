"use client";
import { use } from "react";
import { ClipDetailPage } from "@/features/contributor/clip-detail";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ClipDetailPage submissionId={id} />;
}
