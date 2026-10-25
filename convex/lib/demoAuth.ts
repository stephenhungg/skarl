import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { demoModeEnabled, signedInMembership } from "./authMemberships";

/** DEMO ONLY: these public, impersonable selectors are not authentication. */
export const DEMO_IDENTITIES = ["buyer", "contributor", "controller", "finance-agent"] as const;
export type DemoIdentity = typeof DEMO_IDENTITIES[number];
export type DemoRole = Doc<"memberships">["roles"][number];
export type DemoPrincipal = Doc<"memberships">;
export const demoToken = (identity: DemoIdentity) => `demo:skarl:${identity}`;
// Service identity survives bad role provisioning; a caller-supplied selector
// never determines whether an authenticated human is an agent.
export const POLICY_TOKEN = "service:skarl:policy-engine";
export const isPolicyEngine = (member: DemoPrincipal) => member.tokenIdentifier === POLICY_TOKEN || member.roles.includes("policy-engine");
export const isFinanceAgent = (member: DemoPrincipal) =>
  member.tokenIdentifier === demoToken("finance-agent") || member.roles.includes("finance-agent");

export class DemoRoleError extends Error {
  constructor(public readonly code: string, public readonly principal?: DemoPrincipal) {
    super(code);
  }
}

/** Every mutation, including the privileged seed bootstrap, checks persisted roles here. */
export async function requireRole(
  ctx: Pick<QueryCtx | MutationCtx, "db" | "auth">,
  demoIdentity: string,
  role: DemoRole | readonly DemoRole[],
): Promise<DemoPrincipal> {
  const signedIn = await signedInMembership(ctx);
  let member = signedIn.member;
  if (signedIn.userId === null) {
    if (!demoModeEnabled()) throw new DemoRoleError("unauthenticated");
    if (!DEMO_IDENTITIES.includes(demoIdentity as DemoIdentity)) throw new DemoRoleError("unknown_demo_identity");
    member = await ctx.db.query("memberships")
      .withIndex("by_token_identifier", q => q.eq("tokenIdentifier", demoToken(demoIdentity as DemoIdentity))).unique();
  }
  if (!member || member.status !== "active") throw new DemoRoleError(signedIn.userId ? "inactive_membership" : "inactive_demo_identity", member ?? undefined);
  const organization = await ctx.db.get(member.organizationId);
  if (!organization || organization.status !== "active") throw new DemoRoleError("inactive_organization");
  const roles = typeof role === "string" ? [role] : role;
  if (isPolicyEngine(member)) throw new DemoRoleError("internal_service_only", member);
  const isAgent = isFinanceAgent(member);
  const humanOnly = roles.every(required => required === "buyer" || required === "controller");
  if (humanOnly && isAgent) {
    throw new DemoRoleError("agent_approval_refused", member);
  }
  if ((signedIn.userId && isAgent) || (member.roles.includes("controller") && member.roles.includes("contributor")) ||
    (humanOnly && member.roles.includes("buyer") && member.roles.includes("contributor"))) {
    throw new DemoRoleError("conflicting_roles", member);
  }
  if (!roles.some(required => member.roles.includes(required) && !(required === "controller" && isAgent))) {
    throw new DemoRoleError("forbidden", member);
  }
  return member;
}

/** Human order authority follows the owning organization, never a client selector. */
export function hasOrderAuthority(member: DemoPrincipal | null, order: Pick<Doc<"orders">, "organizationId">): boolean {
  return !!member && member.status === "active" && member.organizationId === order.organizationId &&
    !isFinanceAgent(member) && !isPolicyEngine(member) && !member.roles.includes("contributor") &&
    (member.roles.includes("buyer") || member.roles.includes("controller"));
}

export async function requireOrderAuthority(
  ctx: Pick<QueryCtx | MutationCtx, "db" | "auth">, identity: string, orderId: Id<"orders">,
) {
  const principal = await requireRole(ctx, identity, ["buyer", "controller"]);
  const order = await ctx.db.get(orderId);
  if (!order) throw new Error("order_not_found");
  if (principal.organizationId !== order.organizationId) throw new Error("cross_organization_access");
  if (!hasOrderAuthority(principal, order)) throw new Error("order_not_owned");
  return { principal, order };
}

/** No-order demo controls cannot grant access to a different organization. */
export async function requireDemoOrganizationAuthority(
  ctx: Pick<QueryCtx | MutationCtx, "db" | "auth">, identity: string,
) {
  const principal = await requireRole(ctx, identity, ["buyer", "controller"]);
  const organization = await ctx.db.get(principal.organizationId);
  if (organization?.demoKey !== "skarl-demo-v1" || !hasOrderAuthority(principal, { organizationId: principal.organizationId })) {
    throw new Error("demo_organization_buyer_required");
  }
  return principal;
}
