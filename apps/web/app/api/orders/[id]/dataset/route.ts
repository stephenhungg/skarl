import { ConvexHttpClient } from "convex/browser";
import type { NextRequest } from "next/server";
import { api, paymentJson, type Id } from "../../../../../lib/payments/server";
import { lerobotManifest, rldsJsonManifest } from "../../../../../../../convex/lib/trainingFormats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Membership, buyer ownership, consent and delivery checks run in the Convex query. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const demoIdentity = request.headers.get("x-skarl-demo-identity");
  if (!demoIdentity) return paymentJson({ error: "demo_identity_required" }, 400);
  const orderId = (await context.params).id;
  if (!/^[a-zA-Z0-9]+$/.test(orderId)) return paymentJson({ error: "invalid_order_id" }, 400);
  const format = request.nextUrl.searchParams.get("format") ?? "json";
  if (!["json", "jsonl", "lerobot", "rlds-json"].includes(format)) return paymentJson({ error: "invalid_dataset_format" }, 400);
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return paymentJson({ error: "dataset_not_configured" }, 503);
  try {
    const db = new ConvexHttpClient(url);
    const manifest = await db.query(api.datasets.forOrder, { demoIdentity, orderId: orderId as Id<"orders">,
      refreshKey: Math.floor(Date.now() / 60_000) });
    if (format === "json") return paymentJson(manifest);
    if (format === "lerobot") return paymentJson(lerobotManifest(manifest));
    if (format === "rlds-json") return paymentJson(rldsJsonManifest(manifest));
    // Authorize and materialize the snapshot before starting the response. Each
    // pull emits one complete sample without a manifest or metadata line.
    const samples = manifest.samples[Symbol.iterator]();
    const encoder = new TextEncoder();
    return new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = samples.next();
        if (next.done) { controller.close(); return; }
        controller.enqueue(encoder.encode(JSON.stringify(next.value,
          (_, value) => typeof value === "bigint" ? value.toString() : value) + "\n"));
      },
    }), { headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `attachment; filename="skarl-${orderId}.jsonl"`,
    } });
  } catch (error) {
    // Convex wrappers can contain private arguments. Expose only fixed codes.
    const message = error instanceof Error ? error.message : "";
    if (["forbidden", "order_not_owned", "cross_organization", "unknown_demo_identity", "inactive_demo_identity",
      "inactive_organization", "conflicting_roles", "agent_approval_refused"].some(code => message.includes(code))) {
      return paymentJson({ error: "dataset_forbidden" }, 403);
    }
    if (message.includes("order_not_found")) return paymentJson({ error: "order_unavailable" }, 404);
    if (message.includes("ArgumentValidationError")) return paymentJson({ error: "invalid_order_id" }, 400);
    return paymentJson({ error: "dataset_unavailable" }, 503);
  }
}
