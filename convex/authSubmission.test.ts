import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { canonical, digest } from "./lib/finance";
import { buildVerificationReport } from "./lib/verificationReport";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);

// Synthetic stored bytes and a failure report exercise worker authorization.
// Fake timers keep the real verifier scheduled action from running; no model,
// wallet, chain, OAuth exchange or password hashing is performed.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-25T12:30:00Z"));
  vi.stubEnv("SKARL_DEMO_IDENTITIES", undefined);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function setup(demoMode: "on" | "off") {
  const t = convexTest(schema, modules);
  const seed = await t.mutation(internal.seed.demo, {});
  const userId = await t.run(ctx => ctx.db.insert("users", { email: "worker-contributor@example.test" }));
  const signedIn = t.withIdentity({ subject: `${userId}|synthetic-session`, issuer: "https://auth.example.test" });
  await signedIn.mutation(api["auth/memberships"].claimRole, { role: "contributor" });
  vi.stubEnv("SKARL_DEMO_IDENTITIES", demoMode);
  const challenge = await signedIn.mutation(api.liveness.issueChallenge, { demoIdentity: "contributor" });
  const storageId = await t.run(ctx => ctx.storage.store(new Blob(["synthetic signed-in contributor media"], { type: "video/mp4" })));
  const result = await signedIn.mutation(api.submissions.create, {
    demoIdentity: "contributor", orderId: seed.orderId, storageId,
    clientRequestId: `auth-worker-${demoMode}`, consentAcknowledged: true,
    livenessChallengeId: challenge.challengeId,
  });
  const job = await t.run(async ctx => (await ctx.db.query("jobs")
    .withIndex("by_logical_job", q => q.eq("submissionId", result.submissionId)).unique())!);
  const member = await t.run(async ctx => (await ctx.db.query("memberships")
    .withIndex("by_token_identifier", q => q.eq("tokenIdentifier", `auth:${userId}`)).unique())!);
  return { t, signedIn, userId, member, ...seed, ...result, job };
}
type Fixture = Awaited<ReturnType<typeof setup>>;

async function claim(f: Fixture) {
  // A scheduled function has no human identity. Its authorization comes from
  // the stored submission, never from a hardcoded demo contributor selector.
  const claimed = await f.t.mutation(internal.submissions.claim, { jobId: f.job._id });
  expect(claimed).not.toBeNull();
  expect(claimed!.submission.contributorTokenIdentifier).toBe(`auth:${f.userId}`);
  return claimed!;
}

async function completion(f: Fixture, generation: number) {
  const rubric = (await f.t.run(ctx => ctx.db.get(f.taskVersionId)))!;
  const report = buildVerificationReport({ submissionId: f.submissionId,
    taskVersionId: f.taskVersionId, sourceHash: f.job.sourceHash, durationMs: 12_000,
    criteria: rubric.criteria, modelRuns: [], duplicate: { status: "not_checked", matches: [] },
    failure: "gemini_timeout" });
  const reportJson = canonical(report);
  const reportStorageId = await f.t.run(ctx => ctx.storage.store(new Blob([reportJson], { type: "application/json" })));
  return { jobId: f.job._id, generation, reportJson, reportStorageId,
    reportHash: digest(report), observationsJson: "{}", processingElapsedMs: 90_000,
    failureCode: "gemini_timeout" };
}

async function assertNoFinancialEffects(f: Fixture) {
  const state = await f.t.run(async ctx => ({
    payables: await ctx.db.query("payables").collect(),
    deliveries: await ctx.db.query("deliveries").collect(),
    journals: await ctx.db.query("journalEntries").collect(),
  }));
  expect(state).toEqual({ payables: [], deliveries: [], journals: [] });
}

