// Synthetic HTTP/backend responses only; no hosted Convex or payment calls.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";

const mocks = vi.hoisted(() => ({ query: vi.fn(), client: vi.fn() }));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    constructor(url: string) { mocks.client(url); }
    query = mocks.query;
  },
}));
import { GET } from "../apps/web/app/api/samples/[id]/witnesses/route";

const submissionId = "submission123";
const receipt = { submissionId, verdict: "needs_review", recommendation: null, witnesses: [] };
const context = (id = submissionId) => ({ params: Promise.resolve({ id }) });
function request(identity?: string) {
  return new Request(`https://example.test/api/samples/${submissionId}/witnesses`, {
    headers: identity === undefined ? {} : { "x-skarl-demo-identity": identity },
  }) as Parameters<typeof GET>[0];
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
  vi.stubEnv("SKARL_PAYMENTS_SERVICE_SECRET", "");
  mocks.query.mockResolvedValue(receipt);
});
afterEach(() => vi.unstubAllEnvs());

it("requires an explicit identity rather than silently choosing controller authority", async () => {
  const response = await GET(request(), context());
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "demo_identity_required" });
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(mocks.client).not.toHaveBeenCalled();
  expect(mocks.query).not.toHaveBeenCalled();
});

it.each([submissionId, `sample-${submissionId}`])("reads %s through the role-checked query without payment-service credentials", async id => {
  const response = await GET(request("contributor"), context(id));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(receipt);
  expect(mocks.client).toHaveBeenCalledWith("https://example.convex.cloud");
  expect(mocks.query).toHaveBeenCalledTimes(1);
  const [reference, args] = mocks.query.mock.calls[0]!;
  expect(getFunctionName(reference)).toBe("witnessReceipt:forSubmission");
  expect(args).toEqual({ demoIdentity: "contributor", submissionId });
});

it.each(["submission_not_owned", "order_not_owned", "cross_organization_access", "forbidden"])("maps %s to denial without leaking backend details", async code => {
  mocks.query.mockRejectedValue(new Error(`[Request ID: private] ${code}; arguments: private evidence`));
  const response = await GET(request("buyer"), context());
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "witness_receipt_forbidden" });
});

it("uses exact decimal JSON serialization and disables caching for private receipt data", async () => {
  // Future additions must not round values above JavaScript's safe integer range.
  mocks.query.mockResolvedValue({ ...receipt, amountAtomic: 9007199254740993n });
  const response = await GET(request("controller"), context());
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ ...receipt, amountAtomic: "9007199254740993" });
});

it.each(["submission_not_found", "order_not_found"])("reports %s without exposing wrapped errors", async code => {
  mocks.query.mockRejectedValue(new Error(`${code}: private backend arguments`));
  const response = await GET(request("controller"), context());
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "sample_unavailable" });
});

it("rejects malformed route IDs before backend access and masks validator details", async () => {
  expect((await GET(request("controller"), context("invalid/id"))).status).toBe(400);
  expect(mocks.query).not.toHaveBeenCalled();
  mocks.query.mockRejectedValue(new Error("ArgumentValidationError: sensitive request arguments"));
  const response = await GET(request("controller"), context());
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "invalid_submission_id" });
});

it("reports missing configuration and backend failures as unavailable, never raw errors", async () => {
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "");
  const unconfigured = await GET(request("controller"), context());
  expect(unconfigured.status).toBe(503);
  expect(await unconfigured.json()).toEqual({ error: "witness_receipt_not_configured" });
  expect(mocks.client).not.toHaveBeenCalled();
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
  mocks.query.mockRejectedValue(new Error("Backend unavailable: private-url?secret=do-not-expose"));
  const failed = await GET(request("controller"), context());
  expect(failed.status).toBe(503);
  expect(await failed.json()).toEqual({ error: "witness_receipt_unavailable" });
  expect(failed.headers.get("Cache-Control")).toBe("private, no-store");
});
