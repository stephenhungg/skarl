import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { applySpendControls, type CdpX402ClientConfig } from "@coinbase/cdp-sdk/x402";
import { x402Client } from "@x402/core/client";
import { PAYMENT_NETWORK, SOLANA_PAYMENT_NETWORK, SOLANA_USDC_MINT } from "@skarl/contracts/chain";
import type { PaymentRequirements } from "@x402/core/types";

const mocks = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  return { home: mkdtempSync(join(tmpdir(), "skarl-solana-buyer-test-")), fetch: vi.fn(), parser: vi.fn(), faucet: vi.fn(), balances: vi.fn(), signer: vi.fn(), rpc: vi.fn() };
});
vi.mock("node:os", async original => ({ ...await original<typeof import("node:os")>(), homedir: () => mocks.home }));
vi.mock("../src/solana.ts", () => ({ parseSolanaFundingAuthorization: mocks.parser, solanaRpc: () => mocks.rpc }));
vi.mock("@coinbase/cdp-sdk", () => ({ CdpClient: class {
  solana = { getOrCreateAccount: async () => ({ address: "11111111111111111111111111111112" }), listTokenBalances: mocks.balances, requestFaucet: mocks.faucet };
} }));
vi.mock("@coinbase/cdp-sdk/x402", async original => {
  const sdk = await original<typeof import("@coinbase/cdp-sdk/x402")>();
  const { x402Client } = await import("@x402/core/client");
  return { ...sdk, CdpX402Client: class extends x402Client {
    constructor(config: CdpX402ClientConfig) {
      super();
      this.setSpendControls(false).register("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", { scheme: "exact", createPaymentPayload: mocks.signer });
      sdk.applySpendControls(this, config.spendControls!);
    }
  } };
});
import { allowedSolanaFundingRequirement, fundOrderWithSolana, solanaAttemptPath, solanaBuyerClientConfig, solanaBuyerSpendControls, SolanaFileSpendStore } from "../src/cdp-solana-buyer";
import { fundOrder } from "../src/agent-fund";

const TREASURY = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const PAYER = "11111111111111111111111111111112";
const ORDER = "skarl-red-cup-demo-sol";
const CANONICAL = "canonical-order";
const RESOURCE = new URL(`http://localhost:3000/api/orders/${ORDER}/fund`);
const directory = join(mocks.home, ".config", "skarl");
const amount = 1_000_000n;
const requirement = (overrides = {}): PaymentRequirements => ({ scheme: "exact", network: SOLANA_PAYMENT_NETWORK, asset: SOLANA_USDC_MINT,
  payTo: TREASURY, amount: amount.toString(), maxTimeoutSeconds: 60, extra: { memo: `skarl:${CANONICAL}`, feePayer: PAYER }, ...overrides });
const challenge = (overrides = {}) => ({ x402Version: 2, resource: { url: RESOURCE.href, description: "simulated test funding", mimeType: "application/json" }, accepts: [requirement(overrides)] });
const spendStore = () => new SolanaFileSpendStore(join(directory, "test-spend.jsonl"));

beforeEach(() => {
  vi.resetAllMocks();
  rmSync(directory, { recursive: true, force: true });
  vi.stubEnv("SKARL_APP_URL", "http://localhost:3000");
  vi.stubEnv("SKARL_SOLANA_TREASURY_ADDRESS", TREASURY);
  for (const name of ["CDP_API_KEY_ID", "CDP_API_KEY_SECRET", "CDP_WALLET_SECRET"]) vi.stubEnv(name, "fixture-not-a-credential");
  vi.stubEnv("SKARL_CDP_MAX_CUMULATIVE_ATOMIC", "20000000");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.balances.mockResolvedValue({ balances: [{ token: { mintAddress: SOLANA_USDC_MINT }, amount: { amount: 2_000_000n, decimals: 6 } }] });
  mocks.signer.mockResolvedValue({ x402Version: 2, payload: { transaction: "simulated-not-a-transaction" } });
  mocks.parser.mockResolvedValue({ payerAddress: PAYER, authorizationNonce: `0x${"ab".repeat(32)}` });
  mocks.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url.endsWith("/reconcile")) return Response.json({ fundingStatus: "settlement_pending" });
    expect(request.url).toBe(RESOURCE.href);
    if (request.method === "GET") return Response.json({ orderId: CANONICAL, amountAtomic: amount.toString(), fundingStatus: "awaiting_payment",
      rails: [{ network: SOLANA_PAYMENT_NETWORK, asset: SOLANA_USDC_MINT, recipientAddress: TREASURY }] });
    const signature = request.headers.get("PAYMENT-SIGNATURE");
    if (!signature) return Response.json(challenge(), { status: 402, headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(challenge())).toString("base64") } });
    const payment = JSON.parse(Buffer.from(signature, "base64").toString("utf8"));
    expect(JSON.parse(readFileSync(solanaAttemptPath(RESOURCE), "utf8"))).toMatchObject({ status: "authorization_saved", paymentPayload: payment });
    return Response.json({ fundingStatus: "settlement_pending" }, { status: 202 });
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
afterAll(() => rmSync(mocks.home, { recursive: true, force: true }));

