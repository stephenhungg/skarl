// Recorded CDP evidence (docs/agent-wallet.md, docs/demo-script.md). Checked October 25, 2026, 03:05 PDT.
export const AGENT_ADDRESS = "0x0A9EfDF66c58543538824906aE267B969Ed651c5";
export const POLICY_ID = "fa62ac94-e420-4013-bb4f-2dcab18deb7b";
export const CAP_ATOMIC = "2000000";
export const REJECTIONS = [
  { what: "Over the cap", amount: "2000001", detail: "To the allowlisted recipient", correlation: "a5006791aba9be62-IAD" },
  { what: "Off the allowlist", amount: "100000", detail: "To an unapproved recipient", correlation: "a500679519ddbe62-IAD" },
];

export const JIRA_URL = "https://one-atlas-hmeq.atlassian.net/browse/SKARL";
export const EAS_URL = "https://base-sepolia.easscan.org/attestation/view/0x935c09143c1ddb059ca62429a6623b42b3110dc589cdc45031eaa8c6c5e863e4";


export type Level = "live" | "simulated" | "pending";
export const INVENTORY: { item: string; note?: string; level: Level; href?: string; external?: boolean }[] = [
  { item: "x402 funding", note: "10 USDC", level: "live", external: true,
    href: "https://sepolia.basescan.org/tx/0x28b3f88d593c02a669cb95f4bdc6a23ab3d24bb5d1260e6c4ae54554155cd757" },
  { item: "x402 via CDP", note: "0.01 USDC, signed webhook", level: "live", external: true,
    href: "https://sepolia.basescan.org/tx/0x20c9252f7d67a2dac87be839ad82b83465686157478645354838ac0f7239390d" },
  { item: "EAS attestations", note: "no media", level: "live", external: true, href: EAS_URL },
  { item: "CDP Policy Engine", note: "2 refusals", level: "live", href: "#wallet" },
  { item: "Gemini jury and transcription", note: "accuracy unmeasured", level: "live", href: "/dashboard/submissions" },
  { item: "Claude and Gemini finance agents", note: "read-only", level: "live", href: "/dashboard/agent" },
  { item: "Capital One Nessie", note: "mock bank, no fiat", level: "simulated" },
  { item: "Scenario lab", note: "isolated lab orders", level: "simulated", href: "/dashboard/scenarios" },
  { item: "Copy witness on trimmed clips", note: "fixtures", level: "simulated" },
  { item: "Demo identities", note: "not authentication", level: "simulated" },
  { item: "Contributor payout", note: "needs an accepted, licensed clip and independent approval", level: "pending" },
];
