import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { POLICY_TOKEN, demoToken, type DemoPrincipal } from "./demoAuth";

/** Trusted internal service lookup. Never call this to authorize a public caller.
 * Human entrypoints must authorize the caller first; model args cannot select it.
 * This persisted service remains available when public demo selectors are off.
 */
export async function requireFinanceService(ctx: Pick<QueryCtx, "db">): Promise<DemoPrincipal> {
  const member = await ctx.db.query("memberships").withIndex("by_token_identifier", q =>
    q.eq("tokenIdentifier", demoToken("finance-agent"))).unique();
  if (!member || member.status !== "active" || !member.roles.includes("finance-agent") || member.roles.includes("contributor")) {
    throw new Error("inactive_finance_service");
  }
  const org = await ctx.db.get(member.organizationId);
  if (!org || org.status !== "active") throw new Error("inactive_organization");
  return member;
}

/** Internal deterministic service only. Public selectors cannot name this principal. */
export async function requirePolicyService(ctx: Pick<MutationCtx, "db">, organizationId: Id<"organizations">): Promise<DemoPrincipal> {
  const org = await ctx.db.get(organizationId);
  if (!org || org.status !== "active") throw new Error("inactive_organization");
  const existing = await ctx.db.query("memberships").withIndex("by_token_identifier", q => q.eq("tokenIdentifier", POLICY_TOKEN)).unique();
  if (existing) {
    if (existing.organizationId !== organizationId || existing.status !== "active" || existing.roles.length !== 1 ||
      existing.roles[0] !== "policy-engine") throw new Error("inactive_policy_service");
    return existing;
  }
  const id = await ctx.db.insert("memberships", { organizationId, issuer: "service:skarl", subject: "policy-engine",
    tokenIdentifier: POLICY_TOKEN, roles: ["policy-engine"], grantedByTokenIdentifier: POLICY_TOKEN, status: "active" });
  return (await ctx.db.get(id))!;
}
