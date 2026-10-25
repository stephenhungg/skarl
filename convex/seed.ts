import { internal } from "./_generated/api";
import { demoOrderFixture as fixture } from "./fixtures/demoOrders";
import { demoOrderPublicId, legacyDemoOrderPublicId, demoOrganizationKey } from "./lib/config";
import { internalMutation } from "./_generated/server";
import { DEMO_IDENTITIES, demoToken } from "./lib/demoAuth";
import { audit, digest } from "./lib/finance";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/chain";

/** Privileged CLI bootstrap only. Demo selectors are intentionally impersonable, never production auth. */
export const demo = internalMutation({
  args: {},
  handler: async (ctx) => {
    let org = await ctx.db.query("organizations").withIndex("by_demo_key", q => q.eq("demoKey", demoOrganizationKey())).unique();
    if (!org) {
      const id = await ctx.db.insert("organizations", { name: fixture.organizationName, demoKey: demoOrganizationKey(),
        status: "active", createdByTokenIdentifier: demoToken("buyer") });
      org = (await ctx.db.get(id))!;
    }
    if (org.status !== "active") throw new Error("inactive_organization");
    for (const identity of DEMO_IDENTITIES) {
      const tokenIdentifier = demoToken(identity);
      const existing = await ctx.db.query("memberships").withIndex("by_token_identifier", q => q.eq("tokenIdentifier", tokenIdentifier)).unique();
      if (!existing) await ctx.db.insert("memberships", {
        organizationId: org._id, issuer: fixture.issuer, subject: identity, tokenIdentifier,
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
    const { criteria, taskPrompt } = fixture;
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
        buyerWalletAddress: fixture.wallet,
        title: fixture.title, taskSpecStatus: "pending", status: "awaiting_funding", quantityRequested,
        pricePerSampleAtomic, contributorRateAtomic, budgetAtomic: quantityRequested * pricePerSampleAtomic,
        acceptedCount: 0n, deadlineAt: now + fixture.durationMs,
        termsHash: digest({ contentHash, quantityRequested, pricePerSampleAtomic, contributorRateAtomic, licenseVersion: fixture.licenseVersion }), updatedAt: now,
      });
      const taskVersionId = await ctx.db.insert("rubricVersions", {
        organizationId, orderId, version: 1, taskPrompt, criteria, contentHash, taskSpecStatus: "pending",
        createdByTokenIdentifier: buyer, frozenAt: now,
      });
      await ctx.db.patch(orderId, { taskVersionId });
    await ctx.scheduler.runAfter(0, internal.taskSpecExtraction.extract, { orderId });
      await audit(ctx, { organizationId, eventKey, actor: { kind: "human", identity: buyer },
        action: "demo_seeded", entityType: "orders", entityId: orderId,
        reason: "Synthetic demo identities and unfunded order; no transfer or inference was performed.", evidenceReferences: [taskVersionId] });
      return { orderId, taskVersionId };
    }
    // Retain v1 and its return fields for existing callers; never rewrite stored order terms.
    const legacy = await ensureOrder(legacyDemoOrderPublicId(), fixture.legacy.quantity, fixture.legacy.price, fixture.legacy.rate, fixture.legacy.event);
    const current = await ensureOrder(demoOrderPublicId(), fixture.current.quantity, fixture.current.price, fixture.current.rate, fixture.current.event);
    return { organizationId: org._id, ...legacy, defaultOrderId: current.orderId, defaultTaskVersionId: current.taskVersionId, demoIdentities: DEMO_IDENTITIES };
  },
});

/** Separate idempotent funding demo; denomination and eventual payouts remain Base USDC. */
export const solanaDemo = internalMutation({
  args: {},
  handler: async (ctx) => {
    const organization = await ctx.db.query("organizations").withIndex("by_demo_key", q => q.eq("demoKey", demoOrganizationKey())).unique();
    if (!organization || organization.status !== "active") throw new Error("run_seed_demo_first");
    const buyer = demoToken("buyer");
    const publicId = fixture.solana.publicId;
    const existing = await ctx.db.query("orders").withIndex("by_public_id", q => q.eq("publicId", publicId)).unique();
    if (existing) {
      if (existing.organizationId !== organization._id || !existing.taskVersionId) throw new Error("invalid_demo_order");
      return { orderId: existing._id, taskVersionId: existing.taskVersionId, publicId };
    }
    const source = await ctx.db.query("orders").withIndex("by_public_id", q => q.eq("publicId", demoOrderPublicId())).unique();
    const rubric = source?.taskVersionId && await ctx.db.get(source.taskVersionId);
    if (!source || !rubric || source.organizationId !== organization._id) throw new Error("run_seed_demo_first");
    const now = Date.now(), { quantity: quantityRequested, price: pricePerSampleAtomic, rate: contributorRateAtomic } = fixture.solana;
    const orderId = await ctx.db.insert("orders", {
      organizationId: organization._id, network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS,
      publicId, buyerTokenIdentifier: demoToken("buyer"), buyerWalletAddress: fixture.wallet,
      title: fixture.solana.title, taskSpecStatus: "pending", status: "awaiting_funding", quantityRequested,
      pricePerSampleAtomic, contributorRateAtomic, budgetAtomic: quantityRequested * pricePerSampleAtomic,
      acceptedCount: 0n, deadlineAt: now + fixture.durationMs,
      termsHash: digest({ contentHash: rubric.contentHash, quantityRequested, pricePerSampleAtomic, contributorRateAtomic,
        licenseVersion: fixture.licenseVersion }), updatedAt: now,
    });
    const taskVersionId = await ctx.db.insert("rubricVersions", {
      organizationId: organization._id, orderId, version: 1, taskPrompt: rubric.taskPrompt,
      criteria: rubric.criteria, contentHash: rubric.contentHash, taskSpecStatus: "pending", createdByTokenIdentifier: buyer, frozenAt: now,
    });
    await ctx.db.patch(orderId, { taskVersionId });
    await ctx.scheduler.runAfter(0, internal.taskSpecExtraction.extract, { orderId });
    await audit(ctx, { organizationId: organization._id, eventKey: `seed:${publicId}`,
      actor: { kind: "human", identity: buyer }, action: "demo_seeded", entityType: "orders", entityId: orderId,
      reason: "Unfunded synthetic Solana funding order. No transfer or inference was performed; payouts remain on Base.",
      evidenceReferences: [taskVersionId] });
    return { orderId, taskVersionId, publicId };
  },
});
