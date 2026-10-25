import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { fundingTermsHash, type FundingTerms } from "../packages/payments/src/funding-terms";
import { SOLANA_PAYMENT_NETWORK } from "../packages/contracts/src/chain";

// Synthetic atomic claim tests: no signature, facilitator, wallet, RPC or settlement.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const SERVICE_SECRET = "test-only-funding-terms-service-secret-not-real";
const PAYER = `0x${"11".repeat(20)}`, TREASURY = `0x${"ab".repeat(20)}`;
const NONCE = `0x${"aa".repeat(32)}`;
beforeEach(() => { vi.useFakeTimers(); vi.stubEnv("SKARL_PAYMENTS_SERVICE_SECRET", SERVICE_SECRET); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });

async function setup() {
  const t = convexTest(schema, modules);
  workflowTest.register(t);
  const seeded = await t.mutation(internal.seed.demo, {});
  await t.run(async ctx => ctx.db.patch(seeded.orderId, { autoPay: { enabled: true, maxPerClipAtomic: 7_500_000n,
    requireAllChecks: true, setBy: "demo:skarl:buyer", setAt: Date.now() } }));
  const reviewed: FundingTerms = { orderId: seeded.orderId, amountAtomic: "100000000", payTo: TREASURY,
    autoPay: { enabled: true, maxPerClipAtomic: "7500000", requireAllChecks: true } };
  const funding = { serviceSecret: SERVICE_SECRET, orderId: seeded.orderId, demoIdentity: "buyer", payerAddress: PAYER,
    recipientAddress: TREASURY, authorizationNonce: NONCE, amountAtomic: 100_000_000n,
    validBefore: Date.now() + 60_000, expectedFundingTermsHash: fundingTermsHash(reviewed) };
  return { t, ...seeded, reviewed, funding };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function financialRows(fixture: Fixture) {
  return fixture.t.run(async ctx => ({
    intents: await ctx.db.query("paymentIntents").collect(), attempts: await ctx.db.query("paymentAttempts").collect(),
    journals: await ctx.db.query("journalEntries").collect(), lines: await ctx.db.query("journalLines").collect(),
    idempotency: await ctx.db.query("requestIdempotency").collect(),
  }));
}

describe("reviewed funding terms at the atomic attempt boundary", () => {
  it.each(["enabled", "cap"] as const)("refuses a policy %s edit after the HTTP snapshot without any financial write", async field => {
    const fixture = await setup();
    const before = await financialRows(fixture);
    // The trusted HTTP layer already read/reviewed fixture.reviewed. A separate
    // committed policy update races before its settlement claim mutation.
    await fixture.t.run(async ctx => {
      const order = await ctx.db.get(fixture.orderId);
      await ctx.db.patch(fixture.orderId, { autoPay: { ...order!.autoPay!,
        ...(field === "enabled" ? { enabled: false } : { maxPerClipAtomic: 7_500_001n }) } });
    });
    await expect(fixture.t.mutation(api.payments.recordFundingAttempt, { ...fixture.funding,
      idempotencyKey: "reviewed-funding-race-0001" })).rejects.toThrow("funding_terms_changed");
    expect(await financialRows(fixture)).toEqual(before);
    expect((await fixture.t.run(ctx => ctx.db.get(fixture.orderId)))!.autoPay)
      .toMatchObject(field === "enabled" ? { enabled: false } : { maxPerClipAtomic: 7_500_001n });
  });

  it("accepts the fresh exact rule and payee; claims no journal before chain observation", async () => {
    const fixture = await setup();
    const claim = await fixture.t.mutation(api.payments.recordFundingAttempt, fixture.funding);
    expect(claim.replayed).toBe(false);
    const rows = await financialRows(fixture);
    expect(rows.attempts).toHaveLength(1);
    expect(rows.intents).toHaveLength(1);
    expect(rows.intents[0]).toMatchObject({ amountAtomic: 100_000_000n, recipientAddress: TREASURY });
    expect(rows.journals).toHaveLength(0);
    expect(rows.lines).toHaveLength(0);
  });

  it("requires a fresh review for a changed actual payee, budget or funding rail", async () => {
    const fixture = await setup();
    const before = await financialRows(fixture);
    await expect(fixture.t.mutation(api.payments.recordFundingAttempt, { ...fixture.funding,
      recipientAddress: `0x${"cd".repeat(20)}` })).rejects.toThrow("funding_terms_changed");
    await fixture.t.run(async ctx => ctx.db.patch(fixture.orderId, { pricePerSampleAtomic: 10_000_001n, budgetAtomic: 100_000_010n }));
    await expect(fixture.t.mutation(api.payments.recordFundingAttempt, { ...fixture.funding,
      amountAtomic: 100_000_010n })).rejects.toThrow("funding_terms_changed");
    vi.stubEnv("SKARL_SOLANA_TREASURY_ADDRESS", "22222222222222222222222222222222");
    await expect(fixture.t.mutation(api.payments.recordFundingAttempt, { ...fixture.funding,
      network: SOLANA_PAYMENT_NETWORK, amountAtomic: 100_000_010n,
      payerAddress: "11111111111111111111111111111111", recipientAddress: "22222222222222222222222222222222" }))
      .rejects.toThrow("funding_terms_changed");
    expect(await financialRows(fixture)).toEqual(before);
  });

  it.each(["idempotency", "nonce"] as const)("preserves %s replay after a policy change as status-only, never a new attempt", async replay => {
    const fixture = await setup();
    const funding = { ...fixture.funding, ...(replay === "idempotency" ? { idempotencyKey: "reviewed-funding-replay-0001" } : {}) };
    const first = await fixture.t.mutation(api.payments.recordFundingAttempt, funding);
    await fixture.t.run(async ctx => {
      const order = await ctx.db.get(fixture.orderId);
      await ctx.db.patch(fixture.orderId, { autoPay: { ...order!.autoPay!, enabled: false } });
    });
    const before = await financialRows(fixture);
    expect(await fixture.t.mutation(api.payments.recordFundingAttempt, funding)).toEqual({ ...first, replayed: true });
    expect(await financialRows(fixture)).toEqual(before);
  });

  it("refuses malformed commitments and retains optional legacy no-commitment behavior", async () => {
    const fixture = await setup();
    for (const expectedFundingTermsHash of ["", "0x" + "a".repeat(64), "A".repeat(64), "a".repeat(63)]) {
      await expect(fixture.t.mutation(api.payments.recordFundingAttempt, { ...fixture.funding, expectedFundingTermsHash }))
        .rejects.toThrow("invalid_funding_terms_hash");
    }
    expect((await financialRows(fixture)).attempts).toHaveLength(0);
    const { expectedFundingTermsHash: _reviewedHash, ...legacy } = fixture.funding;
    expect((await fixture.t.mutation(api.payments.recordFundingAttempt, legacy)).replayed).toBe(false);
  });
});
