import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PAYMENT_CHAIN_ID, PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/chain.ts";
import { compareCdpWitness, fetchCdpTransfers } from "../convex/lib/cdpSql.ts";

export const FUNDING_TX = "0x28b3f88d593c02a669cb95f4bdc6a23ab3d24bb5d1260e6c4ae54554155cd757";
export const DEMO_TREASURY = "0x8408a922ea400af33d7c2080a9edd5d3495b695f";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const HASH = /^0x[0-9a-f]{64}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;

/** Read-only proof command. It never records observations, signs, or submits transactions. */
export async function runSqlWitness({ apiKey, txHash = FUNDING_TX, treasury = DEMO_TREASURY,
  rpcUrl = "https://sepolia.base.org", fetchImpl = fetch } = {}) {
  if (!HASH.test(txHash) || !ADDRESS.test(treasury)) throw new Error("invalid_scope");
  const sql = await fetchCdpTransfers({ apiKey, txHashes: [txHash], treasury, fetchImpl });
  const result = { evidence: sql.status === "available" ? "live_cdp_api" : "not_verified",
    network: PAYMENT_NETWORK, txHash: txHash.toLowerCase(), treasury: treasury.toLowerCase(), sql };
  if (sql.status !== "available") return result;
  const rpc = async (method, params) => {
    const response = await fetchImpl(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error("rpc_unavailable");
    const body = await response.json();
    if (body.error || body.result === undefined) throw new Error("rpc_unavailable");
    return body.result;
  };
  try {
    if (BigInt(await rpc("eth_chainId", [])) !== BigInt(PAYMENT_CHAIN_ID)) throw new Error("wrong_network");
    const receipt = await rpc("eth_getTransactionReceipt", [txHash]);
    if (!receipt || receipt.status !== "0x1" || receipt.transactionHash.toLowerCase() !== txHash.toLowerCase()) throw new Error("receipt_unavailable");
    const head = BigInt(await rpc("eth_blockNumber", []));
    const canonical = await rpc("eth_getBlockByNumber", [receipt.blockNumber, false]);
    if (canonical?.hash?.toLowerCase() !== receipt.blockHash.toLowerCase() || head - BigInt(receipt.blockNumber) + 1n < 2n) throw new Error("receipt_unconfirmed");
    const rpcTransfers = receipt.logs.filter(log => log.address.toLowerCase() === USDC_ADDRESS.toLowerCase() &&
      log.topics?.[0]?.toLowerCase() === TRANSFER_TOPIC).map(log => {
      if (log.topics.length !== 3 || !HASH.test(log.topics[1]) || !HASH.test(log.topics[2]) || !HASH.test(log.data) || log.removed) throw new Error("invalid_rpc_log");
      const logIndex = Number(BigInt(log.logIndex));
      if (!Number.isSafeInteger(logIndex) || logIndex < 0) throw new Error("invalid_rpc_log");
      return { network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS.toLowerCase(), txHash: txHash.toLowerCase(), logIndex,
        fromAddress: `0x${log.topics[1].slice(-40)}`.toLowerCase(), toAddress: `0x${log.topics[2].slice(-40)}`.toLowerCase(),
        amountAtomic: BigInt(log.data).toString(), blockHash: receipt.blockHash.toLowerCase(), blockNumber: BigInt(receipt.blockNumber).toString() };
    }).filter(log => [log.fromAddress, log.toAddress].includes(treasury.toLowerCase()));
    return { ...result, rpcStatus: "observed", confirmations: (head - BigInt(receipt.blockNumber) + 1n).toString(),
      witnesses: rpcTransfers.map(transfer => ({ rpcTransfer: transfer, ...compareCdpWitness(transfer, sql) })) };
  } catch {
    return { ...result, rpcStatus: "witness_unavailable" };
  }
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log("usage: node scripts/cdp-sql-witness.mjs [txHash] [treasury]\nloads ~/.config/skarl/cdp.env privately; requires CDP_CLIENT_API_KEY; optional BASE_SEPOLIA_RPC_URL\nread-only: compares live CDP indexed transfers with confirmed Base Sepolia RPC receipt logs");
    return;
  }
  try { process.loadEnvFile(join(homedir(), ".config/skarl/cdp.env")); }
  catch (error) { if (error?.code !== "ENOENT") throw new Error("credential_file_unreadable"); }
  const result = await runSqlWitness({ apiKey: process.env.CDP_CLIENT_API_KEY,
    txHash: process.argv[2] ?? FUNDING_TX, treasury: process.argv[3] ?? process.env.SKARL_TREASURY_ADDRESS ?? DEMO_TREASURY,
    rpcUrl: process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org" });
  console.log(JSON.stringify(result, null, 2));
  if (result.sql.status !== "available" || result.rpcStatus !== "observed" || !result.witnesses?.length ||
      result.witnesses.some(witness => witness.status !== "match")) process.exitCode = 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error(JSON.stringify({ status: "witness_unavailable", reason: "verification_command_failed" }));
    process.exitCode = 1;
  });
}
