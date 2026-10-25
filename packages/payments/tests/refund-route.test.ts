import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { POST } from "../../../apps/web/app/api/payments/refund/route";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "@skarl/contracts/chain";

const mocks = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn(), observeTransfer: vi.fn() }));
vi.mock("../../../apps/web/lib/payments/server", async importOriginal => {
  const actual = await importOriginal<typeof import("../../../apps/web/lib/payments/server")>();
  return { ...actual, paymentService: () => ({ serviceSecret: "synthetic-service-secret-at-least-32-characters",
    db: { query: mocks.query, mutation: mocks.mutation } }) };
});
vi.mock("../../../apps/web/lib/payments/chain", () => ({ observeTransfer: mocks.observeTransfer }));
const treasury = `0x${"2".repeat(40)}`, buyer = `0x${"1".repeat(40)}`, txHash = `0x${"a".repeat(64)}`;
const endpoint = "https://skarl.example/api/payments/refund";
const observation = { network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, txHash, logIndex: 0, fromAddress: treasury,
  toAddress: buyer, amountAtomic: 9_000_000n, blockNumber: 1n, blockHash: `0x${"b".repeat(64)}`, confirmations: 2, succeeded: true, observedAt: 1 };
const body = { intentId: "synthetic-refund-command", demoIdentity: "controller" };
function request(value: unknown, origin?: string) {
  return Object.assign(new Request(endpoint, { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { origin } : {}) },
    body: JSON.stringify(value) }), { nextUrl: new URL(endpoint) }) as Parameters<typeof POST>[0];
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("SKARL_TREASURY_ADDRESS", treasury);
  mocks.query.mockResolvedValue({ command: { recipientAddress: buyer, amountAtomic: 9_000_000n }, attempt: { _id: "synthetic-attempt", payerAddress: treasury } });
  mocks.mutation.mockImplementation(async reference => getFunctionName(reference) === "refunds:claim" ? { intentId: body.intentId,
    claimId: "synthetic-claim", recipientAddress: buyer, amountAtomic: "9000000", senderAddress: treasury, network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS } : { replayed: false });
  mocks.observeTransfer.mockResolvedValue(observation);
});
afterEach(() => vi.unstubAllEnvs());

describe("refund HTTP adapter with simulated RPC/Convex evidence", () => {
  it("claims stored command terms without sending or trusting supplied recipient/amount", async () => {
    const response = await POST(request({ ...body, action: "claim", senderAddress: treasury, recipientAddress: treasury, amountAtomic: "1" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ recipientAddress: buyer, amountAtomic: "9000000" });
    expect(mocks.mutation.mock.calls[0]![1]).toMatchObject({ commandId: body.intentId, treasuryAddress: treasury, senderAddress: treasury });
    expect(mocks.mutation.mock.calls[0]![1]).not.toHaveProperty("amountAtomic");
    expect(mocks.observeTransfer).not.toHaveBeenCalled();
  });
  it("records the submitted hash first, then obtains RPC evidence and confirms the exact transfer", async () => {
    const response = await POST(request({ ...body, action: "submitted", claimId: "synthetic-claim", txHash }));
    expect(response.status).toBe(200);
    expect(mocks.mutation.mock.calls.map(([ref]) => getFunctionName(ref))).toEqual(["payments:recordTransaction", "refunds:recordObservation"]);
    expect(mocks.observeTransfer).toHaveBeenCalledWith(txHash, { fromAddress: treasury, toAddress: buyer, amountAtomic: 9_000_000n });
    expect(mocks.mutation.mock.calls[1]![1]).toMatchObject({ attemptId: "synthetic-attempt", observation });
  });
  it("a pending RPC result stays reconciling and never resends", async () => {
    mocks.observeTransfer.mockRejectedValue(new Error("simulated pending receipt"));
    const response = await POST(request({ ...body, action: "submitted", claimId: "synthetic-claim", txHash }));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: "reconciling", txHash });
    expect(mocks.mutation.mock.calls.map(([ref]) => getFunctionName(ref))).toEqual(["payments:recordTransaction"]);
  });
  it("cross-origin requests are refused before touching the service", async () => {
    expect((await POST(request({ ...body, action: "claim", senderAddress: treasury }, "https://elsewhere.example"))).status).toBe(403);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
});
