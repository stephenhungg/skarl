import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyCdpSignature, parseCdpTransfer } from "../apps/web/lib/cdp/webhook.ts";
import { USDC_ADDRESS, PAYMENT_NETWORK } from "../packages/contracts/src/chain.ts";
const secret = "synthetic-webhook-signing-secret";
const now = 1_800_000_000_000;
const raw = Buffer.from('{"data":"synthetic"}');
const signature = (timestamp, body = raw) => `t=${timestamp},v0=${createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex")}`;
test("v0 checks exact bytes, timestamp on both sides, secret rotation and malformed headers", () => {
  const header = signature(now / 1000);
  assert.equal(verifyCdpSignature(raw, header, ["other", secret], now), true);
  for (const [body, signed, keys] of [
    [Buffer.from('{ "data":"synthetic"}'), header, [secret]], [raw, header, ["wrong"]],
    [raw, signature(now / 1000 - 301), [secret]], [raw, signature(now / 1000 + 301), [secret]],
    [raw, `${header},t=${now / 1000}`, [secret]], [raw, `t=${now / 1000},v0=bad`, [secret]],
    [raw, null, [secret]], [raw, header, []],
  ]) assert.equal(verifyCdpSignature(body, signed, keys, now), false);
});
const treasury = `0x${"11".repeat(20)}`, from = `0x${"22".repeat(20)}`, txHash = `0x${"aa".repeat(32)}`;
const data = { network: "base-sepolia", contract_address: USDC_ADDRESS, event_name: "Transfer", transaction_hash: txHash,
  log_index: 8, parameters: { from, to: treasury, value: "10000000" } };
test("normalizes documented onchain payload without float money", () => {
  assert.deepEqual(parseCdpTransfer({ id: "evt-test", type: "onchain.activity.detected", data }, treasury, "fallback"),
    { eventId: "evt-test", network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, txHash, logIndex: 8, fromAddress: from, toAddress: treasury, amountAtomic: "10000000" });
  assert.equal(parseCdpTransfer(data, treasury, "digest").eventId, "digest");
  assert.equal(parseCdpTransfer({ data: { networkId: "base-sepolia", contractAddress: USDC_ADDRESS, eventName: "Transfer",
    transactionHash: txHash, logIndex: 8, from, to: treasury, value: "10000000" } }, treasury, "digest").amountAtomic, "10000000");
});
test("rejects wrong chain, asset, treasury, event and lossy or malformed money", () => {
  for (const change of [{ network: "base-mainnet" }, { contract_address: treasury }, { event_name: "Approval" },
    { parameters: { from, to: from, value: "1" } }, { parameters: { from, to: treasury, value: 10000000 } },
    { parameters: { from, to: treasury, value: "1e6" } }, { log_index: -1 }]) {
    assert.throws(() => parseCdpTransfer({ data: { ...data, ...change } }, treasury, "digest"));
  }
});
