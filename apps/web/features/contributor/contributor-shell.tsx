"use client";
import { Component, type ReactNode } from "react";
import { useConvexConfig } from "@/components/convex-provider";
import { AppShell, type Counts, type ShellConfig } from "@/features/dashboard/shell";
import { useClips } from "./data";

const NAV: ShellConfig["nav"] = [{ items: [
  { href: "/contribute", label: "Overview", icon: "bar-chart-vertical-grow" },
  { href: "/contribute/clips", label: "My clips", icon: "folder", count: "retake", loud: true },
  { href: "/contribute/earnings", label: "Earnings", icon: "coins" },
] }];

export const CONTRIBUTOR_SHELL: ShellConfig = {
  home: "/contribute", role: "Contributor", homeLabel: "Overview", nav: NAV, mobile: NAV[0]!.items,
  titles: { clips: "My clips", earnings: "Earnings" },
  switchTo: { label: "Open controller view", href: "/dashboard" },
};

function ContributorCounts({ children }: { children: (counts: Counts) => ReactNode }) {
  const { clips } = useClips();
  // A requested retake is the one thing that waits on the contributor.
  return children({ retake: (clips ?? []).filter(clip => clip.status === "needs_correction").length });
}

/** A failed count query must not take the whole shell down; pages show the error themselves. */
class CountsBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function ContributorShell({ children }: { children: ReactNode }) {
  const { status } = useConvexConfig();
  const plain = <AppShell config={CONTRIBUTOR_SHELL} counts={{}}>{children}</AppShell>;
  return status === "ready"
    ? <CountsBoundary fallback={plain}><ContributorCounts>{counts => <AppShell config={CONTRIBUTOR_SHELL} counts={counts}>{children}</AppShell>}</ContributorCounts></CountsBoundary>
    : plain;
}
