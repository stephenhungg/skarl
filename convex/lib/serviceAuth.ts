import type { QueryCtx } from "../_generated/server";
import { demoToken, type DemoPrincipal } from "./demoAuth";

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
