import { seedWithTaskSpecs } from "./fixtures/seedWithTaskSpecs";
import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import type { Id } from "./_generated/dataModel";
import { rubricPlan, validatePlan, type PlanInput } from "./lib/recordingPlan";
import schema from "./schema";

// A contributor agent must be able to go from zero to "ready to get paid" over MCP alone,
// and must never see a task it cannot be paid for. Local signatures only; no chain transaction.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const identities = ["buyer", "contributor"] as const;
type Identity = typeof identities[number];
const keys = { buyer: "synthetic-kit-buyer-credential-for-local-tests", contributor: "synthetic-kit-contributor-credential-for-local-tests" };
const hash = async (key: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
beforeEach(async () => {
  vi.stubEnv("SKARL_MCP_KEYS", JSON.stringify(Object.fromEntries(await Promise.all(identities.map(async identity => [await hash(keys[identity]), { identity, label: `Synthetic ${identity}` }])))));
});
afterEach(() => vi.unstubAllEnvs());

async function setup() {
  const t = convexTest(schema, modules);
  workflowTest.register(t);
  const seeded = await seedWithTaskSpecs(t);
  return { t, orderId: seeded.defaultOrderId as Id<"orders"> };
}
type Test = Awaited<ReturnType<typeof setup>>["t"];
async function call(t: Test, name: string, args: unknown = {}, identity: Identity = "contributor") {
  const response = await t.fetch("/mcp", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-11-25", Authorization: `Bearer ${keys[identity]}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  const body = await response.json();
  return { isError: !!body.result?.isError, error: body.error, data: body.result ? JSON.parse(body.result.content[0].text).data : null };
}
const openOrder = (t: Test, orderId: Id<"orders">, status: "collecting" | "fulfilled" = "collecting") =>
  t.run(ctx => ctx.db.patch(orderId, { status, deadlineAt: Date.now() + 86_400_000 }));

describe("contributor agent kit over MCP", () => {
  it("onboards from zero to ready-to-get-paid: tax attestation and a signature-verified payout wallet", async () => {
    const { t } = await setup();
    const start = await call(t, "skarl_contributor_onboard");
    expect(start.data.steps).toHaveLength(7);
    expect(start.data.readyToGetPaid).toBe(false);
    expect(start.data.skill).toMatch(/\/contributor-skill\.md$/);

    expect((await call(t, "skarl_tax_profile", { country: "us", taxForm: "w9_on_file" })).data).toMatchObject({ ok: true });
    const account = privateKeyToAccount(`0x${"3".repeat(64)}`);
    const issued = (await call(t, "skarl_earnings_wallet_challenge", { walletAddress: account.address })).data;
    const forged = await privateKeyToAccount(`0x${"4".repeat(64)}`).signMessage({ message: issued.message });
    expect((await call(t, "skarl_earnings_wallet_verify", { nonce: issued.nonce, signature: forged })).data).toMatchObject({ ok: false, code: "invalid_wallet_signature" });
    const signature = await account.signMessage({ message: issued.message });
    expect((await call(t, "skarl_earnings_wallet_verify", { nonce: issued.nonce, signature })).data).toMatchObject({ verified: true, walletAddress: account.address.toLowerCase() });

    const done = await call(t, "skarl_contributor_onboard");
    expect(done.data.readyToGetPaid).toBe(true);
    expect(done.data.checks.map((check: { ok: boolean }) => check.ok)).toEqual([true, true]);
  });

  it("lists only open, payable tasks with the contributor rate, never the buyer's price or balances", async () => {
    const { t, orderId } = await setup();
    await openOrder(t, orderId);
    const order = await t.run(ctx => ctx.db.get(orderId));
    const found = (await call(t, "skarl_find_tasks")).data;
    const task = found.tasks.find((item: { orderId: string }) => item.orderId === orderId);
    expect(task).toMatchObject({ payPerClipAtomic: order!.contributorRateAtomic.toString(), open: true });
    expect(task.criteria.length).toBeGreaterThan(0);
    expect(JSON.stringify(found)).not.toContain("pricePerSampleAtomic");
    expect(JSON.stringify(found)).not.toContain("balances");

    await openOrder(t, orderId, "fulfilled");
    expect((await call(t, "skarl_find_tasks")).data.tasks.some((item: { orderId: string }) => item.orderId === orderId)).toBe(false);
  });

  it("keeps contributor tools behind the contributor key", async () => {
    const { t } = await setup();
    const asBuyer = await call(t, "skarl_find_tasks", {}, "buyer");
    expect(asBuyer.isError || !!asBuyer.error).toBe(true);
  });

  it("refuses a recording plan for a task that cannot pay", async () => {
    const { t, orderId } = await setup();
    await openOrder(t, orderId, "fulfilled");
    expect((await call(t, "skarl_recording_plan", { orderId })).data).toMatchObject({ ok: false, code: "task_not_open" });
  });
});

describe("recording plan validation", () => {
  const input: PlanInput = { title: "Cup to bowl", prompt: "Move the cup into the bowl.", maxClipSeconds: 30,
    criteria: [{ criterionId: "grasp", description: "Grasp the cup", modality: "visual" }, { criterionId: "place", description: "Place it in the bowl", modality: "visual" }],
    taskSpec: { object: "red_cup", distractors: ["spoon"], target: "bowl", steps: ["Grasp the red cup", "Place it in the bowl"] } };
  const plan = (shots: { instruction: string; criterionIds: string[] }[]) => JSON.stringify({ setup: ["Frame the cup"], narration: ["Grasping"], rejectionRisks: [],
    shots: shots.map((shot, index) => ({ order: index + 1, ...shot })) });

  it("accepts a plan that covers every criterion", () => {
    expect(validatePlan(plan([{ instruction: "Grasp", criterionIds: ["grasp"] }, { instruction: "Place", criterionIds: ["place"] }]), input)?.source).toBe("claude");
  });
  it("rejects a plan that skips a criterion, because the verifier would reject that recording", () => {
    expect(validatePlan(plan([{ instruction: "Grasp", criterionIds: ["grasp"] }]), input)).toBeNull();
  });
  it("rejects invented criteria and non-JSON output", () => {
    expect(validatePlan(plan([{ instruction: "Wave", criterionIds: ["grasp", "place", "wave"] }]), input)).toBeNull();
    expect(validatePlan("not json", input)).toBeNull();
  });
  it("falls back to a rubric plan that still covers every criterion and the clip limit", () => {
    const fallback = rubricPlan(input);
    expect(new Set(fallback.shots.flatMap(shot => shot.criterionIds))).toEqual(new Set(["grasp", "place"]));
    expect(fallback.setup[0]).toContain("30 seconds");
    expect(fallback.source).toBe("rubric");
  });
});
