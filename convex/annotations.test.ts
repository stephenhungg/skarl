import { convexTest } from "convex-test";
import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { frameHasObjectInHand, frameHasCupInHand, MAX_ANNOTATION_BYTES, summarizeAnnotations, validateAnnotationFile } from "./lib/derivedAnnotations";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.ts"]);
const keypoints = () => Array.from({ length: 21 }, () => [0.5, 0.5, 0.5]);
const file = (submissionId = "synthetic-submission", sourceSha256 = "a".repeat(64)) => ({
  schema: "skarl.annotations.v1", submissionId, sourceSha256, kind: "objects",
  model: { name: "synthetic-detector", version: "fixture-v1", runtime: "browser-wasm" },
  sampleFps: 2, videoWidth: 640, videoHeight: 480, advisory: true,
  frames: [
    { tMs: 0, objects: [{ label: "cup", score: 0.9, box: [0.3, 0.3, 0.3, 0.3] }, { label: "hand", score: 0.8, box: [0.4, 0.4, 0.2, 0.2] }] },
    { tMs: 500, objects: [{ label: "cup", score: 0.9, box: [0.3, 0.3, 0.3, 0.3] }] },
    { tMs: 1000, objects: [] },
  ],
});
const forgedSummary = { kind: "masks" as const, frames: 9999, cupInHandFrames: 9999, durationMs: 9999 };
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.restoreAllMocks(); vi.clearAllTimers(); vi.useRealTimers(); });

// convex-test 0.0.65 predates Convex 1.48's mutation storageGet syscall.
// Bridge only that missing transport to the harness's actual stored blob; no
// authorization, metadata, JSON validation or summary behavior is mocked.
function supportMutationBlobReads() {
  type Runtime = { asyncSyscall: (op: string, args: string) => Promise<string>;
    jsSyscall: (op: string, args: unknown) => Promise<Blob | null> };
  const runtime = (globalThis as unknown as { Convex: Runtime }).Convex;
  const original = Object.getOwnPropertyDescriptor(runtime, "asyncSyscall")!.get!;
  vi.spyOn(runtime, "asyncSyscall", "get").mockImplementation(() => async (op, args) => {
    if (op !== "1.0/storageGet") return original.call(runtime)(op, args);
    const blob = await runtime.jsSyscall("storage/getBlob", JSON.parse(args));
    return JSON.stringify(blob ? { blob: Buffer.from(await blob.arrayBuffer()).toString("base64"), contentType: blob.type } : null);
  });
}

async function setup() {
  const t = convexTest(schema, modules);
  supportMutationBlobReads();
  const seeded = await t.mutation(internal.seed.demo, {});
  const video = await t.run(ctx => ctx.storage.store(new Blob(["synthetic-video"], { type: "video/mp4" })));
  const { submissionId } = await t.mutation(api.submissions.create, { demoIdentity: "contributor", orderId: seeded.orderId,
    storageId: video, clientRequestId: "annotation-fixture", consentAcknowledged: true });
  const submission = (await t.run(ctx => ctx.db.get(submissionId)))!;
  const input = file(submissionId, submission.expectedSourceHash);
  const store = (value: unknown, type = "application/json") => t.run(ctx => ctx.storage.store(new Blob([JSON.stringify(value)], { type })));
  const storageId = await store(input);
  return { t, ...seeded, submissionId, input, store, storageId,
    args: { demoIdentity: "contributor", submissionId, storageId, summary: forgedSummary } };
}

