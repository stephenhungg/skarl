import { convexTest, type TestConvex } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { runScheduledUntil } from "../test/workflow";
import { PAYMENT_CHAIN_ID, PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/chain";

// These are isolated in-memory policy tests. The stored media, completed-analysis
// projection, verified-wallet record, and funding entry below are synthetic
// fixtures, not evidence of inference, SIWE verification, or a chain transfer.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
type Test = TestConvex<typeof schema>;
type Fixture = {
  t: Test;
  organizationId: Id<"organizations">;
  orderId: Id<"orders">;
  taskVersionId: Id<"rubricVersions">;
  sequence: number;
};

const CONTRIBUTOR = "demo:skarl:contributor";
const CONTROLLER = "demo:skarl:controller";
const AGENT = "demo:skarl:finance-agent";
const RECIPIENT = "0x1111111111111111111111111111111111111111";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

async function setup(funded = true): Promise<Fixture> {
  const t = convexTest(schema, modules);
  workflowTest.register(t);
  const seeded = await t.mutation(internal.seed.demo, {});
  await t.run(async (ctx) => {
    const contributor = await ctx.db.query("memberships")
      .withIndex("by_token_identifier", (q) => q.eq("tokenIdentifier", CONTRIBUTOR)).unique();
    if (!contributor) throw new Error("missing fixture contributor");
    await ctx.db.patch(contributor._id, {
      walletAddress: RECIPIENT,
      walletVerification: {
        siweMessageHash: "e".repeat(64), nonce: "fixture-only-not-a-live-siwe-proof",
        signature: `0x${"1".repeat(130)}`, chainId: PAYMENT_CHAIN_ID, verifiedAt: Date.now(),
      },
    });
    if (!funded) return;
    // Deliberately bypass the real funding integration: this simulates its
    // trusted database preconditions without fabricating a transaction hash.
    const now = Date.now();
    const entry = await ctx.db.insert("journalEntries", {
      organizationId: seeded.organizationId, orderId: seeded.orderId,
      network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS,
      eventKey: `fixture:funding:${seeded.orderId}`, kind: "funding", status: "posted",
      memo: "Synthetic test prepayment; no onchain transfer performed",
      sourceReference: "fixture-only:no-chain-receipt", effectiveAt: now, recordedAt: now,
    });
    await ctx.db.insert("journalLines", {
      organizationId: seeded.organizationId, journalEntryId: entry,
      account: "asset:usdc", side: "debit", amountAtomic: 100_000_000n, lineNumber: 0,
    });
    await ctx.db.insert("journalLines", {
      organizationId: seeded.organizationId, journalEntryId: entry,
      account: "liability:customer_prepayments", side: "credit", amountAtomic: 100_000_000n, lineNumber: 1,
    });
    await ctx.db.patch(seeded.orderId, { status: "funded", updatedAt: now });
  });
  return { t, organizationId: seeded.organizationId, orderId: seeded.orderId, taskVersionId: seeded.taskVersionId, sequence: 0 };
}

async function submission(fixture: Fixture, options: {
  sourceHash?: string;
  perceptualHash?: string;
  unavailableAnalysis?: boolean;
  environment?: string;
  variant?: string;
} = {}) {
  const sequence = ++fixture.sequence;
  const sourceHash = options.sourceHash ?? sequence.toString(16).padStart(64, "0");
  return fixture.t.run(async (ctx) => {
    const now = Date.now();
    const submissionId = await ctx.db.insert("submissions", {
      organizationId: fixture.organizationId, orderId: fixture.orderId, taskVersionId: fixture.taskVersionId,
      contributorTokenIdentifier: CONTRIBUTOR, status: "needs_review", clientRequestId: `fixture-submission-${sequence}`,
      ...(options.environment !== undefined ? { environment: options.environment } : {}),
      ...(options.variant !== undefined ? { variant: options.variant } : {}),
      expectedSourceHash: sourceHash, sourceHash,
      ...(options.perceptualHash ? { perceptualHash: options.perceptualHash } : {}), updatedAt: now,
    });
    const storageId = await ctx.storage.store(new Blob([`synthetic-media-fixture-${sequence}`], { type: "video/mp4" }));
    const originalAssetId = await ctx.db.insert("mediaAssets", {
      organizationId: fixture.organizationId, submissionId, storageId, purpose: "original", status: "verified",
      contentHash: sourceHash, mimeType: "video/mp4", sizeBytes: 128, durationMs: 12_000, width: 720, height: 480,
    });
    const consentRecordId = await ctx.db.insert("consentRecords", {
      organizationId: fixture.organizationId, submissionId, contributorTokenIdentifier: CONTRIBUTOR,
      licenseVersion: "demo-consent-v1", licenseHash: "f".repeat(64), scope: "Synthetic test demonstration license",
      acknowledgedAt: now, receiptHash: "d".repeat(64),
    });
    const jobId = await ctx.db.insert("jobs", {
      organizationId: fixture.organizationId, submissionId, taskVersionId: fixture.taskVersionId,
      sourceHash, pipelineVersion: "fixture-inference-v1", status: "completed", availableAt: now,
      attempt: 1, maxAttempts: 1, leaseGeneration: 1, completedAt: now,
    });
    const reportStorageId = await ctx.storage.store(new Blob([
      JSON.stringify({ fixtureOnly: true, submissionId, sourceHash, note: "No model was run" }),
    ], { type: "application/json" }));
    const outcome = options.unavailableAnalysis
      ? { implementation: "scaffold" as const, pipelineStatus: "ml_unavailable" as const, recommendation: "needs_review" as const }
      : { implementation: "inference" as const, pipelineStatus: "completed" as const, recommendation: "accept" as const };
    const analysisId = await ctx.db.insert("analysisResults", {
      organizationId: fixture.organizationId, jobId, submissionId, taskVersionId: fixture.taskVersionId,
      sourceHash, pipelineVersion: "fixture-inference-v1", leaseGeneration: 1,
      ...outcome, summary: "Synthetic stored analysis projection; not a live model result",
      reportStorageId, reportHash: "c".repeat(64), evidenceAssetIds: [originalAssetId], completedAt: now,
    });
    await ctx.db.patch(submissionId, { originalAssetId, consentRecordId, currentAnalysisId: analysisId });
    return submissionId;
  });
}

async function snapshot(fixture: Fixture) {
  return fixture.t.run(async (ctx) => {
    const order = await ctx.db.get(fixture.orderId);
    const payables = await ctx.db.query("payables").withIndex("by_order", (q) => q.eq("orderId", fixture.orderId)).collect();
    const deliveries = await ctx.db.query("deliveries").withIndex("by_order", (q) => q.eq("orderId", fixture.orderId)).collect();
    const entries = await ctx.db.query("journalEntries").withIndex("by_order", (q) => q.eq("orderId", fixture.orderId)).collect();
    const lines = (await Promise.all(entries.map((entry) => ctx.db.query("journalLines")
      .withIndex("by_entry", (q) => q.eq("journalEntryId", entry._id)).collect()))).flat();
    const commands = await ctx.db.query("paymentCommands").filter((q) => q.eq(q.field("orderId"), fixture.orderId)).collect();
    const intents = await ctx.db.query("paymentIntents").withIndex("by_order", (q) => q.eq("orderId", fixture.orderId)).collect();
    const approvals = (await ctx.db.query("approvals").collect()).filter((approval) =>
      commands.some((command) => command._id === approval.paymentCommandId));
    const audits = await ctx.db.query("auditEvents").withIndex("by_org_time", (q) => q.eq("organizationId", fixture.organizationId)).collect();
    const outbox = await ctx.db.query("outboxEvents").filter((q) => q.eq(q.field("orderId"), fixture.orderId)).collect();
    const attempts = await ctx.db.query("paymentAttempts").collect();
    const observations = await ctx.db.query("chainObservations").collect();
    return { order, payables, deliveries, entries, lines, commands, intents, approvals, audits, outbox, attempts, observations };
  });
}

type Snapshot = Awaited<ReturnType<typeof snapshot>>;
function balance(state: Snapshot, account: string, normalSide: "debit" | "credit") {
  return state.lines.filter((line) => line.account === account).reduce((sum, line) =>
    sum + (line.side === normalSide ? line.amountAtomic : -line.amountAtomic), 0n);
}
function expectBalanced(state: Snapshot) {
  for (const entry of state.entries) {
    const lines = state.lines.filter((line) => line.journalEntryId === entry._id);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.every((line) => typeof line.amountAtomic === "bigint" && line.amountAtomic > 0n)).toBe(true);
    const total = (side: "debit" | "credit") => lines.filter((line) => line.side === side)
      .reduce((sum, line) => sum + line.amountAtomic, 0n);
    expect(total("debit")).toBe(total("credit"));
  }
}
async function acceptedFixture() {
  const fixture = await setup();
  const submissionId = await submission(fixture);
  const accepted = await fixture.t.mutation(api.finance.acceptAndPublish, { demoIdentity: "controller", submissionId });
  expect(accepted.ok).toBe(true);
  if (!accepted.ok) throw new Error(`Fixture acceptance failed: ${accepted.code}`);
  return { ...fixture, submissionId, accepted };
}

