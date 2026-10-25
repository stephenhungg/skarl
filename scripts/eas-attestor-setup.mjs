import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createPublicClient, encodeFunctionData, http, serializeTransaction, zeroAddress, zeroHash } from "viem";
import { baseSepolia } from "viem/chains";
import { assertNoProjectOverride, buildPolicy as payoutPolicy, credentials, requestId, safeError } from "./cdp-policy.ts";
import { ATTESTOR_NAME, EAS_ABI, EAS_ADDRESS, EAS_CHAIN_ID, EAS_NETWORK, EAS_SCHEMA_UID, SCHEMA_REGISTRY_ADDRESS } from "../convex/lib/eas.ts";

export const publicClient = () => createPublicClient({ chain: baseSepolia,
  transport: http(process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org", { timeout: 20_000 }) });

/** The operation-specific reject rules close signing routes that default to allow. */
export function strictContractPolicy(address, abi, functions, description) {
  const denies = payoutPolicy([zeroAddress], 1n, "in").rules.filter(rule => rule.action === "reject");
  return { scope: "account", description, rules: [
    ...functions.map(name => ({ action: "accept", operation: "sendEvmTransaction", criteria: [
      { type: "evmNetwork", networks: [EAS_NETWORK], operator: "in" },
      { type: "evmAddress", addresses: [address], operator: "in" },
      { type: "ethValue", ethValue: "0", operator: "==" },
      { type: "evmData", abi: abi.filter(entry => entry.type === "function" && entry.name === name), conditions: [{ function: name }] },
    ] })), ...denies,
  ] };
}

export async function applyAccountPolicy(cdp, account, policy) {
  await assertNoProjectOverride(cdp);
  const created = await cdp.policies.createPolicy({ policy, idempotencyKey: requestId(`eas:${JSON.stringify(policy)}`) });
  await cdp.evm.updateAccount({ address: account.address, update: { accountPolicy: created.id } });
  const checked = await cdp.evm.getAccount({ address: account.address });
  if (!checked.policies?.includes(created.id)) throw new Error("attestor_policy_not_attached");
  const stored = await cdp.policies.getPolicyById({ id: created.id });
  if (stored.scope !== "account" || stored.status !== "active") throw new Error("attestor_policy_not_active");
  return created.id;
}

export async function ensureFaucet(cdp, client, account) {
  if (await client.getChainId() !== EAS_CHAIN_ID) throw new Error("wrong_rpc_network");
  if (await client.getBalance({ address: account.address }) >= 20_000_000_000_000n) return;
  const { transactionHash } = await cdp.evm.requestFaucet({ address: account.address, network: EAS_NETWORK, token: "eth" });
  console.log(JSON.stringify({ faucetAddress: account.address, transactionHash }));
  const receipt = await client.waitForTransactionReceipt({ hash: transactionHash, timeout: 60_000 });
  if (receipt.status !== "success") throw new Error("faucet_transaction_reverted");
}

function serialized(transaction, network = EAS_NETWORK) {
  return serializeTransaction({ ...transaction, type: "eip1559", chainId: network === EAS_NETWORK ? EAS_CHAIN_ID : 8453,
    nonce: 0, gas: 500_000n, maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 1_000_000n });
}

export async function verifyContractPolicy(cdp, address, policyId, transactions) {
  for (const [name, transaction] of Object.entries(transactions)) {
    const result = await cdp.policies.simulate({ operation: "sendEvmTransaction", address, network: EAS_NETWORK, transaction: serialized(transaction) });
    console.log(JSON.stringify({ probe: name, simulated: true, action: result.action, reason: result.reason }));
    if (result.action !== "accept" || result.matchedRule?.policy.id !== policyId || result.matchedRule.policy.scope !== "account") {
      throw new Error(`policy_failed_accept_${name}`);
    }
  }
  const transaction = Object.values(transactions)[0];
  const denied = [
    ["wrong_target", { ...transaction, to: zeroAddress }, EAS_NETWORK],
    ["wrong_network", transaction, "base"],
    ["wrong_function", { ...transaction, data: "0xdeadbeef" }, EAS_NETWORK],
    ["native_value", { ...transaction, value: 1n }, EAS_NETWORK],
  ];
  for (const [name, tx, network] of denied) {
    const result = await cdp.policies.simulate({ operation: "sendEvmTransaction", address, network, transaction: serialized(tx, network) });
    console.log(JSON.stringify({ probe: name, simulated: true, action: result.action, reason: result.reason }));
    if (result.action !== "reject") throw new Error(`policy_failed_reject_${name}`);
  }
  for (const probe of [
    { operation: "signEvmTransaction", address, transaction: serialized(transaction) },
    { operation: "signEvmHash", address, hash: zeroHash },
    { operation: "signEvmMessage", address, message: "Skarl policy probe" },
  ]) {
    const result = await cdp.policies.simulate(probe);
    console.log(JSON.stringify({ probe: probe.operation, simulated: true, action: result.action, reason: result.reason }));
    if (result.action !== "reject") throw new Error(`policy_failed_reject_${probe.operation}`);
  }
}

export async function setupAttestor() {
  const cdp = credentials();
  await assertNoProjectOverride(cdp);
  const account = await cdp.evm.getOrCreateAccount({ name: ATTESTOR_NAME });
  const policy = strictContractPolicy(EAS_ADDRESS, EAS_ABI, ["attest", "revoke"], "Skarl EAS Base Sepolia attest and revoke");
  const policyId = await applyAccountPolicy(cdp, account, policy);
  const attest = { to: EAS_ADDRESS, value: 0n, data: encodeFunctionData({ abi: EAS_ABI, functionName: "attest",
    args: [{ schema: EAS_SCHEMA_UID, data: { recipient: zeroAddress, expirationTime: 0n, revocable: true, refUID: zeroHash, data: "0x", value: 0n } }] }) };
  const revoke = { to: EAS_ADDRESS, value: 0n, data: encodeFunctionData({ abi: EAS_ABI, functionName: "revoke",
    args: [{ schema: EAS_SCHEMA_UID, data: { uid: zeroHash, value: 0n } }] }) };
  await verifyContractPolicy(cdp, account.address, policyId, { attest, revoke });
  // Registry must remain outside the attestor's permissions.
  const denied = await cdp.policies.simulate({ operation: "sendEvmTransaction", address: account.address,
    network: EAS_NETWORK, transaction: serialized({ ...attest, to: SCHEMA_REGISTRY_ADDRESS }) });
  if (denied.action !== "reject") throw new Error("attestor_policy_allows_registry");
  await ensureFaucet(cdp, publicClient(), account);
  const result = { accountName: ATTESTOR_NAME, attestorAddress: account.address, policyId, network: EAS_NETWORK, policyVerified: true,
    sponsorship: false, reason: "EOA preserves sendEvmTransaction only policy; smart sponsorship requires sendUserOperation" };
  console.log(JSON.stringify(result));
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  setupAttestor().catch(error => { console.error(JSON.stringify({ error: safeError(error) })); process.exitCode = 1; });
}