describe("strict advisory annotation files", () => {
  it("validates all kinds and recomputes only observed summaries", () => {
    expect(summarizeAnnotations(validateAnnotationFile(file()))).toEqual({ kind: "objects", frames: 3, durationMs: 1000,
      objectLabels: { cup: 2, hand: 1 }, cupInHandFrames: 1 });
    const hands = validateAnnotationFile({ ...file(), kind: "hands", frames: [
      { tMs: 0, hands: [{ handedness: "Left", score: 0.9, keypoints: keypoints() }] }, { tMs: 500, hands: [] },
    ] });
    expect(summarizeAnnotations(hands)).toEqual({ kind: "hands", frames: 2, durationMs: 500, handsDetectedFrames: 1, maxHands: 1 });
    const masks = validateAnnotationFile({ ...file(), kind: "masks", frames: [{ tMs: 0, masks: [{ label: "cup",
      prompt: { x: 0.5, y: 0.5 }, score: 1, bbox: [0, 0, 1, 1], areaFrac: 0.1, polygon: [[0, 0], [1, 0], [1, 1]] }] }] });
    expect(summarizeAnnotations(masks)).toEqual({ kind: "masks", frames: 1, durationMs: 0, masks: 1 });
    expect(summarizeAnnotations(validateAnnotationFile({ ...file(), frames: [] }))).toMatchObject({ frames: 0, durationMs: 0, cupInHandFrames: 0 });
  });
  it("requires cup/hand spatial evidence and never treats a person box as a grasp", () => {
    const frame = validateAnnotationFile(file()).frames[0]!;
    expect(frameHasCupInHand(frame)).toBe(true);
    const cup = frame.objects![0]!;
    expect(frameHasCupInHand({ tMs: 0, objects: [cup, { label: "person", score: 1, box: [0, 0, 1, 1] }] })).toBe(false);
    expect(frameHasCupInHand({ tMs: 0, objects: [cup, { label: "hand", score: 1, box: [0, 0, 0.1, 0.1] }] })).toBe(false);
    expect(frameHasCupInHand({ tMs: 0, objects: [cup, { label: "hand", score: 0, box: [0, 0, 1, 1] }] })).toBe(false);
    expect(frameHasCupInHand({ tMs: 0, objects: [cup], hands: [{ handedness: "Left", score: 0.9, keypoints: keypoints() as [number, number, number][] }] })).toBe(true);
  });
  it("matches only the requested faithful detector class, with hand evidence", () => {
    const frame = validateAnnotationFile(file()).frames[0]!;
    const bottle = { ...frame.objects![0]!, label: "bottle" };
    expect(frameHasObjectInHand({ ...frame, objects: [bottle, frame.objects![1]!] }, "bottle")).toBe(true);
    expect(frameHasObjectInHand(frame, "bottle")).toBe(false);
    expect(frameHasObjectInHand({ ...frame, objects: [bottle] }, "bottle")).toBe(false);
    expect(frameHasObjectInHand({ ...frame, objects: [bottle, frame.objects![1]!] }, "can")).toBe(false);
  });
  it("rejects schema, kind, model, timing, count and unknown-field violations", () => {
    const valid = file();
    for (const input of [null, [], { ...valid, schema: "other" }, { ...valid, kind: "verdict" }, { ...valid, advisory: false },
      { ...valid, model: { ...valid.model, runtime: "server" } }, { ...valid, model: { ...valid.model, version: "" } },
      { ...valid, model: { ...valid.model, accept: true } }, { ...valid, sourceSha256: "not-a-hash" },
      { ...valid, sampleFps: 0 }, { ...valid, sampleFps: Infinity }, { ...valid, videoWidth: 0 }, { ...valid, videoHeight: 1.5 },
      { ...valid, frames: Array.from({ length: 2001 }, (_, tMs) => ({ tMs, objects: [] })) },
      { ...valid, frames: [{ tMs: -1, objects: [] }] }, { ...valid, frames: [{ tMs: 30_001, objects: [] }] },
      { ...valid, frames: [{ tMs: 1, objects: [] }, { tMs: 0, objects: [] }] },
      { ...valid, frames: [{ tMs: 0, objects: [] }, { tMs: 0, objects: [] }] },
      { ...valid, frames: [{ tMs: 0, hands: [] }] }, { ...valid, frames: [{ tMs: 0, objects: [], accepted: true }] },
      { ...valid, acceptance: true }]) expect(() => validateAnnotationFile(input)).toThrow("invalid_annotations");
  });
  it("rejects bad coordinates, scores, bounding boxes, keypoint counts and mask shapes", () => {
    const object = file().frames[0]!.objects[0]!;
    for (const patch of [{ box: [-0.1, 0, 1, 1] }, { box: [0, 0, 1.1, 1] }, { box: [0.9, 0, 0.2, 1] },
      { box: [0, 0, NaN, 1] }, { box: [0, 0, 1] }, { score: -1 }, { score: Infinity }, { label: "__proto__" }]) {
      expect(() => validateAnnotationFile({ ...file(), frames: [{ tMs: 0, objects: [{ ...object, ...patch }] }] })).toThrow("invalid_annotations");
    }
    for (const points of [keypoints().slice(1), [...keypoints(), [0, 0, 0]], [[-0.1, 0, 0], ...keypoints().slice(1)],
      [[0, 0, -0.1], ...keypoints().slice(1)], [[0, 0], ...keypoints().slice(1)]]) {
      expect(() => validateAnnotationFile({ ...file(), kind: "hands", frames: [{ tMs: 0, hands: [{ handedness: "Left", score: 1, keypoints: points }] }] })).toThrow("invalid_annotations");
    }
    const mask = { prompt: { x: 0, y: 0 }, score: 0.5, bbox: [0, 0, 1, 1], areaFrac: 0.5 };
    for (const patch of [{ prompt: { x: 1.1, y: 0 } }, { areaFrac: 1.1 }, { polygon: [[0, 0], [1, 1]] },
      { polygon: [[0, 0], [1, 1], [2, 0]] }]) {
      expect(() => validateAnnotationFile({ ...file(), kind: "masks", frames: [{ tMs: 0, masks: [{ ...mask, ...patch }] }] })).toThrow("invalid_annotations");
    }
    // Even files under the byte cap cannot create an unbounded inline label summary.
    expect(() => validateAnnotationFile({ ...file(), frames: Array.from({ length: 101 }, (_, tMs) => ({ tMs,
      objects: [{ ...object, label: `label-${tMs}` }] })) })).toThrow("invalid_annotations");
  });
});

