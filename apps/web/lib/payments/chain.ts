import { paymentConfig } from "../../../../packages/payments/src/config";
import { webConfig } from "../config";
import { createPublicClient, http, parseEventLogs, parseAbi, type Hash } from "viem";
import { baseSepolia } from "viem/chains";
import { PAYMENT_CHAIN_ID, PAYMENT_NETWORK, USDC_ADDRESS } from "@skarl/contracts/chain";
import { validateTransfer, type ExpectedTransfer } from "../../../../packages/payments/src/reconciliation";

export const usdcEvents = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)",
]);
export const publicClient = () => createPublicClient({ chain: baseSepolia,
  transport: http(webConfig.rpcUrl, { timeout: webConfig.rpcTimeoutMs, retryCount: webConfig.rpcRetryCount }) });

/** Reads a receipt and its canonical block. Client-supplied hashes are only lookup keys, never proof. */
export async function observeTransfer(txHash: Hash, expected: ExpectedTransfer, authorizationNonce?: string) {
  const client = publicClient();
  if (await client.getChainId() !== PAYMENT_CHAIN_ID) throw new Error("wrong_rpc_network");
  const receipt = await client.waitForTransactionReceipt({ hash: txHash, confirmations: paymentConfig.requiredConfirmations, timeout: webConfig.receiptTimeoutMs });
  if (receipt.transactionHash.toLowerCase() !== txHash.toLowerCase()) throw new Error("transaction_replaced_reconcile_manually");
  const [head, block] = await Promise.all([client.getBlockNumber({ cacheTime: 0 }), client.getBlock({ blockNumber: receipt.blockNumber })]);
  if (block.hash !== receipt.blockHash) throw new Error("receipt_reorged");
  const tokenLogs = receipt.logs.filter(log => log.address.toLowerCase() === USDC_ADDRESS.toLowerCase());
  if (authorizationNonce) {
    const used = parseEventLogs({ abi: usdcEvents, logs: tokenLogs, eventName: "AuthorizationUsed" });
    if (!used.some(log => log.args.authorizer.toLowerCase() === expected.fromAddress.toLowerCase() &&
      log.args.nonce.toLowerCase() === authorizationNonce.toLowerCase())) throw new Error("authorization_not_in_receipt");
  }
  const transfers = parseEventLogs({ abi: usdcEvents, logs: tokenLogs, eventName: "Transfer" }).filter(log =>
    log.args.from.toLowerCase() === expected.fromAddress.toLowerCase() && log.args.to.toLowerCase() === expected.toAddress.toLowerCase() &&
    log.args.value === expected.amountAtomic);
  if (transfers.length !== 1) throw new Error("expected_single_exact_transfer");
  const log = transfers[0]!;
  const observation = { network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, txHash, logIndex: log.logIndex,
    blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, fromAddress: log.args.from, toAddress: log.args.to,
    amountAtomic: log.args.value, confirmations: Number(head - receipt.blockNumber + 1n), succeeded: receipt.status === "success",
    observedAt: Number(block.timestamp) * 1000 };
  validateTransfer(observation, expected);
  return observation;
}
