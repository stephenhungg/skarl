import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, erc20Abi, type EIP1193Provider } from "viem";
import { PAYMENT_CHAIN_ID, PAYMENT_NETWORK, USDC_ADDRESS } from "@skarl/contracts/chain";
import { executeApprovedPayout, getPayoutRecovery, PayoutExecutionError, reportPayoutTransaction } from "../../../apps/web/lib/payments/payout";

// Real viem ABI encoding and wallet client, synthetic browser/provider/network.
// The wallet RPC returns a fixture hash; no signature or transfer occurs here.
const TREASURY = `0x${"22".repeat(20)}`;
const RECIPIENT = `0x${"33".repeat(20)}`;
const TX_HASH = `0x${"bb".repeat(32)}` as const;
const INTENT_ID = "synthetic-approved-intent";
const CLAIM_ID = "synthetic-server-issued-claim";
const storage = new Map<string, string>();
const rpc = vi.fn();
const http = vi.fn();
const provider = { request: rpc } as unknown as EIP1193Provider;
const options = { intentId: INTENT_ID, demoIdentity: "controller", provider };
let loseReport: boolean;
let claimedTerms: Record<string, unknown>;

beforeEach(() => {
  vi.resetAllMocks();
  storage.clear();
  loseReport = false;
  claimedTerms = { intentId: INTENT_ID, claimId: CLAIM_ID, senderAddress: TREASURY,
    recipientAddress: RECIPIENT, amountAtomic: "7500000", network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS };
  vi.stubGlobal("window", { localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  } });
  rpc.mockImplementation(async ({ method }: { method: string }) => {
    if (method === "eth_requestAccounts" || method === "eth_accounts") return [TREASURY];
    if (method === "wallet_switchEthereumChain") return null;
    if (method === "eth_chainId") return `0x${PAYMENT_CHAIN_ID.toString(16)}`;
    if (method === "eth_sendTransaction") return TX_HASH;
    throw new Error(`Unexpected wallet RPC ${method}`);
  });
  http.mockImplementation(async (_url: string, request: RequestInit) => {
    const body = JSON.parse(request.body as string);
    if (body.action === "claim") return Response.json(claimedTerms);
    if (body.action === "submitted") {
      if (loseReport) throw new Error("synthetic lost report response");
      return Response.json({ status: "reconciling", txHash: body.txHash });
    }
    throw new Error(`Unexpected payout action ${body.action}`);
  });
  vi.stubGlobal("fetch", http);
});
afterEach(() => { vi.unstubAllGlobals(); });

function sentTransactions() {
  return rpc.mock.calls.filter(([input]) => input.method === "eth_sendTransaction");
}
function reportBodies() {
  return http.mock.calls.map(([, request]) => JSON.parse(request.body as string));
}

