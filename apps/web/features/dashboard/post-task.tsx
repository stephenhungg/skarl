"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState, type ReactNode } from "react";
import { createWalletClient, custom, type EIP1193Provider } from "viem";
import { baseSepolia } from "viem/chains";
import { Button } from "@/components/glaze/ui/button";
import { StatusMark } from "@/components/glaze/ui/status";
import { Switch } from "@/components/glaze/ui/switch";
import { toast } from "@/components/glaze/ui/toast";
import { cn } from "@/lib/glaze/utils";
import { fundOrderInBrowser, type FundingStep } from "@/lib/payments/fund-browser";
import { api, BUYER, chooseOrder, type Id } from "./data";
import { formatUsdc, humanize, shortHash } from "./format";
import { Amount, PageHeader } from "./ui";

const EXAMPLE = {
  title: "Pick up a red cup and place it on the coaster",
  prompt: "Film with the back camera, phone held steady. Pick up the red cup with one hand, place it on the coaster, and say out loud what you are doing as you do it.",
  checks: ["A red cup is picked up by hand", "The cup ends up on the coaster", "The narration matches what the hands do"],
};
const DAYS = [1, 3, 7] as const;
const STEP_LABEL: Record<FundingStep, string> = {
  checking: "Checking the quote", connecting: "Connecting your wallet", signing: "Approve the payment in your wallet",
  settling: "Settling on Base Sepolia", reconciling: "Checking an earlier payment",
};

/** Decimal USDC text to exact micro-USDC digits, or null. Never goes through a float. */
function toAtomic(text: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{0,6}))?$/.exec(text.trim().replaceAll(",", ""));
  if (!match) return null;
  const atomic = BigInt(match[1]!) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0") || "0");
  return atomic > 0n ? atomic : null;
}
const slug = (text: string, index: number) => `${text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "check"}-${index + 1}`;
const injected = () => (typeof window === "undefined" ? null : (window as unknown as { ethereum?: EIP1193Provider }).ethereum ?? null);

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="type-label">{label}</span>
      {children}
      {hint && <span className="type-body-sm text-text-3">{hint}</span>}
    </label>
  );
}
const input = "rounded-tag border border-line-control bg-paper px-3 py-2 type-body outline-none focus:border-line-focus";

export function PostTask() {
  const createOrder = useMutation(api.orders.createOrder);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [checks, setChecks] = useState<string[]>(["", ""]);
  const [clips, setClips] = useState("4");
  const [price, setPrice] = useState("2.50");
  const [days, setDays] = useState<(typeof DAYS)[number]>(3);
  const [autoPay, setAutoPay] = useState(true);
  const [busy, setBusy] = useState(false);
  const [orderId, setOrderId] = useState<Id<"orders"> | null>(null);
  const [requestId] = useState(() => `post-${crypto.randomUUID()}`);
  // /dashboard/post?order=<id> opens straight to funding an order that is still waiting for money.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("order");
    if (id && /^[a-zA-Z0-9_-]+$/.test(id)) setOrderId(id as Id<"orders">);
  }, []);

  const count = /^\d+$/.test(clips.trim()) ? BigInt(clips.trim()) : 0n;
  const each = toAtomic(price);
  const total = each && count > 0n ? each * count : null;
  const filled = checks.map(c => c.trim()).filter(Boolean);
  const problem = !title.trim() ? "Name the task" : !prompt.trim() ? "Write the instructions" : !filled.length ? "Add at least one check"
    : count < 1n || count > 100n ? "Ask for 1 to 100 clips" : !each ? "Set a price per clip" : null;

  async function post() {
    if (problem || !each) return;
    const provider = injected();
    if (!provider) { toast.fail("Connect a wallet", { description: "Install Coinbase Wallet or MetaMask. The task is funded from it." }); return; }
    setBusy(true);
    try {
      const wallet = createWalletClient({ chain: baseSepolia, transport: custom(provider, { retryCount: 0 }) });
      const [address] = await wallet.requestAddresses();
      if (!address) throw new Error("No wallet account selected.");
      const result = await createOrder({ demoIdentity: BUYER, requestId, title: title.trim(), buyerWalletAddress: address,
        quantityRequested: count.toString(), pricePerSampleAtomic: each.toString(), contributorRateAtomic: each.toString(),
        deadlineAt: Date.now() + days * 86_400_000, taskPrompt: prompt.trim(),
        criteria: filled.map((description, index) => ({ criterionId: slug(description, index), description, modality: "visual" as const })),
        autoPay: { enabled: autoPay, maxPerClipAtomic: each.toString(), requireAllChecks: true } });
      setOrderId(result.orderId);
    } catch (error) {
      toast.fail("Could not post the task", { description: error instanceof Error ? humanize(error.message.replace(/^.*Error: /, "").split("\n")[0]!) : undefined });
    } finally { setBusy(false); }
  }

  if (orderId) return <Fund orderId={orderId} />;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Post a task" actions={
        <button type="button" onClick={() => { setTitle(EXAMPLE.title); setPrompt(EXAMPLE.prompt); setChecks(EXAMPLE.checks); }}
          className="type-label-sm text-text-2 underline underline-offset-4 hover:text-text-1">Fill an example</button>} />
      <div className="flex flex-col gap-8">
        <section className="flex flex-col gap-4">
          <h2 className="type-heading-sm">What should people record?</h2>
          <Field label="Task name"><input className={input} value={title} maxLength={200} onChange={e => setTitle(e.target.value)} placeholder="Pick up a red cup and place it on the coaster" /></Field>
          <Field label="Instructions" hint="Contributors read this on their phone before recording.">
            <textarea className={cn(input, "min-h-28 resize-y")} value={prompt} maxLength={10_000} onChange={e => setPrompt(e.target.value)} />
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="type-label">What the AI checks</span>
            {checks.map((check, index) => (
              <div key={index} className="flex items-center gap-2">
                <input className={cn(input, "flex-1")} value={check} maxLength={2000} placeholder={EXAMPLE.checks[index] ?? "Another thing the clip must show"}
                  onChange={e => setChecks(list => list.map((c, i) => (i === index ? e.target.value : c)))} />
                {checks.length > 1 && <button type="button" onClick={() => setChecks(list => list.filter((_, i) => i !== index))} aria-label="Remove check"
                  className="rounded-tag px-2 py-2 type-label-sm text-text-3 hover:bg-hover hover:text-text-1">Remove</button>}
              </div>
            ))}
            {checks.length < 10 && <button type="button" onClick={() => setChecks(list => [...list, ""])} className="self-start type-label-sm text-text-2 underline underline-offset-4 hover:text-text-1">Add a check</button>}
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="type-heading-sm">How many, and for how much?</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Clips"><input className={input} inputMode="numeric" value={clips} onChange={e => setClips(e.target.value)} /></Field>
            <Field label="Pay per clip">
              <span className="flex items-center rounded-tag border border-line-control bg-paper pe-3 focus-within:border-line-focus">
                <input className="min-w-0 flex-1 bg-transparent px-3 py-2 type-body outline-none" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} />
                <span className="type-label-sm text-text-3">USDC</span>
              </span>
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="type-label">Open for</span>
              <div className="flex gap-1 rounded-tag bg-field p-1">
                {DAYS.map(d => <button key={d} type="button" onClick={() => setDays(d)} aria-pressed={days === d}
                  className={cn("flex-1 rounded-[6px] py-1.5 type-label-sm", days === d ? "bg-paper text-text-1 shadow-sm" : "text-text-2 hover:text-text-1")}>{d} {d === 1 ? "day" : "days"}</button>)}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-panel border border-line-faint px-4 py-3">
            <span className="min-w-0 flex-1">
              <span className="block type-label">Auto-pay</span>
              <span className="block type-body-sm text-text-2">{autoPay ? "Clips that pass every check pay out by themselves." : "You approve every payout."}</span>
            </span>
            <Switch checked={autoPay} onCheckedChange={setAutoPay} aria-label="Auto-pay" />
          </div>
        </section>

        <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-line-faint bg-page px-4 py-4 md:-mx-6 md:px-6">
          <span className="me-auto">
            <span className="block type-label-sm text-text-3">You fund</span>
            <span className="type-title">{total ? <Amount value={total} /> : "None"}</span>
          </span>
          {problem && <span className="type-body-sm text-text-2">{problem}</span>}
          <Button disabled={!!problem || busy} onClick={() => void post()}>{busy ? "Posting…" : "Post task"}</Button>
        </div>
      </div>
    </div>
  );
}

