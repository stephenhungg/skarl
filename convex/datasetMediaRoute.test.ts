// Synthetic grants, backend records and media bytes; no hosted download.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { createDatasetMediaToken, verifyDatasetMediaToken } from "../packages/payments/src/dataset-media-token";

const mocks = vi.hoisted(() => ({ query: vi.fn(), fetch: vi.fn() }));
vi.mock("convex/browser", () => ({ ConvexHttpClient: class { query = mocks.query; } }));
import { GET } from "../apps/web/app/api/orders/[id]/dataset/media/route";

const secret = "synthetic-dataset-secret-32-characters-minimum";
const orderId = "order123", submissionId = "submission123", binding = "a".repeat(64);
const grant = { demoIdentity: "buyer", orderId, submissionId, binding };
const now = 1792928000000;
const context = (id = orderId) => ({ params: Promise.resolve({ id }) });
const original = { storageUrl: "https://synthetic.convex.cloud/api/storage/private-original", mimeType: "video/mp4", binding };
function request(token: string) {
  const url = `https://example.test/api/orders/${orderId}/dataset/media?token=${token}`;
  return Object.assign(new Request(url), { nextUrl: new URL(url) }) as Parameters<typeof GET>[0];
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://synthetic.convex.cloud");
  vi.stubEnv("SKARL_PAYMENTS_SERVICE_SECRET", secret);
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.query.mockResolvedValue(original);
  mocks.fetch.mockResolvedValue(new Response("synthetic video bytes", { headers: { "Content-Type": "video/mp4" } }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("portable dataset media grants", () => {
  it("binds identity, order, source snapshot and a five-minute expiry without a storage URL", () => {
    const token = createDatasetMediaToken(grant, secret, now);
    expect(token.expiresAt).toBe(now + 300000);
    expect(verifyDatasetMediaToken(token.token, secret, now)).toEqual({ ...grant, expiresAt: now + 300000 });
    expect(token.token).not.toContain(original.storageUrl);
    expect(verifyDatasetMediaToken(token.token, secret, now + 299999).submissionId).toBe(submissionId);
    expect(() => verifyDatasetMediaToken(token.token, secret, now + 300000)).toThrow("invalid_dataset_media_grant");
    expect(() => verifyDatasetMediaToken(token.token, secret, now - 1)).toThrow("invalid_dataset_media_grant");
  });
  it("rejects tampered content, signatures, alternate secrets and malformed tokens", () => {
    const { token } = createDatasetMediaToken(grant, secret, now);
    const [body, mac] = token.split(".");
    for (const invalid of ["", `${body}.00`, `${body}.${mac}.extra`, `${body?.slice(0, -2)}00.${mac}`,
      `${body}.${mac?.[0] === "a" ? "b" : "a"}${mac?.slice(1)}`, "a".repeat(2049)]) {
      expect(() => verifyDatasetMediaToken(invalid, secret, now)).toThrow("invalid_dataset_media_grant");
    }
    expect(() => verifyDatasetMediaToken(token, "another-synthetic-secret-at-least-32-chars", now)).toThrow("invalid_dataset_media_grant");
    expect(() => createDatasetMediaToken(grant, "short", now)).toThrow("payment_service_not_configured");
  });
  it("rejects arbitrary identity, malformed IDs and invalid source bindings at issuance", () => {
    for (const invalid of [{ ...grant, demoIdentity: "finance-agent" }, { ...grant, orderId: "bad/id" },
      { ...grant, submissionId: "" }, { ...grant, binding: "not-a-hash" }]) {
      expect(() => createDatasetMediaToken(invalid, secret, now)).toThrow("invalid_dataset_media_grant");
    }
  });
});

it("streams authorized original bytes with private no-cache headers and never redirects to storage", async () => {
  const { token } = createDatasetMediaToken(grant, secret, now);
  const response = await GET(request(token), context());
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("synthetic video bytes");
  expect(response.headers.get("Content-Type")).toBe("video/mp4");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("Location")).toBeNull();
  const [reference, args] = mocks.query.mock.calls[0]!;
  expect(getFunctionName(reference)).toBe("datasets:originalMedia");
  expect(args).toEqual({ serviceSecret: secret, ...grant });
  expect(mocks.fetch).toHaveBeenCalledWith(original.storageUrl,
    expect.objectContaining({ cache: "no-store", redirect: "error", signal: expect.any(AbortSignal) }));
});

it.each(["expired", "wrong-order", "tampered", "missing"])("denies %s grants before backend or storage access", async failure => {
  let { token } = createDatasetMediaToken(grant, secret, now);
  if (failure === "expired") vi.setSystemTime(now + 300000);
  if (failure === "tampered") token = `${token}0`;
  if (failure === "missing") token = "";
  const response = await GET(request(token), context(failure === "wrong-order" ? "anotherOrder" : orderId));
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "dataset_media_unavailable_or_grant_expired" });
  expect(mocks.query).not.toHaveBeenCalled();
  expect(mocks.fetch).not.toHaveBeenCalled();
});

it("rechecks the source binding and does not fetch a swapped asset", async () => {
  mocks.query.mockResolvedValue({ ...original, binding: "b".repeat(64) });
  const { token } = createDatasetMediaToken(grant, secret, now);
  const response = await GET(request(token), context());
  expect(response.status).toBe(403);
  expect(mocks.fetch).not.toHaveBeenCalled();
});

it("sanitizes revoked access and upstream download failures", async () => {
  const { token } = createDatasetMediaToken(grant, secret, now);
  mocks.query.mockRejectedValueOnce(new Error("private source details forbidden"));
  const denied = await GET(request(token), context());
  expect(denied.status).toBe(403);
  expect(await denied.json()).toEqual({ error: "dataset_media_unavailable_or_grant_expired" });
  mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
  const unavailable = await GET(request(token), context());
  expect(unavailable.status).toBe(503);
  expect(await unavailable.json()).toEqual({ error: "dataset_media_unavailable" });
});
