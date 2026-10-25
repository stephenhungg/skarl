import { internalMutation } from "./_generated/server";
import { DEMO_IDENTITIES, demoToken } from "./lib/demoAuth";
import { audit, digest } from "./lib/finance";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/chain";

/** Privileged CLI bootstrap only. Demo selectors are intentionally impersonable, never production auth. */
export const demo = internalMutation({
  args: {},
  handler: async (ctx) => {
    let org = await ctx.db.query("organizations").withIndex("by_demo_key", q => q.eq("demoKey", "skarl-demo-v1")).unique();
    if (!org) {
      const id = await ctx.db.insert("organizations", { name: "Skarl Demo", demoKey: "skarl-demo-v1",
        status: "active", createdByTokenIdentifier: demoToken("buyer") });
      org = (await ctx.db.get(id))!;
    }
    if (org.status !== "active") throw new Error("inactive_organization");
    for (const identity of DEMO_IDENTITIES) {
      const tokenIdentifier = demoToken(identity);
      const existing = await ctx.db.query("memberships").withIndex("by_token_identifier", q => q.eq("tokenIdentifier", tokenIdentifier)).unique();
      if (!existing) await ctx.db.insert("memberships", {
        organizationId: org._id, issuer: "demo:skarl", subject: identity, tokenIdentifier,
        roles: [identity], grantedByTokenIdentifier: demoToken("buyer"), status: "active",
      });
      else if (existing.organizationId !== org._id || (identity === "finance-agent" && existing.roles.includes("controller"))) {
        throw new Error("invalid_demo_membership; repair explicitly, not by silently granting roles");
      }
    }
    // Internal bootstrap has no browser role or unsigned demo-mode dependency.
    const buyer = demoToken("buyer");
    const organizationId = org._id;
    const now = Date.now();
    const criteria = [
      { criterionId: "red-cup-pickup", description: "Pick up the red cup, not the blue cup", modality: "visual" as const },
      { criterionId: "coaster-placement", description: "Place the red cup on the marked coaster", modality: "temporal" as const },
      { criterionId: "narration-alignment", description: "Narration agrees with visible actions and object", modality: "cross_modal" as const },
    ];
    const taskPrompt = "Pick up the red cup and place it on the marked coaster. Narrate each action. Fixed camera; red and blue cups; 10–30 seconds.";
    const contentHash = digest({ version: 1, taskPrompt, criteria });
    async function ensureOrder(publicId: string, quantityRequested: bigint, pricePerSampleAtomic: bigint,
      contributorRateAtomic: bigint, eventKey: string) {
      const existingOrder = await ctx.db.query("orders").withIndex("by_public_id", q => q.eq("publicId", publicId)).unique();
      if (existingOrder) {
        if (existingOrder.organizationId !== organizationId || !existingOrder.taskVersionId) throw new Error("invalid_demo_order");
        return { orderId: existingOrder._id, taskVersionId: existingOrder.taskVersionId };
      }
      const orderId = await ctx.db.insert("orders", {
        organizationId, network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS,
        publicId, buyerTokenIdentifier: demoToken("buyer"),
        // Explicit non-signing fixture address. Replace through verified funding integration before real payment.
        buyerWalletAddress: "0x0000000000000000000000000000000000000001",
        title: "Red-cup narrated demonstrations", status: "awaiting_funding", quantityRequested,
        pricePerSampleAtomic, contributorRateAtomic, budgetAtomic: quantityRequested * pricePerSampleAtomic,
        acceptedCount: 0n, deadlineAt: now + 8 * 60 * 60 * 1000,
        termsHash: digest({ contentHash, quantityRequested, pricePerSampleAtomic, contributorRateAtomic, licenseVersion: "demo-consent-v1" }), updatedAt: now,
      });
      const taskVersionId = await ctx.db.insert("rubricVersions", {
        organizationId, orderId, version: 1, taskPrompt, criteria, contentHash,
        createdByTokenIdentifier: buyer, frozenAt: now,
      });
      await ctx.db.patch(orderId, { taskVersionId });
      await audit(ctx, { organizationId, eventKey, actor: { kind: "human", identity: buyer },
        action: "demo_seeded", entityType: "orders", entityId: orderId,
        reason: "Synthetic demo identities and unfunded order; no transfer or inference was performed.", evidenceReferences: [taskVersionId] });
      return { orderId, taskVersionId };
    }
    // Retain v1 and its return fields for existing callers; never rewrite stored order terms.
    const legacy = await ensureOrder("skarl-red-cup-demo-v1", 10n, 10_000_000n, 7_500_000n, "seed:skarl-demo-v1");
    const current = await ensureOrder("skarl-red-cup-demo-v2", 4n, 2_500_000n, 1_875_000n, "seed:skarl-demo-v2");
    return { organizationId: org._id, ...legacy, defaultOrderId: current.orderId, defaultTaskVersionId: current.taskVersionId, demoIdentities: DEMO_IDENTITIES };
  },
});

