"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { useConvexConfig } from "@/components/convex-provider";
import { AccountMenu, RoleClaims } from "./account-menu";
import { useSession } from "./session";
import { QueryBoundary } from "@/features/dashboard/ui";

export function DashboardAccess({ children }: { children: ReactNode }) {
  const config = useConvexConfig();
  if (config.status !== "ready") return children;
  return <QueryBoundary><ConnectedDashboardAccess>{children}</ConnectedDashboardAccess></QueryBoundary>;
}

function ConnectedDashboardAccess({ children }: { children: ReactNode }) {
  const { me, isLoading } = useSession();
  if (isLoading || me === undefined) return <div className="frame py-24" role="status">Checking access…</div>;
  if (me.userId && me.roles.includes("controller")) return children;
  if (!me.userId && me.demoMode) return <>
    <div className="relative z-40 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-haze bg-accent px-4 py-2 text-center text-[13px] text-accent-ink">
      <span className="cut-medium">Demo identity</span>
      <span>You are viewing the labeled demo controller. Demo selectors are public.</span>
      <Link href="/signin" className="cut-regular underline underline-offset-4">Sign in with your own account</Link>
    </div>
    {children}
  </>;
  return (
    <main className="frame min-h-dvh py-8">
      <header className="mb-20 flex items-center justify-between"><Link href="/" className="cut-medium text-xl">Skarl</Link><AccountMenu /></header>
      <section className="mx-auto max-w-lg rounded-[20px] border border-haze bg-paper p-8">
        <p className="mono mb-4 text-xs text-slate-700">Controller console</p>
        <h1 className="cut-medium mb-4 text-3xl">Controller access required</h1>
        <p className="mb-5 leading-relaxed text-slate-700">{me.userId
          ? "Your account does not have the controller role. A demo identity cannot grant access to a signed-in account."
          : "Demo identities are disabled. Sign in with an authorized controller account to open the console."}</p>
        {me.userId ? <RoleClaims /> : <Link href="/signin" className="cut-medium inline-flex rounded-[10px] bg-accent px-5 py-3 text-accent-ink">Sign in</Link>}
        <Link href="/contribute" className="mt-6 block text-sm underline underline-offset-4">Open contributor view</Link>
      </section>
    </main>
  );
}
