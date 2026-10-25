import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { generateKeyPairSync } from "node:crypto";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "@skarl/contracts/chain";
import { GET } from "../../../apps/web/app/api/samples/[id]/evidence/route";
import { verifyMediaToken } from "../../../apps/web/lib/payments/media-token";

// Synthetic facilitator/RPC/Convex responses exercise real Next/x402 middleware.
// These tests do not prove a valid signature, live settlement or Bazaar indexing.
const mocks = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn(), observeTransfer: vi.fn(), fetch: vi.fn() }));
vi.mock("../../../apps/web/lib/payments/server", async importOriginal => {
  const actual = await importOriginal<typeof import("../../../apps/web/lib/payments/server")>();
  return { ...actual, paymentService: () => ({ serviceSecret: "synthetic-service-secret-at-least-32-characters",
    db: { query: mocks.query, mutation: mocks.mutation } }) };
});
vi.mock("../../../apps/web/lib/payments/chain", () => ({ observeTransfer: mocks.observeTransfer }));

const TREASURY = `0x${"22".repeat(20)}`;
const PAYER = `0x${"11".repeat(20)}`;
const NONCE = `0x${"aa".repeat(32)}`;
const TX_HASH = `0x${"bb".repeat(32)}`;
const SAMPLE_ID = "sample-accepted123";
const ENDPOINT = `https://skarl.example/api/samples/${SAMPLE_ID}/evidence`;
const context = { params: Promise.resolve({ id: SAMPLE_ID }) };
const report = { syntheticFixture: "stored-private-verification-evidence" };
const sample = { sampleId: SAMPLE_ID, report, storageUrl: "https://private.convex.cloud/api/storage/private-original",
  mimeType: "video/webm", binding: "synthetic-evidence-binding" };
const extensions = { bazaar: { status: "processing" } };
const extensionHeader = Buffer.from(JSON.stringify(extensions)).toString("base64");
const observation = { network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, txHash: TX_HASH, logIndex: 1,
  blockNumber: 100n, blockHash: `0x${"cc".repeat(32)}`, fromAddress: PAYER, toAddress: TREASURY,
  amountAtomic: 250_000n, confirmations: 2, succeeded: true, observedAt: Date.now() };
const events: string[] = [];
let claimed = false;

