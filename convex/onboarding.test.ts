// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { onboardingSteps, skarlBuyerSkill } from "./lib/onboardingSteps";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const digest = (n: number) => n.toString(16).padStart(64, "0");
const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

describe("testnet USDC faucet abuse control", () => {
  // The faucet spends a shared CDP allowance; one address or caller must not drain it for everyone.
  it("caps requests per address even when the caller rotates", async () => {
    const t = convexTest(schema, modules);
    const results = [];
    for (let i = 1; i <= 3; i++) results.push(await t.mutation(internal.onboardingData.reserveFaucet, { address: address(7), ipDigest: digest(i) }));
    expect(results.map(r => r.ok)).toEqual([true, true, false]);
    expect(results[2]).toMatchObject({ code: "faucet_rate_limited" });
  });

  it("caps requests per caller even when the address rotates, and treats address case as one wallet", async () => {
    const t = convexTest(schema, modules);
    const results = [];
    for (let i = 1; i <= 4; i++) results.push(await t.mutation(internal.onboardingData.reserveFaucet, { address: address(100 + i), ipDigest: digest(1) }));
    expect(results.map(r => r.ok)).toEqual([true, true, true, false]);
    const upper = "0x" + "AB".repeat(20), lower = upper.toLowerCase();
    await t.mutation(internal.onboardingData.reserveFaucet, { address: upper, ipDigest: digest(50) });
    await t.mutation(internal.onboardingData.reserveFaucet, { address: lower, ipDigest: digest(51) });
    expect(await t.mutation(internal.onboardingData.reserveFaucet, { address: upper, ipDigest: digest(52) })).toMatchObject({ ok: false });
  });
});

describe("personal agent onboarding script", () => {
  // Agents follow these words literally; they must keep the human in the loop and never self-approve payouts.
  it("asks the human before money moves and states the agent never approves payouts", () => {
    const text = JSON.stringify(onboardingSteps());
    expect(text).toContain("ask your human");
    expect(text).toContain("never approve payouts");
    const skill = skarlBuyerSkill("https://example.test/mcp", "eip155:84532");
    expect(skill.startsWith("---\nname: skarl-buyer\n")).toBe(true);
    expect(skill).toContain("https://example.test/mcp");
    expect(skill).toContain("Pay only the exact returned quote");
  });
});
