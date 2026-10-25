import { convexAuthNextjsMiddleware } from "@convex-dev/auth/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

const authMiddleware = convexAuthNextjsMiddleware();

// Next 16 calls middleware "proxy". Convex handles auth cookies and /api/auth;
// authorization remains in Convex, with a demo-aware dashboard gate in the UI.
export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL?.trim()) return NextResponse.next();
  return authMiddleware(request, event);
}

export const config = {
  matcher: ["/((?!api|_next|.*\\..*).*)", "/api/auth/:path*"],
};