describe("signed-in contributor verification jobs", () => {
  it.each(["on", "off"] as const)("claims, stores facts and completes the persisted auth contributor's job with demo mode %s", async demoMode => {
    const f = await setup(demoMode);
    const claimed = await claim(f);
    await f.t.mutation(internal.submissions.facts, { jobId: f.job._id, generation: claimed.generation,
      sourceHash: f.job.sourceHash, durationMs: 12_000, mediaVerified: true });
    const args = await completion(f, claimed.generation);
    const analysisId = await f.t.mutation(internal.submissions.complete, args);
    expect(await f.t.mutation(internal.submissions.complete, args)).toBe(analysisId);
    const state = await f.t.run(async ctx => ({
      submission: await ctx.db.get(f.submissionId), job: await ctx.db.get(f.job._id),
      analysis: await ctx.db.get(analysisId),
    }));
    expect(state.submission).toMatchObject({ contributorTokenIdentifier: `auth:${f.userId}`,
      currentAnalysisId: analysisId, status: "needs_review", sourceHash: f.job.sourceHash });
    expect(state.job).toMatchObject({ status: "failed", lastErrorCode: "gemini_timeout" });
    expect(state.analysis).toMatchObject({ implementation: "inference", recommendation: "needs_review", pipelineStatus: "failed" });
    expect(await f.signedIn.query(api.submissions.getReport, {
      demoIdentity: "controller", submissionId: f.submissionId,
    })).toMatchObject({ status: "needs_review" });
    await assertNoFinancialEffects(f);
  });

  it.each(["on", "off"] as const)("expires and records interrupted auth-owned work without model calls with demo mode %s", async demoMode => {
    const f = await setup(demoMode);
    const provider = vi.fn(async () => { throw new Error("no model network permitted in authorization fixture"); });
    vi.stubGlobal("fetch", provider);
    const claimed = await claim(f);
    await f.t.mutation(internal.submissions.facts, { jobId: f.job._id, generation: claimed.generation,
      sourceHash: f.job.sourceHash, durationMs: 12_000, mediaVerified: true });
    await f.t.run(ctx => ctx.db.patch(f.job._id, { leaseExpiresAt: Date.now() - 1 }));
    await f.t.mutation(internal.submissions.expire, { jobId: f.job._id, generation: claimed.generation });
    expect(await f.t.run(ctx => ctx.db.get(f.job._id))).toMatchObject({ status: "failed", lastErrorCode: "verification_interrupted" });
    expect(await f.t.run(ctx => ctx.db.get(f.submissionId))).toMatchObject({ status: "needs_review" });
    const result = await f.t.action(internal.verify.interrupted, { jobId: f.job._id, generation: claimed.generation });
    expect(result.analysisId).toBeDefined();
    expect(await f.t.run(ctx => ctx.db.get(result.analysisId!))).toMatchObject({ recommendation: "needs_review", pipelineStatus: "failed" });
    expect(await f.t.action(internal.verify.interrupted, { jobId: f.job._id, generation: claimed.generation })).toEqual({ skipped: true });
    expect(provider).not.toHaveBeenCalled();
    await assertNoFinancialEffects(f);
  });

  it.each(["revoked", "controller", "finance-agent", "foreign-organization"])("does not lease a job when its persisted contributor membership becomes %s", async kind => {
    const f = await setup("off");
    await f.t.run(async ctx => {
      if (kind === "revoked") await ctx.db.patch(f.member._id, { status: "revoked" });
      else if (kind === "foreign-organization") {
        const organizationId = await ctx.db.insert("organizations", { name: "Synthetic unrelated tenant", status: "active", createdByTokenIdentifier: "fixture:other" });
        await ctx.db.patch(f.member._id, { organizationId });
      } else await ctx.db.patch(f.member._id, { roles: ["contributor", kind as "controller" | "finance-agent"] });
    });
    await expect(f.t.mutation(internal.submissions.claim, { jobId: f.job._id })).rejects.toThrow();
    expect(await f.t.run(ctx => ctx.db.get(f.job._id))).toMatchObject({ status: "pending", leaseGeneration: 0 });
    expect(await f.t.run(ctx => ctx.db.get(f.submissionId))).toMatchObject({ status: "queued", contributorTokenIdentifier: `auth:${f.userId}` });
  });

  it("rechecks the persisted contributor before writing source facts after membership revocation", async () => {
    const f = await setup("off"), claimed = await claim(f);
    await f.t.run(ctx => ctx.db.patch(f.member._id, { status: "revoked" }));
    await expect(f.t.mutation(internal.submissions.facts, { jobId: f.job._id, generation: claimed.generation,
      sourceHash: f.job.sourceHash, durationMs: 12_000, mediaVerified: true })).rejects.toThrow();
    expect(await f.t.run(ctx => ctx.db.get(f.submissionId))).toMatchObject({ status: "analysing" });
    expect((await f.t.run(ctx => ctx.db.get(f.submissionId)))?.sourceHash).toBeUndefined();
  });
});
