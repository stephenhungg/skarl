export type HealthStatus = "ok" | "degraded" | "missing";
export type HealthItem = {
  id: string; status: HealthStatus; demoCritical: boolean; reason: string; fix: string;
  checkedAt: number; lastSuccessAt: number | null;
  evidence: Record<string, string | number | boolean | null>;
};

/** Missing means no prerequisite/evidence; stale or unsuccessful evidence is degraded. */
export function evidenceStatus(now: number, at: number | null, successful: boolean, freshMs?: number): HealthStatus {
  if (at === null) return "missing";
  return successful && at <= now && (freshMs === undefined || now - at <= freshMs) ? "ok" : "degraded";
}

export const REQUIRED_ENV = [
  ["GEMINI_API_KEY", true], ["ANTHROPIC_API_KEY", true], ["SKARL_PAYMENTS_SERVICE_SECRET", true],
  ["CDP_AGENT_ADDRESS", true], ["CDP_API_KEY_ID", true], ["CDP_API_KEY_SECRET", true],
  ["CDP_WALLET_SECRET", true], ["CDP_AGENT_POLICY_ID", true], ["PAYOUT_EXECUTOR", true],
  ["NESSIE_API_KEY", false], ["NESSIE_ENABLED", false], ["SKARL_JIRA_FEED_SECRET", false],
  ["EAS_ATTESTATIONS_ENABLED", false], ["EAS_ATTESTOR_ADDRESS", false], ["EAS_ATTESTOR_POLICY_ID", false],
  ["AUTH_GOOGLE_ID", false], ["AUTH_GOOGLE_SECRET", false], ["JWT_PRIVATE_KEY", false], ["JWKS", false],
  ["SITE_URL", true],
] as const;

export function envConfigured(name: string, env: Record<string, string | undefined>): boolean {
  const value = env[name];
  if (!value?.trim()) return false;
  if (name === "SKARL_PAYMENTS_SERVICE_SECRET") return value.length >= 32;
  if (name === "SKARL_JIRA_FEED_SECRET") return value.length >= 32 && value.length <= 512;
  if (name === "PAYOUT_EXECUTOR") return value === "cdp_agent";
  if (name === "NESSIE_ENABLED" || name === "EAS_ATTESTATIONS_ENABLED") return value === "true";
  if (name === "CDP_AGENT_ADDRESS" || name === "EAS_ATTESTOR_ADDRESS") return /^0x[\da-fA-F]{40}$/.test(value) && !/^0x0{40}$/i.test(value);
  if (name === "SITE_URL") return publicSiteUrl(value) !== null;
  return true;
}

/** SITE_URL is public, but a misconfigured credential/query must not be echoed. */
export function publicSiteUrl(value: string | undefined): string | null {
  try {
    const url = new URL(value ?? "");
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password &&
      !url.search && !url.hash && url.pathname === "/" ? url.origin : null;
  } catch { return null; }
}
