import { convexTest } from "convex-test";
import { makeFunctionReference, type ApiFromModules } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import type * as proof from "./proof";
import schema from "./schema";
import { publicFingerprint } from "./lib/publicRateLimit";
import { PAYMENT_NETWORK, SOLANA_PAYMENT_NETWORK, SOLANA_USDC_MINT, USDC_ADDRESS } from "../packages/contracts/src/chain";

// Synthetic persisted facts only: these tests run no inference, signing, chain,
// bank or Jira calls. The assertions protect what the dashboard is allowed to claim.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
type ProofApi = ApiFromModules<{ proof: typeof proof }>["proof"];
const ref = <K extends keyof ProofApi>(name: K) => makeFunctionReference(`proof:${name}`) as ProofApi[K];
const FROM = `0x${"1".repeat(40)}`, TO = `0x${"2".repeat(40)}`, TX = `0x${"3".repeat(64)}`;
afterEach(() => vi.unstubAllEnvs());
async function setup() {
  const t = convexTest(schema, modules), seed = await t.mutation(internal.seed.demo, {});
  return { t, ...seed, args: { demoIdentity: "controller", orderId: seed.defaultOrderId } };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function submission(f: Fixture) {
  return f.t.run(async ctx => {
    const submissionId = await ctx.db.insert("submissions", { organizationId: f.organizationId, orderId: f.defaultOrderId,
      taskVersionId: f.defaultTaskVersionId, contributorTokenIdentifier: "demo:skarl:contributor", clientRequestId: "synthetic-proof",
      sourceHash: "a".repeat(64), status: "needs_review", updatedAt: Date.now() });
    const jobId = await ctx.db.insert("jobs", { organizationId: f.organizationId, submissionId, taskVersionId: f.defaultTaskVersionId,
      sourceHash: "a".repeat(64), pipelineVersion: "fixture", status: "completed", availableAt: Date.now(), attempt: 1, maxAttempts: 1, leaseGeneration: 1 });
    const modelRuns = ["synthetic-vision-a", "synthetic-vision-b", "synthetic-audio"].map((model, index) => ({ model, provider: "google",
      promptVersion: index === 2 ? "audio-only-events-v1" : "timestamped-frames-visible-events-v1", elapsedMs: 100 + index }));
    const report = { submissionId, taskVersionId: f.defaultTaskVersionId, source: { sha256: "a".repeat(64) },
      pipeline: { implementation: "inference", status: "completed", modelRuns }, recommendation: "accept",
      criteria: [{ criterionId: "pickup", status: "supported" }] };
    const reportStorageId = await ctx.storage.store(new Blob([JSON.stringify(report)]));
    const analysisId = await ctx.db.insert("analysisResults", { organizationId: f.organizationId, jobId, submissionId,
      taskVersionId: f.defaultTaskVersionId, sourceHash: "a".repeat(64), pipelineVersion: "fixture", leaseGeneration: 1,
      summary: "PRIVATE_MODEL_TEXT", reportStorageId, reportHash: "b".repeat(64), evidenceAssetIds: [], completedAt: Date.now(),
      reportJson: JSON.stringify(report), processingElapsedMs: 250, implementation: "inference", pipelineStatus: "completed", recommendation: "accept" });
    await ctx.db.patch(submissionId, { currentAnalysisId: analysisId });
    return { submissionId, analysisId, report };
  });
}
async function payment(f: Fixture, kind: "funding" | "contributor_payout" = "funding") {
  return f.t.run(async ctx => {
    const tenant = { organizationId: f.organizationId }, asset = { network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS };
    const amountAtomic = 9007199254740993n, now = Date.now();
    let paymentCommandId;
    let intentId;
    if (kind === "funding") {
      intentId = await ctx.db.insert("paymentIntents", { ...tenant, ...asset, kind, orderId: f.defaultOrderId,
        intentId: "synthetic-funding", buyerWalletAddress: FROM, recipientAddress: TO, amountAtomic, termsHash: "fixture",
        resourcePath: "/synthetic", x402Version: 2, paymentIdentifier: "private-nonce", expiresAt: now + 60000, status: "confirmed", updatedAt: now });
    } else {
      const submissionId = await ctx.db.insert("submissions", { ...tenant, orderId: f.defaultOrderId, taskVersionId: f.defaultTaskVersionId,
        contributorTokenIdentifier: "demo:skarl:contributor", clientRequestId: "synthetic-payable", sourceHash: "a".repeat(64), status: "accepted", updatedAt: now });
      const decisionId = await ctx.db.insert("reviewDecisions", { ...tenant, submissionId, taskVersionId: f.defaultTaskVersionId,
        decisionKey: "synthetic", decision: "accepted", reviewerTokenIdentifier: "demo:skarl:buyer", reason: "PRIVATE_REVIEW_TEXT", evidenceHash: "fixture", decidedAt: now });
      const payableId = await ctx.db.insert("payables", { ...tenant, ...asset, orderId: f.defaultOrderId, submissionId, decisionId,
        contributorTokenIdentifier: "demo:skarl:contributor", recipientAddress: TO, amountAtomic, sourceEventKey: "fixture", status: "paid", createdAt: now });
      const binding = { ...tenant, ...asset, orderId: f.defaultOrderId, payableId, requesterTokenIdentifier: "demo:skarl:finance-agent",
        recipientAddress: TO, amountAtomic, bindingHash: "fixture", sourceVersion: "fixture", status: "confirmed" as const, updatedAt: now };
      paymentCommandId = await ctx.db.insert("paymentCommands", { ...binding, commandId: "synthetic-payout", kind,
        requestedBy: { kind: "service", identity: "demo:skarl:finance-agent" }, attemptCount: 1, leaseGeneration: 0 });
      intentId = await ctx.db.insert("paymentIntents", { ...binding, kind, intentId: "synthetic-payout", paymentCommandId, expiresAt: now + 60000 });
    }
    const attemptId = await ctx.db.insert("paymentAttempts", { ...tenant, ...asset, paymentIntentId: intentId,
      ...(paymentCommandId ? { paymentCommandId } : {}), attemptId: "synthetic-attempt", attempt: 1, amountAtomic,
      payerAddress: FROM, authorizationNonce: kind === "funding" ? "private-nonce" : undefined,
      status: "confirmed", txHash: TX, createdAt: now - 500, updatedAt: now });
    return { intentId, attemptId, paymentCommandId, amountAtomic, observation: { ...tenant, ...asset, paymentAttemptId: attemptId,
      txHash: TX, logIndex: 2, blockNumber: 123n, blockHash: `0x${"4".repeat(64)}`, fromAddress: FROM, toAddress: TO,
      amountAtomic, confirmations: 2, succeeded: true, observedAt: now } };
  });
}

describe("sponsor proof read boundaries", () => {
  it.each(["buyer", "controller", "finance-agent"])("allows %s to render one summary without manufacturing missing proof", async demoIdentity => {
    const f = await setup(), result = await f.t.query(ref("summary"), { ...f.args, demoIdentity });
    expect(result.bank4Way).toMatchObject({ label: "Mock bank (Capital One Nessie)", simulated: true });
    for (const section of [result.payouts, result.fundingTimeline, result.attestations, result.agentRuns, result.jury]) expect(section.missing).toBeTypeOf("string");
    expect(result.guard).toMatchObject({ mirroredExceptionCount: null, lastSyncAt: null, uncertainWrites: null });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it.each(["bank4Way", "payouts", "fundingTimeline", "attestations", "agentRuns", "summary"] as const)("%s denies another buyer's order because organization membership is insufficient", async name => {
    const f = await setup();
    await f.t.run(ctx => ctx.db.patch(f.defaultOrderId, { buyerTokenIdentifier: "auth:another-buyer" }));
    await expect(f.t.query(ref(name), { ...f.args, demoIdentity: "buyer" })).rejects.toThrow("order_not_owned");
  });

  it.each(["agentWallet", "guard", "convexFeatures"] as const)("%s does not grant financial reads to a contributor", async name => {
    const f = await setup();
    await expect(f.t.query(ref(name), { demoIdentity: "contributor" })).rejects.toThrow("forbidden");
  });

  it("uses signed-in membership rather than a caller's demo selector", async () => {
    const f = await setup();
    const userId = await f.t.run(ctx => ctx.db.insert("users", {}));
    await expect(f.t.withIdentity({ subject: `${userId}|synthetic-session` }).query(ref("summary"), f.args)).rejects.toThrow("inactive_membership");
  });

  it("rejects a cross-tenant reference even when the order id is known", async () => {
    const f = await setup();
    await f.t.run(async ctx => {
      const organizationId = await ctx.db.insert("organizations", { name: "Other", status: "active", createdByTokenIdentifier: "other" });
      await ctx.db.patch(f.defaultOrderId, { organizationId });
    });
    await expect(f.t.query(ref("payouts"), f.args)).rejects.toThrow();
  });

  it("keeps global proof cards scoped to owned orders when shared dashboard authority is broader", async () => {
    const f = await setup();
    await f.t.run(async ctx => {
      await ctx.db.patch(f.defaultOrderId, { buyerTokenIdentifier: "auth:another-buyer" });
      await ctx.db.insert("scheduledCheckpoints", { organizationId: f.organizationId, orderId: f.defaultOrderId,
        key: `reconciliation:${f.defaultOrderId}`, kind: "reconciliation", generation: 1, nextAt: 0, leaseUntil: 0,
        status: "complete", updatedAt: 1234, payloadJson: JSON.stringify([{ detail: "OTHER_BUYER_PRIVATE_EXCEPTION" }]) });
    });
    const buyerGuard = await f.t.query(ref("guard"), { demoIdentity: "buyer" });
    expect(buyerGuard.feedExceptionCount).toBe("0");
    expect((await f.t.query(ref("guard"), { demoIdentity: "controller" })).feedExceptionCount).toBe("1");
    const buyerFeatures = await f.t.query(ref("convexFeatures"), { demoIdentity: "buyer" });
    expect(buyerFeatures.scheduler.runs).toEqual([]);
    expect(JSON.stringify([buyerGuard, buyerFeatures])).not.toMatch(/OTHER_BUYER_PRIVATE_EXCEPTION/);
  });
});

describe("payment claim evidence", () => {
  it.each(["no_observation", "wrong_amount", "failed_receipt", "one_confirmation"])("does not label a confirmed DB status paid with %s", async condition => {
    const f = await setup(), p = await payment(f, "contributor_payout");
    if (condition !== "no_observation") await f.t.run(ctx => ctx.db.insert("chainObservations", { ...p.observation,
      ...(condition === "wrong_amount" ? { amountAtomic: p.amountAtomic - 1n } : {}),
      ...(condition === "failed_receipt" ? { succeeded: false } : {}), ...(condition === "one_confirmation" ? { confirmations: 1 } : {}) }));
    const result = await f.t.query(ref("payouts"), f.args);
    expect(result.rows[0]).toMatchObject({ status: "requires_reconciliation", chainObserved: false, amountAtomic: "9007199254740993", executor: null });
  });

  it("requires an exact observed transfer and keeps historical executor unknown after the flag changes", async () => {
    const f = await setup(), p = await payment(f, "contributor_payout");
    await f.t.run(ctx => ctx.db.insert("chainObservations", p.observation));
    vi.stubEnv("PAYOUT_EXECUTOR", "cdp_agent");
    const result = await f.t.query(ref("payouts"), f.args);
    expect(result.rows[0]).toMatchObject({ status: "paid", chainObserved: true, executor: null, txHash: TX,
      explorerUrl: `https://sepolia.basescan.org/tx/${TX}` });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("does not collapse two transfer logs into one successful payout", async () => {
    const f = await setup(), p = await payment(f, "contributor_payout");
    await f.t.run(async ctx => {
      await ctx.db.insert("chainObservations", p.observation);
      await ctx.db.insert("chainObservations", { ...p.observation, logIndex: 3 });
    });
    expect((await f.t.query(ref("payouts"), f.args)).rows[0].status).toBe("requires_reconciliation");
  });

  it("shows a pending webhook before chain observation and never invents challenge or settlement times", async () => {
    const f = await setup(), p = await payment(f);
    await f.t.run(ctx => ctx.db.insert("cdpWebhookReceipts", { organizationId: f.organizationId, treasury: TO,
      eventId: "synthetic-webhook", transferKey: `${PAYMENT_NETWORK}:${TX}:2`, txHash: TX, logIndex: 2,
      fromAddress: FROM, toAddress: TO, amountAtomic: p.amountAtomic.toString(), status: "pending", receivedAt: 1000, updatedAt: 1001 }));
    const result = await f.t.query(ref("fundingTimeline"), f.args), steps = result.rows[0]!.steps;
    expect(steps.map(row => row.stage)).toEqual(["402", "signed", "settled", "webhook", "chain"]);
    expect(steps.find(row => row.stage === "signed")).toMatchObject({ missing: null });
    expect(steps.find(row => row.stage === "webhook")).toMatchObject({ timestamp: 1000, missing: null });
    for (const stage of ["402", "settled", "chain"]) expect(steps.find(row => row.stage === stage)).toMatchObject({ timestamp: null, missing: expect.any(String) });
    const bank = await f.t.query(ref("bank4Way"), f.args);
    expect(bank.rows).toHaveLength(1);
    expect(bank.bankAvailable).toBe(false);
    expect(bank.missing).toContain("Nessie");
  });

  it("preserves Solana signature case so a different transaction cannot satisfy funding evidence", async () => {
    const f = await setup(), p = await payment(f);
    await f.t.run(async ctx => {
      const rail = { network: SOLANA_PAYMENT_NETWORK, tokenAddress: SOLANA_USDC_MINT };
      await ctx.db.patch(p.intentId, { ...rail, buyerWalletAddress: "D".repeat(32), recipientAddress: "E".repeat(32) });
      await ctx.db.patch(p.attemptId, { ...rail, payerAddress: "D".repeat(32), txHash: "A".repeat(88) });
      await ctx.db.insert("chainObservations", { ...p.observation, ...rail, fromAddress: "D".repeat(32), toAddress: "E".repeat(32),
        blockHash: "C".repeat(32), txHash: "a".repeat(88) });
    });
    const result = await f.t.query(ref("fundingTimeline"), f.args);
    expect(result.rows[0]!.label).toBe("Solana Devnet");
    expect(result.rows[0]!.observations[0]!.agrees).toBe(false);
    expect((await (await f.t.fetch(`/proof.json?orderId=${f.defaultOrderId}`)).json()).funding.rows[0].chainObserved).toBe(false);
  });
});

describe("jury and sponsor provenance", () => {
  it("does not count the audio run as a second independent visual judge", async () => {
    const f = await setup(), s = await submission(f);
    const result = await f.t.query(ref("jury"), { demoIdentity: "buyer", submissionId: s.submissionId });
    expect(result.modelRuns).toHaveLength(3);
    expect(result.agreementFraction).toBeNull();
    expect(result.missing).toContain("Two independent");
  });

  it.each([false, true])("compares both models per criterion; failed judge=%s cannot become agreement", async failed => {
    const f = await setup(), s = await submission(f);
    await f.t.run(ctx => ctx.db.patch(s.analysisId, { observationsJson: JSON.stringify({ jury: { agreementFraction: 1,
      judges: [
        { model: "synthetic-vision-a", report: s.report },
        { model: "synthetic-vision-b", ...(failed ? { failureCode: "video_unavailable" } : {}),
          report: { ...s.report, criteria: [{ criterionId: "pickup", status: "contradicted" }] } },
      ] } }) }));
    const result = await f.t.query(ref("jury"), { demoIdentity: "controller", submissionId: s.submissionId });
    expect(result.judges.map(row => row.latencyMs)).toEqual([100, 101]);
    expect(result.latencyMs).toBe(250);
    expect(result.agreementFraction).toBe(failed ? null : 0);
    expect(result.criteria[0]!.agreement).toBe(failed ? null : false);
  });

  it("rejects a borrowed current analysis instead of showing another submission's jury", async () => {
    const f = await setup(), s = await submission(f);
    await f.t.run(ctx => ctx.db.patch(s.analysisId, { sourceHash: "f".repeat(64) }));
    await expect(f.t.query(ref("jury"), { demoIdentity: "buyer", submissionId: s.submissionId })).rejects.toThrow("analysis_reference_mismatch");
  });

  it("separates recorded CDP rejections from current configuration and never returns credentials", async () => {
    const f = await setup();
    vi.stubEnv("CDP_AGENT_ADDRESS", FROM); vi.stubEnv("CDP_AGENT_POLICY_ID", "synthetic-policy");
    vi.stubEnv("CDP_PAYOUT_CAP_ATOMIC", "9007199254740993"); vi.stubEnv("PAYOUT_EXECUTOR", "cdp_agent");
    vi.stubEnv("CDP_API_KEY_SECRET", "SYNTHETIC_DO_NOT_EXPORT");
    const result = await f.t.query(ref("agentWallet"), { demoIdentity: "buyer" });
    expect(result).toMatchObject({ address: FROM, capAtomic: "9007199254740993", executorMode: "cdp_agent" });
    expect(result.recordedRejections).toHaveLength(2);
    expect(result.recorded.address).not.toBe(result.address);
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_DO_NOT_EXPORT");
  });

  it("reports actual routes/crons and checkpoint evidence without treating registration as execution", async () => {
    const f = await setup();
    await f.t.run(ctx => ctx.db.insert("scheduledCheckpoints", { organizationId: f.organizationId, key: "job:reconciliation",
      kind: "job", generation: 1, nextAt: 2000, leaseUntil: 0, status: "failed", updatedAt: 1234 }));
    const result = await f.t.query(ref("convexFeatures"), { demoIdentity: "controller" });
    expect(result.crons.map(row => row.function)).toEqual(expect.arrayContaining([
      "scheduledJobs:reconcile", "scheduledJobs:finance", "attestations:sweep", "bankWitness:sweep",
    ]));
    expect(result.crons.find(row => row.function === "scheduledJobs:reconcile")).toMatchObject({ lastRunAt: 1234, lastStatus: "failed" });
    expect(result.crons.find(row => row.function === "attestations:sweep")?.lastRunAt).toBeNull();
    expect(result.httpActions).toContainEqual({ path: "/proof.json", method: "GET" });
    expect(result.httpActions).toContainEqual({ path: "/mcp", method: "POST" });
    const buyer = await f.t.query(ref("convexFeatures"), { demoIdentity: "buyer" });
    expect(buyer.scheduler.runs).toEqual([]);
  });

  it("shows dispatcher refusals and independent policy approval alongside the actual model badge", async () => {
    const f = await setup(), p = await payment(f, "contributor_payout");
    await f.t.run(async ctx => {
      const approvalId = await ctx.db.insert("approvals", { organizationId: f.organizationId, paymentCommandId: p.paymentCommandId!,
        requestedBy: { kind: "service", identity: "demo:skarl:finance-agent" }, approverTokenIdentifier: "service:skarl:policy-engine",
        bindingHash: "fixture", status: "approved", reason: "Synthetic buyer-signed cap check", decidedAt: 2000, expiresAt: Date.now() + 60000 });
      await ctx.db.patch(p.paymentCommandId!, { approvalId });
      await ctx.db.insert("financeAgentRuns", { organizationId: f.organizationId, orderId: f.defaultOrderId, requestId: "fixture",
        prompt: "PRIVATE_PROMPT", requesterTokenIdentifier: "demo:skarl:buyer", provider: "claude", model: "synthetic-claude-model",
        maxToolCalls: 2, maxBatchAtomic: p.amountAtomic, proposedAtomic: p.amountAtomic, reservedPayableIds: [], status: "completed",
        transcriptJson: JSON.stringify([{ call: { name: "approve", arguments: { note: "PRIVATE_TOOL_ARGUMENT" } }, result: { ok: false, code: "self_approval_refused" } }]), startedAt: 1000 });
    });
    const result = await f.t.query(ref("agentRuns"), f.args);
    expect(result.rows[0]).toMatchObject({ provider: "claude", model: "synthetic-claude-model", toolRefusals: [{ index: 0, tool: "approve", code: "self_approval_refused", source: "persisted_dispatcher_result" }] });
    expect(result.approvals[0]).toMatchObject({ policyEngine: true, status: "approved", decidedAt: 2000 });
    expect(result.refusalMissing).toBeNull();
    expect(result.policyApprovalMissing).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_PROMPT|PRIVATE_TOOL_ARGUMENT/);
  });

  it("never exports a stale attestation after the current analysis changes", async () => {
    const f = await setup(), s = await submission(f), uid = `0x${"c".repeat(64)}`;
    await f.t.run(ctx => ctx.db.insert("attestations", { analysisId: s.analysisId, submissionId: s.submissionId, schemaUid: "fixture",
      attestor: FROM, requestId: "fixture", status: "confirmed", attestationUid: uid, txHash: TX, generation: 1, leaseUntil: 0,
      nextRetryAt: 0, createdAt: 1000, updatedAt: 2000, fields: { reportHash: "fixture", sourceSha256: "a".repeat(64), rubricHash: "fixture",
        pipelineVersion: "fixture", videoModel: "synthetic-vision-a", recommendation: "accept", verifiedAt: 1000, licensed: false } }));
    const confirmed = await f.t.query(ref("attestations"), f.args);
    expect(confirmed.rows[0]!.attestation).toMatchObject({ uid, easscanUrl: expect.stringContaining("easscan.org") });
    expect((await (await f.t.fetch(`/proof.json?orderId=${f.defaultOrderId}`)).json()).attestations.rows).toHaveLength(1);
    await f.t.run(ctx => ctx.db.patch(s.submissionId, { currentAnalysisId: undefined }));
    expect((await f.t.query(ref("attestations"), f.args)).rows[0]!.missing).toContain("current analysis");
    expect((await (await f.t.fetch(`/proof.json?orderId=${f.defaultOrderId}`)).json()).attestations.rows).toEqual([]);
  });

  it("does not treat two copies of the same model as an independent jury", async () => {
    const f = await setup(), s = await submission(f);
    await f.t.run(ctx => ctx.db.patch(s.analysisId, { observationsJson: JSON.stringify({ jury: { judges: [
      { model: "synthetic-vision-a", report: s.report }, { model: "synthetic-vision-a", report: s.report },
    ] } }) }));
    const result = await f.t.query(ref("jury"), { demoIdentity: "controller", submissionId: s.submissionId });
    expect(result.agreementFraction).toBeNull();
    expect(result.missing).toContain("independent");
  });
});

describe("public sponsor proof", () => {
  it("shares discovery's durable abuse budget so proof reads cannot bypass the public ingress limit", async () => {
    const f = await setup(), origin = "https://judge.example";
    const fingerprint = await publicFingerprint(new Request("https://example.test/proof.json", { headers: { Origin: origin } }));
    await f.t.run(ctx => ctx.db.insert("publicRateBuckets", { key: `discovery:${fingerprint}`, tokens: 0, updatedAt: Date.now() + 10000 }));
    const response = await f.t.fetch(`/proof.json?orderId=${f.defaultOrderId}`, { headers: { Origin: origin } });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(await response.json()).toMatchObject({ error: "rate_limited" });
  });

  it("uses an explicit publication boundary, not role impersonation or knowledge of private ids", async () => {
    const f = await setup();
    expect((await f.t.fetch(`/proof.json?orderId=${f.orderId}`)).status).toBe(404);
    expect((await f.t.fetch(`/proof.json?orderId=${f.orderId}`, { headers: { Authorization: "Bearer synthetic-private-token" } })).status).toBe(404);
    expect((await f.t.fetch(`/proof.json?orderId=${f.defaultOrderId}&demoIdentity=controller`)).status).toBe(400);
    expect((await f.t.fetch(`/proof.json?orderId=${f.defaultOrderId}&orderId=${f.orderId}`)).status).toBe(400);
    expect((await f.t.fetch("/proof.json?orderId=invalid")).status).toBe(404);
    expect((await f.t.fetch("/proof.json")).status).toBe(400);
  });

  it("publishes allowlisted exact funding proof while withholding identities, media and outgoing transfer linkage", async () => {
    const f = await setup(), p = await payment(f), s = await submission(f);
    await f.t.run(ctx => ctx.db.insert("chainObservations", p.observation));
    vi.stubEnv("CDP_API_KEY_SECRET", "SYNTHETIC_DO_NOT_EXPORT");
    const response = await f.t.fetch(`/proof.json?orderId=${f.defaultOrderId}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.text(), result = JSON.parse(body);
    expect(result.funding.rows[0]).toMatchObject({ chainObserved: true, amountAtomic: "9007199254740993", transfers: [{ txHash: TX, logIndex: 2, observedAt: p.observation.observedAt, explorerUrl: `https://sepolia.basescan.org/tx/${TX}` }] });
    for (const value of [FROM, TO, s.submissionId, s.analysisId, p.attemptId, "demo:skarl", "PRIVATE_MODEL_TEXT", "private-nonce", "SYNTHETIC_DO_NOT_EXPORT"]) expect(body).not.toContain(value);
    expect(result.payouts.chainObservedCount).toBe("0");
    expect(result.bank).toEqual({ label: "Mock bank (Capital One Nessie)", simulated: true });
    expect((await f.t.fetch("/proof.json", { method: "OPTIONS" })).status).toBe(204);
    expect(await (await f.t.fetch("/llms.txt")).text()).toContain("/proof.json?orderId=");
    expect((await (await f.t.fetch("/.well-known/agent-card.json")).json()).proofUrl).toContain("/proof.json?orderId=");
  });
});
