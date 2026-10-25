import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export const authToken = (userId: Id<"users">) => `auth:${userId}`;
export const demoModeEnabled = () => process.env.SKARL_DEMO_IDENTITIES !== "off";
export const githubEnabled = () => Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET);

/** Password signup alone does not prove ownership of a controller's email. */
export function controllerEmailAllowed(user: Doc<"users"> | null) {
  if (!user?.email || !user.emailVerificationTime) return false;
  const allowlist = (process.env.SKARL_CONTROLLER_EMAILS ?? "").split(",")
    .map(email => email.trim().toLowerCase()).filter(Boolean);
  return allowlist.includes(user.email.trim().toLowerCase());
}

export async function signedInMembership(ctx: Pick<QueryCtx, "db" | "auth">) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return { userId: null, member: null };
  const member = await ctx.db.query("memberships")
    .withIndex("by_token_identifier", q => q.eq("tokenIdentifier", authToken(userId))).unique();
  return { userId, member };
}

/** Called only from the auth lifecycle and claimRole, never from a query. */
export async function ensureAuthMembership(ctx: Pick<MutationCtx, "db">, userId: Id<"users">) {
  const tokenIdentifier = authToken(userId);
  const existing = await ctx.db.query("memberships")
    .withIndex("by_token_identifier", q => q.eq("tokenIdentifier", tokenIdentifier)).unique();
  if (existing) return existing;
  const org = await ctx.db.query("organizations")
    .withIndex("by_demo_key", q => q.eq("demoKey", "skarl-demo-v1")).unique();
  // Authentication can be initialized before the operator seeds the demo org.
  if (!org || org.status !== "active") return null;
  const id = await ctx.db.insert("memberships", {
    organizationId: org._id, issuer: "auth", subject: userId, tokenIdentifier,
    roles: [], grantedByTokenIdentifier: tokenIdentifier, status: "active",
  });
  return ctx.db.get(id);
}
