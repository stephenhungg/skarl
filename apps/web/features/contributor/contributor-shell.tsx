"use client";
import { useQuery } from "convex/react";
import type { ReactNode } from "react";
import { useConvexConfig } from "@/components/convex-provider";
import { AppShell, type Counts, type ShellConfig } from "@/features/dashboard/shell";
import { DEMO_IDENTITY, refs, type Payable, type Submission } from "./api";

const NAV: ShellConfig["nav"] = [{ items: [
  { href: "/contribute", label: "Record", icon: "desktop" },
  { href: "/contribute/clips", label: "My clips", icon: "folder", count: "retake", loud: true },
  { href: "/contribute/earnings", label: "Earnings", icon: "coins" },
] }];

export const CONTRIBUTOR_SHELL: ShellConfig = {
  home: "/contribute", role: "Contributor", homeLabel: "Record", nav: NAV, mobile: NAV[0]!.items,
  titles: { clips: "My clips", earnings: "Earnings" },
  switchTo: { label: "Open controller view", href: "/dashboard" },
};

/** The contributor's live clips and payables, shared by the shell counts and the pages. */
export function useContributorData() {
  const context = useQuery(refs.demoContext, { demoIdentity: DEMO_IDENTITY });
  const args = context ? { demoIdentity: DEMO_IDENTITY, orderId: context.orderId } : "skip";
  const summary = useQuery(refs.orderSummary, args);
  const history = useQuery(refs.submissions, args) as Submission[] | undefined;
  const payables = useQuery(refs.payables, args) as Payable[] | undefined;
  return { context, summary, history, payables };
}

function ContributorCounts({ children }: { children: (counts: Counts) => ReactNode }) {
  const { history } = useContributorData();
  // A requested retake is the one thing that waits on the contributor.
  return children({ retake: (history ?? []).filter(s => s.status === "needs_correction").length });
}

export function ContributorShell({ children }: { children: ReactNode }) {
  const { status } = useConvexConfig();
  return status === "ready"
    ? <ContributorCounts>{counts => <AppShell config={CONTRIBUTOR_SHELL} counts={counts}>{children}</AppShell>}</ContributorCounts>
    : <AppShell config={CONTRIBUTOR_SHELL} counts={{}}>{children}</AppShell>;
}