describe("private annotation storage boundary", () => {
  it.each(["bottle", "can"])("binds recomputed object overlap to the frozen %s spec rather than the caller summary", async taskObject => {
    const f = await setup();
    const spec = { object: taskObject, distractors: [], target: "hat", steps: [`Pick up the ${taskObject}`, `Place the ${taskObject} beside the hat`] };
    await f.t.run(async ctx => {
      await ctx.db.patch(f.orderId, { taskSpec: spec });
      await ctx.db.patch(f.taskVersionId, { taskSpec: spec });
    });
    const input = { ...f.input, frames: f.input.frames.map(frame => ({ ...frame,
      objects: frame.objects.map(item => item.label === "cup" ? { ...item, label: "bottle" } : item) })) };
    const annotationId = await f.t.mutation(api.annotations.saveDerived, { ...f.args, storageId: await f.store(input),
      summary: { ...forgedSummary, objectInHandFrames: 9999 } });
    const row = (await f.t.run(ctx => ctx.db.get(annotationId)))!;
    expect(row.taskObject).toBe(taskObject);
    expect(row.detectorClass).toBe(taskObject === "bottle" ? "bottle" : undefined);
    expect(row.objectInHandTimestampsMs).toEqual(taskObject === "bottle" ? [0] : []);
    expect(row.summary.objectInHandFrames).toBe(taskObject === "bottle" ? 1 : 0);
    expect(row.summary.cupInHandFrames).toBe(0);
  });

  it("reads blob bytes, ignores forged summary, retries idempotently and never changes decisions or money", async () => {
    const f = await setup();
    const before = await f.t.run(ctx => ctx.db.get(f.submissionId));
    const annotationId = await f.t.mutation(api.annotations.saveDerived, f.args);
    expect(await f.t.mutation(api.annotations.saveDerived, { ...f.args, summary: { ...forgedSummary, frames: 1 } })).toBe(annotationId);
    const row = await f.t.run(ctx => ctx.db.get(annotationId));
    expect(row).toMatchObject({ advisory: true, createdBy: "demo:skarl:contributor", kind: "objects", model: f.input.model,
      summary: { kind: "objects", frames: 3, durationMs: 1000, cupInHandFrames: 1, objectLabels: { cup: 2, hand: 1 } }, cupInHandTimestampsMs: [0] });
    expect(await f.t.run(ctx => ctx.db.get(f.submissionId))).toEqual(before);
    for (const table of ["derivedAnnotations", "reviewDecisions", "payables", "journalEntries"] as const) {
      const rows = await f.t.run(ctx => ctx.db.query(table).collect());
      expect(rows).toHaveLength(table === "derivedAnnotations" ? 1 : 0);
    }
  });
  it("allows buyer/legacy controller/contributor-owner uploads and reads, newest first", async () => {
    const f = await setup();
    for (const demoIdentity of ["buyer", "controller", "contributor"]) expect(await f.t.mutation(api.annotations.generateUploadUrl, { demoIdentity, submissionId: f.submissionId })).toMatch(/^https?:/);
    const first = await f.t.mutation(api.annotations.saveDerived, f.args);
    vi.advanceTimersByTime(1000);
    const second = await f.t.mutation(api.annotations.saveDerived, { ...f.args, demoIdentity: "controller", storageId: await f.store({ ...f.input, model: { ...f.input.model, version: "fixture-v2" } }) });
    for (const demoIdentity of ["controller", "buyer", "contributor"]) {
      const rows = await f.t.query(api.annotations.forSubmission, { demoIdentity, submissionId: f.submissionId });
      expect(rows.map(row => row._id)).toEqual([second, first]);
      expect(rows[0]!.url).toMatch(/^https?:/);
      expect(Object.keys(rows[0]!).sort()).toEqual(["_id", "kind", "model", "createdAt", "createdBy", "url", "summary"].sort());
    }
    for (const demoIdentity of ["finance-agent"]) {
      await expect(f.t.mutation(api.annotations.generateUploadUrl, { demoIdentity, submissionId: f.submissionId })).rejects.toThrow("forbidden");
      await expect(f.t.mutation(api.annotations.saveDerived, { ...f.args, demoIdentity })).rejects.toThrow("forbidden");
    }
    await expect(f.t.query(api.annotations.forSubmission, { demoIdentity: "finance-agent", submissionId: f.submissionId })).rejects.toThrow("forbidden");
  });
  it("uses authenticated roles and ownership rather than the caller's demo selector", async () => {
    const f = await setup();
    const userId = await f.t.run(ctx => ctx.db.insert("users", { email: "synthetic-contributor@example.test" }));
    const tokenIdentifier = `auth:${userId}`;
    const membershipId = await f.t.run(ctx => ctx.db.insert("memberships", { organizationId: f.organizationId,
      issuer: "auth", subject: userId, tokenIdentifier, roles: ["contributor"],
      grantedByTokenIdentifier: "synthetic-controller", status: "active" }));
    const signedIn = f.t.withIdentity({ subject: `${userId}|synthetic-session`, issuer: "https://auth.example.test" });
    await expect(signedIn.mutation(api.annotations.saveDerived, { ...f.args, demoIdentity: "controller" })).rejects.toThrow("submission_not_owned");
    await f.t.run(ctx => ctx.db.patch(f.submissionId, { contributorTokenIdentifier: tokenIdentifier }));
    const id = await signedIn.mutation(api.annotations.saveDerived, { ...f.args, demoIdentity: "buyer" });
    expect((await f.t.run(ctx => ctx.db.get(id)))?.createdBy).toBe(tokenIdentifier);
    await f.t.run(ctx => ctx.db.patch(membershipId, { roles: ["buyer"] }));
    expect(await signedIn.mutation(api.annotations.saveDerived, { ...f.args, demoIdentity: "controller" })).toBe(id);
    expect(await signedIn.query(api.annotations.forSubmission, { demoIdentity: "controller", submissionId: f.submissionId })).toHaveLength(1);
    await f.t.run(ctx => ctx.db.patch(membershipId, { roles: ["controller"] }));
    // A signed-in human's identity comes from their session, never this selector.
    expect(await signedIn.mutation(api.annotations.generateUploadUrl, { demoIdentity: "finance-agent", submissionId: f.submissionId })).toMatch(/^https?:/);
    await f.t.run(ctx => ctx.db.patch(membershipId, { status: "revoked" }));
    await expect(signedIn.query(api.annotations.forSubmission, { demoIdentity: "controller", submissionId: f.submissionId })).rejects.toThrow("inactive_membership");
  });
  it("allows an organization buyer while rejecting foreign contributors and tenants", async () => {
    const f = await setup();
    await f.t.run(ctx => ctx.db.patch(f.submissionId, { contributorTokenIdentifier: "demo:other" }));
    await expect(f.t.mutation(api.annotations.saveDerived, f.args)).rejects.toThrow("submission_not_owned");
    await expect(f.t.mutation(api.annotations.generateUploadUrl, { demoIdentity: "contributor", submissionId: f.submissionId })).rejects.toThrow("submission_not_owned");
    await expect(f.t.query(api.annotations.forSubmission, { demoIdentity: "contributor", submissionId: f.submissionId })).rejects.toThrow("submission_not_owned");
    await f.t.run(ctx => ctx.db.patch(f.orderId, { buyerTokenIdentifier: "demo:other-buyer" }));
    expect(await f.t.query(api.annotations.forSubmission, { demoIdentity: "buyer", submissionId: f.submissionId })).toEqual([]);
    await f.t.run(async ctx => {
      const organizationId = await ctx.db.insert("organizations", { name: "Other", status: "active", createdByTokenIdentifier: "other" });
      await ctx.db.patch(f.submissionId, { organizationId });
    });
    for (const demoIdentity of ["buyer", "controller"]) await expect(f.t.query(api.annotations.forSubmission, { demoIdentity, submissionId: f.submissionId })).rejects.toThrow("cross_organization_access");
    await expect(f.t.mutation(api.annotations.saveDerived, { ...f.args, demoIdentity: "controller" })).rejects.toThrow("cross_organization_access");
  });
  it("rejects oversize, malformed and mismatched stored files before any write", async () => {
    const f = await setup();
    const oversize = await f.t.run(ctx => ctx.storage.store(new Blob([" ".repeat(MAX_ANNOTATION_BYTES + 1)], { type: "application/json" })));
    await expect(f.t.mutation(api.annotations.saveDerived, { ...f.args, storageId: oversize })).rejects.toThrow("annotation_size_invalid");
    const badJson = await f.t.run(ctx => ctx.storage.store(new Blob(["{"], { type: "application/json" })));
    await expect(f.t.mutation(api.annotations.saveDerived, { ...f.args, storageId: badJson })).rejects.toThrow("invalid_annotations");
    await expect(f.t.mutation(api.annotations.saveDerived, { ...f.args, storageId: await f.store(f.input, "text/plain") })).rejects.toThrow("annotation_type_invalid");
    for (const input of [{ ...f.input, submissionId: "another-submission" }, { ...f.input, sourceSha256: "b".repeat(64) }]) {
      await expect(f.t.mutation(api.annotations.saveDerived, { ...f.args, storageId: await f.store(input) })).rejects.toThrow("annotation_source_mismatch");
    }
    const malformed = { ...f.input, frames: [{ tMs: 0, objects: [{ label: "cup", score: 1, box: [-1, 0, 1, 1] }] }] };
    await expect(f.t.mutation(api.annotations.saveDerived, { ...f.args, storageId: await f.store(malformed) })).rejects.toThrow("invalid_annotations");
    const malformedHands = { ...f.input, kind: "hands", frames: [{ tMs: 0, hands: [{ handedness: "Right", score: 1, keypoints: [] }] }] };
    await expect(f.t.mutation(api.annotations.saveDerived, { ...f.args, storageId: await f.store(malformedHands) })).rejects.toThrow("invalid_annotations");
    expect(await f.t.run(ctx => ctx.db.query("derivedAnnotations").collect())).toHaveLength(0);
  });
  it("rejects timestamps beyond known original duration and cannot rebind an existing blob", async () => {
    const f = await setup();
    const submission = (await f.t.run(ctx => ctx.db.get(f.submissionId)))!;
    await f.t.run(ctx => ctx.db.patch(submission.originalAssetId!, { durationMs: 100 }));
    await expect(f.t.mutation(api.annotations.saveDerived, f.args)).rejects.toThrow("annotation_timestamp_out_of_bounds");
    await f.t.run(ctx => ctx.db.patch(submission.originalAssetId!, { durationMs: 1000 }));
    await f.t.mutation(api.annotations.saveDerived, f.args);
    const other = await f.t.run(ctx => { const { _id, _creationTime, ...copy } = submission; return ctx.db.insert("submissions", { ...copy, clientRequestId: "other" }); });
    await expect(f.t.mutation(api.annotations.saveDerived, { ...f.args, submissionId: other })).rejects.toThrow("annotation_upload_already_attached");
  });
});
