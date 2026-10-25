import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConvexHttpClient } from "convex/browser";
import { authenticateConvexRequest } from "../../lib/auth/server";

const mocks = vi.hoisted(() => ({ token: vi.fn() }));
vi.mock("@convex-dev/auth/nextjs/server", () => ({ convexAuthNextjsToken: mocks.token }));

function client() {
  const setAuth = vi.fn();
  return { db: { setAuth } as unknown as ConvexHttpClient, setAuth };
}

beforeEach(() => { mocks.token.mockReset(); });

describe("HTTP route identity propagation", () => {
  it("preserves anonymous demo/script requests without reading Next request state", async () => {
    const { db, setAuth } = client();
    await authenticateConvexRequest(db, new Request("https://skarl.example/api/payments/payout"));
    expect(mocks.token).not.toHaveBeenCalled();
    expect(setAuth).not.toHaveBeenCalled();
  });

  it("passes the signed-in browser token to Convex instead of using demo selectors", async () => {
    mocks.token.mockResolvedValue("signed-controller-token");
    const { db, setAuth } = client();
    await authenticateConvexRequest(db, new Request("https://skarl.example/api/payments/payout", {
      headers: { cookie: "__Host-__convexAuthJWT=signed-controller-token", "x-skarl-demo-identity": "finance-agent" },
    }));
    expect(setAuth).toHaveBeenCalledExactlyOnceWith("signed-controller-token");
  });

  it("refuses a stale signed-in cookie instead of falling back to anonymous demo mode", async () => {
    mocks.token.mockResolvedValue(undefined);
    const { db, setAuth } = client();
    await expect(authenticateConvexRequest(db, new Request("https://skarl.example/api/payments/payout", {
      headers: { cookie: "__Host-__convexAuthRefreshToken=stale-session" },
    }))).rejects.toThrow("unauthenticated");
    expect(setAuth).not.toHaveBeenCalled();
  });

  it("supports local development cookies and ignores unrelated cookies", async () => {
    const { db, setAuth } = client();
    await authenticateConvexRequest(db, new Request("http://localhost:3000/api/payments/payout", {
      headers: { cookie: "theme=paper; __convexAuthOAuthVerifier=in-progress" },
    }));
    expect(mocks.token).not.toHaveBeenCalled();
    mocks.token.mockResolvedValue("local-signed-token");
    await authenticateConvexRequest(db, new Request("http://localhost:3000/api/payments/payout", {
      headers: { cookie: "theme=paper; __convexAuthJWT=local-signed-token" },
    }));
    expect(setAuth).toHaveBeenCalledExactlyOnceWith("local-signed-token");
  });
});
