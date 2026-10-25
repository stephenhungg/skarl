import test from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics, parseAbi } from "viem";
import { verifyFundingReceipt, WalletFlowError } from "./wallet-mcp-flow.mjs";
import { PAYMENT_CHAIN_ID, PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/chain.ts";

// Actual ABI bytes, synthetic RPC state. No wallet, transaction submission or network.
const abi = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
const TX = `0x${"ab".repeat(32)}`, BLOCK_HASH = `0x${"cd".repeat(32)}`;
const PAYER = `0x${"11".repeat(20)}`, PAYEE = `0x${"22".repeat(20)}`, OTHER = `0x${"33".repeat(20)}`;
const BLOCK = 100n, AMOUNT = 10_000_001n;
function transfer({ from = PAYER, to = PAYEE, amount = AMOUNT, token = USDC_ADDRESS, logIndex = 7 } = {}) {
  return { address: token, topics: encodeEventTopics({ abi, eventName: "Transfer", args: { from, to } }),
    data: encodeAbiParameters([{ type: "uint256" }], [amount]), logIndex, transactionHash: TX,
    blockHash: BLOCK_HASH, blockNumber: BLOCK, transactionIndex: 0, removed: false };
}
function fixture(t) {
  const network = t.mock.method(globalThis, "fetch", async () => { throw new Error("Real network is forbidden in receipt proof tests"); });
  const state = { chainId: PAYMENT_CHAIN_ID, head: BLOCK + 1n,
    block: { number: BLOCK, hash: BLOCK_HASH, timestamp: 1_792_922_000n },
    receipt: { transactionHash: TX, blockNumber: BLOCK, blockHash: BLOCK_HASH, status: "success", logs: [transfer()] } };
  const client = {
    getChainId: t.mock.fn(async () => state.chainId),
    getTransactionReceipt: t.mock.fn(async ({ hash }) => { assert.equal(hash, TX); return state.receipt; }),
    getBlockNumber: t.mock.fn(async options => { assert.deepEqual(options, { cacheTime: 0 }); return state.head; }),
    getBlock: t.mock.fn(async ({ blockNumber }) => { assert.equal(blockNumber, state.receipt.blockNumber); return state.block; }),
  };
  t.after(() => assert.equal(network.mock.callCount(), 0));
  return { state, client, expected: { fromAddress: PAYER, toAddress: PAYEE, amountAtomic: AMOUNT } };
}

test("canonical Base USDC transfer yields exact JSON-safe proof only after two confirmations", async t => {
  const f = fixture(t), proof = await verifyFundingReceipt(f.client, TX, f.expected);
  assert.deepEqual(proof, { network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, txHash: TX,
    logIndex: 7, blockNumber: "100", blockHash: BLOCK_HASH, confirmations: 2,
    payerAddress: PAYER, recipientAddress: PAYEE, amountAtomic: "10000001" });
  assert.equal(f.client.getChainId.mock.callCount(), 1);
  assert.equal(f.client.getTransactionReceipt.mock.callCount(), 1);
  assert.equal(f.client.getBlockNumber.mock.callCount(), 1);
  assert.equal(f.client.getBlock.mock.callCount(), 1);
  assert.doesNotThrow(() => JSON.stringify(proof));
});

test("receipt proof preserves integer micro-USDC above JavaScript's safe integer range", async t => {
  const f = fixture(t), amountAtomic = 9_007_199_254_740_993n;
  f.state.receipt.logs = [transfer({ amount: amountAtomic })];
  const proof = await verifyFundingReceipt(f.client, TX, { ...f.expected, amountAtomic });
  assert.equal(proof.amountAtomic, "9007199254740993");
});

test("an unrelated token and a nonmatching USDC log do not replace the single exact transfer", async t => {
  const f = fixture(t);
  f.state.receipt.logs = [transfer({ token: OTHER, logIndex: 1 }), transfer({ to: OTHER, logIndex: 2 }), transfer({ logIndex: 9 })];
  const proof = await verifyFundingReceipt(f.client, TX, f.expected);
  assert.equal(proof.logIndex, 9); assert.equal(proof.amountAtomic, AMOUNT.toString());
});

test("wrong chain fails before requesting a receipt or canonical block", async t => {
  const f = fixture(t); f.state.chainId = 1;
  await assert.rejects(verifyFundingReceipt(f.client, TX, f.expected), WalletFlowError);
  assert.equal(f.client.getTransactionReceipt.mock.callCount(), 0);
  assert.equal(f.client.getBlock.mock.callCount(), 0);
});

test("malformed transaction hash never reaches the RPC", async t => {
  const f = fixture(t);
  await assert.rejects(verifyFundingReceipt(f.client, "0x1234", f.expected), /Wrong transaction hash/);
  assert.equal(f.client.getChainId.mock.callCount(), 0);
  assert.equal(f.client.getTransactionReceipt.mock.callCount(), 0);
});

for (const [name, alter] of [
  ["reorganized block", f => { f.state.block.hash = `0x${"ef".repeat(32)}`; }],
  ["replaced transaction", f => { f.state.receipt.transactionHash = `0x${"01".repeat(32)}`; }],
]) {
  test(`${name} cannot produce funding proof`, async t => {
    const f = fixture(t); alter(f);
    await assert.rejects(verifyFundingReceipt(f.client, TX, f.expected), /replaced or reorganized/);
  });
}

test("a reverted receipt fails even if it contains a syntactically valid matching Transfer log", async t => {
  const f = fixture(t); f.state.receipt.status = "reverted";
  await assert.rejects(verifyFundingReceipt(f.client, TX, f.expected), /receipt_failed/);
});

for (const [name, patch] of [
  ["wrong token", { token: OTHER }],
  ["wrong sender", { from: OTHER }],
  ["wrong payee", { to: OTHER }],
  ["one micro-USDC short", { amount: AMOUNT - 1n }],
  ["one micro-USDC over", { amount: AMOUNT + 1n }],
]) {
  test(`${name} is rejected from actual decoded event bytes`, async t => {
    const f = fixture(t); f.state.receipt.logs = [transfer(patch)];
    await assert.rejects(verifyFundingReceipt(f.client, TX, f.expected), /exactly one matching canonical USDC transfer/);
  });
}

test("one confirmation is insufficient; advancing the same transaction to two succeeds", async t => {
  const f = fixture(t); f.state.head = BLOCK;
  await assert.rejects(verifyFundingReceipt(f.client, TX, f.expected), /insufficient_confirmations/);
  f.state.head = BLOCK + 1n;
  assert.equal((await verifyFundingReceipt(f.client, TX, f.expected)).confirmations, 2);
  assert.equal(f.client.getTransactionReceipt.mock.callCount(), 2);
});

test("a receipt above the canonical head cannot yield positive proof", async t => {
  const f = fixture(t); f.state.head = BLOCK - 1n;
  await assert.rejects(verifyFundingReceipt(f.client, TX, f.expected), /insufficient_confirmations/);
});

test("two matching transfers in the same transaction are ambiguous even at distinct log indexes", async t => {
  const f = fixture(t); f.state.receipt.logs = [transfer({ logIndex: 3 }), transfer({ logIndex: 8 })];
  await assert.rejects(verifyFundingReceipt(f.client, TX, f.expected), /exactly one matching canonical USDC transfer/);
});

test("missing or undecodable transfer evidence never counts as observed funding", async t => {
  const f = fixture(t);
  f.state.receipt.logs = [{ ...transfer(), topics: [], data: "0x" }];
  await assert.rejects(verifyFundingReceipt(f.client, TX, f.expected), /exactly one matching canonical USDC transfer/);
  f.state.receipt.logs = [];
  await assert.rejects(verifyFundingReceipt(f.client, TX, f.expected), /exactly one matching canonical USDC transfer/);
});

test("lookup/provider unavailability remains a failure rather than funding proof", async t => {
  const f = fixture(t);
  f.client.getTransactionReceipt = t.mock.fn(async () => { throw new Error("synthetic receipt unavailable"); });
  await assert.rejects(verifyFundingReceipt(f.client, TX, f.expected), /synthetic receipt unavailable/);
  assert.equal(f.client.getBlock.mock.callCount(), 0);
});
