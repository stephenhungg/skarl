import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { isFinanceAgent, requireRole } from "./lib/demoAuth";
import { actorFor, audit, digest, requireBuyerOrder } from "./lib/finance";
import { payoutTotals, reportingThreshold, rowFor, taxCsv, taxYear, TAX_ASSUMPTION, TAX_COUNTRIES, TAX_LABEL } from "./lib/tax";

const form = v.union(v.literal("none"), v.literal("w9_on_file"), v.literal("w8ben_on_file"));
const scope = { demoIdentity: v.string(), orderId: v.optional(v.id("orders")), year: v.optional(v.number()) };
export const myProfile = query({ args: { demoIdentity: v.string() }, handler: async (ctx, args) => {
  const principal = await requireRole(ctx, args.demoIdentity, "contributor");
  return { label: TAX_LABEL, country: principal.taxProfile?.country, taxForm: principal.taxProfile?.taxForm ?? "none", updatedAt: principal.taxProfile?.updatedAt };
} });
export const setProfile = mutation({ args: { demoIdentity: v.string(), country: v.string(), taxForm: form }, handler: async (ctx, args) => {
  const principal = await requireRole(ctx, args.demoIdentity, "contributor");
  // A bad membership role assignment must not turn the finance service into a contributor.
  if (isFinanceAgent(principal)) throw new Error("agent_tax_status_refused");
  // Country and the bounded attestation enum are the entire input. No form contents or IDs are accepted.
  const country = args.country.trim().toUpperCase();
  if (!TAX_COUNTRIES.has(country)) throw new Error("invalid_iso_country");
  // Keep distinct changes auditable even when two updates share the same clock millisecond.
  const profile = { country, taxForm: args.taxForm, updatedAt: Math.max(Date.now(), (principal.taxProfile?.updatedAt ?? 0) + 1) };
  if (principal.taxProfile?.country === country && principal.taxProfile.taxForm === args.taxForm) return { ok: true, replayed: true, label: TAX_LABEL };
  await ctx.db.patch(principal._id, { taxProfile: profile });
  await audit(ctx, { organizationId: principal.organizationId, eventKey: `tax_profile:${principal._id}:${digest(profile)}`,
    actor: actorFor(principal), action: "contributor_tax_profile_attested", entityType: "memberships", entityId: principal._id,
    reason: `${TAX_LABEL}. Contributor attested ${args.taxForm} for ${country}; no form or tax identifier collected.` });
  return { ok: true, replayed: false, label: TAX_LABEL };
} });

async function summaryFor(ctx: QueryCtx, args: { demoIdentity: string; orderId?: Id<"orders">; year?: number }) {
  const principal = await requireRole(ctx, args.demoIdentity, ["buyer", "controller", "finance-agent"]);
  const year = taxYear(args.year);
  const members = await ctx.db.query("memberships").withIndex("by_org_identity", q => q.eq("organizationId", principal.organizationId)).collect();
  const totals = await payoutTotals(ctx, principal.organizationId, year);
  let tokens = new Set([...members.filter(member => member.roles.includes("contributor")).map(member => member.tokenIdentifier), ...totals.keys()]);
  if (args.orderId) {
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("order_not_found");
    requireBuyerOrder(principal, order);
    const submissions = await ctx.db.query("submissions").withIndex("by_order_status", q => q.eq("orderId", order._id)).collect();
    const payables = await ctx.db.query("payables").withIndex("by_order", q => q.eq("orderId", order._id)).collect();
    tokens = new Set([...submissions.map(row => row.contributorTokenIdentifier), ...payables.map(row => row.contributorTokenIdentifier)]);
  }
  const rows = [...tokens].map(token => rowFor(members.find(member => member.tokenIdentifier === token), token, totals.get(token))).sort((a, b) => a.contributorId.localeCompare(b.contributorId));
  return { label: TAX_LABEL, year, assumption: TAX_ASSUMPTION, thresholdMicroUsd: reportingThreshold().toString(), rows, csv: taxCsv(rows) };
}
/** Journals are authoritative. The selected order chooses contributors; YTD includes all their org payouts. */
export const summary = query({ args: scope, handler: summaryFor });
export const contributorsNeedingForms = query({ args: scope, handler: async (ctx, args) => {
  const result = await summaryFor(ctx, args);
  return { label: TAX_LABEL, year: result.year, rows: result.rows.filter(row => row.taxForm === "none") };
} });
