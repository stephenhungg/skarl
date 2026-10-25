import test from "node:test";
import assert from "node:assert/strict";
import { runSqlWitness } from "./cdp-sql-witness.mjs";
import { USDC_ADDRESS } from "../packages/contracts/src/chain.ts";

const FUNDING_TX = `0x${"a".repeat(64)}`;
const DEMO_TREASURY = `0x${"1".repeat(40)}`;
const from = `0x${"2".repeat(40)}`;
const blockHash = `0x${"b".repeat(64)}`;
const topicAddress = address => `0x${address.slice(2).padStart(64, "0")}`;
const transfer = { transaction_hash: FUNDING_TX, log_index: 7, address: USDC_ADDRESS,
  block_hash: blockHash, block_number: "100", from_address: from, to_address: DEMO_TREASURY, amount_atomic: "10000000" };
const receipt = { transactionHash: FUNDING_TX, status: "0x1", blockHash, blockNumber: "0x64", logs: [{
  address: USDC_ADDRESS, logIndex: "0x7", data: `0x${10000000n.toString(16).padStart(64, "0")}`,
  topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", topicAddress(from), topicAddress(DEMO_TREASURY)],
}] };

// All API/RPC responses below are simulated, not live chain evidence.
test("missing client key never makes a network request", async () => {
  const result = await runSqlWitness({ txHash: FUNDING_TX, treasury: DEMO_TREASURY, fetchImpl: () => { throw new Error("unexpected call"); } });
  assert.equal(result.evidence, "not_verified");
  assert.equal(result.sql.status, "witness_unavailable");
  assert.equal(result.sql.reason, "client_key_not_configured");
});
test("read-only witness compares CDP and a confirmed canonical RPC log", async () => {
  const methods = [];
  const fetchImpl = async (url, options) => {
    const request = JSON.parse(options.body);
    if (url.includes("api.cdp.coinbase.com")) return new Response(JSON.stringify({ result: [transfer] }));
    methods.push(request.method);
    const result = { eth_chainId: "0x14a34", eth_getTransactionReceipt: receipt, eth_blockNumber: "0x65", eth_getBlockByNumber: { hash: blockHash } }[request.method];
    assert.notEqual(result, undefined);
    return new Response(JSON.stringify({ result }));
  };
  const result = await runSqlWitness({ txHash: FUNDING_TX, treasury: DEMO_TREASURY, apiKey: "simulated-key", fetchImpl });
  assert.equal(result.rpcStatus, "observed");
  assert.equal(result.confirmations, "2");
  assert.equal(result.witnesses[0].status, "match");
  assert.equal(result.witnesses[0].rpcTransfer.amountAtomic, "10000000");
  assert.deepEqual(methods, ["eth_chainId", "eth_getTransactionReceipt", "eth_blockNumber", "eth_getBlockByNumber"]);
});

test("missing explicit transaction and treasury fail before a network request", async () => {
  await assert.rejects(runSqlWitness({ txHash: "", treasury: "", fetchImpl: () => { throw new Error("unexpected network"); } }), /invalid_scope/);
});
