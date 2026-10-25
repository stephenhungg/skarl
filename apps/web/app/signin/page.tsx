"use client";
import Link from "next/link";
import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexConfig } from "@/components/convex-provider";
import { Wordmark } from "@/components/wordmark";
import { AccountMenu, RoleClaims } from "@/features/auth/account-menu";
import { useSession } from "@/features/auth/session";
import { QueryBoundary } from "@/features/dashboard/ui";

export default function SignInPage() {
  const config = useConvexConfig();
  return (
    <main className="min-h-dvh bg-paper px-6 py-8 text-ink">
      <header className="mx-auto flex max-w-[1200px] items-center justify-between">
        <Link href="/" aria-label="Skarl home"><Wordmark /></Link>
        <Link href="/dashboard" className="cut-regular rounded-[10px] bg-mist px-5 py-2 text-[14px] hover:bg-haze">Open console</Link>
      </header>
      <div className="mx-auto max-w-[440px] pt-[min(14vh,120px)]">
        {config.status === "ready" ? <QueryBoundary><SignInForm /></QueryBoundary> : <h1 className="cut-medium text-center text-[32px] tracking-[-.02em]">Sign in is offline</h1>}
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

  if (isLoading || me === undefined) return null;
  if (me.userId) return <section>
    <div className="mb-8 flex items-start justify-between gap-3"><h1 className="cut-medium text-[32px] tracking-[-.02em]">Pick a role</h1><AccountMenu /></div>
    <RoleClaims />
    <div className="mt-8 flex flex-wrap gap-3">
      <Link href="/dashboard" className="cut-medium rounded-[10px] bg-accent px-5 py-3 text-accent-ink">Open console</Link>
      <Link href="/contribute" className="cut-regular rounded-[10px] bg-mist px-5 py-3">Contribute</Link>
    </div>
  </section>;

  return <section className="text-center">
    <h1 className="cut-medium mb-8 text-[32px] tracking-[-.02em]">Sign in to Skarl</h1>
    <button type="button" disabled={busy} onClick={() => void google()} className="cut-regular inline-flex h-12 w-full items-center justify-center gap-3 rounded-[10px] border border-haze bg-paper text-[15px] transition-colors hover:bg-mist disabled:opacity-50">
      <GoogleMark />
      Continue with Google
    </button>
    {error && <p role="alert" className="mt-4 text-sm text-slate-700">Couldn’t reach Google, try again.</p>}
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
