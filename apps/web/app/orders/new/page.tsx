"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { LogoMark } from "@/components/logo-mark";
import { formatUsdc } from "@/features/dashboard/format";

type CreatedOrder = { orderId: string; fundUrl: string; amountAtomic: string };

export default function NewOrderPage() {
  const [enabled, setEnabled] = useState(true);
  const [cap, setCap] = useState("1000000");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<CreatedOrder | null>(null);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoPay: { enabled, maxPerClipAtomic: cap, requireAllChecks: true } }) });
      const value = await response.json();
      if (!response.ok || typeof value.orderId !== "string" || typeof value.fundUrl !== "string") {
        throw new Error(response.status === 429 ? "Demo order limit reached. Try again later." : "Order creation is unavailable. Please retry.");
      }
      setCreated(value);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create the order."); }
    finally { setBusy(false); }
  }

  return <main className="frame min-h-dvh py-8">
    <Link href="/" className="cut-medium flex items-center gap-2 text-xl"><LogoMark size={8} />Skarl</Link>
    <section className="mx-auto mt-16 max-w-xl rounded-[20px] border border-haze bg-paper p-8">
      <p className="mono text-xs text-slate-700">Base Sepolia · test USDC only</p>
      <h1 className="cut-medium mt-3 text-3xl">Post a task</h1>
      <p className="mt-4 leading-relaxed text-slate-700">This demo buys one narrated demonstration for 1 USDC using the fixed demo rubric. Contributors see its exact objects and ordered steps before recording.</p>
      {created ? <div className="mt-6" role="status">
        <p className="cut-medium">Order created. Funding is still required.</p>
        <p className="mono mt-2 break-all text-sm">{created.orderId}</p>
        <p className="mt-3 text-sm text-slate-700">Use your x402 wallet to POST the funding URL with a maximum of {formatUsdc(created.amountAtomic)} test USDC. Inspect the quote before paying.</p>
        <p className="mono mt-3 break-all rounded-[10px] bg-mist p-3 text-xs">{created.fundUrl}</p>
        <Link href={`/dashboard?orderId=${encodeURIComponent(created.orderId)}`} className="cut-medium mt-5 inline-block underline underline-offset-4">Open buyer Review</Link>
      </div> : <form onSubmit={create} className="mt-6 flex flex-col gap-4">
        <label className="cut-medium flex items-center gap-3"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />Auto-pay when every check passes</label>
        <label className="flex flex-col gap-2 text-sm">Maximum payout per clip, in micro-USDC
          <input className="mono rounded-[10px] border border-haze bg-paper px-3 py-2" inputMode="numeric" pattern="[1-9][0-9]*" required value={cap} onChange={event => setCap(event.target.value)} />
        </label>
        <p className="text-sm leading-relaxed text-slate-700">1 USDC = 1,000,000 micro-USDC. Creating this order records your rule. AI supplies evidence; deterministic policy approves within your cap. Failed checks and over-cap payouts go to your review queue.</p>
        {error ? <p role="alert" className="text-sm">{error}</p> : null}
        <button disabled={busy} className="cut-medium rounded-[10px] bg-accent px-5 py-3 text-accent-ink disabled:opacity-50">{busy ? "Creating…" : "Create order with this rule"}</button>
      </form>}
    </section>
  </main>;
}
