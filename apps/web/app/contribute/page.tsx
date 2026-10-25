import type { Metadata } from "next";
import { SiteNav } from "@/components/site-nav";
import { ContributeFlow } from "@/features/contributor/contribute-flow";

export const metadata: Metadata = {
  title: "Contribute · Skarl",
  description: "Record a task video, upload it privately and follow its review.",
};

export default function ContributePage() {
  return (
    <>
      <SiteNav />
      <ContributeFlow />
    </>
  );
}
