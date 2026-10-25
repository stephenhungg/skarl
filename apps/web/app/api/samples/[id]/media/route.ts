import { webConfig } from "../../../../../lib/config";
import type { NextRequest } from "next/server";
import { paymentJson, paymentService } from "../../../../../lib/payments/server";
import { evidenceApi } from "../../../../../lib/payments/evidence-service";
import { verifyMediaToken } from "../../../../../lib/payments/media-token";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const sampleId = (await context.params).id;
    const { db, serviceSecret } = paymentService();
    const grant = verifyMediaToken(request.nextUrl.searchParams.get("token") ?? "", sampleId, serviceSecret);
    const sample = await db.query(evidenceApi.sample, { serviceSecret, sampleId });
    if (grant.binding !== sample.binding) throw new Error("invalid_media_grant");
    // Stream bytes, never redirect to a long-lived Convex bearer URL. Ignore caller-controlled headers/URLs.
    const upstream = await fetch(sample.storageUrl, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(webConfig.mediaFetchTimeoutMs) });
    if (!upstream.ok || !upstream.body) return paymentJson({ error: "media_unavailable" }, 503);
    return new Response(upstream.body, { headers: { "Content-Type": sample.mimeType, "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" } });
  } catch {
    return paymentJson({ error: "media_unavailable_or_grant_expired" }, 403);
  }
}
