import { USDC_DECIMALS } from "@skarl/contracts/chain";

const SCALE = 10n ** BigInt(USDC_DECIMALS);

/** Exact micro-USDC to display text. Keeps every significant decimal (1.875 stays 1.875), at least two. */
export function formatUsdc(value: string | bigint | null | undefined): string {
  if (value === null || value === undefined || value === "") return "None";
  const amount = BigInt(value), absolute = amount < 0n ? -amount : amount;
  const fraction = (absolute % SCALE).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${amount < 0n ? "-" : ""}${(absolute / SCALE).toLocaleString("en-US")}.${fraction}`;
}

export function shortHash(value: string | null | undefined, head = 6, tail = 4) {
  if (!value) return "None";
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** 4200 -> "0:04.2" */
export function formatMs(ms: number) {
  const total = Math.max(0, ms) / 1000, minutes = Math.floor(total / 60), seconds = total - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
}

export function formatTime(ms: number | null | undefined) {
  if (!ms) return "Unknown";
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** "eip155:84532:0xabc...:18" -> { txHash, logIndex } */
export function parseChainIdentity(identity: string | null | undefined) {
  const parts = identity?.split(":") ?? [];
  return parts.length >= 4 ? { txHash: parts[2]!, logIndex: parts[3]! } : null;
}

export const basescanTx = (txHash: string) => `https://sepolia.basescan.org/tx/${txHash}`;
export const basescanAddress = (address: string) => `https://sepolia.basescan.org/address/${address}`;

const buyerWording = (text: string) => text.replace(/\bcontroller\b/gi, word => word[0] === "C" ? "Buyer" : "buyer");
export const humanize = (code: string) => buyerWording(code.replace(/[_:]+/g, " ")).replace(/^\w/, c => c.toUpperCase());

/**
 * Backend audit reasons are machine strings ("needs_review: criterion-id=unobservable, ..."). Turn them into a
 * sentence a person can scan without changing what they say.
 */
export function readableReason(reason: string) {
  reason = buyerWording(reason);
  const [head, ...rest] = reason.split(": ");
  if (!rest.length) return /^[a-z0-9_:-]+$/.test(reason) ? humanize(reason) : reason;
  const body = rest.join(": ");
  const pairs = body.split(/,\s*/).map(part => part.split("="));
  const tail = pairs.every(pair => pair.length === 2)
    ? pairs.map(([key, value]) => `${humanize(key!.replace(/-/g, " "))} ${humanize(value!).toLowerCase()}`).join(", ")
    : (/^[a-z0-9_]+$/.test(body.split(": ")[0]!) ? body.split(": ").map((part, i) => i === 0 ? humanize(part) : part).join(". ") : body);
  return /^[a-z0-9_]+$/.test(head!) ? `${humanize(head!)}. ${tail}` : reason;
}

/** Rail label and explorer link from a CAIP chain identity ("eip155:84532:..." or "solana:<genesis>:..."). */
export function rail(chainIdentity: string | null | undefined) {
  const parsed = parseChainIdentity(chainIdentity);
  if (!chainIdentity || !parsed) return null;
  if (chainIdentity.startsWith("solana:")) {
    return { label: "Solana Devnet", explorer: "Solana Explorer", href: `https://explorer.solana.com/tx/${parsed.txHash}?cluster=devnet`, ...parsed };
  }
  return { label: "Base Sepolia", explorer: "BaseScan", href: basescanTx(parsed.txHash), ...parsed };
}

const POLICY_REASON: Record<string, string> = {
  auto_pay_disabled: "auto-pay is off", completed_accept_inference_required: "AI check did not finish", report_binding_or_outcome_invalid: "AI report incomplete",
  report_invalid: "AI report invalid", jury_not_accept: "AI jury did not accept", rubric_checks_incomplete: "not every check passed",
  over_cap_payout: "over your auto-pay cap", duplicate_not_clear: "possible duplicate", prompt_injection_flag: "narration tries to instruct the AI",
  consent_license_required: "no recording consent", verification_only_not_licensed: "test upload, cannot be paid", tax_form_missing: "contributor tax form missing",
  verified_contributor_wallet_required: "contributor has no verified wallet", insufficient_funded_remaining: "not enough funded budget left",
  invalid_payout_amount: "payout amount invalid", accepted_payable_binding_required: "clip not accepted yet", self_approval_refused: "agent tried to approve itself",
};
/** Policy failure codes ("criterion:can-pickup", "over_cap_payout") to a short sentence a buyer can act on. */
export function policyReasons(codes: string[] | string | null | undefined, limit = 2) {
  const list = (Array.isArray(codes) ? codes : (codes ?? "").split(/,\s*/)).map(code => code.trim()).filter(Boolean);
  const liveness = list.filter(code => code.startsWith("liveness:"));
  const criteria = list.filter(code => code.startsWith("criterion:")).map(code => code.slice(10).replace(/[-_]/g, " "));
  const reasons = [...new Set(list.filter(code => !code.startsWith("criterion:") && !code.startsWith("liveness:")).map(code => POLICY_REASON[code] ?? code.replace(/_/g, " ")))];
  if (liveness.length) reasons.push("spoken liveness check missing");
  if (criteria.length) reasons.push(criteria.length === 1 ? `"${criteria[0]}" not confirmed` : `${criteria.length} checks not confirmed`);
  if (!reasons.length) return "Held for your review";
  const shown = reasons.slice(0, limit).join(", ");
  const text = reasons.length > limit ? `${shown} and ${reasons.length - limit} more` : shown;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
