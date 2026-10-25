import type { ReconciliationException } from "../../packages/payments/src/reconciliation";
import { digest } from "./finance";

export interface JiraFeedItem {
  id: string;
  kind: "reconciliation_exception" | "agent_proposal" | "agent_refusal" | "scenario_run";
  status: string;
  amountMicroUsdc?: string;
  orderId?: string;
  createdAt: number;
  description: string;
  witnessReceiptUrl?: string;
  simulated: boolean;
}

/** Constant-time MAC verification, rather than an early-exit string comparison.
 * Candidate length is public; the configured credential is never returned/logged. */
export async function feedSecretMatches(expected: string, candidate: string | null): Promise<boolean> {
  if (!candidate || candidate.length > 512 || expected.length < 32 || expected.length > 512) return false;
  const bytes = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", bytes.encode(expected), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const signature = await crypto.subtle.sign("HMAC", key, bytes.encode(expected));
  return crypto.subtle.verify("HMAC", key, signature, bytes.encode(candidate));
}

// Only small, machine-readable codes are exported. Never relay raw model reasoning,
// prompts, narration, event reasons (which may contain credentials), or media URLs.
export function feedCode(value: unknown): string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : "needs_human_review";
}

export function receiptUrl(submissionId: string | undefined): string | undefined {
  if (!submissionId) return undefined;
  const origin = process.env.SKARL_JIRA_PUBLIC_URL ?? "https://skarl.vercel.app";
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return undefined;
    return `${url.origin}/api/samples/${encodeURIComponent(submissionId)}/witnesses`;
  } catch { return undefined; }
}

export function exceptionFeedItem(exception: Omit<ReconciliationException, "code"> & { code: string }, orderId: string, createdAt: number,
  amountMicroUsdc?: string, witnessReceiptUrl?: string): JiraFeedItem {
  // Stable across repeated reads and ordering changes; no descriptions/timestamps in identity.
  const id = `exception:${digest({ orderId, code: exception.code, eventKey: exception.eventKey,
    chainIdentity: exception.chainIdentity })}`;
  return { id, kind: "reconciliation_exception", status: "open", orderId, createdAt,
    description: `Skarl reconciliation: ${feedCode(exception.code)}. Compare stored obligation, journal and chain evidence. A timeout does not prove failure. Test assets only.`,
    simulated: exception.code === "bank_mismatch", ...(amountMicroUsdc === undefined ? {} : { amountMicroUsdc }),
    ...(witnessReceiptUrl ? { witnessReceiptUrl } : {}) };
}