describe("browser approved payout execution", () => {
  it("encodes only the approved recipient and exact micro-USDC amount on Base Sepolia", async () => {
    const result = await executeApprovedPayout(options);
    expect(result).toMatchObject({ intentId: INTENT_ID, claimId: CLAIM_ID, txHash: TX_HASH,
      explorerUrl: `https://sepolia.basescan.org/tx/${TX_HASH}`, observation: { status: "reconciling" } });
    expect(sentTransactions()).toHaveLength(1);
    const transaction = sentTransactions()[0]![0].params[0];
    expect(transaction.from.toLowerCase()).toBe(TREASURY);
    expect(transaction.to.toLowerCase()).toBe(USDC_ADDRESS.toLowerCase());
    const decoded = decodeFunctionData({ abi: erc20Abi, data: transaction.data });
    expect(decoded.functionName).toBe("transfer");
    expect(decoded.args).toEqual([RECIPIENT, 7_500_000n]);
    expect(rpc.mock.calls.some(([input]) => input.method === "wallet_switchEthereumChain" &&
      input.params[0].chainId === `0x${PAYMENT_CHAIN_ID.toString(16)}`)).toBe(true);
    expect(reportBodies()).toEqual([
      { action: "claim", intentId: INTENT_ID, demoIdentity: "controller", senderAddress: TREASURY },
      { action: "submitted", intentId: INTENT_ID, claimId: CLAIM_ID, demoIdentity: "controller", txHash: TX_HASH },
    ]);
    expect(getPayoutRecovery(INTENT_ID)).toEqual({ intentId: INTENT_ID, claimId: CLAIM_ID, txHash: TX_HASH });
  });

  it("keeps a lost-report transaction hash and retries reporting without another wallet send", async () => {
    loseReport = true;
    let failure: unknown;
    try { await executeApprovedPayout(options); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(PayoutExecutionError);
    expect((failure as PayoutExecutionError).recovery).toEqual({ intentId: INTENT_ID, claimId: CLAIM_ID, txHash: TX_HASH });
    expect(sentTransactions()).toHaveLength(1);
    await expect(executeApprovedPayout(options)).rejects.toThrow("already has an execution claim");
    expect(sentTransactions()).toHaveLength(1);
    loseReport = false;
    const recovered = await reportPayoutTransaction({ ...getPayoutRecovery(INTENT_ID)!, txHash: TX_HASH, demoIdentity: "controller" });
    expect(recovered.txHash).toBe(TX_HASH);
    expect(sentTransactions()).toHaveLength(1);
    expect(reportBodies().filter(body => body.action === "claim")).toHaveLength(1);
    expect(reportBodies().filter(body => body.action === "submitted").map(body => body.txHash)).toEqual([TX_HASH, TX_HASH]);
  });

  it("does not send or request another server claim for a locally recorded execution claim", async () => {
    storage.set(`skarl:payout:${INTENT_ID}`, JSON.stringify({ intentId: INTENT_ID, claimId: CLAIM_ID }));
    await expect(executeApprovedPayout(options)).rejects.toThrow("already has an execution claim");
    expect(rpc).not.toHaveBeenCalled();
    expect(http).not.toHaveBeenCalled();
  });

  it("does not ask the wallet to send if the server rejects an already dispatched intent", async () => {
    http.mockResolvedValue(Response.json({ ok: false, error: "payout_not_executable" }, { status: 409 }));
    await expect(executeApprovedPayout(options)).rejects.toThrow("payout_not_executable");
    expect(sentTransactions()).toHaveLength(0);
  });

  it.each(["wrong-network", "wrong-token", "invalid-amount"] as const)("refuses %s terms before signing", async kind => {
    if (kind === "wrong-network") claimedTerms.network = "eip155:8453";
    else if (kind === "wrong-token") claimedTerms.tokenAddress = RECIPIENT;
    else claimedTerms.amountAtomic = "7.5";
    await expect(executeApprovedPayout(options)).rejects.toThrow("Invalid stored payout terms");
    expect(sentTransactions()).toHaveLength(0);
  });
});

describe("buyer refunds reuse the approved browser transfer and recovery path", () => {
  it("routes both claim and observation to the refund authority and signs only the stored buyer/amount", async () => {
    const { executeApprovedRefund } = await import("../../../apps/web/lib/payments/refund");
    const result = await executeApprovedRefund({ commandId: INTENT_ID, demoIdentity: "controller", provider });
    expect(result.paymentKind).toBe("buyer_refund");
    expect(http.mock.calls.map(([url]) => url)).toEqual(["/api/payments/refund", "/api/payments/refund"]);
    const transaction = sentTransactions()[0]![0].params[0];
    expect(decodeFunctionData({ abi: erc20Abi, data: transaction.data }).args).toEqual([RECIPIENT, 7_500_000n]);
    expect(sentTransactions()).toHaveLength(1);
  });
  it("a lost refund report retains the claim/hash and reconciliation never signs a second transfer", async () => {
    const { executeApprovedRefund, reportRefundTransaction, getRefundRecovery } = await import("../../../apps/web/lib/payments/refund");
    loseReport = true;
    await expect(executeApprovedRefund({ commandId: INTENT_ID, demoIdentity: "controller", provider })).rejects.toBeInstanceOf(PayoutExecutionError);
    expect(getRefundRecovery(INTENT_ID)).toMatchObject({ claimId: CLAIM_ID, txHash: TX_HASH, paymentKind: "buyer_refund" });
    loseReport = false;
    await reportRefundTransaction({ commandId: INTENT_ID, claimId: CLAIM_ID, txHash: TX_HASH, demoIdentity: "controller" });
    await expect(executeApprovedRefund({ commandId: INTENT_ID, demoIdentity: "controller", provider })).rejects.toBeInstanceOf(PayoutExecutionError);
    expect(sentTransactions()).toHaveLength(1);
    expect(http.mock.calls.every(([url]) => url === "/api/payments/refund")).toBe(true);
  });
});
