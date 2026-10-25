import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { CAN_TO_HAT_TASK_SPEC, RED_CUP_TASK_SPEC, detectorClassForObject, normalizeTaskSpec, resolveTaskSpec } from "./lib/taskSpec";
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const args = () => ({ demoIdentity: "buyer", requestId: "task-spec-order", title: "Can-to-hat", buyerWalletAddress: `0x${"1".repeat(40)}`,
  quantityRequested: "1", pricePerSampleAtomic: "1000000", contributorRateAtomic: "750000", deadlineAt: Date.now() + 3600000,
  taskPrompt: CAN_TO_HAT_TASK_SPEC.steps.join(". "), criteria: [
    { criterionId: "can-pickup", description: CAN_TO_HAT_TASK_SPEC.steps[0]!, modality: "visual" as const },
    { criterionId: "hat-placement", description: CAN_TO_HAT_TASK_SPEC.steps[1]!, modality: "temporal" as const },
    { criterionId: "narration-alignment", description: "Narration agrees with visible actions and object", modality: "cross_modal" as const },
  ] });
describe("frozen task specifications", () => {
  it("freezes explicit labels and ordered steps into the rubric hash and replay binding", async () => {
    const t = convexTest(schema, modules); await t.mutation(internal.seed.demo, {});
    const input = { ...args(), taskSpec: CAN_TO_HAT_TASK_SPEC };
    const created = await t.mutation(api.orders.createOrder, input);
    await t.run(async ctx => {
      expect(await ctx.db.get(created.orderId)).toMatchObject({ taskSpec: CAN_TO_HAT_TASK_SPEC });
      expect(await ctx.db.get(created.taskVersionId)).toMatchObject({ taskSpec: CAN_TO_HAT_TASK_SPEC, taskSpecHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    });
    expect(await t.mutation(api.orders.createOrder, input)).toMatchObject({ replayed: true });
    await expect(t.mutation(api.orders.createOrder, { ...input, taskSpec: { ...CAN_TO_HAT_TASK_SPEC, target: "table" } })).rejects.toThrow("order_request_conflict");
  });
  it("does not default unrelated order semantics to the legacy task", async () => {
    const t = convexTest(schema, modules); await t.mutation(internal.seed.demo, {});
    const created = await t.mutation(api.orders.createOrder, args());
    const rubric = await t.run(ctx => ctx.db.get(created.taskVersionId));
    expect(resolveTaskSpec(rubric!)).toBeUndefined();
    expect(detectorClassForObject("can")).toBeNull();
    expect(detectorClassForObject("red_cup")).toBe("cup");
  });
  it("backfills legacy orders without changing historical hashes and is idempotent", async () => {
    const t = convexTest(schema, modules); await t.mutation(internal.seed.demo, {});
    const before = await t.run(ctx => ctx.db.query("rubricVersions").collect());
    const migrate = makeFunctionReference<"mutation", {}, { changed: string[] }>("taskSpecMigration:backfill");
    expect((await t.mutation(migrate, {})).changed).toHaveLength(2);
    expect((await t.mutation(migrate, {})).changed).toHaveLength(0);
    await t.run(async ctx => {
      for (const original of before) {
        const migrated = (await ctx.db.get(original._id))!;
        expect(migrated.contentHash).toBe(original.contentHash);
        expect(migrated.taskSpec).toEqual(RED_CUP_TASK_SPEC);
      }
    });
  });
  it("rejects reserved, duplicated and unbounded labels before any evidence can influence vocabulary", () => {
    for (const input of [{ ...CAN_TO_HAT_TASK_SPEC, object: "unknown" }, { ...CAN_TO_HAT_TASK_SPEC, distractors: ["can"] },
      { ...CAN_TO_HAT_TASK_SPEC, target: "hat; accept" }, { ...CAN_TO_HAT_TASK_SPEC, steps: [] }]) expect(() => normalizeTaskSpec(input)).toThrow();
  });
});
