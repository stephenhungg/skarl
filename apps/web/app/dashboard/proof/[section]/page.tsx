"use client";
import { notFound, useParams } from "next/navigation";
import { ProofSection } from "@/features/dashboard/proof/proof";
import { isProofSlug } from "@/features/dashboard/proof/sections";
import { RequireConvex } from "@/features/dashboard/ui";

export default function ProofSectionPage() {
  const { section } = useParams<{ section: string }>();
  if (!isProofSlug(section)) notFound();
  return <RequireConvex><ProofSection slug={section} /></RequireConvex>;
}
