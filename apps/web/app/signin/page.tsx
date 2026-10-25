"use client";
import Link from "next/link";
import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexConfig } from "@/components/convex-provider";
import { LogoMark } from "@/components/logo-mark";
import { AccountMenu, RoleClaims } from "@/features/auth/account-menu";
import { useSession } from "@/features/auth/session";
import { QueryBoundary } from "@/features/dashboard/ui";

export default function SignInPage() {
  const config = useConvexConfig();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-paper px-6 text-ink">
      <div className="flex w-full max-w-[410px] flex-col items-center text-center">
        <Link href="/" aria-label="Skarl home" className="mb-6 grid size-[56px] place-items-center rounded-[14px] bg-ink text-paper">
          <LogoMark size={16} />
        </Link>
        {config.status === "ready" ? <QueryBoundary><SignInForm /></QueryBoundary> : <h1 className="cut-medium text-[26px] leading-none">Sign in is offline</h1>}
      </div>
    </main>
  );
}

function SignInForm() {
  const { signIn } = useAuthActions();
  const { me, isLoading } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function google() {
    setBusy(true);
    setError(false);
    try { await signIn("google", { redirectTo: "/signin" }); }
    catch { setError(true); setBusy(false); }
  }

  if (isLoading || me === undefined) return <p role="status" className="cut-regular text-[15px] text-slate-700">Checking your account…</p>;
  if (me.userId) return <section>
    <div className="mb-8 flex items-start justify-between gap-3"><h1 className="cut-medium text-[32px] tracking-[-.02em]">Pick a role</h1><AccountMenu /></div>
    <RoleClaims />
    <div className="mt-8 flex flex-wrap gap-3">
      <Link href="/dashboard" className="cut-medium rounded-[10px] bg-accent px-5 py-3 text-accent-ink">Open console</Link>
      <Link href="/contribute" className="cut-regular rounded-[10px] bg-mist px-5 py-3">Contribute</Link>
    </div>
  </section>;

  return <section className="flex w-full flex-col items-center">
    <h1 className="cut-medium mb-3 text-[26px] leading-none">Sign in to Skarl</h1>
    <p className="cut-regular mb-7 text-[15px] leading-snug text-slate-700">Verified human demonstrations, paid in USDC.</p>
    <button type="button" disabled={busy} onClick={() => void google()} className="cut-medium flex h-[50px] w-full items-center justify-center gap-2.5 rounded-[12px] border border-haze bg-white px-5 text-[15px] shadow-sm transition hover:bg-mist disabled:opacity-60">
      <GoogleMark />
      {busy ? "Redirecting…" : "Continue with Google"}
    </button>
    {error && <p role="alert" className="mt-4 text-sm text-red-600">Couldn’t reach Google, try again.</p>}
    {me.demoMode && <p className="mt-6 text-[13px] leading-relaxed text-slate-700">No account? <Link href="/dashboard" className="text-ink underline underline-offset-4">View the demo</Link></p>}
  </section>;
}

function GoogleMark() {
  return <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>;
}
