import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "@skarl/contracts/chain";
import { POST } from "../../../apps/web/app/api/orders/[id]/fund/route";

// Exercises the actual dynamic Next route and real @x402/next/core middleware.
// Facilitator responses, Convex state and RPC receipts are deliberately mocked;
// these tests are not evidence of a valid signature or live chain settlement.
const mocks = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn(), observeTransfer: vi.fn(), fetch: vi.fn() }));
vi.mock("../../../apps/web/lib/payments/server", async importOriginal => {
  const actual = await importOriginal<typeof import("../../../apps/web/lib/payments/server")>();
  return { ...actual, paymentService: () => ({ serviceSecret: "synthetic-service-secret",
    db: { query: mocks.query, mutation: mocks.mutation } }) };
});
vi.mock("../../../apps/web/lib/payments/chain", () => ({ observeTransfer: mocks.observeTransfer }));

const TREASURY = `0x${"22".repeat(20)}`;
const PAYER = `0x${"11".repeat(20)}`;
const NONCE = `0x${"aa".repeat(32)}`;
const TX_HASH = `0x${"bb".repeat(32)}`;
const ORDER_ID = "dynamic-order-123";
const URL = `http://localhost:3000/api/orders/${ORDER_ID}/fund`;
const context = { params: Promise.resolve({ id: ORDER_ID }) };
const events: string[] = [];
let stored: {
  order: { _id: string; status: string; budgetAtomic: bigint; deadlineAt: number };
  intent: null | { status: string; buyerWalletAddress: string; recipientAddress: string; amountAtomic: bigint };
  attempt: null | { _id: string; txHash?: string };
};

