import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const integrations = makeFunctionReference<"query">("health:integrations");
afterEach(() => vi.unstubAllEnvs());

async function verificationFixture({ elapsedMs, simulationOnly = false }: { elapsedMs?: number; simulationOnly?: boolean } = {}) {
  const t = convexTest(schema, modules);
  const seeded = await t.mutation(internal.seed.demo, {});
  await t.run(async ctx => {
    const now = Date.now(), sourceHash = "a".repeat(64);
    const submissionId = await ctx.db.insert("submissions", {
      organizationId: seeded.organizationId, orderId: seeded.defaultOrderId, taskVersionId: seeded.defaultTaskVersionId,
      contributorTokenIdentifier: "demo:skarl:contributor", status: "needs_review", clientRequestId: "synthetic-health-review",
      ...(simulationOnly ? { simulationOnly: true as const } : {}), updatedAt: now,
    });
    const jobId = await ctx.db.insert("jobs", {
      organizationId: seeded.organizationId, submissionId, taskVersionId: seeded.defaultTaskVersionId,
      sourceHash, pipelineVersion: "red-cup-evidence-1.2", status: "completed", availableAt: now,
      attempt: 1, maxAttempts: 1, leaseGeneration: 1,
    });
    const reportStorageId = await ctx.storage.store(new Blob(["synthetic-report"], { type: "application/json" }));
    await ctx.db.insert("analysisResults", {
      organizationId: seeded.organizationId, jobId, submissionId, taskVersionId: seeded.defaultTaskVersionId,
      sourceHash, pipelineVersion: "red-cup-evidence-1.2", leaseGeneration: 1,
      summary: "synthetic-private-model-text", reportStorageId, reportHash: "b".repeat(64), evidenceAssetIds: [],
      completedAt: now, implementation: "inference", pipelineStatus: "needs_review", recommendation: "needs_review",
      reportJson: JSON.stringify({ pipeline: { implementation: "inference", status: "needs_review", modelRuns: [
        { provider: "google", model: "gemini-3.8-flash", ...(elapsedMs === undefined ? {} : { elapsedMs }) },
      ] } }),
    });
  });
  return t;
}

it("counts successful Gemini requests on negative reports because provider reachability does not imply clip acceptance", async () => {
  vi.stubEnv("GEMINI_API_KEY", "synthetic-private-key");
  const t = await verificationFixture({ elapsedMs: 12 });
  const report = await t.query(integrations, {});
  expect(report.items.find((item: { id: string }) => item.id === "gemini")).toMatchObject({ status: "ok" });
  const text = JSON.stringify(report);
  expect(text).not.toContain("synthetic-private-model-text");
  expect(text).not.toContain("synthetic-private-key");
});

it("does not count placeholder Gemini metadata because failed requests also record model names", async () => {
  vi.stubEnv("GEMINI_API_KEY", "synthetic-private-key");
  const t = await verificationFixture();
  expect((await t.query(integrations, {})).items.find((item: { id: string }) => item.id === "gemini")).toMatchObject({ status: "missing" });
});

it("does not count scenario inference because synthetic evidence cannot establish a live integration", async () => {
  vi.stubEnv("GEMINI_API_KEY", "synthetic-private-key");
  const t = await verificationFixture({ elapsedMs: 12, simulationOnly: true });
  expect((await t.query(integrations, {})).items.find((item: { id: string }) => item.id === "gemini")).toMatchObject({ status: "missing" });
});

it("includes successful Claude coach calls because the latest provider success can occur outside the finance loop", async () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-private-key");
  const t = await verificationFixture({ elapsedMs: 12 });
  await t.run(async ctx => {
    const analysis = (await ctx.db.query("analysisResults").first())!;
    await ctx.db.insert("coachExplanations", {
      organizationId: analysis.organizationId, submissionId: analysis.submissionId,
      contributorTokenIdentifier: "demo:skarl:contributor", analysisId: analysis._id,
      sourceKey: "synthetic-coach-health", reportHash: analysis.reportHash, model: "claude-synthetic",
      promptVersion: "synthetic-coach", inputJson: "synthetic-private-input", outputJson: "synthetic-private-output",
      status: "completed", generation: 1, startedAt: Date.now() - 100, completedAt: Date.now(),
    });
  });
  const report = await t.query(integrations, {});
  expect(report.items.find((item: { id: string }) => item.id === "claude")).toMatchObject({ status: "ok" });
  expect(JSON.stringify(report)).not.toContain("synthetic-private");
});

it("never exports env credentials because the public endpoint requires only presence and a public SITE_URL", async () => {
  const names = ["GEMINI_API_KEY", "ANTHROPIC_API_KEY", "SKARL_PAYMENTS_SERVICE_SECRET", "CDP_API_KEY_ID",
    "CDP_API_KEY_SECRET", "CDP_WALLET_SECRET", "CDP_AGENT_POLICY_ID", "NESSIE_API_KEY", "SKARL_JIRA_FEED_SECRET",
    "EAS_ATTESTOR_POLICY_ID", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET", "JWT_PRIVATE_KEY", "JWKS"];
  for (const name of names) vi.stubEnv(name, `synthetic-private-value-${name}-at-least-32-characters`);
  vi.stubEnv("SITE_URL", "https://skarl.example");
  const t = convexTest(schema, modules);
  const query = await t.query(integrations, {});
  const response = await t.fetch("/health");
  expect(response.status).toBe(200);
  for (const text of [JSON.stringify(query), await response.text()]) {
    expect(text).not.toContain("synthetic-private-value-");
    expect(text).toContain("https://skarl.example");
    for (const name of names) expect(text).toContain(name);
  }
});

it("accepts the deployed Forge publisher contract because separate local unit suites cannot prove callback compatibility", async () => {
  const secret = "synthetic-jira-summary-secret-at-least-32-characters";
  vi.stubEnv("SKARL_JIRA_FEED_SECRET", secret);
  const t = convexTest(schema, modules), lastSyncAt = Date.now() - 1000;
  const response = await t.fetch("/health/jira", {
    method: "POST", headers: { "Content-Type": "application/json", "x-skarl-feed-secret": secret },
    body: JSON.stringify({ lastSyncAt, uncertainCount: 0, truncated: true }),
  });
  expect(response.status).toBe(200);
  const row = (await t.query(integrations, {})).items.find((item: { id: string }) => item.id === "jira");
  expect(row).toMatchObject({ status: "degraded", evidence: { lastSyncAt } });
  // Zero is a lower bound when the audit scan is capped, not a clean inventory.
  expect(row.evidence.uncertainCount === null ||
    (row.evidence.uncertainCount === 0 && Object.entries(row.evidence).some(([key, value]) => /truncated/i.test(key) && value === true))).toBe(true);
});
