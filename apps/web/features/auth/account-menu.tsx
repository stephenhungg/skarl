"use client";
import Link from "next/link";
import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation } from "convex/react";
import { useConvexConfig } from "@/components/convex-provider";
import { api } from "../../../../convex/_generated/api";
import { useSession } from "./session";

type HumanRole = "buyer" | "contributor" | "controller";
const actionClass = "block w-full rounded-[8px] px-3 py-2 text-left text-[14px] hover:bg-mist disabled:opacity-50";

export function AccountMenu({ onDark = false }: { onDark?: boolean }) {
  const config = useConvexConfig();
  if (config.status !== "ready") return <Link href="/signin" className="cut-regular text-[14px]">Sign in</Link>;
  return <ConnectedAccountMenu onDark={onDark} />;
}

function ConnectedAccountMenu({ onDark }: { onDark: boolean }) {
  const { me, isLoading } = useSession();
  const { signOut } = useAuthActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (isLoading || me === undefined) return <span className="mono text-[12px] opacity-60">Account…</span>;
  if (!me.userId) return <Link href="/signin" className={`cut-regular rounded-[8px] px-3 py-2 text-[14px] ${onDark ? "text-paper hover:bg-paper/10" : "text-ink hover:bg-mist"}`}>Sign in</Link>;

  async function logOut() {
    setBusy(true);
    setError("");
    try { await signOut(); } catch { setError("Could not sign out. Please try again."); }
    finally { setBusy(false); }
  }

  return (
    <details className="relative">
      <summary className={`cut-regular max-w-48 cursor-pointer truncate rounded-[8px] px-3 py-2 text-[14px] ${onDark ? "text-paper hover:bg-paper/10" : "text-ink hover:bg-mist"}`}>
        {me.email || "Your account"}
      </summary>
      <div className="absolute right-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-[14px] border border-haze bg-paper p-3 text-ink shadow-xl">
        <p className="cut-medium break-all px-3 pt-1 text-[14px]">{me.email || "Signed in"}</p>
        <p className="mono mb-3 px-3 pt-1 text-[11px] text-slate-700">{me.roles.length ? me.roles.join(" · ") : "No role claimed"}</p>
        <RoleClaims />
        <div className="mt-2 border-t border-haze pt-2">
          <Link href="/dashboard" className={actionClass}>Controller console</Link>
          <Link href="/contribute" className={actionClass}>Contributor view</Link>
          <button type="button" className={actionClass} disabled={busy} onClick={() => void logOut()}>{busy ? "Signing out…" : "Sign out"}</button>
        </div>
        {error && <p role="alert" className="px-3 pt-2 text-[13px]">{error}</p>}
      </div>
    </details>
  );
}

export function RoleClaims() {
  const { me } = useSession();
  const claimRole = useMutation(api.auth.memberships.claimRole);
  const [busy, setBusy] = useState<HumanRole | null>(null);
  const [error, setError] = useState("");
  if (!me?.userId) return null;
  const roles: HumanRole[] = ["buyer"];
  if (!me.roles.includes("controller")) roles.push("contributor");
  if (me.canClaimController && !me.roles.includes("contributor")) roles.push("controller");
  const available = roles.filter(role => !me.roles.includes(role));

  async function claim(role: HumanRole) {
    setBusy(role);
    setError("");
    try { await claimRole({ role }); }
    catch { setError("Role claim refused. Controller access needs an allowlisted, verified email; contributor and controller roles must stay separate."); }
    finally { setBusy(null); }
  }

  return (
    <div>
      {available.length > 0 && <p className="mono px-3 pb-1 text-[10px] uppercase tracking-wider text-slate-700">Choose your role</p>}
      {available.map(role => <button key={role} type="button" disabled={busy !== null} className={actionClass} onClick={() => void claim(role)}>
        {busy === role ? "Claiming…" : `Claim ${role} role`}
      </button>)}
      {!me.roles.includes("controller") && !me.canClaimController && <p className="px-3 pt-2 text-[12px] leading-relaxed text-slate-700">Controller access requires a verified email on the operator’s allowlist.</p>}
      {error && <p role="alert" className="px-3 pt-2 text-[13px]">{error}</p>}
    </div>
  );
}
