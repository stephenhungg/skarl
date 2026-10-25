"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
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
        {config.status === "ready" ? <QueryBoundary><SignInForm /></QueryBoundary> : <section className="rounded-[20px] border border-haze p-8">
          <h1 className="cut-medium mb-3 text-3xl">Sign-in unavailable</h1>
          <p className="text-slate-700">Configure NEXT_PUBLIC_CONVEX_URL to connect authentication to your Convex deployment.</p>
        </section>}
      </div>
    </main>
  );
}

function SignInForm() {
  const { signIn } = useAuthActions();
  const { me, isLoading } = useSession();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try { await signIn("password", data); }
    catch { setError(flow === "signIn" ? "Could not sign in. Check your email and password, then try again." : "Could not create your account. Use a valid email and a password with at least 8 characters, or try signing in."); }
    finally { setBusy(false); }
  }

  async function github() {
    setBusy(true);
    setError("");
    try { await signIn("github", { redirectTo: "/signin" }); }
    catch { setError("GitHub sign-in is unavailable. Please try email and password."); }
    finally { setBusy(false); }
  }

  if (isLoading || me === undefined) return <p role="status" className="mono text-sm text-slate-700">Checking your account…</p>;
  if (me.userId) return <section className="rounded-[20px] border border-haze p-8">
    <div className="mb-8 flex items-start justify-between gap-3"><h1 className="cut-medium text-3xl">You’re signed in.</h1><AccountMenu /></div>
    <p className="mb-5 text-slate-700">Choose a role to get started. Roles belong to your account, and are checked by the server.</p>
    <RoleClaims />
    <div className="mt-8 flex flex-wrap gap-3">
      <Link href="/dashboard" className="cut-medium rounded-[10px] bg-accent px-5 py-3 text-accent-ink">Open console</Link>
      <Link href="/contribute" className="cut-regular rounded-[10px] bg-mist px-5 py-3">Contribute</Link>
    </div>
  </section>;

  return <section>
    <p className="mono mb-4 text-[12px] uppercase tracking-[.1em] text-slate-700">Your work. Your account.</p>
    <h1 className="cut-medium mb-3 text-[40px] leading-[1.1] tracking-[-.025em]">{flow === "signIn" ? "Welcome back." : "Make it yours."}</h1>
    <p className="mb-9 leading-relaxed text-slate-700">{flow === "signIn" ? "Sign in to contribute or manage verified demonstrations." : "Create an account, then choose your role in Skarl."}</p>
    <form onSubmit={event => void submit(event)} className="space-y-5">
      <input type="hidden" name="flow" value={flow} />
      <label className="cut-regular block text-[14px]">Email
        <input type="email" name="email" autoComplete="email" required className="cut-book mt-2 block h-12 w-full rounded-[10px] border border-haze bg-paper px-4 text-[16px] outline-offset-2" />
      </label>
      <label className="cut-regular block text-[14px]">Password
        <input type="password" name="password" minLength={8} autoComplete={flow === "signIn" ? "current-password" : "new-password"} required className="cut-book mt-2 block h-12 w-full rounded-[10px] border border-haze bg-paper px-4 text-[16px] outline-offset-2" />
      </label>
      {flow === "signUp" && <p className="text-[12px] text-slate-700">Use at least 8 characters. Email verification and password recovery are not configured for this demo.</p>}
      {error && <p role="alert" className="rounded-[10px] border border-haze bg-mist p-3 text-sm">{error}</p>}
      <button disabled={busy} type="submit" className="cut-medium h-12 w-full rounded-[10px] bg-accent text-[16px] text-accent-ink transition-colors hover:bg-haze disabled:opacity-50">{busy ? "Please wait…" : flow === "signIn" ? "Sign in" : "Create account"}</button>
    </form>
    {me.githubEnabled && <button type="button" disabled={busy} onClick={() => void github()} className="cut-regular mt-3 h-12 w-full rounded-[10px] border border-haze bg-paper text-[15px] hover:bg-mist disabled:opacity-50">Continue with GitHub</button>}
    <p className="mt-6 text-center text-[14px] text-slate-700">{flow === "signIn" ? "New to Skarl? " : "Already have an account? "}<button disabled={busy} type="button" className="cut-regular text-ink underline underline-offset-4" onClick={() => { setFlow(flow === "signIn" ? "signUp" : "signIn"); setError(""); }}>{flow === "signIn" ? "Create an account" : "Sign in"}</button></p>
    {me.demoMode && <p className="mt-9 rounded-[10px] border border-haze bg-mist p-4 text-[13px] leading-relaxed text-slate-700">The public demo is still available without signing in. <Link href="/dashboard" className="text-ink underline underline-offset-4">View with a demo identity</Link>.</p>}
  </section>;
}
