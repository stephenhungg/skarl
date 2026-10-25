import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeFunctionReference } from "convex/server";
import schema from "./schema";
import { PUBLIC_RATE_POLICIES, publicFingerprint, refillBucket, type PublicSurface } from "./lib/publicRateLimit";

// Synthetic requests and clock only: no deployed service or payment claim.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const consume = makeFunctionReference<"mutation", { surface: PublicSurface; fingerprint: string },
  { allowed: boolean; retryAfterSeconds: number }>("publicSecurity:consume");
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("durable public request budgets", () => {
  it("limits a burst across requests and refills after time so one client cannot monopolize the public tools", async () => {
    const t = convexTest(schema, modules);
    let now = 1_800_000_000_000;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const args = { surface: "mcp" as const, fingerprint: "a".repeat(64) };
    for (let n = 0; n < PUBLIC_RATE_POLICIES.mcp.capacity; n++) expect((await t.mutation(consume, args)).allowed).toBe(true);
    expect(await t.mutation(consume, args)).toEqual({ allowed: false, retryAfterSeconds: 1 });
    // Denial must not push the refill forward and lock out a well-behaved retry.
    now += 251;
    vi.setSystemTime(now);
    expect((await t.mutation(consume, args)).allowed).toBe(true);
    expect((await t.mutation(consume, args)).allowed).toBe(false);
    now += 60_000;
    vi.setSystemTime(now);
    for (let n = 0; n < PUBLIC_RATE_POLICIES.mcp.capacity; n++) expect((await t.mutation(consume, args)).allowed).toBe(true);
    expect((await t.mutation(consume, args)).allowed).toBe(false);
  });

  it("caps rotating fingerprints globally and keeps independent surfaces usable", async () => {
    const t = convexTest(schema, modules), now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    await t.run(ctx => ctx.db.insert("publicRateBuckets", { key: "mcp:global", tokens: 0, updatedAt: now }));
    // Origin/IP headers can be forged: a new digest must not bypass a spent global budget.
    expect((await t.mutation(consume, { surface: "mcp", fingerprint: "b".repeat(64) })).allowed).toBe(false);
    expect((await t.mutation(consume, { surface: "discovery", fingerprint: "b".repeat(64) })).allowed).toBe(true);
    const keys = await t.run(async ctx => (await ctx.db.query("publicRateBuckets").collect()).map(row => row.key));
    expect(keys).not.toContain(`mcp:${"b".repeat(64)}`);
  });

  it.each([
    ["/mcp", "mcp"], ["/jira/feed", "jira"], ["/llms.txt", "discovery"],
    ["/.well-known/agent-card.json", "discovery"], ["/.well-known/mcp.json", "discovery"], ["/openapi.json", "discovery"],
  ] as const)("returns actionable 429 before expensive handling at %s", async (path, surface) => {
    const t = convexTest(schema, modules), now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const headers = { "x-forwarded-for": "192.0.2.42", Authorization: "Bearer synthetic-secret-never-persisted" };
    const fingerprint = await publicFingerprint(new Request(`https://example.com${path}`, { headers }));
    await t.run(ctx => ctx.db.insert("publicRateBuckets", { key: `${surface}:${fingerprint}`, tokens: 0, updatedAt: now }));
    const response = await t.fetch(path, { method: path === "/mcp" ? "POST" : "GET", headers });
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await response.json();
    if (surface === "mcp") expect(body).toMatchObject({ jsonrpc: "2.0", id: null, error: { code: -32029, data: { retryAfterSeconds: 1 } } });
    else expect(body).toMatchObject({ error: "rate_limited", retryAfterSeconds: 1 });
    const stored = JSON.stringify(await t.run(ctx => ctx.db.query("publicRateBuckets").collect()));
    expect(stored).not.toMatch(/192\.0\.2\.42|synthetic-secret/);
  });

  it("uses a shared fallback and ignores bearer rotation, since rate identity must not grant authority", async () => {
    const make = (headers = {}) => publicFingerprint(new Request("https://example.com", { headers }));
    expect(await make()).toBe(await make());
    expect(await make({ Authorization: "Bearer one" })).toBe(await make({ Authorization: "Bearer two" }));
    expect(await make({ Origin: "https://one.example" })).not.toBe(await make({ Origin: "https://two.example" }));
    expect(refillBucket(0, 200, 100, 10, 10).tokens).toBe(0);
    expect(refillBucket(0, 0, 1_000_000, 10, 10).tokens).toBe(10);
  });

  it("deletes only fully refilled idle buckets so cleanup cannot reset an active abuser's allowance", async () => {
    const t = convexTest(schema, modules), now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    await t.run(async ctx => {
      await ctx.db.insert("publicRateBuckets", { key: "old", tokens: 0, updatedAt: now - 86_400_001 });
      await ctx.db.insert("publicRateBuckets", { key: "active", tokens: 0, updatedAt: now });
    });
    expect(await t.mutation(makeFunctionReference<"mutation">("publicSecurity:sweep"), {})).toEqual({ removed: 1 });
    expect(await t.run(async ctx => (await ctx.db.query("publicRateBuckets").collect()).map(row => row.key))).toEqual(["active"]);
  });
});
