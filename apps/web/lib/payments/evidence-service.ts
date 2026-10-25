import { makeFunctionReference } from "convex/server";
import type { FunctionArgs, FunctionReturnType, ApiFromModules } from "convex/server";
import type * as handlers from "../../../../packages/payments/src/evidence-store";

type EvidenceApi = ApiFromModules<{ evidenceSales: typeof handlers }>["evidenceSales"];

// A thin convex/evidenceSales.ts re-export is the backend owner's deployment handoff.
export const evidenceApi = {
  sample: makeFunctionReference<"query", FunctionArgs<EvidenceApi["sample"]>, FunctionReturnType<EvidenceApi["sample"]>>("evidenceSales:sample"),
  claim: makeFunctionReference<"mutation", FunctionArgs<EvidenceApi["claim"]>, FunctionReturnType<EvidenceApi["claim"]>>("evidenceSales:claim"),
  confirm: makeFunctionReference<"mutation", FunctionArgs<EvidenceApi["confirm"]>, FunctionReturnType<EvidenceApi["confirm"]>>("evidenceSales:confirm"),
};
