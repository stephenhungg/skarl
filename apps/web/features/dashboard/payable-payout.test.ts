import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EIP1193Provider } from "viem";
import type { Id } from "../../../../convex/_generated/dataModel";
import { executeApprovedPayout, PayoutExecutionError, reportPayoutTransaction } from "../../lib/payments/payout";
import { PAYMENT_CHAIN_ID, PAYMENT_NETWORK, USDC_ADDRESS } from "@skarl/contracts/chain";
import { executePayablePayout, getPayablePayoutRecovery } from "./payable-payout";

// Real transfer client/viem encoding; synthetic wallet and HTTP authority. No live signing.
const DOCUMENT_ID = "mp7syntheticconvexdocument12345678" as Id<"paymentIntents">;
const BUSINESS_ID = "payout:synthetic-payable-business-event";
const intent = { _id: DOCUMENT_ID, intentId: BUSINESS_ID };
const TREASURY = `0x${"2".repeat(40)}`, RECIPIENT = `0x${"3".repeat(40)}`;
const TX_HASH = `0x${"a".repeat(64)}` as const, CLAIM_ID = "synthetic-doc-bound-claim";
const rpc = vi.fn(), http = vi.fn(), storage = new Map<string, string>();
const provider = { request: rpc } as unknown as EIP1193Provider;
const execute = (intentId: Id<"paymentIntents">) => executeApprovedPayout({ intentId, demoIdentity: "controller", provider });
const sends = () => rpc.mock.calls.filter(([input]) => input.method === "eth_sendTransaction");
const requests = () => http.mock.calls.map(([, options]) => JSON.parse(options.body as string));

beforeEach(() => {
  vi.resetAllMocks(); storage.clear();
  vi.stubGlobal("window", { localStorage: { getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); } } });
  rpc.mockImplementation(async ({ method }: { method: string }) => {
    if (method === "eth_requestAccounts" || method === "eth_accounts") return [TREASURY];
    if (method === "wallet_switchEthereumChain") return null;
    if (method === "eth_chainId") return `0x${PAYMENT_CHAIN_ID.toString(16)}`;
    if (method === "eth_sendTransaction") return TX_HASH;
    throw new Error(`unexpected wallet method ${method}`);
  });
  http.mockImplementation(async (_url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    // The production authority also requires a paymentIntents document ID.
    if (body.intentId !== DOCUMENT_ID) return Response.json({ ok: false, error: "invalid_intent_document" }, { status: 409 });
    if (body.action === "claim") return Response.json({ intentId: DOCUMENT_ID, claimId: CLAIM_ID, senderAddress: TREASURY,
      recipientAddress: RECIPIENT, amountAtomic: "1875000", network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS });
    return Response.json({ status: "reconciling", txHash: body.txHash });
  });
  vi.stubGlobal("fetch", http);
});
afterEach(() => vi.unstubAllGlobals());

describe("dashboard payout document-ID boundary", () => {
  it("sends and stores the Convex document ID when the business ID differs, preserving authenticated browser requests", async () => {
    await executePayablePayout(intent, execute);
    expect(requests().map(body => body.intentId)).toEqual([DOCUMENT_ID, DOCUMENT_ID]);
    expect(requests().map(body => body.demoIdentity)).toEqual(["controller", "controller"]);
    for (const [, options] of http.mock.calls) expect(options.credentials).toBe("same-origin");
    const saved = JSON.parse(storage.get(`skarl:payout:${DOCUMENT_ID}`)!);
    expect(saved).toEqual({ intentId: DOCUMENT_ID, claimId: CLAIM_ID, txHash: TX_HASH });
    expect(storage.has(`skarl:payout:${BUSINESS_ID}`)).toBe(false);
    expect(sends()).toHaveLength(1);
  });

  it("recovers the document-bound saved claim, ignoring stale in-memory recovery from a different intent", async () => {
    await executePayablePayout(intent, execute);
    const recovered = getPayablePayoutRecovery(intent, { intentId: BUSINESS_ID, claimId: "stale-other-claim", txHash: TX_HASH });
    expect(recovered).toMatchObject({ intentId: DOCUMENT_ID, claimId: CLAIM_ID, txHash: TX_HASH });
    await reportPayoutTransaction({ ...recovered!, txHash: TX_HASH, demoIdentity: "controller" });
    expect(requests().at(-1)).toMatchObject({ action: "submitted", intentId: DOCUMENT_ID, claimId: CLAIM_ID });
    expect(sends()).toHaveLength(1);
  });

  it("does not substitute a business-ID storage record for the current document's claim", () => {
    storage.set(`skarl:payout:${BUSINESS_ID}`, JSON.stringify({ intentId: BUSINESS_ID, claimId: "legacy-business-claim", txHash: TX_HASH }));
    expect(getPayablePayoutRecovery(intent)).toBeNull();
    expect(http).not.toHaveBeenCalled(); expect(sends()).toHaveLength(0);
  });

  it("requires an intent document rather than accepting a bare business ID", () => {
    // @ts-expect-error A business identifier is not an intent document.
    expect(() => executePayablePayout(BUSINESS_ID, execute)).toThrow("intent document is required");
    expect(http).not.toHaveBeenCalled(); expect(sends()).toHaveLength(0);
  });

  it("the actual client cannot execute a business ID rejected by the payment authority", async () => {
    await expect(executeApprovedPayout({ intentId: BUSINESS_ID, demoIdentity: "controller", provider }))
      .rejects.toThrow("invalid_intent_document");
    expect(requests()[0]).toMatchObject({ action: "claim", intentId: BUSINESS_ID });
    expect(sends()).toHaveLength(0);
    expect(storage.size).toBe(0);
  });

  it("surfaces corrupt recovery and refuses a refund-kind claim without reporting another transfer", () => {
    storage.set(`skarl:payout:${DOCUMENT_ID}`, "{invalid");
    expect(() => getPayablePayoutRecovery(intent)).toThrow();
    storage.clear();
    expect(() => getPayablePayoutRecovery(intent, { intentId: DOCUMENT_ID, claimId: CLAIM_ID, txHash: TX_HASH, paymentKind: "buyer_refund" }))
      .toThrow(PayoutExecutionError);
    expect(http).not.toHaveBeenCalled(); expect(sends()).toHaveLength(0);
  });
});
