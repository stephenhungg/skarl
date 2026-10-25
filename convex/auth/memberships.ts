import { v, ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { authToken, controllerEmailAllowed, demoModeEnabled, ensureAuthMembership, signedInMembership } from "../lib/authMemberships";
import { audit } from "../lib/finance";

export const claimRole = mutation({
  // Internal policy authority is never a self-service role claim.
  args: { role: v.union(v.literal("buyer"), v.literal("contributor"), v.literal("controller"), v.literal("finance-agent")) },
  handler: async (ctx, { role }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("unauthenticated");
    if (role === "finance-agent") throw new ConvexError("human_finance_agent_refused");
    const user = await ctx.db.get(userId);
    if (!user) throw new ConvexError("user_not_found");
    if (role === "controller" && !controllerEmailAllowed(user)) throw new ConvexError("controller_verified_email_not_allowlisted");
    const member = await ensureAuthMembership(ctx, userId);
    if (!member) throw new ConvexError("demo_organization_unavailable");
    if (member.status !== "active") throw new ConvexError("inactive_membership");
    const org = await ctx.db.get(member.organizationId);
    if (!org || org.status !== "active") throw new ConvexError("inactive_organization");
    const roles = [...new Set([...member.roles, role])];
    if (roles.includes("finance-agent") || (roles.includes("contributor") && (roles.includes("buyer") || roles.includes("controller")))) {
      throw new ConvexError("conflicting_roles");
    }
    await ctx.db.patch(member._id, { roles });
    await audit(ctx, { organizationId: member.organizationId, eventKey: `auth:claim:${userId}:${role}`,
      actor: { kind: "human", identity: authToken(userId) }, action: "membership_role_claimed",
      entityType: "memberships", entityId: member._id,
      reason: role === "controller" ? "Verified email matched the operator controller allowlist." : "Demo organization self-service role claim." });
    return { roles };
  },
});

export const me = query({
  args: {},
  handler: async ctx => {
    const { userId, member } = await signedInMembership(ctx);
    const user = userId ? await ctx.db.get(userId) : null;
    const org = member ? await ctx.db.get(member.organizationId) : null;
    const active = member?.status === "active" && org?.status === "active";
    return { userId, email: user?.email ?? null, roles: active ? member.roles : [],
      demoMode: demoModeEnabled(),
      canClaimController: controllerEmailAllowed(user) && !member?.roles.includes("contributor") && !member?.roles.includes("finance-agent"),
    };
  },
});
