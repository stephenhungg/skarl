import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PAYMENT_CHAIN_ID, PAYMENT_NETWORK, USDC_ADDRESS } from "@skarl/contracts/chain";

// Fixtures only: no real CDP signing, faucet, facilitator or chain transactions.
const mocks = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  return { home: mkdtempSync(join(tmpdir(), "skarl-cdp-flow-test-")), fetch: vi.fn(), getChainId: vi.fn(), readContract: vi.fn(),
    waitForTransactionReceipt: vi.fn(), getOrCreateAccount: vi.fn(), requestFaucet: vi.fn(), sign: vi.fn() };
});
vi.mock("node:os", async original => ({ ...await original<typeof import("node:os")>(), homedir: () => mocks.home }));
vi.mock("viem", async original => ({ ...await original<typeof import("viem")>(),
  createPublicClient: () => ({ getChainId: mocks.getChainId, readContract: mocks.readContract, waitForTransactionReceipt: mocks.waitForTransactionReceipt }) }));
vi.mock("@coinbase/cdp-sdk", () => ({ CdpClient: class { evm = { getOrCreateAccount: mocks.getOrCreateAccount, requestFaucet: mocks.requestFaucet }; } }));
vi.mock("@coinbase/cdp-sdk/x402", async original => {
  const actual = await original<typeof import("@coinbase/cdp-sdk/x402")>();
  const { x402Client } = await import("@x402/core/client");
  return { ...actual, CdpX402Client: class extends x402Client {
    constructor(config: import("@coinbase/cdp-sdk/x402").CdpX402ClientConfig) {
      super(); this.setSpendControls(false);
      this.register(PAYMENT_NETWORK, { scheme: "exact", createPaymentPayload: mocks.sign });
      actual.applySpendControls(this, config.spendControls!);
    }
  } };
});
import { attemptPath, CdpBuyerError, payWithCdp } from "../src/cdp-buyer";
const resource = new URL("http://localhost:3000/api/samples/sample-fixture/evidence");
const TREASURY = `0x${"22".repeat(20)}`;
const BUYER = `0x${"11".repeat(20)}`;
const TX = `0x${"aa".repeat(32)}`;
const dir = join(mocks.home, ".config", "skarl");
beforeEach(() => {
  vi.resetAllMocks(); rmSync(dir, { recursive: true, force: true });
  vi.stubEnv("SKARL_TREASURY_ADDRESS", TREASURY);
  vi.stubEnv("SKARL_CDP_MAX_CUMULATIVE_ATOMIC", "20000000");
  for (const key of ["CDP_API_KEY_ID", "CDP_API_KEY_SECRET", "CDP_WALLET_SECRET"]) vi.stubEnv(key, "test-fixture-only");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.getChainId.mockResolvedValue(PAYMENT_CHAIN_ID);
  mocks.getOrCreateAccount.mockResolvedValue({ address: BUYER });
  mocks.readContract.mockResolvedValue(1_000_000n);
  mocks.requestFaucet.mockResolvedValue({ transactionHash: TX });
  mocks.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
  mocks.sign.mockImplementation(async () => {
    expect(JSON.parse(readFileSync(attemptPath(resource), "utf8"))).toMatchObject({ status: "signing_started", payerAddress: BUYER });
    return { x402Version: 2, payload: { authorization: { from: BUYER, nonce: `0x${"bb".repeat(32)}` }, signature: "0xsimulated" } };
  });
  mocks.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    expect(request.url).toBe(resource.href);
    if (request.headers.get("PAYMENT-SIGNATURE")) {
      const saved = JSON.parse(readFileSync(attemptPath(resource), "utf8"));
      expect(saved.status).toBe("authorization_saved");
      expect(saved.paymentPayload.payload.authorization.from).toBe(BUYER);
      return Response.json({ status: "reconciling" }, { status: 202 });
    }
    const quote = { x402Version: 2, resource: { url: resource.href, description: "fixture", mimeType: "application/json" },
      accepts: [{ scheme: "exact", network: PAYMENT_NETWORK, asset: USDC_ADDRESS, payTo: TREASURY, amount: "250000", maxTimeoutSeconds: 300, extra: {} }] };
    return Response.json(quote, { status: 402, headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(quote)).toString("base64") } });
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
afterAll(() => { rmSync(mocks.home, { force: true, recursive: true }); });

describe("CDP buyer orchestration (simulated external services)", () => {
  it("saves intent before signing and authorization before dispatch, then refuses a second charge", async () => {
    expect((await payWithCdp(resource, 250_000n, { method: "GET" })).status).toBe(202);
    expect(mocks.getOrCreateAccount).toHaveBeenCalledWith({ name: "skarl-buyer-sepolia" });
    expect(mocks.sign).toHaveBeenCalledTimes(1);
    expect(mocks.requestFaucet).not.toHaveBeenCalled();
    await expect(payWithCdp(resource, 250_000n, { method: "GET" })).rejects.toThrow(/already exists/);
    expect(mocks.sign).toHaveBeenCalledTimes(1);
    expect(existsSync(join(dir, "cdp-buyer.lock"))).toBe(false);
  });
  it("uses the explicitly approved evidence wallet instead of the funding treasury", async () => {
    const revenue = `0x${"33".repeat(20)}`;
    const original = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await original(input, init);
      if (response.status !== 402) return response;
      const quote = await response.json();
      quote.accepts[0].payTo = revenue;
      return Response.json(quote, { status: 402, headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(quote)).toString("base64") } });
    });
    expect((await payWithCdp(resource, 250_000n, { method: "GET" }, revenue)).status).toBe(202);
    expect(JSON.parse(readFileSync(attemptPath(resource), "utf8")).recipientAddress).toBe(revenue);
  });
  it("refuses the treasury quote when evidence revenue is approved", async () => {
    await expect(payWithCdp(resource, 250_000n, { method: "GET" }, `0x${"33".repeat(20)}`)).rejects.toThrow();
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("requests USDC with durable idempotency when empty and rechecks balance", async () => {
    mocks.readContract.mockResolvedValueOnce(0n).mockResolvedValueOnce(1_000_000n);
    await payWithCdp(resource, 250_000n, { method: "GET" });
    expect(mocks.requestFaucet).toHaveBeenCalledWith({ address: BUYER, network: "base-sepolia", token: "usdc", idempotencyKey: expect.any(String) });
    expect(mocks.waitForTransactionReceipt).toHaveBeenCalledWith({ hash: TX, confirmations: 2, timeout: 60_000 });
    expect(mocks.readContract).toHaveBeenCalledTimes(2);
  });
  it("keeps uncertain settlement evidence and never retries on timeout", async () => {
    const original = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new Request(input, init).headers.has("PAYMENT-SIGNATURE")) throw new Error("sensitive SDK details must not escape");
      return original(input, init);
    });
    await expect(payWithCdp(resource, 250_000n, { method: "GET" })).rejects.toThrow("settlement may have occurred");
    expect(JSON.parse(readFileSync(attemptPath(resource), "utf8"))).toHaveProperty("authorizationNonce");
    await expect(payWithCdp(resource, 250_000n, { method: "GET" })).rejects.toBeInstanceOf(CdpBuyerError);
    expect(mocks.sign).toHaveBeenCalledTimes(1);
  });
  it("refuses a wrong RPC chain before signing or faucet use", async () => {
    mocks.getChainId.mockResolvedValue(8453);
    await expect(payWithCdp(resource, 250_000n, { method: "GET" })).rejects.toThrow("not Base Sepolia");
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.requestFaucet).not.toHaveBeenCalled();
    expect(existsSync(attemptPath(resource))).toBe(false);
  });
});
