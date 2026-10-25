import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireRole } from "./lib/demoAuth";
import { requireTenant } from "./lib/finance";
import { buildProvenance } from "./lib/provenance";

export const forSubmission = query({
  args: { demoIdentity: v.string(), submissionId: v.id("submissions") },
  handler: async (ctx, args) => {
    const principal = await requireRole(ctx, args.demoIdentity, ["buyer", "controller", "contributor"]);
    if (principal.roles.includes("finance-agent")) throw new Error("forbidden");
    const submission = await ctx.db.get(args.submissionId);
    if (!submission) throw new Error("submission_not_found");
    requireTenant(principal, submission);
    const order = await ctx.db.get(submission.orderId);
    if (!order) throw new Error("order_not_found");
    requireTenant(principal, order);
    const controller = principal.roles.includes("controller");
    const owner = principal.roles.includes("contributor") && submission.contributorTokenIdentifier === principal.tokenIdentifier;
    const buyer = principal.roles.includes("buyer") && order.buyerTokenIdentifier === principal.tokenIdentifier;
    if (!controller && !owner && !buyer) throw new Error("submission_not_owned");
    return buildProvenance(ctx, submission);
  },
});