async function recordHumanDecision(fixture: Fixture, submissionId: Id<"submissions">,
  reviewerTokenIdentifier = CONTROLLER, evidenceHash?: string) {
  return fixture.t.run(async (ctx) => {
    const submitted = await ctx.db.get(submissionId);
    if (!submitted?.currentAnalysisId) throw new Error("missing fixture analysis");
    const analysis = await ctx.db.get(submitted.currentAnalysisId);
    if (!analysis) throw new Error("missing fixture analysis projection");
    const decisionId = await ctx.db.insert("reviewDecisions", {
      organizationId: fixture.organizationId, submissionId, analysisResultId: analysis._id,
      taskVersionId: fixture.taskVersionId, decisionKey: `fixture:manual-review:${submissionId}`,
      decision: "accepted", reviewerTokenIdentifier,
      reason: "Synthetic record of independent human review of the attached evidence",
      evidenceHash: evidenceHash ?? analysis.reportHash, decidedAt: Date.now(),
    });
    await ctx.db.patch(submissionId, { currentDecisionId: decisionId });
    return decisionId;
  });
}

describe("demo finance mutations against isolated Convex state", () => {
  it("caps contributor concentration before creating obligations and keeps acceptance replay safe", async () => {
    const f = await setup();
    await f.t.run(ctx => ctx.db.patch(f.orderId, { diversity: { maxPerContributor: 1 } }));
    const firstId = await submission(f), secondId = await submission(f);
    const first = await f.t.mutation(api.finance.acceptAndPublish, { demoIdentity: "controller", submissionId: firstId });
    expect(first.ok).toBe(true);
    expect(await f.t.mutation(api.finance.acceptAndPublish, { demoIdentity: "controller", submissionId: firstId })).toEqual({ ...first, replayed: true });
    const before = await snapshot(f);
    const args = { demoIdentity: "controller", submissionId: secondId };
    expect(await f.t.mutation(api.finance.acceptAndPublish, args)).toEqual({ ok: false, code: "diversity_quota_exceeded" });
    await f.t.mutation(api.finance.acceptAndPublish, args);
    const after = await snapshot(f);
    // A quality-approved clip outside collection terms must accrue no payable,
    // revenue, or delivery; retaining the refusal explains why it was excluded.
    expect(after.payables).toEqual(before.payables);
    expect(after.deliveries).toEqual(before.deliveries);
    expect(after.entries).toEqual(before.entries);
    expect(after.order?.acceptedCount).toBe(1n);
    expect(after.audits.filter(event => event.entityId === secondId && event.reason === "diversity_quota_exceeded"))
      .toMatchObject([{ action: "acceptance_refused", evidenceReferences: [f.orderId, "maxPerContributor"] }]);
    expect(await f.t.run(ctx => ctx.db.get(secondId))).toMatchObject({ status: "needs_review" });
  });

  it("requires an environment bucket so omitted tags cannot bypass its cap", async () => {
    const f = await setup();
    await f.t.run(ctx => ctx.db.patch(f.orderId, { diversity: { maxPerEnvironment: 1 } }));
    for (const environment of [undefined, "kitchen-a", "kitchen-a", "kitchen-b"]) {
      const id = await submission(f, { environment });
      const result = await f.t.mutation(api.finance.acceptAndPublish, { demoIdentity: "controller", submissionId: id });
      expect(result.ok).toBe(environment === "kitchen-b" || (environment === "kitchen-a" && f.sequence === 2));
      if (!result.ok) expect(result.code).toBe("diversity_quota_exceeded");
    }
    const coverage = await f.t.query(api.orders.diversityCoverage, { demoIdentity: "buyer", orderId: f.orderId });
    expect(coverage).toMatchObject({ acceptedCount: "2", tagsSource: "contributor_self_reported",
      environments: [{ label: "kitchen-a", count: "1" }, { label: "kitchen-b", count: "1" }], untaggedEnvironmentCount: "0" });
    expect(coverage.contributors).toMatchObject([{ contributorKey: expect.stringMatching(/^[a-f0-9]{64}$/), count: "2" }]);
    expect(JSON.stringify(coverage)).not.toContain(CONTRIBUTOR);
  });

  it("reserves slots for each required variant because a full but homogeneous order misses the buyer's target", async () => {
    const f = await setup();
    await f.t.run(ctx => ctx.db.patch(f.orderId, { quantityRequested: 2n, budgetAtomic: 20_000_000n,
      diversity: { requiredVariants: ["left-hand", "low-light"] } }));
    const accept = async (variant?: string) => {
      const submissionId = await submission(f, { variant });
      return f.t.mutation(api.finance.acceptAndPublish, { demoIdentity: "controller", submissionId });
    };
    expect(await accept("left-hand")).toMatchObject({ ok: true });
    expect(await accept("left-hand")).toEqual({ ok: false, code: "diversity_quota_exceeded" });
    expect(await accept()).toEqual({ ok: false, code: "diversity_quota_exceeded" });
    const partial = await f.t.query(api.orders.diversityCoverage, { demoIdentity: "controller", orderId: f.orderId });
    expect(partial.missingVariants).toEqual(["low-light"]);
    expect(await accept("low-light")).toMatchObject({ ok: true });
    const complete = await f.t.query(api.orders.diversityCoverage, { demoIdentity: "buyer", orderId: f.orderId });
    expect(complete.missingVariants).toEqual([]);
    expect(complete.acceptedCount).toBe("2");
    expect((await snapshot(f)).order?.status).toBe("fulfilled");
  });

  it("serializes racing accepts so two distinct clips cannot consume the same diversity allowance", async () => {
    const f = await setup();
    await f.t.run(ctx => ctx.db.patch(f.orderId, { diversity: { maxPerContributor: 1 } }));
    const ids = [await submission(f), await submission(f)];
    const results = await Promise.all(ids.map(submissionId => f.t.mutation(api.finance.acceptAndPublish, { demoIdentity: "controller", submissionId })));
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.filter(result => !result.ok)).toEqual([{ ok: false, code: "diversity_quota_exceeded" }]);
    expect((await snapshot(f)).payables).toHaveLength(1);
  });

  it("seeds one unfunded order and identities idempotently without claiming a real payment", async () => {
    const fixture = await setup(false);
    const replay = await fixture.t.mutation(internal.seed.demo, {});
    expect(replay.orderId).toBe(fixture.orderId);
    expect(replay.taskVersionId).toBe(fixture.taskVersionId);
    expect(replay.demoIdentities).toEqual(["buyer", "contributor", "controller", "finance-agent"]);
    const state = await snapshot(fixture);
    expect(state.order).toMatchObject({ status: "awaiting_funding", quantityRequested: 10n,
      pricePerSampleAtomic: 10_000_000n, contributorRateAtomic: 7_500_000n, budgetAtomic: 100_000_000n, acceptedCount: 0n });
    expect(state.entries).toHaveLength(0);
    expect(state.observations).toHaveLength(0);
    const members = await fixture.t.run((ctx) => ctx.db.query("memberships").collect());
    expect(members).toHaveLength(4);
    expect(new Set(members.map((member) => member.tokenIdentifier)).size).toBe(4);
  });

  it("publishes one licensed sample and accrues exactly 7.50 USDC without moving cash", async () => {
    const fixture = await acceptedFixture();
    const state = await snapshot(fixture);
    expect(state.order?.acceptedCount).toBe(1n);
    expect(state.payables).toHaveLength(1);
    expect(state.payables[0]).toMatchObject({ _id: fixture.accepted.payableId, amountAtomic: 7_500_000n,
      status: "accrued", recipientAddress: RECIPIENT, network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS });
    expect(state.deliveries).toHaveLength(1);
    expect(state.deliveries[0]).toMatchObject({ _id: fixture.accepted.deliveryId, submissionId: fixture.submissionId,
      manifest: { schemaVersion: "1.0", taskVersionId: fixture.taskVersionId, licenseVersion: "demo-consent-v1" } });
    expect(state.entries).toHaveLength(2);
    expect(state.entries.some((entry) => entry._id === fixture.accepted.journalEntryId && entry.kind === "fulfillment")).toBe(true);
    expect(balance(state, "asset:usdc", "debit")).toBe(100_000_000n);
    expect(balance(state, "liability:customer_prepayments", "credit")).toBe(90_000_000n);
    expect(balance(state, "revenue:dataset_sales", "credit")).toBe(10_000_000n);
    expect(balance(state, "expense:contributor_acquisition", "debit")).toBe(7_500_000n);
    expect(balance(state, "liability:contributor_payables", "credit")).toBe(7_500_000n);
    expect(state.commands).toHaveLength(0);
    expect(state.observations).toHaveLength(0);
    expectBalanced(state);
  });

  it("replays acceptance without another delivery, payable, or journal", async () => {
    const fixture = await acceptedFixture();
    const replay = await fixture.t.mutation(api.finance.acceptAndPublish, { demoIdentity: "controller", submissionId: fixture.submissionId });
    expect(replay).toEqual({ ...fixture.accepted, replayed: true });
    const state = await snapshot(fixture);
    expect(state.order?.acceptedCount).toBe(1n);
    expect(state.payables).toHaveLength(1);
    expect(state.deliveries).toHaveLength(1);
    expect(state.entries).toHaveLength(2);
    expectBalanced(state);
  });

  it.each(["requested", "revoked"] as const)("blocks first acceptance when consent is %s because delivery requires continuing permission", async revocationStatus => {
    const fixture = await setup(), submissionId = await submission(fixture);
    await fixture.t.run(async ctx => {
      const sample = (await ctx.db.get(submissionId))!;
      await ctx.db.patch(sample.consentRecordId!, { revocationStatus, revocationRequestedAt: Date.now() });
    });
    const before = await snapshot(fixture);
    expect(await fixture.t.mutation(api.finance.acceptAndPublish, { demoIdentity: "controller", submissionId }))
      .toEqual({ ok: false, code: "consent_revocation_pending_or_revoked" });
    const after = await snapshot(fixture);
    expect(after.entries, "A consent exception cannot create revenue or a new contributor obligation").toEqual(before.entries);
    expect(after.lines).toEqual(before.lines);
    expect(after.payables).toEqual([]);
    expect(after.deliveries).toEqual([]);
    expect(after.order?.acceptedCount).toBe(0n);
    expect(after.audits.find(event => event.entityId === submissionId && event.action === "acceptance_refused"))
      .toMatchObject({ reason: "consent_revocation_pending_or_revoked" });
  });

  it("preserves the original earned obligation when acceptance is replayed after a withdrawal request", async () => {
    const fixture = await acceptedFixture(), before = await snapshot(fixture);
    await fixture.t.run(async ctx => {
      const sample = (await ctx.db.get(fixture.submissionId))!;
      await ctx.db.patch(sample.consentRecordId!, { revocationStatus: "requested", revocationRequestedAt: Date.now() });
    });
    expect(await fixture.t.mutation(api.finance.acceptAndPublish, { demoIdentity: "controller", submissionId: fixture.submissionId }))
      .toEqual({ ...fixture.accepted, replayed: true });
    const after = await snapshot(fixture);
    expect(after.payables, "Withdrawal concerns future use; it cannot erase compensation already earned").toEqual(before.payables);
    expect(after.entries).toEqual(before.entries);
    expect(after.lines).toEqual(before.lines);
    expect(after.deliveries).toEqual(before.deliveries);
  });

  it.each(["sha256", "perceptual"] as const)("blocks a distinct submission with the same %s identity and persists matching evidence", async (kind) => {
    const fixture = await setup();
    const originalId = await submission(fixture, { sourceHash: "a".repeat(64), perceptualHash: "perceptual-original" });
    const original = await fixture.t.mutation(api.finance.acceptAndPublish, { demoIdentity: "controller", submissionId: originalId });
    expect(original.ok).toBe(true);
    const copyId = await submission(fixture, {
      sourceHash: kind === "sha256" ? "a".repeat(64) : "b".repeat(64),
      perceptualHash: kind === "perceptual" ? "perceptual-original" : "perceptual-different",
    });
    const refusal = await fixture.t.mutation(api.finance.acceptAndPublish, { demoIdentity: "controller", submissionId: copyId });
    expect(refusal).toMatchObject({ ok: false, code: "duplicate_submission", matchingSubmissionId: originalId });
    const state = await snapshot(fixture);
    expect(state.payables).toHaveLength(1);
    expect(state.deliveries).toHaveLength(1);
    expect(state.entries).toHaveLength(2);
    expect(state.order?.acceptedCount).toBe(1n);
    const audit = state.audits.find((event) => event.entityId === copyId && event.action === "acceptance_refused");
    expect(audit).toMatchObject({ reason: "duplicate_submission", actor: { identity: CONTROLLER } });
    expect(audit?.evidenceReferences).toContain(originalId);
    expect((await fixture.t.run((ctx) => ctx.db.get(copyId)))?.status).toBe("needs_review");
  });

  it("creates only one financial obligation when two copies are accepted concurrently", async () => {
    const fixture = await setup();
    const firstId = await submission(fixture, { sourceHash: "a".repeat(64) });
    const secondId = await submission(fixture, { sourceHash: "a".repeat(64) });
    // Exercise transactional policy in convex-test; this is not a claim about a
    // deployed database's load behavior or a real copy-detection model.
    const results = await Promise.all([firstId, secondId].map((submissionId) =>
      fixture.t.mutation(api.finance.acceptAndPublish, { demoIdentity: "controller", submissionId })));
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok && result.code === "duplicate_submission")).toHaveLength(1);
    const state = await snapshot(fixture);
    expect(state.order?.acceptedCount).toBe(1n);
    expect(state.payables).toHaveLength(1);
    expect(state.deliveries).toHaveLength(1);
    expect(state.entries).toHaveLength(2);
    expect(balance(state, "liability:contributor_payables", "credit")).toBe(7_500_000n);
    expectBalanced(state);
  });

  it("refuses an unfunded order and leaves accounting untouched", async () => {
    const fixture = await setup(false);
    const submissionId = await submission(fixture);
    const refusal = await fixture.t.mutation(api.finance.acceptAndPublish, { demoIdentity: "controller", submissionId });
    expect(refusal).toMatchObject({ ok: false, code: "order_not_funded_or_open" });
    const state = await snapshot(fixture);
    expect(state.order?.acceptedCount).toBe(0n);
    expect(state.entries).toHaveLength(0);
    expect(state.payables).toHaveLength(0);
    expect(state.deliveries).toHaveLength(0);
  });

  it("does not treat an unavailable scaffold analysis as acceptance evidence", async () => {
    const fixture = await setup();
    const submissionId = await submission(fixture, { unavailableAnalysis: true });
    const refusal = await fixture.t.mutation(api.finance.acceptAndPublish, { demoIdentity: "controller", submissionId });
    expect(refusal).toMatchObject({ ok: false, code: "acceptance_evidence_required" });
    const state = await snapshot(fixture);
    expect(state.order?.acceptedCount).toBe(0n);
    expect(state.entries).toHaveLength(1);
    expect(state.payables).toHaveLength(0);
  });

  it("honors a recorded active human controller decision bound to an unavailable analysis's evidence", async () => {
    const fixture = await setup();
    const submissionId = await submission(fixture, { unavailableAnalysis: true });
    const decisionId = await recordHumanDecision(fixture, submissionId);
    const accepted = await fixture.t.mutation(api.finance.acceptAndPublish, { demoIdentity: "controller", submissionId });
    expect(accepted.ok).toBe(true);
    const state = await snapshot(fixture);
    expect(state.payables).toHaveLength(1);
    expect(state.payables[0]).toMatchObject({ decisionId, amountAtomic: 7_500_000n });
    expect(state.deliveries[0]).toMatchObject({ decisionId, manifest: { decisionId } });
    expect(state.order?.acceptedCount).toBe(1n);
    const decisions = await fixture.t.run((ctx) => ctx.db.query("reviewDecisions")
      .withIndex("by_submission", (q) => q.eq("submissionId", submissionId)).collect());
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.evidenceHash).toBe("c".repeat(64));
    expectBalanced(state);
  });

  it("refuses a recorded human decision whose evidence hash does not bind the current report", async () => {
    const fixture = await setup();
    const submissionId = await submission(fixture, { unavailableAnalysis: true });
    await recordHumanDecision(fixture, submissionId, CONTROLLER, "b".repeat(64));
    const refused = await fixture.t.mutation(api.finance.acceptAndPublish, { demoIdentity: "controller", submissionId });
    expect(refused).toMatchObject({ ok: false, code: "acceptance_evidence_required" });
    const state = await snapshot(fixture);
    expect(state.payables).toHaveLength(0);
    expect(state.deliveries).toHaveLength(0);
    expect(state.entries).toHaveLength(1);
  });

  it.each(["wrong-role", "inactive", "finance-agent"] as const)("does not accept a recorded %s reviewer as human approval", async (kind) => {
    const fixture = await setup();
    const submissionId = await submission(fixture, { unavailableAnalysis: true });
    let reviewerTokenIdentifier = "demo:skarl:contributor";
    if (kind === "inactive") {
      reviewerTokenIdentifier = "demo:skarl:inactive-reviewer";
      await fixture.t.run((ctx) => ctx.db.insert("memberships", {
        organizationId: fixture.organizationId, issuer: "demo:skarl", subject: "inactive-reviewer",
        tokenIdentifier: reviewerTokenIdentifier, roles: ["controller"],
        grantedByTokenIdentifier: CONTROLLER, status: "revoked",
      }));
    } else if (kind === "finance-agent") {
      reviewerTokenIdentifier = AGENT;
      // Even a misprovisioned record that drops the finance-agent role must not
      // turn the known machine identity into the independent human reviewer.
      await fixture.t.run(async (ctx) => {
        const agent = await ctx.db.query("memberships").withIndex("by_token_identifier", (q) => q.eq("tokenIdentifier", AGENT)).unique();
        if (!agent) throw new Error("missing fixture agent");
        await ctx.db.patch(agent._id, { roles: ["controller"] });
      });
    }
    await recordHumanDecision(fixture, submissionId, reviewerTokenIdentifier);
    const refused = await fixture.t.mutation(api.finance.acceptAndPublish, { demoIdentity: "controller", submissionId });
    expect(refused).toMatchObject({ ok: false, code: "acceptance_evidence_required" });
    const state = await snapshot(fixture);
    expect(state.order?.acceptedCount).toBe(0n);
    expect(state.payables).toHaveLength(0);
    expect(state.deliveries).toHaveLength(0);
    expect(state.entries).toHaveLength(1);
  });

  it("requires a verified contributor wallet before accepting otherwise supported work", async () => {
    const fixture = await setup();
    const submissionId = await submission(fixture);
    await fixture.t.run(async (ctx) => {
      const member = await ctx.db.query("memberships").withIndex("by_token_identifier", (q) => q.eq("tokenIdentifier", CONTRIBUTOR)).unique();
      if (!member) throw new Error("missing fixture contributor");
      await ctx.db.patch(member._id, { walletVerification: undefined });
    });
    const refused = await fixture.t.mutation(api.finance.acceptAndPublish, { demoIdentity: "controller", submissionId });
    expect(refused).toMatchObject({ ok: false, code: "verified_contributor_wallet_required" });
    const state = await snapshot(fixture);
    expect(state.payables).toHaveLength(0);
    expect(state.deliveries).toHaveLength(0);
    expect(state.entries).toHaveLength(1);
    expect(state.audits.some((event) => event.entityId === submissionId
      && event.reason === "verified_contributor_wallet_required")).toBe(true);
  });

  it("rolls back acceptance when a funded status has no funding ledger behind it", async () => {
    const fixture = await setup(false);
    await fixture.t.run((ctx) => ctx.db.patch(fixture.orderId, { status: "funded" }));
    const submissionId = await submission(fixture);
    await expect(fixture.t.mutation(api.finance.acceptAndPublish, { demoIdentity: "controller", submissionId }))
      .rejects.toThrow(/Insufficient order balance/);
    const state = await snapshot(fixture);
    expect(state.order?.acceptedCount).toBe(0n);
    expect(state.payables).toHaveLength(0);
    expect(state.deliveries).toHaveLength(0);
    expect(state.entries).toHaveLength(0);
    expect(state.lines).toHaveLength(0);
    expect(state.outbox).toHaveLength(0);
    expect(state.audits.some((event) => event.entityId === submissionId
      && event.action === "submission_accepted_and_published")).toBe(false);
    const decisions = await fixture.t.run((ctx) => ctx.db.query("reviewDecisions")
      .withIndex("by_submission", (q) => q.eq("submissionId", submissionId)).collect());
    expect(decisions).toHaveLength(0);
    expect((await fixture.t.run((ctx) => ctx.db.get(submissionId)))?.status).toBe("needs_review");
  });

  it("refuses an exhausted quota even if a stale order status still says collecting", async () => {
    const fixture = await setup();
    // Explicit inconsistent-state injection: a stale status must not admit unit 11.
    await fixture.t.run((ctx) => ctx.db.patch(fixture.orderId, { acceptedCount: 10n, status: "collecting" }));
    const submissionId = await submission(fixture);
    const refusal = await fixture.t.mutation(api.finance.acceptAndPublish, { demoIdentity: "controller", submissionId });
    expect(refusal).toMatchObject({ ok: false, code: "quota_exhausted" });
    const state = await snapshot(fixture);
    expect(state.order?.acceptedCount).toBe(10n);
    expect(state.payables).toHaveLength(0);
    expect(state.entries).toHaveLength(1);
  });

  it("derives one immutable payout proposal from the stored payable and replays it", async () => {
    const fixture = await acceptedFixture();
    const proposed = await fixture.t.mutation(api.finance.proposePayment, { demoIdentity: "finance-agent", payableId: fixture.accepted.payableId });
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) throw new Error(proposed.code);
    const replay = await fixture.t.mutation(api.finance.proposePayment, { demoIdentity: "finance-agent", payableId: fixture.accepted.payableId });
    expect(replay).toEqual({ ...proposed, replayed: true });
    const state = await snapshot(fixture);
    expect(state.intents).toHaveLength(1);
    expect(state.commands).toHaveLength(1);
    expect(state.commands[0]).toMatchObject({ _id: proposed.paymentCommandId, amountAtomic: 7_500_000n,
      recipientAddress: RECIPIENT, network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS,
      requesterTokenIdentifier: AGENT, status: "proposed", attemptCount: 0 });
    expect(state.approvals).toHaveLength(0);
    expect(state.attempts).toHaveLength(0);
  });

  it("persists refusal of the agent's own approval, then permits one independent controller approval", async () => {
    const fixture = await acceptedFixture();
    const proposed = await fixture.t.mutation(api.finance.proposePayment, { demoIdentity: "finance-agent", payableId: fixture.accepted.payableId });
    if (!proposed.ok) throw new Error(proposed.code);
    const refused = await fixture.t.mutation(api.finance.approve, { demoIdentity: "finance-agent", intentId: proposed.intentId });
    expect(refused).toMatchObject({ ok: false, code: "self_approval_refused" });
    let state = await snapshot(fixture);
    expect(state.approvals).toHaveLength(0);
    expect(state.commands[0]?.status).toBe("proposed");
    expect(state.audits.some((event) => event.action === "payment_approval_refused" && event.reason === "self_approval_refused"
      && event.actor.identity === AGENT)).toBe(true);

    const approved = await fixture.t.mutation(api.finance.approve, { demoIdentity: "controller", intentId: proposed.intentId });
    expect(approved.ok).toBe(true);
    if (!approved.ok) throw new Error(approved.code);
    await runScheduledUntil(async () => {
      const dispatch = await fixture.t.run(ctx => ctx.db.query("outboxEvents").withIndex("by_event_key", q =>
        q.eq("organizationId", fixture.organizationId).eq("eventKey", `dispatch:${proposed.paymentCommandId}`)).unique());
      return dispatch?.status === "pending";
    });
    const replay = await fixture.t.mutation(api.finance.approve, { demoIdentity: "controller", intentId: proposed.intentId });
    expect(replay).toEqual({ ...approved, replayed: true });
    state = await snapshot(fixture);
    expect(state.approvals).toHaveLength(1);
    expect(state.approvals[0]).toMatchObject({ _id: approved.approvalId, approverTokenIdentifier: CONTROLLER,
      requestedBy: { identity: AGENT }, bindingHash: state.commands[0]?.bindingHash, status: "approved" });
    expect(state.commands[0]).toMatchObject({ status: "approved", approvalId: approved.approvalId });
    expect(state.intents[0]?.status).toBe("approved");
    expect(state.payables[0]?.status).toBe("payout_in_progress");
    expect(state.outbox.filter((event) => event.kind === "dispatch_settlement")).toHaveLength(1);
    // Approval is not a payment receipt: no payout journal, attempt, or chain fact is invented.
    expect(state.entries).toHaveLength(2);
    expect(state.attempts).toHaveLength(0);
    expect(state.observations).toHaveLength(0);
    expect(balance(state, "asset:usdc", "debit")).toBe(100_000_000n);
    expectBalanced(state);
  });

  it.each(["buyer", "controller"])("refuses %s approving their own proposal and keeps its audit", async demoIdentity => {
    const fixture = await acceptedFixture();
    const proposed = await fixture.t.mutation(api.finance.proposePayment, { demoIdentity, payableId: fixture.accepted.payableId });
    if (!proposed.ok) throw new Error(proposed.code);
    const refusal = await fixture.t.mutation(api.finance.approve, { demoIdentity, intentId: proposed.intentId });
    expect(refusal).toMatchObject({ ok: false, code: "self_approval_refused" });
    const state = await snapshot(fixture);
    expect(state.approvals).toHaveLength(0);
    expect(state.commands[0]?.status).toBe("proposed");
    expect(state.audits.some((event) => event.action === "payment_approval_refused" && event.reason === "self_approval_refused"
      && event.actor.identity === `demo:skarl:${demoIdentity}`)).toBe(true);
  });

  it("never lets the finance agent approve even if its membership is misprovisioned as controller", async () => {
    const fixture = await acceptedFixture();
    const proposed = await fixture.t.mutation(api.finance.proposePayment, { demoIdentity: "controller", payableId: fixture.accepted.payableId });
    if (!proposed.ok) throw new Error(proposed.code);
    await fixture.t.run(async (ctx) => {
      const agent = await ctx.db.query("memberships").withIndex("by_token_identifier", (q) => q.eq("tokenIdentifier", AGENT)).unique();
      if (!agent) throw new Error("missing fixture agent");
      await ctx.db.patch(agent._id, { roles: ["finance-agent", "controller"] });
    });
    const refusal = await fixture.t.mutation(api.finance.approve, { demoIdentity: "finance-agent", intentId: proposed.intentId });
    expect(refusal).toMatchObject({ ok: false, code: "agent_approval_refused" });
    const state = await snapshot(fixture);
    expect(state.approvals).toHaveLength(0);
    expect(state.commands[0]?.status).toBe("proposed");
    expect(state.audits.some((event) => event.action === "payment_approval_refused" && event.reason === "agent_approval_refused"
      && event.actor.identity === AGENT)).toBe(true);
  });

  it("refuses approval after the payable recipient changes", async () => {
    const fixture = await acceptedFixture();
    const proposed = await fixture.t.mutation(api.finance.proposePayment, { demoIdentity: "finance-agent", payableId: fixture.accepted.payableId });
    if (!proposed.ok) throw new Error(proposed.code);
    await fixture.t.run((ctx) => ctx.db.patch(fixture.accepted.payableId, { recipientAddress: "0x2222222222222222222222222222222222222222" }));
    const refusal = await fixture.t.mutation(api.finance.approve, { demoIdentity: "controller", intentId: proposed.intentId });
    expect(refusal).toMatchObject({ ok: false, code: "proposal_binding_changed" });
    const state = await snapshot(fixture);
    expect(state.approvals).toHaveLength(0);
    expect(state.commands[0]).toMatchObject({ status: "proposed", recipientAddress: RECIPIENT });
  });

  it("refuses an expired payout proposal and commits the refusal audit", async () => {
    const fixture = await acceptedFixture();
    const proposed = await fixture.t.mutation(api.finance.proposePayment, { demoIdentity: "finance-agent", payableId: fixture.accepted.payableId });
    if (!proposed.ok) throw new Error(proposed.code);
    await fixture.t.run((ctx) => ctx.db.patch(proposed.intentId, { expiresAt: Date.now() - 1 }));
    const refused = await fixture.t.mutation(api.finance.approve, { demoIdentity: "controller", intentId: proposed.intentId });
    expect(refused).toMatchObject({ ok: false, code: "proposal_expired" });
    const state = await snapshot(fixture);
    expect(state.approvals).toHaveLength(0);
    expect(state.commands[0]?.status).toBe("proposed");
    expect(state.outbox.filter((event) => event.kind === "dispatch_settlement")).toHaveLength(0);
    expect(state.audits.some((event) => event.entityId === proposed.intentId && event.action === "payment_approval_refused"
      && event.reason === "proposal_expired" && event.actor.identity === CONTROLLER)).toBe(true);
  });

  it("does not replay an old successful approval after its payment command is cancelled", async () => {
    const fixture = await acceptedFixture();
    const proposed = await fixture.t.mutation(api.finance.proposePayment, { demoIdentity: "finance-agent", payableId: fixture.accepted.payableId });
    if (!proposed.ok) throw new Error(proposed.code);
    const approved = await fixture.t.mutation(api.finance.approve, { demoIdentity: "controller", intentId: proposed.intentId });
    if (!approved.ok) throw new Error(approved.code);
    await runScheduledUntil(async () => {
      const dispatch = await fixture.t.run(ctx => ctx.db.query("outboxEvents").withIndex("by_event_key", q =>
        q.eq("organizationId", fixture.organizationId).eq("eventKey", `dispatch:${proposed.paymentCommandId}`)).unique());
      return dispatch?.status === "pending";
    });
    await fixture.t.run((ctx) => ctx.db.patch(proposed.paymentCommandId, { status: "cancelled" }));
    const refused = await fixture.t.mutation(api.finance.approve, { demoIdentity: "controller", intentId: proposed.intentId });
    expect(refused).toMatchObject({ ok: false, code: "approval_invalidated" });
    const state = await snapshot(fixture);
    expect(state.approvals).toHaveLength(1);
    expect(state.approvals[0]?._id).toBe(approved.approvalId);
    expect(state.commands[0]).toMatchObject({ status: "cancelled", approvalId: approved.approvalId });
    expect(state.outbox.filter((event) => event.kind === "dispatch_settlement")).toHaveLength(1);
    expect(state.attempts).toHaveLength(0);
    expect(state.observations).toHaveLength(0);
    expect(state.audits.some((event) => event.entityId === proposed.intentId
      && event.reason === "approval_invalidated")).toBe(true);
  });

  it("checks persisted roles rather than allowing a contributor to accept or propose payouts", async () => {
    const fixture = await setup();
    const submissionId = await submission(fixture);
    const refused = await fixture.t.mutation(api.finance.acceptAndPublish, { demoIdentity: "contributor", submissionId });
    expect(refused).toMatchObject({ ok: false, code: "forbidden" });
    const accepted = await fixture.t.mutation(api.finance.acceptAndPublish, { demoIdentity: "controller", submissionId });
    if (!accepted.ok) throw new Error(accepted.code);
    const proposal = await fixture.t.mutation(api.finance.proposePayment, { demoIdentity: "contributor", payableId: accepted.payableId });
    expect(proposal).toMatchObject({ ok: false, code: "forbidden" });
    const state = await snapshot(fixture);
    expect(state.payables).toHaveLength(1);
    expect(state.commands).toHaveLength(0);
    await expect(fixture.t.query(api.dashboard.journal, { demoIdentity: "contributor", orderId: fixture.orderId })).rejects.toThrow("forbidden");
    await expect(fixture.t.query(api.dashboard.auditEvents, { demoIdentity: "contributor", orderId: fixture.orderId })).rejects.toThrow("forbidden");
  });

  it("hides cross-tenant resources and does not write a refusal into another organization's audit", async () => {
    const fixture = await acceptedFixture();
    const foreignId = await fixture.t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", { name: "Other synthetic tenant", status: "active",
        createdByTokenIdentifier: "demo:other:controller" });
      await ctx.db.patch(fixture.submissionId, { organizationId });
      await ctx.db.patch(fixture.accepted.payableId, { organizationId });
      return organizationId;
    });
    const acceptance = await fixture.t.mutation(api.finance.acceptAndPublish, { demoIdentity: "controller", submissionId: fixture.submissionId });
    const proposal = await fixture.t.mutation(api.finance.proposePayment, { demoIdentity: "finance-agent", payableId: fixture.accepted.payableId });
    expect(acceptance).toMatchObject({ ok: false, code: "not_found" });
    expect(proposal).toMatchObject({ ok: false, code: "not_found" });
    const foreignAudits = await fixture.t.run((ctx) => ctx.db.query("auditEvents")
      .withIndex("by_org_time", (q) => q.eq("organizationId", foreignId)).collect());
    expect(foreignAudits).toHaveLength(0);
    const state = await snapshot(fixture);
    expect(state.commands).toHaveLength(0);
    expect(state.entries).toHaveLength(2);
  });

  it("serves exact financial projections and lets the owning buyer review pending exceptions", async () => {
    const fixture = await acceptedFixture();
    await submission(fixture); // Review exposes pending work; licensed delivery APIs still gate dataset access.
    const args = { demoIdentity: "controller", orderId: fixture.orderId };
    const summary = await fixture.t.query(api.dashboard.orderSummary, args);
    expect(summary.order).toMatchObject({ acceptedCount: "1", quantityRequested: "10", budgetAtomic: "100000000" });
    expect(summary.balances).toMatchObject({
      "asset:usdc": "100000000", "liability:customer_prepayments": "90000000",
      "revenue:dataset_sales": "10000000", "liability:contributor_payables": "7500000",
    });
    const results = await Promise.all([
      fixture.t.query(api.dashboard.submissions, args), fixture.t.query(api.dashboard.payables, args),
      fixture.t.query(api.dashboard.journal, args), fixture.t.query(api.dashboard.auditEvents, args),
    ]);
    for (const result of [summary, ...results]) expect(() => JSON.stringify(result)).not.toThrow();
    const buyerClips = await fixture.t.query(api.dashboard.submissions, { demoIdentity: "buyer", orderId: fixture.orderId });
    expect(buyerClips).toHaveLength(2);
    expect(buyerClips.some(row => row._id === fixture.submissionId)).toBe(true);
    const buyerPayables = await fixture.t.query(api.dashboard.payables, { demoIdentity: "buyer", orderId: fixture.orderId });
    expect(buyerPayables).toHaveLength(1);
  });
});
