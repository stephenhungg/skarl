// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, parseAbiParameters, zeroAddress, zeroHash } from "viem";
import { EAS_ABI, EAS_ADDRESS, EAS_SCHEMA_UID, encodeAttestation, type AttestationFields } from "./lib/eas";
import { executeAttestation, IDEMPOTENCY_RETRY_MS, type EasIntent } from "./lib/easSender";

const ADDRESS = `0x${"1".repeat(40)}` as const;
const TX = `0x${"2".repeat(64)}` as const;
const UID = `0x${"3".repeat(64)}` as const;
const OTHER = `0x${"9".repeat(40)}` as const;
const POLICY = "synthetic-account-policy";
const REQUEST = "00000000-0000-4000-8000-000000000001";
const fields: AttestationFields = {
  reportHash: `0x${"a".repeat(64)}`, sourceSha256: `0x${"b".repeat(64)}`, rubricHash: `0x${"c".repeat(64)}`,
  pipelineVersion: "red-cup-evidence-1.1", videoModel: "gemini-4-argon", recommendation: "needs_review", verifiedAt: 1792922400, licensed: false,
};
// No live account, key, RPC, model or transaction is used by these injected transport tests.
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-25T10:00:00Z")); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
function fixture(overrides: Partial<EasIntent> = {}) {
  const intent: EasIntent = { attestor: ADDRESS, fields, requestId: REQUEST, schemaUid: EAS_SCHEMA_UID, ...overrides };
  const calls: string[] = [];
  const stored = { uid: UID, schema: EAS_SCHEMA_UID, attester: ADDRESS, recipient: zeroAddress, refUID: zeroHash,
    revocable: true, revocationTime: 0n, expirationTime: 0n, time: 100n, data: encodeAttestation(fields) };
  const receipt = { transactionHash: TX, status: "success", to: EAS_ADDRESS, from: ADDRESS,
    logs: [{ address: EAS_ADDRESS, logIndex: 0,
      data: encodeAbiParameters(parseAbiParameters("bytes32 uid"), [UID]),
      topics: encodeEventTopics({ abi: EAS_ABI, eventName: "Attested", args: { recipient: zeroAddress, attester: ADDRESS, schemaUID: EAS_SCHEMA_UID } }),
    }] };
  const client = {
    getChainId: vi.fn(async () => 84532), getBlockNumber: vi.fn(async () => 100n), getLogs: vi.fn(async () => [] as unknown[]),
    readContract: vi.fn(async () => stored), waitForTransactionReceipt: vi.fn(async () => receipt),
  };
  const cdp = { evm: { getAccount: vi.fn(async () => ({ address: ADDRESS, policies: [POLICY] })),
    sendTransaction: vi.fn(async () => { calls.push("send"); return { transactionHash: TX }; }),
  }, policies: {
    getPolicyById: vi.fn(async () => ({ id: POLICY, status: "active", scope: "account" })),
    listPolicies: vi.fn(async (): Promise<{ policies: { status: string; rules: { action: string; operation: string }[] }[]; nextPageToken?: string }> => ({ policies: [] })),
  } };
  const markSending = vi.fn(async (startBlock: string) => { calls.push("mark"); intent.firstSendAt ??= Date.now(); intent.startBlock ??= startBlock; });
  const recordTransaction = vi.fn(async (hash: string) => { calls.push("record"); intent.txHash = hash; });
  const run = () => executeAttestation({ intent, cdp: cdp as unknown as Parameters<typeof executeAttestation>[0]["cdp"],
    client: client as unknown as Parameters<typeof executeAttestation>[0]["client"], policyId: POLICY, markSending, recordTransaction });
  return { intent, calls, stored, receipt, client, cdp, markSending, recordTransaction, run };
}

