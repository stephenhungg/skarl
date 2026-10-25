import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Clip } from "./use-recorder";
import type { LivenessChallenge } from "./api";

// Minimal hook driver: these tests exercise async business behavior without a DOM or camera.
// React rendering and browser capture still need the human-device smoke test.
const hooks = vi.hoisted(() => {
  type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
  let slots: Slot[] = [], cursor = 0, effects: (() => void)[] = [];
  const changed = (slot: Slot, deps: unknown[]) => !slot.deps || deps.some((value, i) => value !== slot.deps![i]);
  const next = () => slots[cursor++] ?? (slots[cursor - 1] = {});
  return {
    reset() { slots.forEach(slot => slot.cleanup?.()); slots = []; cursor = 0; effects = []; },
    render<T>(fn: () => T) {
      cursor = 0;
      const result = fn();
      const pending = effects; effects = []; pending.forEach(effect => effect());
      return result;
    },
    state<T>(initial: T) {
      const slot = next();
      if (!("value" in slot)) slot.value = initial;
      return [slot.value as T, (value: T | ((current: T) => T)) => {
        slot.value = typeof value === "function" ? (value as (current: T) => T)(slot.value as T) : value;
      }] as const;
    },
    ref<T>(initial: T) { const slot = next(); return (slot.value ??= { current: initial }) as { current: T }; },
    callback<T>(fn: T, deps: unknown[]) {
      const slot = next();
      if (changed(slot, deps)) { slot.value = fn; slot.deps = deps; }
      return slot.value as T;
    },
    effect(fn: () => void | (() => void), deps: unknown[]) {
      const slot = next();
      if (changed(slot, deps)) {
        slot.deps = deps;
        effects.push(() => { slot.cleanup?.(); slot.cleanup = fn() || undefined; });
      }
    },
  };
});
const transport = vi.hoisted(() => ({ mutation: vi.fn(), uploads: vi.fn() }));
vi.mock("react", () => ({ useState: hooks.state, useRef: hooks.ref, useCallback: hooks.callback, useEffect: hooks.effect }));
vi.mock("convex/react", () => ({ useConvex: () => transport }));
vi.mock("./media", () => ({ sha256Hex: async () => "video-hash" }));

import { refs } from "./api";
import { useLiveness } from "./use-liveness";
import { useSubmit } from "./use-submit";

const challenge = (id = "challenge-original", expiresAt = Date.now() + 120_000): LivenessChallenge =>
  ({ challengeId: id, words: ["apple", "river", "moon"], expiresAt });
const clip = (id?: string): Clip => ({ blob: new Blob(["recording"], { type: "video/webm" }), url: "blob:take",
  mimeType: "video/webm", durationMs: 15_000, sizeBytes: 9, clientRequestId: "take-original",
  ...(id ? { livenessChallengeId: id, livenessExpiresAt: Date.now() + 120_000 } : {}) });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-25T11:20:00Z"));
  transport.mutation.mockReset(); transport.uploads.mockReset();
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("XMLHttpRequest", class {
    upload = {}; status = 200; responseText = JSON.stringify({ storageId: "storage-original" });
    onload?: () => void;
    open() {} setRequestHeader() {}
    send() { transport.uploads(); this.onload?.(); }
  });
});
afterEach(() => { hooks.reset(); vi.useRealTimers(); vi.unstubAllGlobals(); });

test("lost create response retries the original challenge, storage and request after expiry", async () => {
  const take = clip("challenge-original");
  transport.mutation.mockResolvedValueOnce("https://upload.example")
    .mockRejectedValueOnce(new Error("Connection lost after create"))
    .mockResolvedValueOnce({ submissionId: "submission-original", replayed: true });
  const render = () => hooks.render(() => useSubmit("order-original"));
  await render().submit(take);
  expect(render().canRetake).toBe(false);
  vi.advanceTimersByTime(180_000);
  await render().submit(take);
  const creates = transport.mutation.mock.calls.filter(([ref]) => ref === refs.createSubmission);
  expect(creates).toHaveLength(2);
  expect(creates[0][1]).toEqual(creates[1][1]);
  expect(creates[1][1]).toMatchObject({ livenessChallengeId: "challenge-original", storageId: "storage-original", clientRequestId: "take-original" });
  expect(transport.uploads).toHaveBeenCalledTimes(1);
  expect(render().state).toMatchObject({ phase: "queued", replayed: true });
  expect(render().canRetake).toBe(true);
});

test("a take without challenge evidence retains the legacy human-review submission path", async () => {
  transport.mutation.mockResolvedValueOnce("https://upload.example").mockResolvedValueOnce({ submissionId: "submission-original" });
  const render = () => hooks.render(() => useSubmit("order-original"));
  await render().submit(clip());
  expect(transport.mutation.mock.calls[1][1]).not.toHaveProperty("livenessChallengeId");
  expect(render().state.phase).toBe("queued");
});

test.each(["expired", "used", "foreign", "not_found"])("explicit challenge %s refusal unlocks retaking", async suffix => {
  transport.mutation.mockResolvedValueOnce("https://upload.example")
    .mockRejectedValueOnce(new Error(`[Request ID: example] Server Error\nUncaught Error: liveness_challenge_${suffix}\n    at handler`));
  const render = () => hooks.render(() => useSubmit("order-original"));
  await render().submit(clip("challenge-original"));
  expect(render().state).toMatchObject({ phase: "error", kind: "refused", retryable: false });
  expect(render().canRetake).toBe(true);
});

test("expiry refreshes the preview, while a recording keeps its original words", async () => {
  const original = challenge(), fresh = challenge("challenge-fresh", Date.now() + 300_000);
  const issue = vi.fn().mockResolvedValueOnce(original).mockResolvedValueOnce(fresh);
  let preview = true;
  const render = () => hooks.render(() => useLiveness(preview, issue));
  render(); await flush();
  expect(render().challenge).toEqual(original);
  preview = false; render();
  vi.advanceTimersByTime(120_001); await flush();
  expect(render().challenge).toEqual(original);
  expect(issue).toHaveBeenCalledTimes(1);
  preview = true; render(); await flush();
  expect(render().challenge).toEqual(fresh);
  expect(issue).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(179_999); await flush(); render();
  expect(issue).toHaveBeenCalledTimes(3);
});

test("a timed-out optional fetch permits fallback and ignores its late response", async () => {
  let resolve!: (value: LivenessChallenge) => void;
  const issue = vi.fn(() => new Promise<LivenessChallenge>(done => { resolve = done; }));
  const render = () => hooks.render(() => useLiveness(true, issue));
  render();
  expect(render().phase).toBe("loading");
  vi.advanceTimersByTime(8000);
  expect(render().phase).toBe("unavailable");
  resolve(challenge()); await flush();
  expect(render().phase).toBe("unavailable");
  expect(render().challenge).toBeUndefined();
});

test("a rejected optional fetch permits fallback", async () => {
  const issue = vi.fn().mockRejectedValue(new Error("Challenge service unavailable"));
  const render = () => hooks.render(() => useLiveness(true, issue));
  render(); await flush();
  expect(render().phase).toBe("unavailable");
});
