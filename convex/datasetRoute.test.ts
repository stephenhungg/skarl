// Synthetic HTTP/backend responses only; no hosted Convex, media or chain calls.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";

const mocks = vi.hoisted(() => ({ query: vi.fn(), client: vi.fn() }));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    constructor(url: string) { mocks.client(url); }
    query = mocks.query;
  },
}));
import { GET } from "../apps/web/app/api/orders/[id]/dataset/route";

const orderId = "order123";
const sample = { submissionId: "submission123", license: { version: "demo-consent-v1", scope: "training" } };
const manifest = { schema: "skarl.dataset.v1", orderId, task: { id: "task123", version: 1, criterionIds: [] },
  generatedAt: 1792918771043, samples: [sample] };
const context = (id = orderId) => ({ params: Promise.resolve({ id }) });
function request(identity?: string, search = "") {
  const url = `https://example.test/api/orders/${orderId}/dataset${search}`;
  return Object.assign(new Request(url, {
    headers: identity === undefined ? {} : { "x-skarl-demo-identity": identity },
  }), { nextUrl: new URL(url) }) as Parameters<typeof GET>[0];
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
  vi.stubEnv("SKARL_PAYMENTS_SERVICE_SECRET", "");
  mocks.query.mockResolvedValue(manifest);
});
afterEach(() => vi.unstubAllEnvs());

it("requires explicit demo identity before private dataset lookup", async () => {
  const response = await GET(request(), context());
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "demo_identity_required" });
  expect(mocks.query).not.toHaveBeenCalled();
  expect(mocks.client).not.toHaveBeenCalled();
});

it.each(["buyer", "controller"])("returns the manifest using authoritative query access checks for %s", async demoIdentity => {
  const response = await GET(request(demoIdentity), context());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(manifest);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(mocks.client).toHaveBeenCalledWith("https://example.convex.cloud");
  const [reference, args] = mocks.query.mock.calls[0]!;
  expect(getFunctionName(reference)).toBe("datasets:forOrder");
  expect(args).toEqual({ demoIdentity, orderId, refreshKey: Math.floor(Date.now() / 60_000) });
});

it("streams exactly one independently parseable sample per JSONL line", async () => {
  const second = { ...sample, submissionId: "submission456", amountAtomic: 9007199254740993n,
    transcriptSegments: [{ text: "Line one\nline two", startMs: 0, endMs: 1000 }] };
  mocks.query.mockResolvedValue({ ...manifest, samples: [sample, second] });
  const response = await GET(request("buyer", "?format=jsonl"), context());
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("application/x-ndjson; charset=utf-8");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="skarl-order123.jsonl"');
  const body = await response.text();
  expect(body.endsWith("\n")).toBe(true);
  expect(body.trimEnd().split("\n").map(line => JSON.parse(line))).toEqual([
    sample, { ...second, amountAtomic: "9007199254740993" },
  ]);
});

it("exports empty orders as an empty samples array or an empty JSONL stream", async () => {
  mocks.query.mockResolvedValue({ ...manifest, samples: [] });
  const json = await GET(request("buyer"), context());
  expect(json.status).toBe(200);
  expect(await json.json()).toEqual({ ...manifest, samples: [] });
  const jsonl = await GET(request("buyer", "?format=jsonl"), context());
  expect(jsonl.status).toBe(200);
  expect(await jsonl.text()).toBe("");
});

it("serializes JSON money without losing integer precision", async () => {
  mocks.query.mockResolvedValue({ ...manifest, samples: [{ ...sample, amountAtomic: 9007199254740993n }] });
  const response = await GET(request("buyer"), context());
  expect((await response.json()).samples[0].amountAtomic).toBe("9007199254740993");
});

it.each(["order_not_owned", "cross_organization_access", "forbidden", "inactive_demo_identity", "unknown_demo_identity", "agent_approval_refused"])(
  "denies %s before opening a JSONL stream and masks backend arguments", async code => {
    mocks.query.mockRejectedValue(new Error(`[private request] ${code}: private media details`));
    const response = await GET(request("contributor", "?format=jsonl"), context());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "dataset_forbidden" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  },
);

it("validates route ids and formats before accessing Convex", async () => {
  expect((await GET(request("buyer"), context("invalid/id"))).status).toBe(400);
  const invalidFormat = await GET(request("buyer", "?format=csv"), context());
  expect(invalidFormat.status).toBe(400);
  expect(await invalidFormat.json()).toEqual({ error: "invalid_dataset_format" });
  expect(mocks.query).not.toHaveBeenCalled();
  mocks.query.mockRejectedValue(new Error("ArgumentValidationError: private arguments"));
  const response = await GET(request("buyer"), context());
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "invalid_order_id" });
});

it.each([
  ["order_not_found: private arguments", 404, "order_unavailable"],
  ["Backend failed at private-url?secret=hidden", 503, "dataset_unavailable"],
])("sanitizes %s", async (message, status, code) => {
  mocks.query.mockRejectedValue(new Error(message as string));
  const response = await GET(request("buyer"), context());
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error: code });
});

it("reports missing configuration without constructing a client", async () => {
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "");
  const response = await GET(request("buyer"), context());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "dataset_not_configured" });
  expect(mocks.client).not.toHaveBeenCalled();
});
