/** One page per proof. The sidebar, the index and the pager all read this list. */
export const PROOF_SECTIONS = [
  { slug: "payments", title: "Payments", sponsor: "Coinbase x402 and CDP" },
  { slug: "agent", title: "Finance agent", sponsor: "Anthropic Claude" },
  { slug: "jury", title: "AI jury", sponsor: "Google Gemini" },
  { slug: "licenses", title: "Licenses", sponsor: "Solana Token-2022" },
  { slug: "bank", title: "Bank", sponsor: "Capital One Nessie" },
  { slug: "attestations", title: "Attestations", sponsor: "EAS on Base" },
  { slug: "guard", title: "Guard", sponsor: "Atlassian Jira" },
  { slug: "platform", title: "Platform", sponsor: "Convex" },
  { slug: "tax", title: "Tax", sponsor: "Tax-ready ledger" },
] as const;
export type ProofSlug = (typeof PROOF_SECTIONS)[number]["slug"];
export const isProofSlug = (value: string): value is ProofSlug => PROOF_SECTIONS.some(section => section.slug === value);
