import { makeFunctionReference } from "convex/server";
import type { ActionCtx } from "../_generated/server";

// Bursts comfortably exceed the demo workload. The global bucket also bounds
// clients rotating untrusted Origin/forwarded headers; this is abuse control,
// never authentication or proof that a header came from trusted ingress.
export const PUBLIC_RATE_POLICIES = {
  mcp: { capacity: 240, refillPerMinute: 240 },
  discovery: { capacity: 600, refillPerMinute: 600 },
  jira: { capacity: 120, refillPerMinute: 120 },
} as const;
export type PublicSurface = keyof typeof PUBLIC_RATE_POLICIES;

export function refillBucket(tokens: number, updatedAt: number, now: number, capacity: number, refillPerMinute: number) {
  const available = Math.min(capacity, tokens + Math.max(0, now - updatedAt) * refillPerMinute / 60_000);
  return { tokens: available, retryAfterSeconds: available >= 1 ? 0 : Math.max(1, Math.ceil((1 - available) * 60 / refillPerMinute)) };
}

export async function publicFingerprint(request: Request): Promise<string> {
  // Prefer ingress-supplied IP. Origin and a shared fallback support clients
  // without it. Do not use bearer keys as a way to evade the per-IP budget.
  const ip = request.headers.get("cf-connecting-ip")?.trim() || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const value = ip ? `ip:${ip.slice(0, 256)}` : `origin:${request.headers.get("Origin")?.slice(0, 256) || "unknown"}`;
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

const consumeRef = makeFunctionReference<"mutation", { surface: PublicSurface; fingerprint: string },
  { allowed: boolean; retryAfterSeconds: number }>("publicSecurity:consume");

export async function checkPublicRateLimit(ctx: Pick<ActionCtx, "runMutation">, request: Request, surface: PublicSurface): Promise<Response | null> {
  const result = await ctx.runMutation(consumeRef, { surface, fingerprint: await publicFingerprint(request) });
  if (result.allowed) return null;
  const body = surface === "mcp"
    ? { jsonrpc: "2.0", id: null, error: { code: -32029, message: "Rate limit exceeded", data: { retryAfterSeconds: result.retryAfterSeconds } } }
    : { error: "rate_limited", retryAfterSeconds: result.retryAfterSeconds };
  return new Response(JSON.stringify(body), { status: 429, headers: {
    "Content-Type": "application/json", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    "Retry-After": String(result.retryAfterSeconds), "Access-Control-Allow-Origin": "*",
  } });
}
