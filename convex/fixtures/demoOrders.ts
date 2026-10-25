/** Synthetic, unfunded operator seed data. Never a verifier fallback or real inference. */
export const demoOrderFixture = {
  organizationName: "Skarl Demo", issuer: "demo:skarl", wallet: "0x0000000000000000000000000000000000000001",
  title: "Red-cup narrated demonstrations", licenseVersion: "demo-consent-v1", durationMs: 8 * 60 * 60 * 1000,
  criteria: [
    { criterionId: "red-cup-pickup", description: "Pick up the red cup, not the blue cup", modality: "visual" as const },
    { criterionId: "coaster-placement", description: "Place the red cup on the marked coaster", modality: "temporal" as const },
    { criterionId: "narration-alignment", description: "Narration agrees with visible actions and object", modality: "cross_modal" as const },
  ],
  taskPrompt: "Pick up the red cup and place it on the marked coaster. Narrate each action. Fixed camera; red and blue cups; 10–30 seconds.",
  legacy: { quantity: 10n, price: 10_000_000n, rate: 7_500_000n, event: "seed:skarl-demo-v1" },
  current: { quantity: 4n, price: 2_500_000n, rate: 1_875_000n, event: "seed:skarl-demo-v2" },
  solana: { publicId: "skarl-red-cup-demo-sol", title: "Red-cup Solana funding demonstration", quantity: 1n, price: 1_000_000n, rate: 750_000n },
};