describe("Solana funding buyer boundaries (simulated CDP signer, no chain settlement)", () => {
  it("uses named Devnet account, disables Base schemes, and pins exact asset/payee/network", () => {
    const config = solanaBuyerClientConfig(TREASURY, amount, spendStore());
    expect(config.walletConfig).toEqual({ type: "eoa", accountName: "skarl-buyer-devnet" });
    expect(config.networkSchemes).toMatchObject([
      { network: "base-sepolia", scheme: { exact: false, upto: false, authCapture: false, batchSettlement: false } },
      { network: "solana-devnet", scheme: { exact: true, upto: false, authCapture: false, batchSettlement: false } },
    ]);
    expect(config.spendControls).toMatchObject({ allowedNetworks: [SOLANA_PAYMENT_NETWORK], allowedAssets: [SOLANA_USDC_MINT], allowedPayees: [TREASURY] });
  });
  it.each([
    { network: PAYMENT_NETWORK }, { asset: SOLANA_USDC_MINT.toLowerCase() }, { payTo: TREASURY.toLowerCase() }, { amount: "1000001" },
  ])("rejects unapproved quotes before signing: %j", async override => {
    const signer = vi.fn();
    const client = new x402Client().setSpendControls(false).register(SOLANA_PAYMENT_NETWORK, { scheme: "exact", createPaymentPayload: signer });
    applySpendControls(client, solanaBuyerSpendControls(TREASURY, amount));
    await expect(client.createPaymentPayload(challenge(override))).rejects.toThrow();
    expect(signer).not.toHaveBeenCalled();
  });
  it.each([{ extra: {} }, { extra: { memo: "skarl:another-order", feePayer: PAYER } }, { extra: { memo: `skarl:${CANONICAL}` } }])("rejects missing or mismatched memo/fee payer: %j", override => {
    expect(allowedSolanaFundingRequirement(requirement(override), TREASURY, amount, CANONICAL)).toBe(false);
  });
  it("saves validated authorization before dispatch and reconciles without paying on rerun", async () => {
    await fundOrder(["--rail", "solana", ORDER]);
    expect(mocks.signer).toHaveBeenCalledTimes(1);
    expect(mocks.faucet).not.toHaveBeenCalled();
    expect(mocks.parser).toHaveBeenCalledWith({ transaction: "simulated-not-a-transaction" }, { treasuryAddress: TREASURY, amountAtomic: amount, orderId: CANONICAL });
    await fundOrderWithSolana([ORDER]);
    expect(mocks.signer).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls.some(([input]) => String(input).endsWith("/reconcile"))).toBe(true);
  });
  it("never dispatches a payment rejected by local payload validation", async () => {
    mocks.parser.mockRejectedValue(new Error("wrong destination ATA"));
    await expect(fundOrderWithSolana([ORDER])).rejects.toThrow(/saved privately/);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(existsSync(solanaAttemptPath(RESOURCE))).toBe(true);
    await fundOrderWithSolana([ORDER]);
    expect(mocks.signer).toHaveBeenCalledTimes(1);
  });
  it("preserves case-sensitive spend reservations and enforces the cap after restart", async () => {
    vi.stubEnv("SKARL_CDP_MAX_CUMULATIVE_ATOMIC", amount.toString());
    await fundOrderWithSolana([ORDER]);
    const store = new SolanaFileSpendStore(join(directory, "cdp-solana-spend.jsonl"));
    expect(await store.load()).toMatchObject([{ atomicAmount: amount, asset: SOLANA_USDC_MINT, payTo: TREASURY }]);
    const signer = vi.fn();
    const client = new x402Client().setSpendControls(false).register(SOLANA_PAYMENT_NETWORK, { scheme: "exact", createPaymentPayload: signer });
    applySpendControls(client, solanaBuyerSpendControls(TREASURY, amount, store));
    await expect(client.createPaymentPayload(challenge())).rejects.toThrow(/cumulative spend/);
    expect(signer).not.toHaveBeenCalled();
  });
  it("retains uncertain reservations when signing fails", async () => {
    mocks.signer.mockRejectedValue(new Error("ambiguous transport"));
    await expect(fundOrderWithSolana([ORDER])).rejects.toThrow(/saved privately/);
    expect(await new SolanaFileSpendStore(join(directory, "cdp-solana-spend.jsonl")).load()).toHaveLength(1);
    await fundOrderWithSolana([ORDER]);
    expect(mocks.signer).toHaveBeenCalledTimes(1);
  });
  it("finalizes each faucet transaction before the next claim and requests no SOL", async () => {
    mocks.balances.mockResolvedValueOnce({ balances: [] });
    const events: string[] = [];
    mocks.faucet.mockImplementation(async ({ token }) => {
      expect(token).toBe("usdc");
      const signature = mocks.faucet.mock.calls.length === 1 ? "2".repeat(88) : "3".repeat(88);
      events.push(`claim:${signature}`);
      return { signature };
    });
    mocks.rpc.mockImplementation(async (method, [[signature]]) => {
      expect(method).toBe("getSignatureStatuses");
      events.push(`finalized:${signature}`);
      return { value: [{ err: null, confirmationStatus: "finalized" }] };
    });
    await fundOrderWithSolana([ORDER]);
    expect(events).toEqual([`claim:${"2".repeat(88)}`, `finalized:${"2".repeat(88)}`, `claim:${"3".repeat(88)}`, `finalized:${"3".repeat(88)}`]);
    expect(mocks.faucet.mock.calls[0]![0].idempotencyKey).not.toBe(mocks.faucet.mock.calls[1]![0].idempotencyKey);
  });
});
