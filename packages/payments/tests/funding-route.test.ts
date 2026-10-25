import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { PAYMENT_NETWORK, SOLANA_PAYMENT_NETWORK, SOLANA_USDC_MINT, USDC_ADDRESS } from "@skarl/contracts/chain";
import { GET, POST } from "../../../apps/web/app/api/orders/[id]/fund/route";

// Exercises the actual dynamic Next route and real @x402/next/core middleware.
// Facilitator responses, Convex state and RPC receipts are deliberately mocked;
// these tests are not evidence of a valid signature or live chain settlement.
const mocks = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn(), observeTransfer: vi.fn(), parseSolana: vi.fn(), observeSolana: vi.fn(), fetch: vi.fn() }));
vi.mock("../../../apps/web/lib/payments/server", async importOriginal => {
  const actual = await importOriginal<typeof import("../../../apps/web/lib/payments/server")>();
  return { ...actual, paymentService: () => ({ serviceSecret: "synthetic-service-secret",
    db: { query: mocks.query, mutation: mocks.mutation } }) };
});
vi.mock("../../../apps/web/lib/payments/chain", () => ({ observeTransfer: mocks.observeTransfer }));

vi.mock("../src/solana", () => ({ parseSolanaFundingAuthorization: mocks.parseSolana, observeSolanaTransfer: mocks.observeSolana }));
const SOLANA_TREASURY = "5vrHh4EG9dChLEEAkgedPUEq2gjYj95822kSjsCXPshh";
const SOLANA_PAYER = "11111111111111111111111111111111";
const SOLANA_SIGNATURE = "A".repeat(88);
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
  intent: null | { network: string; status: string; buyerWalletAddress: string; recipientAddress: string; amountAtomic: bigint };
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
  vi.stubEnv("SKARL_SOLANA_TREASURY_ADDRESS", undefined);
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
      stored.intent = { network: args.network ?? PAYMENT_NETWORK, status: "settlement_pending", buyerWalletAddress: args.payerAddress,
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
      scheme: "exact", network: PAYMENT_NETWORK }, ...(process.env.SKARL_SOLANA_TREASURY_ADDRESS ? [{ x402Version: 2,
        scheme: "exact", network: SOLANA_PAYMENT_NETWORK, extra: { feePayer: SOLANA_PAYER } }] : [])], extensions: [], signers: {} });
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
  it.each([undefined, "", " ", "not-an-address", `0x${"0".repeat(40)}`])("refuses an unset/invalid treasury (%s) with actionable configuration guidance", async address => {
    vi.stubEnv("SKARL_TREASURY_ADDRESS", address);
    for (const handler of [GET, POST]) {
      const response = await handler(request(), context);
      expect(response.status).toBe(503);
      expect(response.headers.get("PAYMENT-REQUIRED")).toBeNull();
      expect(await response.json()).toEqual({ ok: false, error: "treasury_not_configured",
        message: "Set SKARL_TREASURY_ADDRESS in the web server environment to the treasury wallet receiving address before funding." });
    }
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("keeps Base available when optional Solana configuration is malformed", async () => {
    vi.stubEnv("SKARL_SOLANA_TREASURY_ADDRESS", "not-a-solana-address");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try { expect((await requirement()).accepts).toHaveLength(1); }
    finally { log.mockRestore(); }
  });

  it("quotes and challenges the 10 USDC v2 budget using integer strings", async () => {
    stored.order.budgetAtomic = 4n * 2_500_000n;
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ amountAtomic: "10000000", recipientAddress: TREASURY });
    expect((await requirement()).accepts[0]).toMatchObject({ amount: "10000000", payTo: TREASURY });
  });

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
    stored.intent = { network: PAYMENT_NETWORK, status: "settlement_pending", buyerWalletAddress: PAYER, recipientAddress: TREASURY, amountAtomic: 100_000_000n };
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
  it("aborts explicitly if durable nonce persistence throws (SDK hook errors alone do not stop settlement)", async () => {
    const payment = await signedPayload();
    mocks.mutation.mockRejectedValue(new Error("synthetic database failure"));
    const response = await POST(request(payment), context);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(events).not.toContain("facilitator:settle");
    expect(mocks.observeTransfer).not.toHaveBeenCalled();
  });

});


