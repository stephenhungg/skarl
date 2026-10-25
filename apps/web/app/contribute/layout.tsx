import type { ReactNode } from "react";
import "@/components/glaze/styles.css";
import "@/features/dashboard/skarl-theme.css";
import { skarlMono, skarlSans } from "@/features/dashboard/fonts";
import { ContributorShell } from "@/features/contributor/contributor-shell";

// Authentication and the Convex client are shared by the root layout.
export default function ContributeLayout({ children }: { children: ReactNode }) {
  return <div className={`${skarlSans.variable} ${skarlMono.variable}`}><ContributorShell>{children}</ContributorShell></div>;
}
