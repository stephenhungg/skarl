import { authenticateConvexRequest } from "../../../../../lib/auth/server";
import { ConvexHttpClient } from "convex/browser";
import type { NextRequest } from "next/server";
import { api, paymentJson, type Id } from "../../../../../lib/payments/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only demo projection. Persisted Convex membership and ownership checks are authoritative. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const demoIdentity = request.headers.get("x-skarl-demo-identity");
  if (!demoIdentity) return paymentJson({ error: "demo_identity_required" }, 400);
  const id = (await context.params).id.replace(/^sample-/, "");
  if (!/^[a-zA-Z0-9]+$/.test(id)) return paymentJson({ error: "invalid_submission_id" }, 400);
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return paymentJson({ error: "witness_receipt_not_configured" }, 503);
  try {
    const db = new ConvexHttpClient(url);
    await authenticateConvexRequest(db, request);
    return paymentJson(await db.query(api.witnessReceipt.forSubmission, {
      demoIdentity, submissionId: id as Id<"submissions">,
    }));
  } catch (error) {
    // Wrapped Convex errors may include arguments. Return only fixed public error codes.
    const message = error instanceof Error ? error.message : "";
    if (["forbidden", "submission_not_owned", "cross_organization", "unknown_demo_identity",
      "inactive_demo_identity", "inactive_organization", "conflicting_roles", "order_not_owned"]
      .some(code => message.includes(code))) {
      return paymentJson({ error: "witness_receipt_forbidden" }, 403);
    }
    if (message.includes("submission_not_found") || message.includes("order_not_found")) {
      return paymentJson({ error: "sample_unavailable" }, 404);
    }
    if (message.includes("ArgumentValidationError")) return paymentJson({ error: "invalid_submission_id" }, 400);
    return paymentJson({ error: "witness_receipt_unavailable" }, 503);
  }
}
