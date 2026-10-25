import type { CdpClient } from "@coinbase/cdp-sdk";
import { createPublicClient, decodeEventLog, http, zeroAddress, zeroHash, type Hash, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import { ATTESTOR_NAME, EAS_ABI, EAS_ADDRESS, EAS_CHAIN_ID, EAS_NETWORK, EAS_SCHEMA_UID,
  attestTransaction, encodeAttestation, type AttestationFields } from "./eas.ts";

export const IDEMPOTENCY_RETRY_MS = 23 * 60 * 60_000; // CDP keys expire after 24h; fail closed before that boundary.
export const easClient = () => createPublicClient({ chain: baseSepolia,
  transport: http(process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org", { timeout: 15_000, retryCount: 0 }) });
export type EasIntent = {
  attestor: string; fields: AttestationFields; requestId: string; schemaUid: string;
  txHash?: string; startBlock?: string; firstSendAt?: number;
};
export class AttestationFailure extends Error {
  constructor(public readonly code: string) { super(code); }
}
const fail = (code: string): never => { throw new AttestationFailure(code); };

/** Only this transport has CDP access. Every send follows a durable markSending callback. */
export async function executeAttestation(input: {
  intent: EasIntent; cdp: Pick<CdpClient, "evm" | "policies">; client: ReturnType<typeof easClient>; policyId: string;
  markSending: (startBlock: string) => Promise<void>; recordTransaction: (hash: string) => Promise<void>;
}) {
  const { intent, client, cdp } = input;
  if (intent.schemaUid !== EAS_SCHEMA_UID || await client.getChainId() !== EAS_CHAIN_ID) fail("attestation_network_or_schema_mismatch");
  let hash = intent.txHash as Hash | undefined;
  // Recover the accepted transaction if its HTTP response or DB write was lost.
  if (!hash && intent.firstSendAt && intent.startBlock) {
    const end = await client.getBlockNumber();
    const start = BigInt(intent.startBlock);
    if (end - start > 50_000n) fail("attestation_reconciliation_required");
    for (let fromBlock = start; fromBlock <= end && !hash; fromBlock += 2000n) {
      const logs = await client.getLogs({ address: EAS_ADDRESS, event: EAS_ABI[3],
        args: { attester: intent.attestor as Address, schemaUID: EAS_SCHEMA_UID }, fromBlock,
        toBlock: fromBlock + 1999n < end ? fromBlock + 1999n : end });
      for (const log of logs) {
        const stored = await client.readContract({ address: EAS_ADDRESS, abi: EAS_ABI, functionName: "getAttestation", args: [log.args.uid!] });
        if (stored.data === encodeAttestation(intent.fields)) { hash = log.transactionHash!; break; }
      }
    }
    if (hash) await input.recordTransaction(hash);
  }
  if (!hash) {
    if (intent.firstSendAt && Date.now() - intent.firstSendAt >= IDEMPOTENCY_RETRY_MS) fail("attestation_reconciliation_required");
    const account = await cdp.evm.getAccount({ name: ATTESTOR_NAME });
    if (account.address.toLowerCase() !== intent.attestor.toLowerCase() || !input.policyId ||
      account.policies?.length !== 1 || account.policies[0] !== input.policyId) fail("attestation_account_policy_mismatch");
    const policy = await cdp.policies.getPolicyById({ id: input.policyId });
    if (policy.status !== "active" || policy.scope !== "account") fail("attestation_account_policy_inactive");
    let pageToken: string | undefined;
    do {
      const page = await cdp.policies.listPolicies({ scope: "project", pageSize: 100, pageToken });
      if (page.policies.some(p => p.rules.some(rule => rule.action === "accept" &&
        ["sendEvmTransaction", "signEvmTransaction", "signEvmHash", "signEvmMessage", "signEvmTypedData", "prepareUserOperation", "sendUserOperation"].includes(rule.operation)))) {
        fail("attestation_project_policy_override");
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    await input.markSending((await client.getBlockNumber()).toString());
    const sent = await cdp.evm.sendTransaction({ address: account.address, network: EAS_NETWORK,
      transaction: attestTransaction(intent.fields), idempotencyKey: intent.requestId });
    hash = sent.transactionHash;
    await input.recordTransaction(hash);
  }
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 45_000 });
  if (receipt.transactionHash !== hash) fail("attestation_transaction_replaced");
  if (receipt.to?.toLowerCase() !== EAS_ADDRESS.toLowerCase() || receipt.from.toLowerCase() !== intent.attestor.toLowerCase()) fail("attestation_receipt_mismatch");
  if (receipt.status !== "success") fail("attestation_transaction_reverted");
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== EAS_ADDRESS.toLowerCase()) continue;
    let decoded;
    try { decoded = decodeEventLog({ abi: EAS_ABI, eventName: "Attested", data: log.data, topics: log.topics }); }
    catch { continue; }
    const args = decoded.args;
    if (args.attester.toLowerCase() !== intent.attestor.toLowerCase() || args.schemaUID !== EAS_SCHEMA_UID || args.recipient !== zeroAddress) continue;
    const stored = await client.readContract({ address: EAS_ADDRESS, abi: EAS_ABI, functionName: "getAttestation", args: [args.uid] });
    if (stored.uid !== args.uid || stored.schema !== EAS_SCHEMA_UID || stored.attester.toLowerCase() !== intent.attestor.toLowerCase() ||
      stored.recipient !== zeroAddress || stored.refUID !== zeroHash || !stored.revocable || stored.revocationTime !== 0n || stored.expirationTime !== 0n ||
      stored.data !== encodeAttestation(intent.fields)) fail("attestation_data_mismatch");
    return { uid: args.uid, txHash: hash, logIndex: log.logIndex };
  }
  return fail("attestation_event_missing");
}