describe("optional Solana funding adapter", () => {
  beforeEach(() => {
    vi.stubEnv("SKARL_SOLANA_TREASURY_ADDRESS", SOLANA_TREASURY);
    mocks.parseSolana.mockResolvedValue({ payerAddress: SOLANA_PAYER, recipientAddress: SOLANA_TREASURY,
      amountAtomic: 100_000_000n, authorizationNonce: NONCE, validBefore: Date.now() + 60_000, logIndex: 2 });
    mocks.observeSolana.mockRejectedValue(new Error("solana_transaction_pending"));
    const baseFetch = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation(async (input: string | Request, options?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.endsWith("/verify")) { events.push("facilitator:verify"); return Response.json({ isValid: true, payer: SOLANA_PAYER }); }
      if (url.endsWith("/settle")) {
        events.push("facilitator:settle");
        expect(stored.attempt?._id).toBe("synthetic-attempt");
        expect(stored.intent?.network).toBe(SOLANA_PAYMENT_NETWORK);
        return Response.json({ success: true, transaction: SOLANA_SIGNATURE, network: SOLANA_PAYMENT_NETWORK, payer: SOLANA_PAYER });
      }
      return baseFetch(input, options);
    });
  });
  async function solanaPayload() {
    const challenge = await requirement();
    expect(challenge.accepts.map((a: { network: string }) => a.network)).toEqual([PAYMENT_NETWORK, SOLANA_PAYMENT_NETWORK]);
    expect(challenge.accepts[1]).toMatchObject({ asset: SOLANA_USDC_MINT, payTo: SOLANA_TREASURY, extra: { memo: `skarl:${ORDER_ID}`, feePayer: SOLANA_PAYER } });
    return { x402Version: 2, resource: challenge.resource, accepted: challenge.accepts[1], payload: { transaction: "mocked_signed_wire" } };
  }
  it("advertises Base first and reports both approved treasury quotes", async () => {
    await solanaPayload();
    const quote = await (await GET(request(), context)).json();
    expect(quote.rails).toEqual([{ network: PAYMENT_NETWORK, recipientAddress: TREASURY, asset: USDC_ADDRESS },
      { network: SOLANA_PAYMENT_NETWORK, recipientAddress: SOLANA_TREASURY, asset: SOLANA_USDC_MINT }]);
  });
  function rotateSupportedFeePayer(includeOriginal = true) {
    const previous = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation(async (input: string | Request, options?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.endsWith("/supported")) return Response.json({ kinds: [
        { x402Version: 2, scheme: "exact", network: PAYMENT_NETWORK },
        { x402Version: 2, scheme: "exact", network: SOLANA_PAYMENT_NETWORK, extra: { feePayer: SOLANA_TREASURY } },
      ], extensions: [], signers: { "solana:*": includeOriginal ? [SOLANA_PAYER, SOLANA_TREASURY] : [SOLANA_TREASURY] } });
      if (url.endsWith("/verify") || url.endsWith("/settle")) {
        const body = JSON.parse(options!.body as string);
        expect(body.paymentRequirements.extra.feePayer).toBe(SOLANA_PAYER);
        expect(body.paymentPayload.accepted.extra.feePayer).toBe(SOLANA_PAYER);
      }
      return previous(input, options);
    });
  }
  it("accepts a rotated quote fee payer still in the current supported set", async () => {
    const payload = await solanaPayload();
    rotateSupportedFeePayer();
    expect((await POST(request(payload), context)).status).toBe(202);
    expect(events).toEqual(["facilitator:verify", "payments:recordFundingAttempt", "facilitator:settle", "payments:recordTransaction"]);
    expect(mocks.parseSolana).toHaveBeenCalledWith(payload.payload, expect.objectContaining({ feePayer: SOLANA_PAYER }));
  });
  it("rejects a previously quoted fee payer absent from current support before verify or claim", async () => {
    const payload = await solanaPayload();
    rotateSupportedFeePayer(false);
    expect((await POST(request(payload), context)).status).toBe(402);
    expect(events).toEqual([]);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
  it.each([
    { network: "solana:wrong" }, { asset: SOLANA_TREASURY }, { payTo: SOLANA_PAYER },
    { amount: "1" }, { scheme: "upto" }, { maxTimeoutSeconds: 61 },
    { extra: { feePayer: SOLANA_PAYER, memo: "skarl:another-order" } },
    { extra: { feePayer: SOLANA_PAYER } },
    { extra: { feePayer: SOLANA_PAYER, memo: `skarl:${ORDER_ID}`, unexpected: true } },
  ])("rejects other quote mismatches even with a supported rotated fee payer: %j", async change => {
    const payload = await solanaPayload();
    rotateSupportedFeePayer();
    payload.accepted = { ...payload.accepted, ...change };
    expect((await POST(request(payload), context)).status).toBe(402);
    expect(events).toEqual([]);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
  it("still refuses an already claimed Solana authorization after rotation", async () => {
    const payload = await solanaPayload();
    rotateSupportedFeePayer();
    mocks.mutation.mockResolvedValue({ attemptId: "previous-attempt", replayed: true });
    expect((await POST(request(payload), context)).status).toBeGreaterThanOrEqual(400);
    expect(events).toEqual(["facilitator:verify"]);
    expect(mocks.observeSolana).not.toHaveBeenCalled();
  });
  it("claims the message before settlement, preserves signature case, and waits for RPC", async () => {
    const response = await POST(request(await solanaPayload()), context);
    expect(response.status).toBe(202);
    expect(stored.order.status).toBe("awaiting_funding");
    expect(stored.attempt?.txHash).toBe(SOLANA_SIGNATURE);
    expect(events).toEqual(["facilitator:verify", "payments:recordFundingAttempt", "facilitator:settle", "payments:recordTransaction"]);
    expect(mocks.observeTransfer).not.toHaveBeenCalled();
    expect(mocks.observeSolana).toHaveBeenCalledWith(SOLANA_SIGNATURE, { fromAddress: SOLANA_PAYER,
      toAddress: SOLANA_TREASURY, amountAtomic: 100_000_000n, authorizationNonce: NONCE, orderId: ORDER_ID });
  });
  it("does not call settlement when the signed Solana message fails validation", async () => {
    const payload = await solanaPayload();
    mocks.parseSolana.mockRejectedValue(new Error("wrong_order_memo"));
    expect((await POST(request(payload), context)).status).toBeGreaterThanOrEqual(400);
    expect(events).toEqual(["facilitator:verify"]);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
  it("confirms only after Solana RPC evidence and returns the rail explorer", async () => {
    const payload = await solanaPayload();
    mocks.observeSolana.mockResolvedValue({ network: SOLANA_PAYMENT_NETWORK, txHash: SOLANA_SIGNATURE });
    const response = await POST(request(payload), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ fundingStatus: "confirmed", network: SOLANA_PAYMENT_NETWORK,
      explorerUrl: `https://explorer.solana.com/tx/${SOLANA_SIGNATURE}?cluster=devnet` });
    expect(events.at(-1)).toBe("payments:confirmFunding");
  });
});
