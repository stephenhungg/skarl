import type { GoogleProfile } from "@auth/core/providers/google";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authRedirect, clearUnverifiedGoogleEmail, googleProfile } from "./lib/authPolicy";
import { controllerEmailAllowed } from "./lib/authMemberships";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
afterEach(() => vi.unstubAllEnvs());

describe("Google OAuth trust boundaries", () => {
  it.each([true, false, undefined, "true"])("only trusts Google's boolean email_verified claim: %s", verified => {
    const mapped = googleProfile({ sub: "synthetic-google-subject", email: "controller@example.test", name: "Synthetic User",
      picture: "https://example.test/avatar", email_verified: verified } as GoogleProfile);
    expect(mapped).toEqual({ id: "synthetic-google-subject", email: "controller@example.test", name: "Synthetic User",
      image: "https://example.test/avatar", emailVerified: verified === true });
  });

  it("removes stale email verification before privileged role claims", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("SKARL_CONTROLLER_EMAILS", "controller@example.test");
    const userId = await t.run(ctx => ctx.db.insert("users", {
      email: "controller@example.test", emailVerificationTime: Date.now(),
    }));
    await t.run(ctx => clearUnverifiedGoogleEmail(ctx, userId, "google", { emailVerified: false }));
    const user = await t.run(ctx => ctx.db.get(userId));
    expect(user?.emailVerificationTime).toBeUndefined();
    expect(controllerEmailAllowed(user)).toBe(false);
  });

  it("preserves verified Google email ownership", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(ctx => ctx.db.insert("users", { email: "controller@example.test", emailVerificationTime: 123 }));
    await t.run(ctx => clearUnverifiedGoogleEmail(ctx, userId, "google", { emailVerified: true }));
    expect((await t.run(ctx => ctx.db.get(userId)))?.emailVerificationTime).toBe(123);
  });
});

describe("OAuth redirect allowlist", () => {
  it.each([
    ["/dashboard?tab=orders", "https://skarl.example/dashboard?tab=orders"],
    ["?signedIn=1", "https://skarl.example/?signedIn=1"],
    ["https://skarl.example/contribute", "https://skarl.example/contribute"],
    ["skarl://", "skarl://"],
    ["skarl:///oauth", "skarl:///oauth"],
    ["skarl://oauth", "skarl://oauth"],
    ["exp://192.168.1.20:8081/--/oauth", "exp://192.168.1.20:8081/--/oauth"],
    ["exp://example.exp.direct/--/oauth", "exp://example.exp.direct/--/oauth"],
  ])("allows web and Expo destinations: %s", async (redirectTo, expected) => {
    vi.stubEnv("SITE_URL", "https://skarl.example");
    expect(await authRedirect({ redirectTo })).toBe(expected);
  });

  it.each([
    "https://attacker.example", "https://skarl.example.attacker.example/", "https://skarl.example:444/",
    "http://skarl.example/", "//attacker.example/", "https://skarl.example@attacker.example/",
    "https://attacker@skarl.example/", "javascript:alert(1)", "data:text/html,test", "file:///etc/passwd",
    "otherapp://oauth", "exps://192.168.1.20:8081/--/oauth", "skarl:oauth", "exp:///oauth", "exp://?oauth=1", "exp://",
    "skarl://user:password@oauth", "exp://user@localhost:8081/--/oauth", "skarl://oauth#fragment",
    "/\\attacker.example", " https://skarl.example", "/dashboard\n",
  ])("rejects a foreign or ambiguous destination: %s", async redirectTo => {
    vi.stubEnv("SITE_URL", "https://skarl.example");
    await expect(authRedirect({ redirectTo })).rejects.toThrow();
  });
});