describe("durable CDP attestation execution", () => {
  it("persists send intent before CDP, records the tx before waiting, and verifies the stored EAS payload", async () => {
    const f = fixture();
    f.client.waitForTransactionReceipt.mockImplementation(async () => { f.calls.push("receipt"); return f.receipt; });
    expect(await f.run()).toEqual({ uid: UID, txHash: TX, logIndex: 0 });
    expect(f.calls).toEqual(["mark", "send", "record", "receipt"]);
    expect(f.cdp.evm.sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ address: ADDRESS, network: "base-sepolia", idempotencyKey: REQUEST,
      transaction: expect.objectContaining({ to: EAS_ADDRESS, value: 0n }) }));
    expect(f.client.waitForTransactionReceipt).toHaveBeenCalledWith({ hash: TX, confirmations: 2, timeout: 45_000 });
    expect(f.client.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "getAttestation", args: [UID] }));
  });
  it("never sends if the durable send marker cannot be committed", async () => {
    const f = fixture();
    f.markSending.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(f.run()).rejects.toThrow("database unavailable");
    expect(f.cdp.evm.sendTransaction).not.toHaveBeenCalled();
  });
  it("reuses the same request identity after an unknown CDP outcome and scans for a prior on-chain result first", async () => {
    const f = fixture();
    f.cdp.evm.sendTransaction.mockImplementationOnce(async () => { throw new Error("response lost after acceptance"); });
    await expect(f.run()).rejects.toThrow("response lost");
    expect(f.intent.firstSendAt).toBeDefined(); expect(f.intent.startBlock).toBe("100"); expect(f.intent.txHash).toBeUndefined();
    vi.setSystemTime(Date.now() + 120_000);
    expect(await f.run()).toEqual({ uid: UID, txHash: TX, logIndex: 0 });
    expect(f.client.getLogs).toHaveBeenCalledOnce();
    expect(f.cdp.evm.sendTransaction.mock.calls.map(([arg]) => arg.idempotencyKey)).toEqual([REQUEST, REQUEST]);
  });
  it("recovers a matching chain event after a lost tx hash and does not resend", async () => {
    const f = fixture({ firstSendAt: Date.now() - 120_000, startBlock: "99" });
    f.client.getLogs.mockResolvedValueOnce([{ args: { uid: UID }, transactionHash: TX }]);
    expect(await f.run()).toEqual({ uid: UID, txHash: TX, logIndex: 0 });
    expect(f.recordTransaction).toHaveBeenCalledWith(TX);
    expect(f.cdp.evm.sendTransaction).not.toHaveBeenCalled();
    expect(f.cdp.evm.getAccount).not.toHaveBeenCalled();
  });
  it("reconciles an existing tx without accessing the wallet or creating another transaction", async () => {
    const f = fixture({ txHash: TX });
    expect(await f.run()).toEqual({ uid: UID, txHash: TX, logIndex: 0 });
    expect(f.cdp.evm.sendTransaction).not.toHaveBeenCalled();
    expect(f.cdp.evm.getAccount).not.toHaveBeenCalled();
    expect(f.markSending).not.toHaveBeenCalled();
  });
  it("does not resend after the bounded CDP idempotency window", async () => {
    const f = fixture({ firstSendAt: Date.now() - IDEMPOTENCY_RETRY_MS, startBlock: "100" });
    await expect(f.run()).rejects.toThrow("attestation_reconciliation_required");
    expect(f.cdp.evm.sendTransaction).not.toHaveBeenCalled();
    expect(f.markSending).not.toHaveBeenCalled();
  });
  it("bounds recovery scanning and requires reconciliation instead of blindly resending", async () => {
    const f = fixture({ firstSendAt: Date.now() - 1000, startBlock: "1" });
    f.client.getBlockNumber.mockResolvedValueOnce(50_002n);
    await expect(f.run()).rejects.toThrow("attestation_reconciliation_required");
    expect(f.client.getLogs).not.toHaveBeenCalled(); expect(f.cdp.evm.sendTransaction).not.toHaveBeenCalled();
  });
  it("does not infer confirmation from a successful CDP response when receipt waiting fails", async () => {
    const f = fixture(); f.client.waitForTransactionReceipt.mockRejectedValueOnce(new Error("RPC timeout"));
    await expect(f.run()).rejects.toThrow("RPC timeout");
    expect(f.intent.txHash).toBe(TX);
    expect(f.recordTransaction).toHaveBeenCalledWith(TX);
    expect(await f.run()).toEqual({ uid: UID, txHash: TX, logIndex: 0 });
    expect(f.cdp.evm.sendTransaction).toHaveBeenCalledOnce();
  });
  it.each(["network", "schema", "account", "policy"])("rejects a changed %s before sending", async variant => {
    const f = fixture();
    if (variant === "network") f.client.getChainId.mockResolvedValue(1);
    if (variant === "schema") f.intent.schemaUid = `0x${"f".repeat(64)}`;
    if (variant === "account") f.cdp.evm.getAccount.mockResolvedValue({ address: OTHER, policies: [POLICY] } as never);
    if (variant === "policy") f.cdp.evm.getAccount.mockResolvedValue({ address: ADDRESS, policies: [] });
    await expect(f.run()).rejects.toThrow(/mismatch/);
    expect(f.cdp.evm.sendTransaction).not.toHaveBeenCalled();
  });
  it("fails closed on a repriced/replaced transaction receipt without linking the original hash", async () => {
    const f = fixture({ txHash: TX });
    f.receipt.transactionHash = `0x${"f".repeat(64)}`;
    await expect(f.run()).rejects.toThrow("attestation_transaction_replaced");
    expect(f.cdp.evm.sendTransaction).not.toHaveBeenCalled();
  });
  it.each(["paused", "project"])("refuses %s account-policy configuration before creating a send intent", async mode => {
    const f = fixture();
    f.cdp.policies.getPolicyById.mockResolvedValue({ id: POLICY, status: mode === "paused" ? "paused" : "active", scope: mode === "project" ? "project" : "account" });
    await expect(f.run()).rejects.toThrow("attestation_account_policy_inactive");
    expect(f.markSending).not.toHaveBeenCalled(); expect(f.cdp.evm.sendTransaction).not.toHaveBeenCalled();
  });
  it.each(["active", "paused"])("rejects a %s project accept rule found on a later policy page", async status => {
    const f = fixture();
    f.cdp.policies.listPolicies.mockResolvedValueOnce({ policies: [], nextPageToken: "page-2" })
      .mockResolvedValueOnce({ policies: [{ status, rules: [{ action: "accept", operation: "signEvmHash" }] }] });
    await expect(f.run()).rejects.toThrow("attestation_project_policy_override");
    expect(f.cdp.policies.listPolicies).toHaveBeenLastCalledWith({ scope: "project", pageSize: 100, pageToken: "page-2" });
    expect(f.markSending).not.toHaveBeenCalled(); expect(f.cdp.evm.sendTransaction).not.toHaveBeenCalled();
  });
  it.each(["reverted", "wrong_target", "wrong_sender", "wrong_data", "revoked", "missing_event"])("rejects %s chain evidence", async variant => {
    const f = fixture({ txHash: TX });
    if (variant === "reverted") f.receipt.status = "reverted";
    if (variant === "wrong_target") f.receipt.to = OTHER as never;
    if (variant === "wrong_sender") f.receipt.from = OTHER as never;
    if (variant === "wrong_data") f.stored.data = "0x";
    if (variant === "revoked") f.stored.revocationTime = 1n;
    if (variant === "missing_event") f.receipt.logs = [];
    await expect(f.run()).rejects.toThrow(/attestation_(transaction_reverted|receipt_mismatch|data_mismatch|event_missing)/);
    expect(f.cdp.evm.sendTransaction).not.toHaveBeenCalled();
  });
});
