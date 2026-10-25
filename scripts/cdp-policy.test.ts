import assert from "node:assert/strict";
import { test } from "node:test";
import { CdpClient, CreatePolicyBodySchema } from "@coinbase/cdp-sdk";
import { decodeFunctionData, erc20Abi, type Address } from "viem";
import { USDC_ADDRESS } from "../packages/contracts/src/chain.ts";
import { assertNoProjectOverride, buildPolicy, requestId, safeError, transfer, verifyPolicy } from "./cdp-policy.ts";

const address = `0x${"11".repeat(20)}` as Address;
const second = `0x${"22".repeat(20)}` as Address;

test("both allowlist forms satisfy CDP 1.60 schema and close alternative signing routes", () => {
  for (const mode of ["in", "equals"] as const) {
    const policy = buildPolicy([address, second], 1_875_000n, mode);
    assert.equal(CreatePolicyBodySchema.safeParse(policy).success, true);
    assert.deepEqual([...new Set(policy.rules.filter(rule => rule.action === "accept").map(rule => rule.operation))], ["sendEvmTransaction"]);
    for (const operation of ["signEvmTransaction", "signEvmMessage", "signEvmTypedData", "signEvmHash", "prepareUserOperation", "sendUserOperation"]) {
      assert.ok(policy.rules.some(rule => rule.operation === operation && rule.action === "reject"));
    }
    assert.equal(policy.rules.filter(rule => rule.action === "accept").length, mode === "in" ? 1 : 2);
  }
});

test("encoded transfer binds exact bigint USDC units and token, including values beyond float precision", () => {
  const amount = 9_007_199_254_740_993n;
  const tx = transfer(address, amount);
  assert.equal(tx.to, USDC_ADDRESS);
  assert.equal(tx.value, 0n);
  const decoded = decodeFunctionData({ abi: erc20Abi, data: tx.data });
  assert.equal(decoded.functionName, "transfer");
  assert.deepEqual(decoded.args, [address, amount]);
});

test("policy validation refuses an unexpectedly accepted negative case", async () => {
  const cdp = { policies: { simulate: async () => ({ action: "accept", reason: "rule_accepted",
    matchedRule: { policy: { id: "policy", scope: "account" } } }) } } as unknown as CdpClient;
  await assert.rejects(verifyPolicy(cdp, address, "policy", [address], 100n), /policy_accepted_over_cap/);
});

test("project accepts are refused even if paused and on a later page", async () => {
  let calls = 0;
  const cdp = { policies: { listPolicies: async () => ++calls === 1 ? { policies: [], nextPageToken: "next" }
    : { policies: [{ status: "paused", rules: [{ operation: "signEvmHash", action: "accept" }] }] } } } as unknown as CdpClient;
  await assert.rejects(assertNoProjectOverride(cdp), /project_accept_rules_override/);
  assert.equal(calls, 2);
});

test("management idempotency keys are stable UUIDs bound to exact terms", () => {
  assert.match(requestId("policy-a"), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(requestId("policy-a"), requestId("policy-a"));
  assert.notEqual(requestId("policy-a"), requestId("policy-b"));
});

test("error redaction happens before truncation can expose a partial secret", () => {
  const name = "SKARL_POLICY_TEST_SECRET";
  const previous = process.env[name];
  const secret = "synthetic-secret-that-straddles-the-output-limit";
  process.env[name] = secret;
  try {
    const result = safeError(new Error(`${"x".repeat(1195)}${secret}`));
    assert.equal(result.message.includes("synth"), false);
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
});
