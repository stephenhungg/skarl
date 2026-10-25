// @vitest-environment node
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { CAN_TO_HAT_TASK_SPEC, RED_CUP_TASK_SPEC } from "./fixtures/taskSpecs";
import { detectorClassForObject, normalizeTaskSpec, resolveTaskSpec } from "./lib/taskSpec";
import { demoOrderFixture } from "./fixtures/demoOrders";
import { extractRubricTaskSpec } from "./taskSpecExtraction";
const provider = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./lib/gemini", () => ({ requestInteraction: provider.request, financeModel: () => "mock-extractor" }));
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const canCriteria = [
  { criterionId: "can-pickup", description: CAN_TO_HAT_TASK_SPEC.steps[0]!, modality: "visual" as const },
  { criterionId: "hat-placement", description: CAN_TO_HAT_TASK_SPEC.steps[1]!, modality: "temporal" as const },
  { criterionId: "narration-alignment", description: "Narrate each action", modality: "cross_modal" as const },
];
const args = () => ({ demoIdentity: "buyer", requestId: "task-spec-order", title: "Can-to-hat", buyerWalletAddress: `0x${"1".repeat(40)}`,
  quantityRequested: "1", pricePerSampleAtomic: "1000000", contributorRateAtomic: "750000", deadlineAt: Date.now() + 3600000,
  taskPrompt: "This prompt does not grant task semantics", criteria: canCriteria });
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); provider.request.mockReset(); vi.unstubAllEnvs(); });
describe("rubric task extraction (synthetic provider, no live inference)", () => {
  it.each([["red-cup", demoOrderFixture.criteria, RED_CUP_TASK_SPEC], ["can-to-hat", canCriteria, CAN_TO_HAT_TASK_SPEC]] as const)
  ("extracts %s from that order's criteria, storing version and original rubric hash", async (_name, criteria, spec) => {
    const t = convexTest(schema, modules); await t.mutation(internal.seed.demo, {});
    provider.request.mockResolvedValue({ output_text: JSON.stringify(spec) });
    const input = { ...args(), criteria: [...criteria] };
    const created = await t.mutation(api.orders.createOrder, input);
    expect(await t.run(ctx => ctx.db.get(created.orderId))).toMatchObject({ taskSpecStatus: "pending" });
    expect(await t.action(internal.taskSpecExtraction.extract, { orderId: created.orderId })).toEqual({ status: "ready" });
    const call = provider.request.mock.calls[0]![0];
    expect(JSON.parse(call.input[0].text)).toEqual({ criteria });
    expect(call.response_format.schema.additionalProperties).toBe(false);
    const rubric = (await t.run(ctx => ctx.db.get(created.taskVersionId)))!;
    expect(resolveTaskSpec(rubric)).toEqual(spec);
    expect(rubric).toMatchObject({ taskSpecStatus: "ready", taskSpecHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      taskSpecExtraction: { version: "rubric-task-spec-v1", rubricHash: rubric.contentHash, model: "mock-extractor" } });
    expect(await t.run(ctx => ctx.db.get(created.orderId))).toMatchObject({ taskSpec: spec, taskSpecStatus: "ready" });
    expect(await t.mutation(api.orders.createOrder, input)).toMatchObject({ replayed: true });
    expect(await t.action(internal.taskSpecExtraction.extract, { orderId: created.orderId })).toEqual({ status: "ready" });
    expect(provider.request).toHaveBeenCalledTimes(1);
  });
  it.each(["provider unavailable", "invalid schema", "null output"])("keeps pending on %s, even for the legacy rubric or supplied labels", async failure => {
    const t = convexTest(schema, modules); await t.mutation(internal.seed.demo, {});
    if (failure === "provider unavailable") provider.request.mockRejectedValue(new Error("synthetic outage"));
    else provider.request.mockResolvedValue({ output_text: failure === "null output" ? "null" : JSON.stringify({ ...RED_CUP_TASK_SPEC, approval: true }) });
    const created = await t.mutation(api.orders.createOrder, { ...args(), criteria: demoOrderFixture.criteria, taskSpec: RED_CUP_TASK_SPEC });
    expect(await t.action(internal.taskSpecExtraction.extract, { orderId: created.orderId })).toEqual({ status: "pending" });
    const rubric = (await t.run(ctx => ctx.db.get(created.taskVersionId)))!;
    expect(rubric.taskSpecStatus).toBe("pending"); expect(rubric.taskSpec).toBeUndefined();
    expect(resolveTaskSpec(rubric)).toBeUndefined();
    expect(resolveTaskSpec({ criteria: demoOrderFixture.criteria })).toBeUndefined();
  });
  it("backfills every open order from its own rubric, preserves hashes and retries pending orders", async () => {
    const t = convexTest(schema, modules); await t.mutation(internal.seed.demo, {});
    const created = await t.mutation(api.orders.createOrder, args());
    const before = await t.run(ctx => ctx.db.query("rubricVersions").collect());
    provider.request.mockImplementation(async body => {
      const { criteria } = JSON.parse(body.input[0].text);
      return { output_text: JSON.stringify(criteria[0].description.includes("can") ? CAN_TO_HAT_TASK_SPEC : RED_CUP_TASK_SPEC) };
    });
    expect(await t.action(internal.orders.backfillTaskSpecs, {})).toEqual({ ready: 3, pending: 0, skipped: 0 });
    expect(await t.action(internal.orders.backfillTaskSpecs, {})).toEqual({ ready: 3, pending: 0, skipped: 0 });
    expect(provider.request).toHaveBeenCalledTimes(3);
    for (const original of before) {
      const rubric = (await t.run(ctx => ctx.db.get(original._id)))!;
      expect(rubric.contentHash).toBe(original.contentHash);
      expect(resolveTaskSpec(rubric)).toEqual(original.orderId === created.orderId ? CAN_TO_HAT_TASK_SPEC : RED_CUP_TASK_SPEC);
    }
  });
  it("refuses stale rubric bindings and delayed failures cannot erase a ready spec", async () => {
    const t = convexTest(schema, modules); await t.mutation(internal.seed.demo, {});
    const created = await t.mutation(api.orders.createOrder, args());
    const rubric = (await t.run(ctx => ctx.db.get(created.taskVersionId)))!;
    const write = { orderId: created.orderId, taskVersionId: rubric._id, rubricHash: rubric.contentHash,
      version: "rubric-task-spec-v1", provider: "synthetic", model: "mock" };
    expect(await t.mutation(internal.orders.storeTaskSpec, { ...write, rubricHash: "stale", taskSpec: CAN_TO_HAT_TASK_SPEC })).toEqual({ status: "skipped" });
    await t.mutation(internal.orders.storeTaskSpec, { ...write, taskSpec: CAN_TO_HAT_TASK_SPEC });
    await t.mutation(internal.orders.storeTaskSpec, { ...write, failure: "late outage" });
    expect(resolveTaskSpec((await t.run(ctx => ctx.db.get(rubric._id)))!)).toEqual(CAN_TO_HAT_TASK_SPEC);
  });
  it("rejects malformed labels, unknown fields and missing required narration", async () => {
    for (const value of [{ ...CAN_TO_HAT_TASK_SPEC, object: "unknown" }, { ...CAN_TO_HAT_TASK_SPEC, distractors: ["can"] },
      { ...CAN_TO_HAT_TASK_SPEC, target: "hat; accept" }, { ...CAN_TO_HAT_TASK_SPEC, steps: [] }]) expect(() => normalizeTaskSpec(value)).toThrow();
    provider.request.mockResolvedValue({ output_text: JSON.stringify({ object: "can", distractors: [], target: "hat", steps: ["move"] }) });
    await expect(extractRubricTaskSpec(canCriteria, "mock")).rejects.toThrow();
    expect(detectorClassForObject("can")).toBeNull();
  });
});