/** Separate idempotent funding demo; denomination and eventual payouts remain Base USDC. */
export const solanaDemo = internalMutation({
  args: {},
  handler: async (ctx) => {
    const organization = await ctx.db.query("organizations").withIndex("by_demo_key", q => q.eq("demoKey", "skarl-demo-v1")).unique();
    if (!organization || organization.status !== "active") throw new Error("run_seed_demo_first");
    const buyer = demoToken("buyer");
    const publicId = "skarl-red-cup-demo-sol";
    const existing = await ctx.db.query("orders").withIndex("by_public_id", q => q.eq("publicId", publicId)).unique();
    if (existing) {
      if (existing.organizationId !== organization._id || !existing.taskVersionId) throw new Error("invalid_demo_order");
      return { orderId: existing._id, taskVersionId: existing.taskVersionId, publicId };
    }
    const source = await ctx.db.query("orders").withIndex("by_public_id", q => q.eq("publicId", "skarl-red-cup-demo-v2")).unique();
    const rubric = source?.taskVersionId && await ctx.db.get(source.taskVersionId);
    if (!source || !rubric || source.organizationId !== organization._id) throw new Error("run_seed_demo_first");
    const now = Date.now(), quantityRequested = 1n, pricePerSampleAtomic = 1_000_000n, contributorRateAtomic = 750_000n;
    const orderId = await ctx.db.insert("orders", {
      organizationId: organization._id, network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS,
      publicId, buyerTokenIdentifier: demoToken("buyer"), buyerWalletAddress: "0x0000000000000000000000000000000000000001",
      title: "Red-cup Solana funding demonstration", status: "awaiting_funding", quantityRequested,
      pricePerSampleAtomic, contributorRateAtomic, budgetAtomic: quantityRequested * pricePerSampleAtomic,
      acceptedCount: 0n, deadlineAt: now + 8 * 60 * 60 * 1000,
      termsHash: digest({ contentHash: rubric.contentHash, quantityRequested, pricePerSampleAtomic, contributorRateAtomic,
        licenseVersion: "demo-consent-v1" }), updatedAt: now,
    });
    const taskVersionId = await ctx.db.insert("rubricVersions", {
      organizationId: organization._id, orderId, version: 1, taskPrompt: rubric.taskPrompt,
      criteria: rubric.criteria, contentHash: rubric.contentHash, createdByTokenIdentifier: buyer, frozenAt: now,
    });
    await ctx.db.patch(orderId, { taskVersionId });
    await audit(ctx, { organizationId: organization._id, eventKey: `seed:${publicId}`,
      actor: { kind: "human", identity: buyer }, action: "demo_seeded", entityType: "orders", entityId: orderId,
      reason: "Unfunded 1 USDC Solana funding demo. No transfer or inference was performed; payouts remain on Base.",
      evidenceReferences: [taskVersionId] });
    return { orderId, taskVersionId, publicId };
  },
});
