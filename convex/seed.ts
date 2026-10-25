import { internalMutation } from "./_generated/server";
import { DEMO_IDENTITIES, demoToken, requireRole } from "./lib/demoAuth";
import { audit, digest } from "./lib/finance";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/chain";

/** Privileged CLI bootstrap only. Demo selectors are intentionally impersonable, never production auth. */
export const demo = internalMutation({
  args: {},
  handler: async (ctx) => {
    let org = await ctx.db.query("organizations").withIndex("by_demo_key", q => q.eq("demoKey", "skarl-demo-v1")).unique();
    if (!org) {
      const id = await ctx.db.insert("organizations", { name: "Skarl Demo", demoKey: "skarl-demo-v1",
        status: "active", createdByTokenIdentifier: demoToken("controller") });
      org = (await ctx.db.get(id))!;
    }
    for (const identity of DEMO_IDENTITIES) {
      const tokenIdentifier = demoToken(identity);
      const existing = await ctx.db.query("memberships").withIndex("by_token_identifier", q => q.eq("tokenIdentifier", tokenIdentifier)).unique();
      if (!existing) await ctx.db.insert("memberships", {
        organizationId: org._id, issuer: "demo:skarl", subject: identity, tokenIdentifier,
        roles: [identity], grantedByTokenIdentifier: demoToken("controller"), status: "active",
      });
      else if (existing.organizationId !== org._id || (identity === "finance-agent" && existing.roles.includes("controller"))) {
        throw new Error("invalid_demo_membership; repair explicitly, not by silently granting roles");
      }
    }
    // Only this internal bootstrap may provision the initial controller before this check.
    const controller = await requireRole(ctx, "controller", "controller");
    const existingOrder = await ctx.db.query("orders").withIndex("by_public_id", q => q.eq("publicId", "skarl-red-cup-demo-v1")).unique();
    if (existingOrder) {
      if (existingOrder.organizationId !== org._id || !existingOrder.taskVersionId) throw new Error("invalid_demo_order");
      return { organizationId: org._id, orderId: existingOrder._id, taskVersionId: existingOrder.taskVersionId, demoIdentities: DEMO_IDENTITIES };
    }
    const now = Date.now();
    const criteria = [
      { criterionId: "red-cup-pickup", description: "Pick up the red cup, not the blue cup", modality: "visual" as const },
      { criterionId: "coaster-placement", description: "Place the red cup on the marked coaster", modality: "temporal" as const },
      { criterionId: "narration-alignment", description: "Narration agrees with visible actions and object", modality: "cross_modal" as const },
    ];
    const taskPrompt = "Pick up the red cup and place it on the marked coaster. Narrate each action. Fixed camera; red and blue cups; 10–30 seconds.";
    const contentHash = digest({ version: 1, taskPrompt, criteria });
    const quantityRequested = 10n, pricePerSampleAtomic = 10_000_000n, contributorRateAtomic = 7_500_000n;
    const orderId = await ctx.db.insert("orders", {
      organizationId: org._id, network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS,
      publicId: "skarl-red-cup-demo-v1", buyerTokenIdentifier: demoToken("buyer"),
      // Explicit non-signing fixture address. Replace through verified funding integration before real payment.
      buyerWalletAddress: "0x0000000000000000000000000000000000000001",
      title: "Red-cup narrated demonstrations", status: "awaiting_funding", quantityRequested,
      pricePerSampleAtomic, contributorRateAtomic, budgetAtomic: quantityRequested * pricePerSampleAtomic,
      acceptedCount: 0n, deadlineAt: now + 8 * 60 * 60 * 1000,
      termsHash: digest({ contentHash, quantityRequested, pricePerSampleAtomic, contributorRateAtomic, licenseVersion: "demo-consent-v1" }), updatedAt: now,
    });
    const taskVersionId = await ctx.db.insert("rubricVersions", {
      organizationId: org._id, orderId, version: 1, taskPrompt, criteria, contentHash,
      createdByTokenIdentifier: controller.tokenIdentifier, frozenAt: now,
    });
    await ctx.db.patch(orderId, { taskVersionId });
    await audit(ctx, { organizationId: org._id, eventKey: "seed:skarl-demo-v1", actor: { kind: "human", identity: controller.tokenIdentifier },
      action: "demo_seeded", entityType: "orders", entityId: orderId,
      reason: "Synthetic demo identities and unfunded order; no transfer or inference was performed.", evidenceReferences: [taskVersionId] });
    return { organizationId: org._id, orderId, taskVersionId, demoIdentities: DEMO_IDENTITIES };
  },
});
