import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../../apps/web/app/api/samples/[id]/media/route";
import { issueMediaToken } from "../../../apps/web/lib/payments/media-token";
const mocks = vi.hoisted(() => ({ query: vi.fn(), fetch: vi.fn() }));
const secret = "synthetic-service-secret-at-least-32-characters";
vi.mock("../../../apps/web/lib/payments/server", async importOriginal => {
  const actual = await importOriginal<typeof import("../../../apps/web/lib/payments/server")>();
  return { ...actual, paymentService: () => ({ serviceSecret: "synthetic-service-secret-at-least-32-characters", db: { query: mocks.query } }) };
});
const SAMPLE_ID = "sample-accepted123";
const context = { params: Promise.resolve({ id: SAMPLE_ID }) };
const sample = { sampleId: SAMPLE_ID, report: {}, storageUrl: "https://private.convex.cloud/api/storage/private-original", mimeType: "video/webm", binding: "bound-evidence" };
function request(token?: string) {
  const url = new URL(`https://skarl.example/api/samples/${SAMPLE_ID}/media`);
  if (token) url.searchParams.set("token", token);
  const value = new Request(url);
  return Object.assign(value, { nextUrl: url }) as Parameters<typeof GET>[0];
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.query.mockResolvedValue(sample);
  mocks.fetch.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "video/webm" } }));
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => vi.unstubAllGlobals());
describe("paid media proxy", () => {
  it.each([undefined, "invalid", "a.b"])("rejects invalid grants before backend reads (%s)", async token => {
    const response = await GET(request(token), context);
    expect(response.status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("rejects expired grants before reading media", async () => {
    const grant = issueMediaToken(SAMPLE_ID, sample.binding, secret, Date.now() - 300_001);
    expect((await GET(request(grant.token), context)).status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("streams private bytes and never exposes a storage redirect or cacheable response", async () => {
    const grant = issueMediaToken(SAMPLE_ID, sample.binding, secret);
    const response = await GET(request(grant.token), context);
    expect(response.status).toBe(200);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(response.headers.get("Location")).toBeNull();
    expect(response.headers.get("Content-Type")).toBe("video/webm");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(mocks.fetch).toHaveBeenCalledWith(sample.storageUrl, expect.objectContaining({ redirect: "error", cache: "no-store" }));
  });
  it("revokes access if the stored evidence binding changes", async () => {
    const grant = issueMediaToken(SAMPLE_ID, sample.binding, secret);
    mocks.query.mockResolvedValue({ ...sample, binding: "changed" });
    expect((await GET(request(grant.token), context)).status).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("does not serve media that becomes unavailable after payment", async () => {
    const grant = issueMediaToken(SAMPLE_ID, sample.binding, secret);
    mocks.query.mockRejectedValue(new Error("sample_unavailable"));
    expect((await GET(request(grant.token), context)).status).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