/** After posting: one action, fund it. Status flips live when the money lands. */
function Fund({ orderId }: { orderId: Id<"orders"> }) {
  const router = useRouter();
  const summary = useQuery(api.dashboard.orderSummary, { demoIdentity: BUYER, orderId });
  const [step, setStep] = useState<FundingStep | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const order = summary?.order;
  const funded = !!order && order.status !== "awaiting_funding";
  useEffect(() => { if (funded) setStep(null); }, [funded]);

  async function fund() {
    const provider = injected();
    if (!provider) { setError("Install Coinbase Wallet or MetaMask to fund from the browser."); return; }
    setError(null);
    try {
      const result = await fundOrderInBrowser({ orderId, provider, onStep: setStep });
      setTxHash(result.txHash);
      toast.success(result.status === "reconciling" ? "Checking the earlier payment." : "Payment sent. Waiting for Base Sepolia to confirm.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Funding failed. Nothing was charged unless your wallet shows a signature.");
    } finally { setStep(null); }
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={funded ? "Task is live" : "Fund your task"} />
      <div className="flex flex-col gap-4 rounded-panel border border-line-faint p-5">
        <p className="type-heading-sm">{order?.title ?? "Your task"}</p>
        <div className="flex items-baseline justify-between gap-3">
          <span className="type-body-sm text-text-2">{order ? `${order.quantityRequested} clips at ${formatUsdc(order.pricePerSampleAtomic)} USDC` : ""}</span>
          <span className="type-title">{order ? <Amount value={order.budgetAtomic} /> : null}</span>
        </div>
        <p className="flex items-center gap-2 type-body-sm">
          <StatusMark status={funded ? "ok" : step ? "running" : "waiting"} />
          {funded ? "Funded. Contributors can see it in the app now." : step ? STEP_LABEL[step] : "Waiting for funding. Test USDC on Base Sepolia, no gas needed."}
        </p>
        {txHash && <a href={`https://sepolia.basescan.org/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="type-label-sm underline underline-offset-4">View on BaseScan ({shortHash(txHash)})</a>}
        {error && <p role="alert" className="type-body-sm text-fail-text">{error}</p>}
        {funded ? (
          <Button onClick={() => { chooseOrder(orderId); router.push("/dashboard"); }}>Open the task</Button>
        ) : (
          <Button disabled={!!step || !order} onClick={() => void fund()}>{step ? STEP_LABEL[step] : `Fund ${order ? formatUsdc(order.budgetAtomic) : ""} USDC`}</Button>
        )}
        {!funded && <p className="type-body-sm text-text-3">No test USDC? Get some at <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">faucet.circle.com</a> (Base Sepolia).
          {" "}Or fund from a terminal: <code className="rounded-tag bg-field px-1.5 py-0.5">pnpm agent:fund {orderId}</code></p>}
      </div>
      <Link href="/dashboard" className="mt-4 inline-block type-label-sm text-text-2 underline underline-offset-4">Back to overview</Link>
    </div>
  );
}
