import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { digest } from "./lib/finance";
import { envNumber, envString } from "./lib/config";
import { SOLANA_PAYMENT_NETWORK } from "../packages/contracts/src/chain";

const outcome = v.union(
  v.object({ status: v.literal("minted"), mintAddress: v.string(), signature: v.string(), holderAddress: v.string() }),
  v.object({ status: v.literal("unconfirmed"), mintAddress: v.string(), signature: v.string(), holderAddress: v.string() }),
  v.object({ status: v.union(v.literal("failed"), v.literal("skipped")), error: v.string() }),
);

/** Claims the one license mint for a delivery. Minted/in-flight rows are never re-minted; failures retry up to a cap. */
export const prepare = internalMutation({
  args: { deliveryId: v.id("deliveries") },
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery?.manifest) return { ok: false as const, code: "delivery_not_licensed" as const };
    const consent = await ctx.db.get(delivery.manifest.consentRecordId);
    if (!consent || consent.submissionId !== delivery.submissionId || consent.organizationId !== delivery.organizationId) {
      return { ok: false as const, code: "consent_mismatch" as const };
    }
    if (consent.revocationStatus) return { ok: false as const, code: "consent_revocation_recorded" as const };
    // Everything a verifier needs to bind the token to Skarl's off-chain license, folded into one on-chain value.
    const licenseDigest = digest({ deliveryId: delivery._id, manifestHash: delivery.manifestHash, termsHash: delivery.termsHash,
      consentReceiptHash: consent.receiptHash, licenseHash: consent.licenseHash, licenseVersion: consent.licenseVersion });
    const now = Date.now();
    const existing = await ctx.db.query("solanaLicenses").withIndex("by_delivery", q => q.eq("deliveryId", delivery._id)).unique();
    if (existing?.status === "minted" || existing?.status === "unconfirmed") return { ok: false as const, code: "already_minted" as const };
    if (existing?.status === "pending" && now - existing.updatedAt < envNumber("SKARL_SOLANA_LICENSE_LEASE_MS", 120_000, 10_000)) {
      return { ok: false as const, code: "mint_in_flight" as const };
    }
    const attempts = (existing?.attempts ?? 0) + 1;
    if (attempts > envNumber("SKARL_SOLANA_LICENSE_MAX_ATTEMPTS", 3, 1)) return { ok: false as const, code: "attempts_exhausted" as const };
    const row = { status: "pending" as const, attempts, licenseDigest, updatedAt: now };
    const licenseId = existing ? (await ctx.db.patch(existing._id, row), existing._id) : await ctx.db.insert("solanaLicenses", {
      ...row, organizationId: delivery.organizationId, orderId: delivery.orderId, submissionId: delivery.submissionId,
      deliveryId: delivery._id, network: SOLANA_PAYMENT_NETWORK, createdAt: now });
    const order = await ctx.db.get(delivery.orderId);
    const site = envString("SITE_URL", process.env.CONVEX_SITE_URL ?? "").replace(/\/+$/, "");
    return { ok: true as const, licenseId, idempotencyKey: `skarl-license-${delivery._id}-${attempts}`,
      terms: { name: `Skarl license ${(order?.publicId ?? delivery.orderId).slice(0, 18)}`, symbol: envString("SKARL_SOLANA_LICENSE_SYMBOL", "SKARL"),
        uri: `${site}/proof?order=${delivery.orderId}`, fields: { license: licenseDigest } } };
  },
});

export const record = internalMutation({
  args: { licenseId: v.id("solanaLicenses"), outcome },
  handler: async (ctx, args) => {
    const { status } = args.outcome;
    await ctx.db.patch(args.licenseId, "error" in args.outcome
      ? { status, lastError: args.outcome.error.slice(0, 200), updatedAt: Date.now() }
      : { status, mintAddress: args.outcome.mintAddress, signature: args.outcome.signature, holderAddress: args.outcome.holderAddress,
        lastError: undefined, updatedAt: Date.now() });
  },
});

export const forOrder = internalQuery({
  args: { orderId: v.id("orders") },
  handler: (ctx, args) => ctx.db.query("solanaLicenses").withIndex("by_order", q => q.eq("orderId", args.orderId)).collect(),
});
