import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireRole } from "./lib/demoAuth";

export const CHALLENGE_TTL_MS = 2 * 60_000;
// Fixed, pronounceable words; exclude the task's cup/coaster/action vocabulary.
export const LIVENESS_WORDS = [
  "apple", "apron", "arrow", "bacon", "badge", "basket", "beach", "bean",
  "bear", "bell", "berry", "bird", "blanket", "boat", "bone", "book",
  "boot", "bottle", "branch", "bread", "bridge", "broom", "bubble", "button",
  "cabin", "candle", "carrot", "castle", "chair", "cheese", "cherry", "chicken",
  "circle", "cloud", "cookie", "corn", "cotton", "crayon", "crown", "daisy",
  "desert", "dinner", "dolphin", "donkey", "dragon", "dream", "drum", "duck",
  "eagle", "earth", "elbow", "engine", "feather", "fence", "field", "finger",
  "flower", "forest", "fork", "fox", "frog", "garden", "giant", "glove",
  "goat", "grape", "grass", "guitar", "hammer", "hat", "honey", "horse",
  "island", "jacket", "jelly", "juice", "key", "kite", "kitten", "ladder",
  "lake", "lamp", "leaf", "lemon", "letter", "lion", "lizard", "moon",
  "mountain", "mouse", "muffin", "nest", "ocean", "onion", "orange", "otter",
  "panda", "paper", "peach", "peanut", "pencil", "pepper", "piano", "pillow",
  "planet", "pocket", "potato", "pumpkin", "rabbit", "rainbow", "river", "robot",
  "rocket", "saddle", "salad", "sand", "scarf", "shell", "sheep", "shoe",
  "snow", "soap", "spoon", "star", "stone", "tiger", "train", "tree",
] as const;

export const issueChallenge = mutation({
  args: { demoIdentity: v.string() },
  handler: async (ctx, args) => {
    const contributor = await requireRole(ctx, args.demoIdentity, "contributor");
    const issuedAt = Date.now(), expiresAt = issuedAt + CHALLENGE_TTL_MS;
    // Like the wallet nonce, these public words use Convex's transaction-seeded
    // randomness. Persisted ownership, expiry and atomic consumption prevent reuse.
    const available: string[] = [...LIVENESS_WORDS];
    const words = Array.from({ length: 3 }, () => available.splice(Math.floor(Math.random() * available.length), 1)[0]!);
    const challengeId = await ctx.db.insert("livenessChallenges", {
      organizationId: contributor.organizationId, contributorTokenIdentifier: contributor.tokenIdentifier,
      words, issuedAt, expiresAt,
    });
    return { challengeId, words, expiresAt };
  },
});
