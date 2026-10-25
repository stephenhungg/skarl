import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PAYMENT_CHAIN_ID, PAYMENT_NETWORK, USDC_ADDRESS } from "@skarl/contracts/chain";

// Use the real x402 client and local EIP-3009 signer with a disposable test key.
// HTTP/RPC are mocked: this does not demonstrate facilitator or chain settlement.
const mocks = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  return { home: mkdtempSync(join(tmpdir(), "skarl-buyer-test-")), fetch: vi.fn(),
    getChainId: vi.fn(), readContract: vi.fn(), getBalance: vi.fn() };
});
vi.mock("node:os", async importOriginal => ({
  ...await importOriginal<typeof import("node:os")>(), homedir: () => mocks.home,
}));
vi.mock("viem", async importOriginal => ({
  ...await importOriginal<typeof import("viem")>(),
  createPublicClient: () => ({ getChainId: mocks.getChainId, readContract: mocks.readContract, getBalance: mocks.getBalance }),
}));
import { fundOrder } from "../src/agent-fund";

const ORDER = "skarl-red-cup-demo-v2";
const RESOURCE = `http://localhost:3000/api/orders/${ORDER}/fund`;
const TREASURY = `0x${"22".repeat(20)}`;
const directory = join(mocks.home, ".config", "skarl");
const savedPath = join(directory, `funding-${ORDER}.json`);
const quote = { amountAtomic: "10000000", recipientAddress: TREASURY, fundingStatus: "awaiting_payment" };
const treasuryError = () => Response.json({ ok: false, error: "treasury_not_configured", message: "Untrusted server text must not be echoed." }, { status: 503 });

beforeEach(() => {
  vi.resetAllMocks();
  rmSync(directory, { force: true, recursive: true });
  vi.stubEnv("SKARL_APP_URL", "http://localhost:3000");
  vi.stubEnv("SKARL_TREASURY_ADDRESS", undefined); // The receiving address is configured on the server, not the buyer.
  for (const name of ["PAYMENT_NETWORK", "SKARL_PAYMENT_NETWORK", "SKARL_BUYER_NETWORK", "PAYMENT_CHAIN_ID", "SKARL_PAYMENT_CHAIN_ID"]) vi.stubEnv(name, undefined);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.getChainId.mockResolvedValue(PAYMENT_CHAIN_ID);
  mocks.readContract.mockResolvedValue(20_000_000n);
  mocks.getBalance.mockResolvedValue(0n);
  mocks.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    expect(request.url).toBe(RESOURCE);
    expect(request.headers.has("x-skarl-demo-identity")).toBe(false);
    if (request.method === "GET") return Response.json(quote);
    const signature = request.headers.get("PAYMENT-SIGNATURE");
    if (!signature) {
      const challenge = { x402Version: 2, resource: { url: RESOURCE, description: "Test funding", mimeType: "application/json" },
        accepts: [{ scheme: "exact", network: PAYMENT_NETWORK, asset: USDC_ADDRESS, amount: "10000000",
          payTo: TREASURY, maxTimeoutSeconds: 300, extra: { name: "USDC", version: "2", assetTransferMethod: "eip3009" } }] };
      return Response.json(challenge, { status: 402, headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(challenge)).toString("base64") } });
    }
    const payment = JSON.parse(Buffer.from(signature, "base64").toString("utf8"));
    expect(payment.payload.authorization).toMatchObject({ to: TREASURY, value: "10000000" });
    expect(payment.payload.signature).toMatch(/^0x[0-9a-f]+$/i);
    // The durable authorization must exist before sending the signed request.
    expect(JSON.parse(readFileSync(savedPath, "utf8")).paymentPayload).toEqual(payment);
    return Response.json({ fundingStatus: "settlement_pending" }, { status: 202 });
  });
});
afterEach(() => { process.exitCode = 0; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
afterAll(() => { rmSync(mocks.home, { force: true, recursive: true }); });

describe("buyer funding prerequisites", () => {
  it.each([
    { flags: [], expected: { enabled: true, maxPerClipAtomic: "1000000", requireAllChecks: true } },
    { flags: ["--no-auto-pay", "--auto-pay-cap", "500000"], expected: { enabled: false, maxPerClipAtomic: "500000", requireAllChecks: true } },
  ])("creates the buyer rule before funding: $expected", async ({ flags, expected }) => {
    mocks.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.url.endsWith("/api/orders")) {
        expect(request.method).toBe("POST");
        expect(await request.json()).toEqual({ autoPay: expected });
        return Response.json({ orderId: "new-policy-order" }, { status: 201 });
      }
      expect(request.url).toBe("http://localhost:3000/api/orders/new-policy-order/fund");
      return Response.json({ fundingStatus: "confirmed" });
    });
    await fundOrder(["--create", ...flags]);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.getChainId).not.toHaveBeenCalled();
  });
  it.each(["0", "1.5", "9223372036854775808"])("refuses invalid buyer cap %s before creating or funding", async cap => {
    await expect(fundOrder(["--create", "--auto-pay-cap", cap])).rejects.toThrow("positive integer micro-USDC");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("defaults to v2 and signs 10 USDC with 20 USDC and zero buyer ETH without reading ETH", async () => {
    await fundOrder([]);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(mocks.getBalance).not.toHaveBeenCalled();
    expect(mocks.readContract).toHaveBeenCalledWith(expect.objectContaining({ address: USDC_ADDRESS, functionName: "balanceOf" }));
    expect(JSON.parse(readFileSync(savedPath, "utf8"))).toMatchObject({ orderId: ORDER, amountAtomic: "10000000", recipientAddress: TREASURY });
  });

  it("still refuses insufficient USDC before signing or posting", async () => {
    mocks.readContract.mockResolvedValue(9_999_999n);
    await fundOrder([]);
    expect(process.exitCode).toBe(2);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.getBalance).not.toHaveBeenCalled();
    expect(existsSync(savedPath)).toBe(false);
  });

  it("explains missing server treasury configuration before RPC, signing or posting", async () => {
    mocks.fetch.mockResolvedValue(treasuryError());
    await expect(fundOrder([])).rejects.toThrow("Set SKARL_TREASURY_ADDRESS in the web server environment to the treasury wallet receiving address before funding.");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.getChainId).not.toHaveBeenCalled();
    expect(existsSync(savedPath)).toBe(false);
  });

  it("also explains a quote missing its receiving address", async () => {
    mocks.fetch.mockResolvedValue(Response.json({ ...quote, recipientAddress: "" }));
    await expect(fundOrder([])).rejects.toThrow("Set SKARL_TREASURY_ADDRESS");
    expect(mocks.getChainId).not.toHaveBeenCalled();
    expect(existsSync(savedPath)).toBe(false);
  });

  it("preserves configuration guidance if the treasury is unset between GET and unsigned POST", async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json(quote)).mockResolvedValueOnce(treasuryError());
    await expect(fundOrder([])).rejects.toThrow("Set SKARL_TREASURY_ADDRESS");
    expect(existsSync(savedPath)).toBe(false);
  });
});
