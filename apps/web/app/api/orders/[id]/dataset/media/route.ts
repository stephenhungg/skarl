import { webConfig } from "../../../../../../lib/config";
import { authenticateConvexRequest } from "../../../../../../lib/auth/server";
import { makeFunctionReference } from "convex/server";
import type { NextRequest } from "next/server";
import { paymentJson, paymentService, type Id } from "../../../../../../lib/payments/server";
import { verifyDatasetMediaToken } from "../../../../../../../../packages/payments/src/dataset-media-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const originalMedia = makeFunctionReference<"query", {
  serviceSecret: string; demoIdentity: string; orderId: Id<"orders">; submissionId: Id<"submissions">; binding: string;
}, { storageUrl: string; mimeType: string; binding: string }>("datasets:originalMedia");

/** Expiring bearer grant; recheck current licensed delivery before streaming bytes. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const orderId = (await context.params).id;
    const { db, serviceSecret } = paymentService();
    await authenticateConvexRequest(db, request);
    const grant = verifyDatasetMediaToken(request.nextUrl.searchParams.get("token") ?? "", serviceSecret);
    if (grant.orderId !== orderId) throw new Error("invalid_dataset_media_grant");
    const original = await db.query(originalMedia, { serviceSecret, demoIdentity: grant.demoIdentity,
      orderId: grant.orderId as Id<"orders">, submissionId: grant.submissionId as Id<"submissions">, binding: grant.binding });
    if (original.binding !== grant.binding) throw new Error("invalid_dataset_media_grant");
    const upstream = await fetch(original.storageUrl, {
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(webConfig.mediaFetchTimeoutMs),
    });
    if (!upstream.ok || !upstream.body) return paymentJson({ error: "dataset_media_unavailable" }, 503);
    return new Response(upstream.body, { headers: {
      "Content-Type": original.mimeType,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    } });
  } catch {
    return paymentJson({ error: "dataset_media_unavailable_or_grant_expired" }, 403);
  }
}
