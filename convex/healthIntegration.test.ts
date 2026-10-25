import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { REQUIRED_ENV, evidenceStatus } from "./lib/health";
import { probeBinding } from "./lib/healthProbe";
import { PAYMENT_NETWORK, SOLANA_PAYMENT_NETWORK, USDC_ADDRESS, SOLANA_USDC_MINT } from "../packages/contracts/src/chain";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const health = makeFunctionReference<"query">("health:integrations");
const mutate = (name: string) => makeFunctionReference<"mutation">(`healthData:${name}`);
const rows = async (t: ReturnType<typeof convexTest>) => (await t.query(health, {})).items;
const row = async (t: ReturnType<typeof convexTest>, id: string) => (await rows(t)).find((item: { id: string }) => item.id === id);
const PRIVATE = "synthetic-private-health-sentinel";
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function setup() {
  const t = convexTest(schema, modules);
  return { t, ...await t.mutation(internal.seed.demo, {}) };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
const TREASURY = `0x${"22".repeat(20)}`;
async function funding(f: Fixture) {
  const secret = `${PRIVATE}-service-secret`;
  vi.stubEnv("SKARL_PAYMENTS_SERVICE_SECRET", secret);
  return f.t.mutation(api.payments.recordFundingAttempt, { serviceSecret: secret, orderId: f.defaultOrderId,
    demoIdentity: "buyer", payerAddress: `0x${"11".repeat(20)}`, recipientAddress: TREASURY,
    authorizationNonce: `0x${"33".repeat(32)}`, amountAtomic: 10_000_000n, validBefore: Date.now() + 60_000 });
}

/** Synthetic stored records exercise projections; they are never live integration proof. */
async function analysis(f: Fixture, { simulationOnly = false, elapsedMs = 10 }: { simulationOnly?: boolean; elapsedMs?: number | null } = {}) {
  return f.t.run(async ctx => {
    const submissionId = await ctx.db.insert("submissions", { organizationId: f.organizationId, orderId: f.defaultOrderId,
      taskVersionId: f.defaultTaskVersionId, contributorTokenIdentifier: "demo:skarl:contributor", clientRequestId: "health-fixture",
      status: "needs_review", sourceHash: "a".repeat(64), updatedAt: Date.now(), ...(simulationOnly ? { simulationOnly: true as const } : {}) });
    const jobId = await ctx.db.insert("jobs", { organizationId: f.organizationId, submissionId, taskVersionId: f.defaultTaskVersionId,
      sourceHash: "a".repeat(64), pipelineVersion: "synthetic", status: "completed", availableAt: Date.now(), attempt: 1, maxAttempts: 1, leaseGeneration: 1 });
    const report = { pipeline: { implementation: "inference", modelRuns: [{ provider: "google", model: "gemini-synthetic", ...(elapsedMs === null ? {} : { elapsedMs }) }] } };
    const reportStorageId = await ctx.storage.store(new Blob([PRIVATE]));
    const analysisId = await ctx.db.insert("analysisResults", { organizationId: f.organizationId, jobId, submissionId,
      taskVersionId: f.defaultTaskVersionId, sourceHash: "a".repeat(64), pipelineVersion: "synthetic", leaseGeneration: 1,
      summary: PRIVATE, reportStorageId, reportHash: "b".repeat(64), evidenceAssetIds: [], completedAt: Date.now(),
      implementation: "inference", pipelineStatus: "needs_review", recommendation: "needs_review", reportJson: JSON.stringify(report) });
    return { submissionId, analysisId, reportStorageId };
  });
}

describe("redacted integration evidence", () => {
  it("public query and HTTP never expose env values or perform network calls", async () => {
    const t = convexTest(schema, modules), fetcher = vi.fn(() => { throw new Error(PRIVATE); });
    vi.stubGlobal("fetch", fetcher);
    for (const [name] of REQUIRED_ENV) vi.stubEnv(name, PRIVATE);
    vi.stubEnv("SITE_URL", "https://public.example");
    const result = await t.query(health, {});
    const response = await t.fetch("/health");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(JSON.stringify([result, await response.json()])).not.toContain(PRIVATE);
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.items.find((item: {id: string}) => item.id === "site_url").evidence).toEqual({ value: "https://public.example" });
    for (const item of result.items) expect(item).toHaveProperty("fix");
  });

  it.each(REQUIRED_ENV.map(([name]) => name))("missing %s cannot be hidden by an unrelated configured secret", async name => {
    const t = convexTest(schema, modules);
    vi.stubEnv(name, "");
    expect(await row(t, `env.${name}`)).toMatchObject({ status: "missing", evidence: { name, configured: false } });
  });

  it("Google configuration requires signing keys and public origin, and never claims login was exercised", async () => {
    const t = convexTest(schema, modules);
    for (const name of ["AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET", "JWT_PRIVATE_KEY", "JWKS"]) vi.stubEnv(name, PRIVATE);
    vi.stubEnv("SITE_URL", "https://public.example");
    expect(await row(t, "auth.google")).toMatchObject({ status: "ok", reason: "google provider configured; sign-in not exercised" });
    vi.stubEnv("JWKS", "");
    expect(await row(t, "auth.google")).toMatchObject({ status: "missing" });
    vi.stubEnv("SITE_URL", `https://user:${PRIVATE}@public.example?key=${PRIVATE}`);
    expect(await row(t, "site_url")).toMatchObject({ status: "missing", evidence: { value: null } });
  });

  it.each(["agent_wallet", "treasury", "nessie"])("%s distinguishes absent, failed, healthy and stale probes", async kind => {
    const t = convexTest(schema, modules);
    expect(await row(t, kind)).toMatchObject({ status: "missing" });
    const save = (outcome: string, checkedAt = Date.now(), extra = {}) => t.mutation(mutate("storeProbes"), { probes: [{ kind, checkedAt, outcome, bindingHash: probeBinding(kind as "agent_wallet" | "treasury" | "nessie", kind === "agent_wallet" ? process.env.CDP_AGENT_ADDRESS : null), ...extra }] });
    await save("failed");
    expect(await row(t, kind)).toMatchObject({ status: "degraded", evidence: { usdcMicro: null } });
    await save("success", Date.now(), { ethWei: "90071992547409931234", usdcMicro: "123456789012345678" });
    expect(await row(t, kind)).toMatchObject({ status: "ok", evidence: { usdcMicro: "123456789012345678" } });
    // A delayed older request cannot overwrite fresher balances.
    await save("failed", Date.now() - 400_000);
    expect(await row(t, kind)).toMatchObject({ status: "ok" });
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 400_000);
    expect(await row(t, kind)).toMatchObject({ status: "degraded" });
  });

  it.each(["agent_wallet", "treasury"])("zero %s funds are a missing demo prerequisite, not healthy RPC alone", async kind => {
    const t = convexTest(schema, modules);
    await t.mutation(mutate("storeProbes"), { probes: [{ kind, checkedAt: Date.now(), outcome: "success", bindingHash: probeBinding(kind as "agent_wallet" | "treasury", kind === "agent_wallet" ? process.env.CDP_AGENT_ADDRESS : null), ethWei: "0", usdcMicro: "0" }] });
    expect(await row(t, kind)).toMatchObject({ status: "missing", reason: "required testnet balance is zero" });
  });

  it.each(["reconcile", "attest", "bank", "finance"])("%s cron records completed invocation separately from downstream evidence", async job => {
    const t = convexTest(schema, modules);
    expect(await row(t, `cron.${job}`)).toMatchObject({ status: "missing" });
    const id = await t.mutation(mutate("startCron"), { job });
    expect(await row(t, `cron.${job}`)).toMatchObject({ status: "degraded", evidence: { outcome: "running" } });
    await t.mutation(mutate("finishCron"), { id, outcome: "disabled" });
    expect(await row(t, `cron.${job}`)).toMatchObject({ status: "degraded" });
    const next = await t.mutation(mutate("startCron"), { job });
    await t.mutation(mutate("finishCron"), { id: next, outcome: "complete" });
    expect(await row(t, `cron.${job}`)).toMatchObject({ status: "ok", evidence: { outcome: "complete" } });
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 26 * 60_000);
    expect(await row(t, `cron.${job}`)).toMatchObject({ status: "degraded" });
  });

  it.each(["reconcile", "finance", "attest", "bank"])("the actual %s wrapper records disabled execution instead of fabricating a successful cron", async job => {
    const t = convexTest(schema, modules);
    vi.stubEnv("SKARL_SCHEDULED_JOBS_DISABLED", "true");
    vi.stubEnv("NESSIE_ENABLED", "false");
    vi.stubEnv("EAS_ATTESTATIONS_ENABLED", "false");
    await t.action(makeFunctionReference<"action">(`healthJobs:${job}`), {});
    expect(await row(t, `cron.${job}`)).toMatchObject({ status: "degraded", evidence: { outcome: "disabled" } });
  });

  it("a thrown cron failure is recorded with a closed error code because provider errors can contain credentials", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("SKARL_SCHEDULED_JOBS_DISABLED", "false");
    vi.stubEnv("FINANCE_AGENT_BACKGROUND_ENABLED", "true");
    // No seeded service membership: the underlying job must refuse authorization.
    await expect(t.action(makeFunctionReference<"action">("healthJobs:finance"), {})).rejects.toThrow("observed_cron_failed");
    expect(await row(t, "cron.finance")).toMatchObject({ status: "degraded", evidence: { outcome: "failed" } });
  });

  it("successful Gemini calls still count when deterministic evidence routes a clip to review", async () => {
    const f = await setup();
    expect(await row(f.t, "gemini")).toMatchObject({ status: "missing" });
    await analysis(f);
    expect(await row(f.t, "gemini")).toMatchObject({ status: "ok" });
    expect(await row(f.t, "licensed_clip")).toMatchObject({ status: "missing", reason: "needs a licensed accepted clip" });
    expect(JSON.stringify(await rows(f.t))).not.toContain(PRIVATE);
  });

  it.each([{ simulationOnly: true }, { elapsedMs: null }])("replayed reports and failed-call placeholders cannot count as live Gemini success: %j", async options => {
    const f = await setup(); await analysis(f, options);
    expect(await row(f.t, "gemini")).toMatchObject({ status: "missing" });
  });

  it("Claude needs a completed stored run; failed attempts do not prove successful inference", async () => {
    const f = await setup();
    const id = await f.t.run(ctx => ctx.db.insert("financeAgentRuns", { organizationId: f.organizationId, orderId: f.defaultOrderId,
      requestId: "synthetic-health", prompt: PRIVATE, requesterTokenIdentifier: "demo:skarl:finance-agent", provider: "claude", model: "claude-synthetic",
      maxToolCalls: 1, maxBatchAtomic: 1n, proposedAtomic: 0n, reservedPayableIds: [], status: "failed", transcriptJson: PRIVATE, startedAt: Date.now() }));
    expect(await row(f.t, "claude")).toMatchObject({ status: "missing" });
    await f.t.run(ctx => ctx.db.patch(id, { status: "completed", completedAt: Date.now() }));
    expect(await row(f.t, "claude")).toMatchObject({ status: "ok" });
  });

  it("bank freshness is independent of reachable Nessie and never exposes snapshot contents", async () => {
    const f = await setup();
    expect(await row(f.t, "bank_snapshot")).toMatchObject({ status: "missing" });
    const id = await f.t.run(ctx => ctx.db.insert("bankSnapshots", { organizationId: f.organizationId,
      accountId: PRIVATE, activitiesJson: PRIVATE, status: "available", fetchedAt: Date.now() }));
    expect(await row(f.t, "bank_snapshot")).toMatchObject({ status: "ok", evidence: { simulated: true } });
    await f.t.run(ctx => ctx.db.patch(id, { status: "unavailable", reason: PRIVATE }));
    expect(await row(f.t, "bank_snapshot")).toMatchObject({ status: "degraded" });
    expect(JSON.stringify(await rows(f.t))).not.toContain(PRIVATE);
  });

  it("Jira unknown/capped uncertain counts stay unknown; stale/out-of-order telemetry cannot turn green", async () => {
    const t = convexTest(schema, modules);
    expect(await row(t, "jira")).toMatchObject({ status: "missing", evidence: { uncertainCount: null } });
    const now = Date.now();
    await t.mutation(mutate("recordJira"), { lastSyncAt: now, uncertainCount: 0, truncated: true });
    expect(await row(t, "jira")).toMatchObject({ status: "degraded", evidence: { uncertainCount: null } });
    await t.mutation(mutate("recordJira"), { lastSyncAt: now, uncertainCount: 0, truncated: false });
    expect(await row(t, "jira")).toMatchObject({ status: "ok" });
    await t.mutation(mutate("recordJira"), { lastSyncAt: now - 1, uncertainCount: 99, truncated: false });
    expect(await row(t, "jira")).toMatchObject({ status: "ok", evidence: { uncertainCount: 0 } });
    await t.mutation(mutate("recordJira"), { lastSyncAt: now, uncertainCount: 1, truncated: false });
    expect(await row(t, "jira")).toMatchObject({ status: "degraded", evidence: { uncertainCount: 1 } });
  });

  it("the Jira receiver accepts only authenticated, bounded numeric telemetry, not source text", async () => {
    const t = convexTest(schema, modules); vi.stubEnv("SKARL_JIRA_FEED_SECRET", PRIVATE + "-long-enough");
    const send = (body: unknown, authorized = true) => t.fetch("/health/jira", { method: "POST", headers: {
      "Content-Type": "application/json", ...(authorized ? { "x-skarl-feed-secret": PRIVATE + "-long-enough" } : {}) }, body: JSON.stringify(body) });
    const body = { lastSyncAt: Date.now(), uncertainCount: 0, truncated: false };
    expect((await send(body, false)).status).toBe(401);
    expect((await send({ ...body, privateText: PRIVATE })).status).toBe(400);
    expect((await send({ ...body, uncertainCount: -1 })).status).toBe(400);
    expect((await send({ ...body, lastSyncAt: Date.now() + 120_000 })).status).toBe(400);
    expect((await send({ privateText: PRIVATE.repeat(50) })).status).toBe(413);
    expect((await send(body)).status).toBe(200);
    expect(await row(t, "jira")).toMatchObject({ status: "ok" });
  });

  it("EAS needs confirmed evidence and Solana stays optional funding-only", async () => {
    const f = await setup(), fixture = await analysis(f);
    expect(await row(f.t, "eas")).toMatchObject({ status: "missing" });
    const id = await f.t.run(ctx => ctx.db.insert("attestations", { analysisId: fixture.analysisId, submissionId: fixture.submissionId,
      schemaUid: PRIVATE, attestor: PRIVATE, requestId: PRIVATE, status: "submitted", generation: 1, leaseUntil: 0, nextRetryAt: 0, createdAt: Date.now(), updatedAt: Date.now() }));
    expect(await row(f.t, "eas")).toMatchObject({ status: "missing" });
    await f.t.run(ctx => ctx.db.patch(id, { status: "confirmed", attestationUid: "synthetic", txHash: "synthetic" }));
    expect(await row(f.t, "eas")).toMatchObject({ status: "ok" });
    expect(await row(f.t, "solana")).toMatchObject({ status: "missing", demoCritical: false, evidence: { fundingOnly: true } });
    expect(JSON.stringify(await rows(f.t))).not.toContain(PRIVATE);
  });

  it("a cached balance cannot describe a replacement wallet because the subject is part of the evidence binding", async () => {
    const t = convexTest(schema, modules), address = `0x${"11".repeat(20)}`;
    vi.stubEnv("CDP_AGENT_ADDRESS", address);
    await t.mutation(mutate("storeProbes"), { probes: [{ kind: "agent_wallet", checkedAt: Date.now(), outcome: "success",
      bindingHash: probeBinding("agent_wallet", address), ethWei: "1", usdcMicro: "1000000" }] });
    expect(await row(t, "agent_wallet")).toMatchObject({ status: "ok" });
    vi.stubEnv("CDP_AGENT_ADDRESS", TREASURY);
    expect(await row(t, "agent_wallet")).toMatchObject({ status: "missing", lastSuccessAt: null, evidence: { usdcMicro: null, ethWei: null } });
  });

  it("treasury inputs stay on the canonical order even when newer scenario intents use synthetic wallets", async () => {
    const f = await setup(); await funding(f);
    await f.t.run(async ctx => {
      const original = (await ctx.db.query("orders").withIndex("by_public_id", q => q.eq("publicId", "skarl-red-cup-demo-v2")).unique())!;
      const { _id, _creationTime, ...terms } = original;
      const labOrder = await ctx.db.insert("orders", { ...terms, publicId: "scenario:health-fixture" });
      const intent = (await ctx.db.query("paymentIntents").first())!;
      const { _id: oldId, _creationTime: oldTime, ...intentTerms } = intent;
      await ctx.db.insert("paymentIntents", { ...intentTerms, orderId: labOrder, intentId: "SIMULATED:health", recipientAddress: `0x${"99".repeat(20)}` });
    });
    expect(await f.t.query(makeFunctionReference<"query">("healthData:probeInputs"), {})).toMatchObject({ treasury: TREASURY });
  });

  it("only canonical-treasury webhook ingress counts; synthetic lab events cannot establish CDP delivery", async () => {
    const f = await setup(); await funding(f);
    expect(await row(f.t, "cdp_webhook")).toMatchObject({ status: "missing" });
    const insert = (eventId: string) => f.t.run(ctx => ctx.db.insert("cdpWebhookReceipts", { organizationId: f.organizationId,
      treasury: TREASURY, eventId, transferKey: PRIVATE, txHash: PRIVATE, logIndex: 0, fromAddress: PRIVATE, toAddress: PRIVATE,
      amountAtomic: "1", status: "pending", receivedAt: Date.now(), updatedAt: Date.now() }));
    await insert("SIMULATED health-test");
    expect(await row(f.t, "cdp_webhook")).toMatchObject({ status: "missing" });
    await insert("synthetic-verified-ingress-fixture");
    expect(await row(f.t, "cdp_webhook")).toMatchObject({ status: "ok" });
    expect(JSON.stringify(await rows(f.t))).not.toContain(PRIVATE);
  });

  it("Solana observation success is independent of payout readiness and never makes Solana a payout target", async () => {
    const f = await setup(), attempt = await funding(f);
    const id = await f.t.run(ctx => ctx.db.insert("chainObservations", { organizationId: f.organizationId,
      network: SOLANA_PAYMENT_NETWORK, tokenAddress: SOLANA_USDC_MINT, paymentAttemptId: attempt.attemptId,
      txHash: PRIVATE, logIndex: 0, blockNumber: 1n, blockHash: PRIVATE, fromAddress: PRIVATE, toAddress: PRIVATE,
      amountAtomic: 10_000_000n, confirmations: 1, succeeded: false, observedAt: Date.now() }));
    expect(await row(f.t, "solana")).toMatchObject({ status: "degraded", demoCritical: false });
    await f.t.run(ctx => ctx.db.patch(id, { succeeded: true }));
    expect(await row(f.t, "solana")).toMatchObject({ status: "ok", evidence: { fundingOnly: true } });
    expect((await f.t.query(health, {})).network).toBe(PAYMENT_NETWORK);
  });

  it("a licensed accepted clip needs a verified source and current consent; revocation or lab replay removes readiness", async () => {
    const f = await setup(), sample = await analysis(f);
    const consentId = await f.t.run(async ctx => {
      const originalAssetId = await ctx.db.insert("mediaAssets", { organizationId: f.organizationId, submissionId: sample.submissionId,
        storageId: sample.reportStorageId, purpose: "original", status: "verified", contentHash: "a".repeat(64), mimeType: "video/mp4", sizeBytes: 1 });
      const consentRecordId = await ctx.db.insert("consentRecords", { organizationId: f.organizationId, submissionId: sample.submissionId,
        contributorTokenIdentifier: "demo:skarl:contributor", licenseVersion: "synthetic-license", licenseHash: PRIVATE,
        scope: "synthetic fixture consent", acknowledgedAt: Date.now(), receiptHash: PRIVATE });
      const decisionId = await ctx.db.insert("reviewDecisions", { organizationId: f.organizationId, submissionId: sample.submissionId,
        analysisResultId: sample.analysisId, taskVersionId: f.defaultTaskVersionId, decisionKey: "synthetic-health", decision: "accepted",
        reviewerTokenIdentifier: "demo:skarl:buyer", reason: PRIVATE, evidenceHash: PRIVATE, decidedAt: Date.now() });
      await ctx.db.patch(sample.submissionId, { status: "accepted", currentAnalysisId: sample.analysisId, originalAssetId, consentRecordId });
      await ctx.db.insert("deliveries", { organizationId: f.organizationId, orderId: f.defaultOrderId, submissionId: sample.submissionId, decisionId,
        manifest: { schemaVersion: "1.0", originalAssetId, sourceHash: "a".repeat(64), taskVersionId: f.defaultTaskVersionId,
          consentRecordId, licenseVersion: "synthetic-license", decisionId, analysisResultId: sample.analysisId },
        manifestHash: PRIVATE, termsHash: PRIVATE, eventKey: PRIVATE, publishedAt: Date.now() });
      return consentRecordId;
    });
    expect(await row(f.t, "licensed_clip")).toMatchObject({ status: "ok" });
    await f.t.run(ctx => ctx.db.patch(consentId, { revocationStatus: "requested" }));
    expect(await row(f.t, "licensed_clip")).toMatchObject({ status: "missing" });
    await f.t.run(async ctx => { await ctx.db.patch(consentId, { revocationStatus: undefined }); await ctx.db.patch(sample.submissionId, { simulationOnly: true }); });
    expect(await row(f.t, "licensed_clip")).toMatchObject({ status: "missing" });
  });

  it("derivation treats absent, stale, future and failed evidence differently from fresh success", () => {
    expect(evidenceStatus(1000, null, true)).toBe("missing");
    expect(evidenceStatus(1000, 900, true, 100)).toBe("ok");
    expect(evidenceStatus(1000, 899, true, 100)).toBe("degraded");
    expect(evidenceStatus(1000, 1001, true)).toBe("degraded");
    expect(evidenceStatus(1000, 900, false)).toBe("degraded");
  });
});
