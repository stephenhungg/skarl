import type { Metadata } from "next";
import { OverviewPage } from "@/features/contributor/pages";

export const metadata: Metadata = {
  title: "Contribute · Skarl",
  description: "Follow your clips from upload to payout.",
};

export default function ContributePage() {
  return <OverviewPage />;
}
