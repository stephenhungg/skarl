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
