/** Unsigned demo selectors are impersonable; signed-in authorization is enforced by Convex. */
export const DEMO_BUYER = "buyer" as const;
export const DEMO_FINANCE_AGENT = "finance-agent" as const;
export const DEMO_CONTRIBUTOR = "contributor" as const;
const ACTOR: Record<string, string> = {
  "demo:skarl:controller": "Buyer (legacy)", "demo:skarl:contributor": "Contributor", "demo:skarl:buyer": "Buyer",
  "demo:skarl:finance-agent": "Finance agent", "finance-agent": "Finance agent", "gemini-verifier": "Gemini verifier",
  "payments-gateway": "Payments", "policy-engine": "Buyer-signed policy", "service:skarl:policy-engine": "Buyer-signed policy", "verifier-01": "Verifier",
};
export const knownActorName = (identity: string) => ACTOR[identity];
export const unscopedActorName = (identity: string) => identity.replace(/^demo:skarl:/, "");