function request(payment?: unknown) {
  const value = new Request(ENDPOINT, { headers: { Accept: "application/json",
    ...(payment ? { "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify(payment)).toString("base64") } : {}) } });
  return Object.assign(value, { nextUrl: new URL(ENDPOINT) }) as Parameters<typeof GET>[0];
}
async function challenge() {
  const response = await GET(request(), context);
  expect(response.status).toBe(402);
  return { response, required: JSON.parse(Buffer.from(response.headers.get("PAYMENT-REQUIRED")!, "base64").toString()) };
}
async function payload() {
  const { required } = await challenge();
  return { x402Version: 2, resource: required.resource, accepted: required.accepts[0], extensions: required.extensions,
    payload: { signature: `0x${"ff".repeat(65)}`, authorization: { from: PAYER, to: TREASURY, value: "250000",
      validAfter: "0", validBefore: String(Math.floor(Date.now() / 1000) + 240), nonce: NONCE } } };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SKARL_TREASURY_ADDRESS", TREASURY);
  vi.stubEnv("CDP_API_KEY_ID", undefined);
  vi.stubEnv("CDP_API_KEY_SECRET", undefined);
  vi.stubEnv("X402_FACILITATOR_URL", undefined);
  events.length = 0;
  claimed = false;
  mocks.query.mockResolvedValue(structuredClone(sample));
  mocks.mutation.mockImplementation(async (reference, args) => {
    const name = getFunctionName(reference);
    events.push(name);
    if (name === "evidenceSales:claim") { claimed = true; return { attemptId: "synthetic-attempt", replayed: false, binding: sample.binding }; }
    if (name === "payments:recordTransaction") {
      expect(args.txHash).toBe(TX_HASH);
      expect(claimed).toBe(true);
      return;
    }
    if (name === "evidenceSales:confirm") return { observationId: "synthetic-observation", replayed: false };
    throw new Error(`Unexpected mutation ${name}`);
  });
  mocks.fetch.mockImplementation(async (input: string | Request, options?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.endsWith("/supported")) return Response.json({ kinds: [{ x402Version: 2, scheme: "exact", network: PAYMENT_NETWORK }],
      extensions: ["bazaar"], signers: {} });
    if (url.endsWith("/verify")) { events.push("facilitator:verify"); return Response.json({ isValid: true, payer: PAYER }); }
    if (url.endsWith("/settle")) {
      events.push("facilitator:settle");
      expect(claimed).toBe(true);
      expect(JSON.parse(options!.body as string).paymentRequirements).toMatchObject({ scheme: "exact", network: PAYMENT_NETWORK,
        amount: "250000", payTo: TREASURY, asset: USDC_ADDRESS });
      return Response.json({ success: true, transaction: TX_HASH, network: PAYMENT_NETWORK, payer: PAYER },
        { headers: { "EXTENSION-RESPONSES": extensionHeader } });
    }
    throw new Error(`Unexpected network request ${url}`);
  });
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.observeTransfer.mockImplementation(async () => { events.push("chain:observe"); throw new Error("receipt_not_available"); });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("paid evidence route", () => {
  it("offers anonymous exact 0.25 USDC discovery without private report or media", async () => {
    const { response, required } = await challenge();
    expect(required.accepts).toHaveLength(1);
    expect(required.accepts[0]).toMatchObject({ scheme: "exact", network: PAYMENT_NETWORK, asset: USDC_ADDRESS,
      amount: "250000", payTo: TREASURY, maxTimeoutSeconds: 300 });
    expect(required.extensions.bazaar.info.input).toMatchObject({ type: "http", method: "GET" });
    expect(required.extensions.bazaar.schema.properties.output).toBeTruthy();
    expect(response.headers.get("X-Skarl-Facilitator")).toBe("x402.org");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    const text = await response.text();
    expect(text).not.toContain(sample.storageUrl);
    expect(text).not.toContain(report.syntheticFixture);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("refuses unavailable/rejected samples before settlement or discovery", async () => {
    mocks.query.mockRejectedValue(new Error("sample_not_available"));
    const response = await GET(request(), context);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "sample_unavailable" });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("claims the durable nonce before settlement and withholds evidence pending receipt", async () => {
    const payment = await payload();
    const response = await GET(request(payment), context);
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toMatchObject({ sampleId: SAMPLE_ID, status: "settlement_pending", txHash: TX_HASH, settledBy: "x402.org" });
    expect(body).not.toHaveProperty("report");
    expect(body).not.toHaveProperty("media");
    expect(events).toEqual(["facilitator:verify", "evidenceSales:claim", "facilitator:settle", "payments:recordTransaction", "chain:observe"]);
    expect(mocks.mutation.mock.calls[0]?.[1]).toMatchObject({ sampleId: SAMPLE_ID, authorizationNonce: NONCE, amountAtomic: 250_000n, facilitator: "x402.org" });
  });

  it.each(["failure", "replay"])("never settles after a durable claim %s", async mode => {
    const payment = await payload();
    mocks.mutation.mockImplementation(async reference => {
      events.push(getFunctionName(reference));
      if (mode === "failure") throw new Error("claim_failed");
      return { attemptId: "previous-attempt", replayed: true, binding: sample.binding };
    });
    const response = await GET(request(payment), context);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(events).toEqual(["facilitator:verify", "evidenceSales:claim"]);
    expect(mocks.observeTransfer).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain(report.syntheticFixture);
  });

  it("releases stored evidence only after confirmed receipt and journal import, with an expiring proxy URL", async () => {
    const payment = await payload();
    mocks.observeTransfer.mockImplementation(async () => { events.push("chain:observe"); return observation; });
    const before = Date.now();
    const response = await GET(request(payment), context);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ sampleId: SAMPLE_ID, report, settlement: { status: "confirmed", txHash: TX_HASH, facilitator: "x402.org" },
      accountingTreatment: "funding_like_inflow" });
    expect(JSON.stringify(body)).not.toContain(sample.storageUrl);
    expect(body.media.expiresAt).toBeGreaterThanOrEqual(before + 300_000);
    expect(body.media.expiresAt).toBeLessThanOrEqual(Date.now() + 300_000);
    const mediaUrl = new URL(body.media.url);
    expect(mediaUrl.origin).toBe(new URL(ENDPOINT).origin);
    expect(mediaUrl.pathname).toBe(`/api/samples/${SAMPLE_ID}/media`);
    expect(verifyMediaToken(mediaUrl.searchParams.get("token")!, SAMPLE_ID, "synthetic-service-secret-at-least-32-characters").binding).toBe(sample.binding);
    expect(events.at(-1)).toBe("evidenceSales:confirm");
    expect(mocks.mutation.mock.calls.at(-1)?.[1]).toMatchObject({ attemptId: "synthetic-attempt", authorizationNonce: NONCE, observation });
    expect(response.headers.get("PAYMENT-RESPONSE")).toBeTruthy();
    const header = response.headers.get("EXTENSION-RESPONSES");
    expect(header).toBeTruthy();
    expect(JSON.parse(Buffer.from(header!, "base64").toString())).toEqual(extensions);
  });

  it("does not release evidence when receipt import fails", async () => {
    const payment = await payload();
    mocks.observeTransfer.mockResolvedValue(observation);
    const normalMutation = mocks.mutation.getMockImplementation()!;
    mocks.mutation.mockImplementation(async (reference, args) => {
      if (getFunctionName(reference) === "evidenceSales:confirm") throw new Error("journal_import_failed");
      return normalMutation(reference, args);
    });
    const response = await GET(request(payment), context);
    expect(response.status).toBe(202);
    expect(await response.text()).not.toContain(report.syntheticFixture);
  });

  it("attributes CDP settlement through the real CDP client with synthetic credentials", async () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    vi.stubEnv("CDP_API_KEY_ID", "synthetic-cdp-test-key");
    vi.stubEnv("CDP_API_KEY_SECRET", privateKey.export({ type: "pkcs8", format: "pem" }).toString());
    const payment = await payload();
    mocks.observeTransfer.mockResolvedValue(observation);
    const response = await GET(request(payment), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ settlement: { facilitator: "cdp", txHash: TX_HASH } });
    expect(response.headers.get("X-Skarl-Facilitator")).toBe("cdp");
    expect(mocks.fetch.mock.calls.every(([url]) => String(url).startsWith("https://api.cdp.coinbase.com/platform/v2/x402/"))).toBe(true);
    expect(mocks.mutation.mock.calls[0]?.[1]).toMatchObject({ facilitator: "cdp" });
  });

  it.each(["changed binding", "quarantined sample"])("retains settlement evidence when paid content is unavailable: %s", async state => {
    const payment = await payload();
    mocks.observeTransfer.mockResolvedValue(observation);
    mocks.query.mockResolvedValueOnce(structuredClone(sample));
    if (state === "changed binding") mocks.query.mockResolvedValueOnce({ ...sample, binding: "changed" });
    else mocks.query.mockRejectedValueOnce(new Error("sample_not_available"));
    const response = await GET(request(payment), context);
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({ status: "paid_content_unavailable", attemptId: "synthetic-attempt",
      settlement: { status: "confirmed", txHash: TX_HASH, facilitator: "x402.org" } });
    expect(body).not.toHaveProperty("report");
    expect(body).not.toHaveProperty("media");
    expect(JSON.stringify(body)).not.toContain(sample.storageUrl);
    expect(events.at(-1)).toBe("evidenceSales:confirm");
    expect(response.headers.get("PAYMENT-RESPONSE")).toBeTruthy();
    expect(response.headers.get("X-Skarl-Facilitator")).toBe("x402.org");
    const header = response.headers.get("EXTENSION-RESPONSES");
    expect(header).toBeTruthy();
    expect(JSON.parse(Buffer.from(header!, "base64").toString())).toEqual(extensions);
  });
});
