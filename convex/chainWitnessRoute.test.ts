// Simulated signed HTTP deliveries; no CDP, RPC or cloud Convex requests.
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { USDC_ADDRESS, PAYMENT_NETWORK } from "../packages/contracts/src/chain";
const mocks = vi.hoisted(() => ({ mutation: vi.fn(), observe: vi.fn() }));
vi.mock("../apps/web/lib/payments/server", () => ({
  api: { payments: { recordTransaction: "recordTransaction", confirmFunding: "confirmFunding", recordPayoutObservation: "recordPayoutObservation" } },
  paymentService: () => ({ db: { mutation: mocks.mutation }, serviceSecret: "synthetic-service-secret" }),
  treasuryAddress: () => `0x${"11".repeat(20)}`,
  paymentJson: (value: unknown, status = 200) => Response.json(value, { status }),
}));
vi.mock("../apps/web/lib/payments/chain", () => ({ observeTransfer: mocks.observe }));
import { POST, HEAD } from "../apps/web/app/api/webhooks/cdp/route";
const treasury = `0x${"11".repeat(20)}`, payer = `0x${"22".repeat(20)}`, txHash = `0x${"aa".repeat(32)}`;
const secret = "synthetic-webhook-secret";
const event = { id: "evt-fixture", type: "onchain.activity.detected", data: { network: "base-sepolia", event_name: "Transfer",
  contract_address: USDC_ADDRESS, transaction_hash: txHash, log_index: 3, parameters: { from: payer, to: treasury, value: "10000000" } } };
const receipt = { receiptId: "receipt-fixture", processed: false, replayed: false,
  candidates: [{ attemptId: "attempt-fixture", kind: "funding", authorizationNonce: "nonce-fixture" }] };
function request(body = JSON.stringify(event), signed = true) {
  const time = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret).update(`${time}.${body}`).digest("hex");
  return new Request("https://example.test/api/webhooks/cdp", { method: "POST", body,
    headers: signed ? { "x-webhook-signature": `t=${time},v0=${signature}` } : {} });
}
beforeEach(() => {
  vi.stubEnv("CDP_WEBHOOK_SECRET_TO", secret); vi.stubEnv("CDP_WEBHOOK_SECRET_FROM", ""); vi.stubEnv("CDP_WEBHOOK_SECRET", "");
  mocks.mutation.mockReset(); mocks.observe.mockReset();
  mocks.mutation.mockImplementation(async ref => typeof ref !== "string" && getFunctionName(ref) === "chainWitness:receiveWebhook" ? receipt : null);
  mocks.observe.mockResolvedValue({ network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, txHash, logIndex: 3,
    fromAddress: payer, toAddress: treasury, amountAtomic: 10000000n });
});
afterEach(() => vi.unstubAllEnvs());
it("HEAD is reachable before credentials; bad signatures never access the payment service", async () => {
  vi.stubEnv("CDP_WEBHOOK_SECRET_TO", ""); expect(HEAD().status).toBe(200);
  expect((await POST(request())).status).toBe(503);
  vi.stubEnv("CDP_WEBHOOK_SECRET_TO", secret);
  expect((await POST(request(undefined, false))).status).toBe(401);
  expect(mocks.mutation).not.toHaveBeenCalled();
});
it("verifies RPC nonce/log before recording and confirming through the existing path", async () => {
  expect((await POST(request())).status).toBe(200);
  expect(mocks.observe).toHaveBeenCalledWith(txHash, { fromAddress: payer, toAddress: treasury, amountAtomic: 10000000n }, "nonce-fixture");
  expect(mocks.mutation.mock.calls.map(([ref]) => typeof ref === "string" ? ref : getFunctionName(ref))).toEqual([
    "chainWitness:receiveWebhook", "recordTransaction", "confirmFunding", "chainWitness:finishWebhook",
  ]);
});
it("replays terminal receipts without RPC and persists unknown transfers without posting", async () => {
  mocks.mutation.mockResolvedValueOnce({ ...receipt, processed: true });
  expect(await (await POST(request())).json()).toMatchObject({ status: "processed", replayed: true });
  expect(mocks.observe).not.toHaveBeenCalled();
  mocks.mutation.mockResolvedValueOnce({ ...receipt, candidates: [] });
  expect(await (await POST(request())).json()).toEqual({ status: "unknown_transfer" });
  expect(mocks.mutation.mock.calls.at(-1)?.[1]).toMatchObject({ status: "unknown_transfer" });
  expect(mocks.observe).not.toHaveBeenCalled();
});
it("keeps transient RPC failures pending and never binds the webhook hash", async () => {
  mocks.observe.mockRejectedValue(new Error("rpc timeout"));
  expect((await POST(request())).status).toBe(503);
  expect(mocks.mutation).toHaveBeenCalledTimes(1);
});
it("mismatched stored funding nonce produces unknown_transfer without a hash binding", async () => {
  mocks.observe.mockRejectedValue(new Error("authorization_not_in_receipt"));
  expect(await (await POST(request())).json()).toEqual({ status: "unknown_transfer" });
  expect(mocks.mutation.mock.calls.map(([ref]) => getFunctionName(ref))).toEqual(["chainWitness:receiveWebhook", "chainWitness:finishWebhook"]);
});
it("rejects oversized and wrong-network events before durable ingress", async () => {
  expect((await POST(request("x".repeat(64001)))).status).toBe(413);
  expect((await POST(request(JSON.stringify({ ...event, data: { ...event.data, network: "base-mainnet" } })))).status).toBe(400);
  expect(mocks.mutation).not.toHaveBeenCalled();
});