function request(payment?: unknown) {
  // NextAdapter uses the standard Request surface plus NextRequest.nextUrl.
  // Route execution and the NextResponse implementation remain real.
  const value = new Request(URL, { method: "POST", headers: { Accept: "application/json",
    ...(payment ? { "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify(payment)).toString("base64") } : {}) } });
  return Object.assign(value, { nextUrl: new globalThis.URL(URL) }) as Parameters<typeof POST>[0];
}
async function requirement() {
  const response = await POST(request(), context);
  expect(response.status).toBe(402);
  const header = response.headers.get("PAYMENT-REQUIRED");
  expect(header).toBeTruthy();
  return JSON.parse(Buffer.from(header!, "base64").toString("utf8"));
}
async function signedPayload() {
  const challenge = await requirement();
  return { x402Version: 2, resource: challenge.resource, accepted: challenge.accepts[0], payload: {
    signature: `0x${"ff".repeat(65)}`, authorization: { from: PAYER, to: TREASURY, value: "100000000",
      validAfter: "0", validBefore: String(Math.floor(Date.now() / 1000) + 240), nonce: NONCE },
  } };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SKARL_TREASURY_ADDRESS", TREASURY);
  vi.stubEnv("CDP_API_KEY_ID", undefined);
  vi.stubEnv("CDP_API_KEY_SECRET", undefined);
  vi.stubEnv("X402_FACILITATOR_URL", undefined);
  events.length = 0;
  stored = { order: { _id: ORDER_ID, status: "awaiting_funding", budgetAtomic: 100_000_000n,
    deadlineAt: Date.now() + 60_000 }, intent: null, attempt: null };
  mocks.query.mockImplementation(async () => structuredClone(stored));
  mocks.mutation.mockImplementation(async (reference, args) => {
    const name = getFunctionName(reference);
    events.push(name);
    if (name === "payments:recordFundingAttempt") {
      stored.intent = { status: "settlement_pending", buyerWalletAddress: args.payerAddress,
        recipientAddress: args.recipientAddress, amountAtomic: args.amountAtomic };
      stored.attempt = { _id: "synthetic-attempt" };
      return { attemptId: "synthetic-attempt", replayed: false };
    }
    if (name === "payments:recordTransaction") {
      if (!stored.attempt) throw new Error("attempt must exist before settlement");
      stored.attempt.txHash = args.txHash;
      return;
    }
    if (name === "payments:confirmFunding") {
      stored.order.status = "funded";
      stored.intent!.status = "confirmed";
      return { observationId: "synthetic-observation", replayed: false };
    }
    throw new Error(`Unexpected mutation ${name}`);
  });
  mocks.fetch.mockImplementation(async (input: string | Request, options?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.endsWith("/supported")) return Response.json({ kinds: [{ x402Version: 2,
      scheme: "exact", network: PAYMENT_NETWORK }], extensions: [], signers: {} });
    if (url.endsWith("/verify")) {
      events.push("facilitator:verify");
      return Response.json({ isValid: true, payer: PAYER });
    }
    if (url.endsWith("/settle")) {
      events.push("facilitator:settle");
      expect(stored.attempt?._id).toBe("synthetic-attempt");
      expect(JSON.parse(options!.body as string).paymentRequirements).toMatchObject({
        scheme: "exact", network: PAYMENT_NETWORK, amount: "100000000", payTo: TREASURY, asset: USDC_ADDRESS });
      return Response.json({ success: true, transaction: TX_HASH, network: PAYMENT_NETWORK, payer: PAYER });
    }
    throw new Error(`Unexpected network request ${url}`);
  });
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.observeTransfer.mockImplementation(async () => { events.push("chain:observe"); throw new Error("receipt_not_available"); });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("actual POST /api/orders/[id]/fund x402 adapter", () => {
  it("protects the dynamic route with exact stored micro-USDC requirements", async () => {
    const challenge = await requirement();
    expect(challenge.x402Version).toBe(2);
    expect(challenge.resource.url).toBe(URL);
    expect(challenge.accepts).toHaveLength(1);
    expect(challenge.accepts[0]).toMatchObject({ scheme: "exact", network: PAYMENT_NETWORK,
      asset: USDC_ADDRESS, amount: "100000000", payTo: TREASURY, maxTimeoutSeconds: 300,
      extra: { name: "USDC", version: "2", assetTransferMethod: "eip3009" } });
    expect(mocks.mutation).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    expect(mocks.fetch.mock.calls[0]?.[0]).toBe("https://x402.org/facilitator/supported");
  });

  it("refuses a closed order before contacting the facilitator", async () => {
    stored.order.status = "closed";
    const response = await POST(request(), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "order_not_fundable" });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("returns pending status for an interrupted attempt without verifying or settling again", async () => {
    stored.intent = { status: "settlement_pending", buyerWalletAddress: PAYER, recipientAddress: TREASURY, amountAtomic: 100_000_000n };
    stored.attempt = { _id: "existing-attempt", txHash: TX_HASH };
    const response = await POST(request({ untrusted: "ignored on pending attempts" }), context);
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ attemptId: "existing-attempt", txHash: TX_HASH, fundingStatus: "settlement_pending" });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("persists nonce intent before settle and leaves signed payment pending until a receipt exists", async () => {
    const payment = await signedPayload();
    const response = await POST(request(payment), context);
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ fundingStatus: "settlement_pending", txHash: TX_HASH });
    expect(events).toEqual(["facilitator:verify", "payments:recordFundingAttempt", "facilitator:settle",
      "payments:recordTransaction", "chain:observe"]);
    expect(stored.order.status).toBe("awaiting_funding");
    expect(mocks.observeTransfer).toHaveBeenCalledWith(TX_HASH, { fromAddress: PAYER, toAddress: TREASURY, amountAtomic: 100_000_000n }, NONCE);
    expect(mocks.mutation.mock.calls.some(([reference]) => getFunctionName(reference) === "payments:confirmFunding")).toBe(false);
  });

  it("confirms only after RPC observation and carries the settlement receipt header", async () => {
    const payment = await signedPayload();
    const observation = { network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, txHash: TX_HASH, logIndex: 1,
      blockNumber: 100n, blockHash: `0x${"cc".repeat(32)}`, fromAddress: PAYER, toAddress: TREASURY,
      amountAtomic: 100_000_000n, confirmations: 2, succeeded: true, observedAt: Date.now() };
    mocks.observeTransfer.mockImplementation(async () => { events.push("chain:observe"); return observation; });
    const response = await POST(request(payment), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ fundingStatus: "confirmed", txHash: TX_HASH,
      explorerUrl: `https://sepolia.basescan.org/tx/${TX_HASH}` });
    expect(response.headers.get("PAYMENT-RESPONSE")).toBeTruthy();
    expect(events.at(-2)).toBe("chain:observe");
    expect(events.at(-1)).toBe("payments:confirmFunding");
    expect(mocks.mutation.mock.calls.at(-1)?.[1]).toMatchObject({ attemptId: "synthetic-attempt", authorizationNonce: NONCE, observation });
  });

  it("does not settle if nonce persistence refuses an already claimed authorization", async () => {
    const payment = await signedPayload();
    mocks.mutation.mockImplementation(async reference => {
      events.push(getFunctionName(reference));
      return { attemptId: "previous-attempt", replayed: true };
    });
    const response = await POST(request(payment), context);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(events).toEqual(["facilitator:verify", "payments:recordFundingAttempt"]);
    expect(mocks.observeTransfer).not.toHaveBeenCalled();
  });
});
