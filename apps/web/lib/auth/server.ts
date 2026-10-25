import type { ConvexHttpClient } from "convex/browser";

/** Never turn an authenticated HTTP request into an anonymous demo request. */
export async function authenticateConvexRequest(db: ConvexHttpClient, request: Request) {
  // Public agent/script requests have no auth cookie and need no Next request
  // context. The official helper reads the server-only cookie for browser calls.
  if (!/(?:^|;\s*)(?:__Host-)?__convexAuth(?:JWT|RefreshToken)=[^;]+/.test(request.headers.get("cookie") ?? "")) return;
  const { convexAuthNextjsToken } = await import("@convex-dev/auth/nextjs/server");
  const token = await convexAuthNextjsToken();
  if (!token) throw new Error("unauthenticated");
  db.setAuth(token);
}
