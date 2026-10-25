import { v } from "convex/values";
import { getAddress, hashMessage, verifyMessage, type Hex } from "viem";
import { createSiweMessage } from "viem/siwe";
import { mutation, type MutationCtx } from "./_generated/server";
import { PAYMENT_CHAIN_ID } from "../packages/contracts/src/chain";
import { requireRole } from "./lib/demoAuth";
import { actorFor, audit, digest, normalizeAddress, requireTenant } from "./lib/finance";

const DOMAIN = "skarl.vercel.app";
const URI = `https://${DOMAIN}`;
const CHALLENGE_TTL_MS = 5 * 60_000;

async function contributorFor(ctx: MutationCtx, demoIdentity: string, tokenIdentifier: string) {
  const controller = await requireRole(ctx, demoIdentity, "controller");
  const contributor = await ctx.db.query("memberships").withIndex("by_token_identifier", q =>
    q.eq("tokenIdentifier", tokenIdentifier)).unique();
  if (!contributor) throw new Error("contributor_not_found");
  requireTenant(controller, contributor);
  if (contributor.status !== "active" || !contributor.roles.includes("contributor") ||
    contributor.roles.includes("controller") || contributor.roles.includes("finance-agent")) {
    throw new Error("active_contributor_required");
  }
  return { controller, contributor };
}

/** Demo controller role is persisted but impersonable; this is not production authentication. */
export const challenge = mutation({
  args: { demoIdentity: v.string(), contributorTokenIdentifier: v.string(), walletAddress: v.string() },
  handler: async (ctx, args) => {
    const { contributor } = await contributorFor(ctx, args.demoIdentity, args.contributorTokenIdentifier);
    if (contributor.walletVerification) throw new Error("wallet_already_verified");
    const walletAddress = normalizeAddress(args.walletAddress);
    if (walletAddress === "0x0000000000000000000000000000000000000000") throw new Error("invalid_evm_address");
    const now = Date.now(), expiresAt = now + CHALLENGE_TTL_MS;
    // A public challenge nonce is not a secret. Convex's transaction-seeded randomness
    // distinguishes challenges; the persisted exact message and consumption prevent replay.
    const nonce = digest({ membership: contributor._id, now, random: Math.random() });
    const message = createSiweMessage({
      domain: DOMAIN, uri: URI, version: "1", chainId: PAYMENT_CHAIN_ID,
      address: getAddress(walletAddress), nonce,
      statement: `Register this Base Sepolia payout wallet for Skarl contributor ${contributor.tokenIdentifier}.`,
      requestId: contributor._id, issuedAt: new Date(now), expirationTime: new Date(expiresAt),
      resources: [`urn:skarl:organization:${contributor.organizationId}`, `urn:skarl:membership:${contributor._id}`],
    });
    await ctx.db.patch(contributor._id, { walletChallenge: { message, nonce, walletAddress, expiresAt } });
    return { message, nonce, expiresAt, walletAddress, chainId: PAYMENT_CHAIN_ID };
  },
});

export const verify = mutation({
  args: { demoIdentity: v.string(), contributorTokenIdentifier: v.string(), nonce: v.string(), signature: v.string() },
  handler: async (ctx, args) => {
    const { controller, contributor } = await contributorFor(ctx, args.demoIdentity, args.contributorTokenIdentifier);
    const existing = contributor.walletVerification;
    if (existing) {
      if (existing.nonce !== args.nonce || existing.signature !== args.signature) throw new Error("wallet_already_verified");
      return { verified: true as const, replayed: true, walletAddress: contributor.walletAddress!, chainId: existing.chainId, verifiedAt: existing.verifiedAt };
    }
    const challenge = contributor.walletChallenge;
    if (!challenge || challenge.nonce !== args.nonce) throw new Error("wallet_challenge_not_found");
    if (Date.now() >= challenge.expiresAt) throw new Error("wallet_challenge_expired");
    if (!/^0x[0-9a-fA-F]{130}$/.test(args.signature)) throw new Error("invalid_wallet_signature");
    let valid = false;
    try {
      valid = await verifyMessage({ address: getAddress(challenge.walletAddress), message: challenge.message, signature: args.signature as Hex });
    } catch { /* Malformed signatures are refused without provider/network calls. */ }
    if (!valid) throw new Error("invalid_wallet_signature");
    const verifiedAt = Date.now();
    await ctx.db.patch(contributor._id, {
      walletAddress: challenge.walletAddress, walletChallenge: undefined,
      walletVerification: { siweMessageHash: hashMessage(challenge.message), nonce: challenge.nonce,
        signature: args.signature, chainId: PAYMENT_CHAIN_ID, verifiedAt },
    });
    await audit(ctx, { organizationId: contributor.organizationId, eventKey: `wallet-verified:${contributor._id}:${challenge.nonce}`,
      actor: actorFor(controller), action: "contributor_wallet_verified", entityType: "memberships", entityId: contributor._id,
      reason: "Controller registered a Base Sepolia contributor payout wallet after EIP-191 verification of a one-use SIWE challenge.",
      evidenceReferences: [hashMessage(challenge.message)] });
    return { verified: true as const, replayed: false, walletAddress: challenge.walletAddress, chainId: PAYMENT_CHAIN_ID, verifiedAt };
  },
});
