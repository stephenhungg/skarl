import type { Metadata } from "next";
import { ContributorEarnings } from "@/features/contributor/earnings-page";

export const metadata: Metadata = {
  title: "Your submissions & earnings · Skarl",
  description: "Follow your submission evidence, review decisions and confirmed payouts.",
};

export default function EarningsPage() {
  return <ContributorEarnings />;
}
