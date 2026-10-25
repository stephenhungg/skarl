import { v, type Infer } from "convex/values";
import type { Doc } from "../_generated/dataModel";

export const diversityValidator = v.object({
  maxPerContributor: v.optional(v.number()),
  maxPerEnvironment: v.optional(v.number()),
  requiredVariants: v.optional(v.array(v.string())),
});
export type Diversity = Infer<typeof diversityValidator>;

/** Labels describe contributor declarations; they are not inferred environmental facts. */
export function normalizeDiversityTag(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const tag = value.trim();
  if (!tag || tag.length > 120 || /[\u0000-\u001f\u007f]/.test(tag)) throw new Error("invalid_diversity_tag");
  return tag;
}

export function normalizeDiversity(value: Diversity | undefined, quantity: bigint): Diversity | undefined {
  if (value === undefined) return undefined;
  for (const cap of [value.maxPerContributor, value.maxPerEnvironment]) {
    if (cap !== undefined && (!Number.isSafeInteger(cap) || cap < 1)) throw new Error("invalid_diversity_quota");
  }
  const variants = value.requiredVariants?.map(tag => normalizeDiversityTag(tag)!);
  if (variants && (variants.length > 100 || BigInt(variants.length) > quantity || new Set(variants).size !== variants.length)) {
    throw new Error("invalid_diversity_variants");
  }
  return { ...(value.maxPerContributor !== undefined ? { maxPerContributor: value.maxPerContributor } : {}),
    ...(value.maxPerEnvironment !== undefined ? { maxPerEnvironment: value.maxPerEnvironment } : {}),
    ...(variants !== undefined ? { requiredVariants: [...variants].sort() } : {}) };
}

type TaggedSample = Pick<Doc<"submissions">, "contributorTokenIdentifier" | "environment" | "variant">;

/** Run inside acceptance's transaction, which also updates the order, so racing accepts conflict. */
export function diversityRefusal(order: Pick<Doc<"orders">, "diversity" | "quantityRequested" | "acceptedCount">,
  accepted: TaggedSample[], candidate: TaggedSample): string | null {
  const quotas = order.diversity;
  if (!quotas) return null;
  if (quotas.maxPerContributor !== undefined && accepted.filter(sample =>
    sample.contributorTokenIdentifier === candidate.contributorTokenIdentifier).length >= quotas.maxPerContributor) return "maxPerContributor";
  // An untagged upload cannot bypass an environment quota by omitting its bucket.
  if (quotas.maxPerEnvironment !== undefined && (!candidate.environment || accepted.filter(sample =>
    sample.environment === candidate.environment).length >= quotas.maxPerEnvironment)) return "maxPerEnvironment";
  const covered = new Set([...accepted.map(sample => sample.variant), candidate.variant]);
  const missing = (quotas.requiredVariants ?? []).filter(variant => !covered.has(variant));
  // Reserve one remaining slot per uncovered variant; otherwise the order could
  // fill with valid clips while never satisfying the buyer's requested coverage.
  if (BigInt(missing.length) > order.quantityRequested - order.acceptedCount - 1n) return "requiredVariants";
  return null;
}
