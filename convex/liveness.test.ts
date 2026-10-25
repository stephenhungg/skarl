import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { CHALLENGE_TTL_MS, LIVENESS_WORDS } from "./liveness";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
// Synthetic storage only. Fake time keeps scheduled inference from running.
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-25T11:00:00Z")); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
async function setup() {
  const t = convexTest(schema, modules);
  const seeded = await t.mutation(internal.seed.demo, {});
  const args = { demoIdentity: "contributor", orderId: seeded.orderId,
    storageId: await t.run(ctx => ctx.storage.store(new Blob(["fixture video"], { type: "video/mp4" }))),
    clientRequestId: "take-1", consentAcknowledged: true };
  return { t, args, ...seeded };
}

describe("per-take spoken challenge ownership and consumption", () => {
  it("issues three distinct common words for a persisted contributor, so clients cannot choose their own replay code", async () => {
    const { t } = await setup();
    await expect(t.mutation(api.liveness.issueChallenge, { demoIdentity: "buyer" })).rejects.toThrow("forbidden");
    const result = await t.mutation(api.liveness.issueChallenge, { demoIdentity: "contributor" });
    expect(result.words).toHaveLength(3);
    expect(new Set(result.words).size).toBe(3);
    expect(result.words.every(word => (LIVENESS_WORDS as readonly string[]).includes(word))).toBe(true);
    const stored = await t.run(ctx => ctx.db.get(result.challengeId));
    expect(result.expiresAt - stored!.issuedAt).toBe(CHALLENGE_TTL_MS);
    expect(stored).toMatchObject({ contributorTokenIdentifier: "demo:skarl:contributor", words: result.words, expiresAt: result.expiresAt });
  });

  it("binds the issued words atomically and permits exact lost-response retries even after expiry", async () => {
    const { t, args } = await setup();
    const challenge = await t.mutation(api.liveness.issueChallenge, { demoIdentity: "contributor" });
    const input = { ...args, livenessChallengeId: challenge.challengeId };
    const created = await t.mutation(api.submissions.create, input);
    const stored = await t.run(ctx => ctx.db.get(challenge.challengeId));
    const liveness = { words: challenge.words, issuedAt: challenge.expiresAt - CHALLENGE_TTL_MS, consumedAt: stored!.consumedAt! };
    expect(liveness.consumedAt).toBeGreaterThanOrEqual(liveness.issuedAt);
    expect(liveness.consumedAt).toBeLessThan(challenge.expiresAt);
    expect(await t.run(ctx => ctx.db.get(created.submissionId))).toMatchObject({ liveness, livenessChallengeId: challenge.challengeId });
    expect(await t.run(ctx => ctx.db.get(challenge.challengeId))).toMatchObject({ submissionId: created.submissionId, consumedAt: liveness.consumedAt });
    expect(await t.query(api.submissions.getReport, { demoIdentity: "controller", submissionId: created.submissionId })).toMatchObject({ liveness });
    vi.setSystemTime(challenge.expiresAt + 1);
    expect(await t.mutation(api.submissions.create, input)).toEqual({ ...created, replayed: true });
    const next = await t.mutation(api.liveness.issueChallenge, { demoIdentity: "contributor" });
    await expect(t.mutation(api.submissions.create, { ...input, livenessChallengeId: next.challengeId })).rejects.toThrow("submission_request_conflict");
    await expect(t.mutation(api.submissions.create, args)).rejects.toThrow("submission_request_conflict");
  });

  it("rejects an expired challenge at the exact boundary so upload delays cannot extend freshness", async () => {
    const { t, args } = await setup();
    const challenge = await t.mutation(api.liveness.issueChallenge, { demoIdentity: "contributor" });
    vi.setSystemTime(challenge.expiresAt);
    await expect(t.mutation(api.submissions.create, { ...args, livenessChallengeId: challenge.challengeId })).rejects.toThrow("liveness_challenge_expired");
    expect(await t.run(ctx => ctx.db.query("submissions").collect())).toHaveLength(0);
    expect((await t.run(ctx => ctx.db.get(challenge.challengeId)))?.consumedAt).toBeUndefined();
  });

  it("refuses reuse on a different upload because one spoken witness must bind only one take", async () => {
    const { t, args } = await setup();
    const challenge = await t.mutation(api.liveness.issueChallenge, { demoIdentity: "contributor" });
    await t.mutation(api.submissions.create, { ...args, livenessChallengeId: challenge.challengeId });
    const storageId = await t.run(ctx => ctx.storage.store(new Blob(["second fixture"], { type: "video/mp4" })));
    await expect(t.mutation(api.submissions.create, { ...args, storageId, clientRequestId: "take-2", livenessChallengeId: challenge.challengeId })).rejects.toThrow("liveness_challenge_used");
    expect(await t.run(ctx => ctx.db.query("submissions").collect())).toHaveLength(1);
  });

  it("refuses another contributor or tenant's challenge even when its ID and words are known", async () => {
    const { t, args } = await setup();
    const challenge = await t.mutation(api.liveness.issueChallenge, { demoIdentity: "contributor" });
    await t.run(ctx => ctx.db.patch(challenge.challengeId, { contributorTokenIdentifier: "demo:foreign-contributor" }));
    await expect(t.mutation(api.submissions.create, { ...args, livenessChallengeId: challenge.challengeId })).rejects.toThrow("liveness_challenge_foreign");
    await t.run(async ctx => {
      const organizationId = await ctx.db.insert("organizations", { name: "Foreign", status: "active", createdByTokenIdentifier: "fixture" });
      await ctx.db.patch(challenge.challengeId, { contributorTokenIdentifier: "demo:skarl:contributor", organizationId });
    });
    await expect(t.mutation(api.submissions.create, { ...args, livenessChallengeId: challenge.challengeId })).rejects.toThrow("liveness_challenge_foreign");
    expect((await t.run(ctx => ctx.db.get(challenge.challengeId)))?.consumedAt).toBeUndefined();
  });

  it("does not consume challenges on failed creates, and still accepts legacy clients without a challenge", async () => {
    const { t, args } = await setup();
    const challenge = await t.mutation(api.liveness.issueChallenge, { demoIdentity: "contributor" });
    await expect(t.mutation(api.submissions.create, { ...args, consentAcknowledged: false, livenessChallengeId: challenge.challengeId })).rejects.toThrow("consent_required");
    expect((await t.run(ctx => ctx.db.get(challenge.challengeId)))?.consumedAt).toBeUndefined();
    const created = await t.mutation(api.submissions.create, args);
    expect((await t.run(ctx => ctx.db.get(created.submissionId)))?.liveness).toBeUndefined();
    expect(await t.mutation(api.submissions.create, args)).toMatchObject({ replayed: true });
  });
});
