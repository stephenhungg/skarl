import { configNumber, livenessWords } from "./lib/config";
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireRole } from "./lib/demoAuth";

export const CHALLENGE_TTL_MS = configNumber("SKARL_LIVENESS_CHALLENGE_TTL_MS");
// Fixed, pronounceable words; independent of task object, destination and action vocabulary.
export const LIVENESS_WORDS = livenessWords();

export const issueChallenge = mutation({
  args: { demoIdentity: v.string() },
  handler: async (ctx, args) => {
    const contributor = await requireRole(ctx, args.demoIdentity, "contributor");
    const issuedAt = Date.now(), expiresAt = issuedAt + CHALLENGE_TTL_MS;
    // Like the wallet nonce, these public words use Convex's transaction-seeded
    // randomness. Persisted ownership, expiry and atomic consumption prevent reuse.
    const available: string[] = [...LIVENESS_WORDS];
    const count = configNumber("SKARL_LIVENESS_WORD_COUNT");
    if (new Set(available).size < count || available.some(word => !/^[a-z]+$/.test(word))) throw new Error("invalid_liveness_configuration");
    const words = Array.from({ length: count }, () => available.splice(Math.floor(Math.random() * available.length), 1)[0]!);
    const challengeId = await ctx.db.insert("livenessChallenges", {
      organizationId: contributor.organizationId, contributorTokenIdentifier: contributor.tokenIdentifier,
      words, issuedAt, expiresAt,
    });
    return { challengeId, words, expiresAt };
  },
});
