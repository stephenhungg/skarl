import { replayStorageUrl } from "@/features/replay/media-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Possession of the existing storage bearer URL is required. No role or media grant is minted here. */
export async function GET(request: Request) {
  try {
    const input = new URL(request.url).searchParams.get("url") ?? "";
    if (input.length > 2048) throw new Error("invalid_media_url");
    const source = replayStorageUrl(input, process.env.NEXT_PUBLIC_CONVEX_URL ?? "");
    const range = request.headers.get("range");
    if (range && !/^bytes=\d*-\d*$/.test(range)) throw new Error("invalid_range");
    const upstream = await fetch(source, {
      headers: range ? { Range: range } : {}, redirect: "error", cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const contentType = upstream.headers.get("content-type") ?? "";
    if (!upstream.ok || !upstream.body || !contentType.startsWith("video/")) throw new Error("media_unavailable");
    const headers = new Headers({
      "Content-Type": contentType, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline",
    });
    for (const key of ["content-length", "content-range", "accept-ranges"]) {
      const value = upstream.headers.get(key);
      if (value) headers.set(key, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return Response.json({ error: "replay_media_unavailable" }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
  }
}
