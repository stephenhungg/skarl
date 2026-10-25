import { CdpClient, type CreatePolicyBody, type PolicySimulationResult } from "@coinbase/cdp-sdk";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { loadEnvFile } from "node:process";
import { encodeFunctionData, erc20Abi, serializeTransaction, type Address } from "viem";
import { PAYMENT_CHAIN_ID, USDC_ADDRESS } from "../packages/contracts/src/chain.ts";

export const AGENT_NAME = "skarl-finance-agent";
export const PROBE_NAME = "skarl-policy-probe";
const ZERO = "0x0000000000000000000000000000000000000000";
const EVM_OPERATIONS = new Set(["sendEvmTransaction", "signEvmTransaction", "signEvmHash", "signEvmMessage",
  "signEvmTypedData", "prepareUserOperation", "sendUserOperation"]);

export function credentials() {
  const file = `${homedir()}/.config/skarl/cdp.env`;
  if (existsSync(file)) loadEnvFile(file);
  for (const name of ["CDP_API_KEY_ID", "CDP_API_KEY_SECRET", "CDP_WALLET_SECRET"]) {
    if (!process.env[name]) throw new Error(`missing_${name}`);
  }
  return new CdpClient();
}

/** Never print the full SDK error: request config can contain credentials. */
export function safeError(error: unknown) {
  const e = error as { name?: string; errorType?: string; statusCode?: number; message?: string };
  let message = typeof e?.message === "string" ? e.message : "operation_failed";
  for (const [name, value] of Object.entries(process.env)) {
    if (value && /SECRET|KEY|TOKEN|PASSWORD/.test(name)) message = message.split(value).join("[redacted]");
  }
  return { name: e?.name, errorType: e?.errorType, statusCode: e?.statusCode, message: message.slice(0, 1200) };
}

export function convexRun(name: string, args: object): unknown {
  // `convex run` invokes an existing function; it does not deploy code.
  const output = execFileSync("pnpm", ["exec", "convex", "run", name, JSON.stringify(args)],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 });
  return JSON.parse(output);
}

export function verifiedAllowlist(): Address[] {
  const value = convexRun("lib/cdpWallet:allowlist", {});
  if (!Array.isArray(value) || value.length === 0 || value.some(address =>
    typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address) || address.toLowerCase() === ZERO)) {
    throw new Error("verified_contributor_allowlist_required");
  }
  return [...new Set(value.map(address => address.toLowerCase() as Address))].sort();
}

export function capAtomic(): bigint {
  const value = process.env.CDP_PAYOUT_CAP_ATOMIC;
  if (!value || !/^[1-9][0-9]*$/.test(value) || BigInt(value) > 9_223_372_036_854_775_807n) {
    throw new Error("CDP_PAYOUT_CAP_ATOMIC_must_be_positive_Int64_micro_USDC");
  }
  return BigInt(value);
}

/** A stable UUID binds repeat management requests to the same exact policy body. */
export function requestId(value: string) {
  const hex = createHash("sha256").update(value).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function buildPolicy(addresses: Address[], cap: bigint, mode: "in" | "equals"): CreatePolicyBody {
  if (!addresses.length || addresses.length > 90 || cap <= 0n) throw new Error("invalid_policy_bounds");
  const groups = mode === "in" ? [addresses] : addresses.map(address => [address]);
  const rules: CreatePolicyBody["rules"] = groups.map(group => ({ action: "accept", operation: "sendEvmTransaction",
    criteria: [
      { type: "evmNetwork", networks: ["base-sepolia"], operator: "in" },
      { type: "evmAddress", addresses: [USDC_ADDRESS], operator: "in" },
      { type: "ethValue", ethValue: "0", operator: "==" },
      { type: "evmData", abi: "erc20", conditions: [{ function: "transfer", params: [
        mode === "in" ? { name: "to", operator: "in", values: group } : { name: "to", operator: "==", value: group[0]! },
        { name: "value", operator: "<=", value: cap.toString() },
        { name: "value", operator: ">", value: "0" },
      ] }] },
    ],
  }));
  // A targeted operation with no matching accept is rejected. These reject-only
  // rules also close alternative signing routes, including raw hash signing.
  rules.push(
    { action: "reject", operation: "signEvmTransaction", criteria: [{ type: "ethValue", operator: ">=", ethValue: "0" }] },
    { action: "reject", operation: "signEvmHash" },
    { action: "reject", operation: "signEvmMessage", criteria: [{ type: "evmMessage", match: ".*" }] },
    { action: "reject", operation: "signEvmTypedData", criteria: [{ type: "evmTypedDataVerifyingContract", operator: "in", addresses: [ZERO] }] },
    { action: "reject", operation: "prepareUserOperation", criteria: [{ type: "ethValue", operator: ">=", ethValue: "0" }] },
    { action: "reject", operation: "sendUserOperation", criteria: [{ type: "ethValue", operator: ">=", ethValue: "0" }] },
  );
  return { scope: "account", description: "Skarl approved Base Sepolia USDC payouts", rules };
}

export async function assertNoProjectOverride(cdp: CdpClient) {
  let pageToken: string | undefined;
  do {
    const page = await cdp.policies.listPolicies({ scope: "project", pageSize: 100, pageToken });
    // Also reject paused accepts because an automatic resume can reopen access.
    if (page.policies.some(policy => policy.rules.some(rule => rule.action === "accept" && EVM_OPERATIONS.has(rule.operation)))) {
      throw new Error("project_accept_rules_override_account_policy_use_a_dedicated_project");
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
}

export function transfer(recipient: Address, amount: bigint) {
  return { to: USDC_ADDRESS, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, amount] }) };
}

export async function simulate(cdp: CdpClient, address: Address, recipient: Address, amount: bigint,
  override: { to?: Address; value?: bigint; data?: `0x${string}`; network?: "base" | "base-sepolia" } = {}) {
  const { network = "base-sepolia", ...transaction } = override;
  return cdp.policies.simulate({ operation: "sendEvmTransaction", address, network,
    transaction: serializeTransaction({ ...transfer(recipient, amount), ...transaction,
      type: "eip1559", chainId: network === "base-sepolia" ? PAYMENT_CHAIN_ID : 8453,
      nonce: 0, gas: 100_000n, maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 1_000_000n }) });
}

export function evidence(label: string, result: PolicySimulationResult) {
  console.log(JSON.stringify({ label, simulated: true, action: result.action, reason: result.reason,
    matchedRule: result.matchedRule, unmatchedRules: result.unmatchedRules, evaluatedPolicies: result.evaluatedPolicies }));
}

export function outsider(addresses: Address[]): Address {
  const candidate = "0x000000000000000000000000000000000000dEaD";
  if (addresses.some(address => address.toLowerCase() === candidate.toLowerCase())) throw new Error("probe_recipient_is_allowlisted");
  return candidate;
}

export async function verifyPolicy(cdp: CdpClient, address: Address, policyId: string, addresses: Address[], cap: bigint) {
  const allowed = await simulate(cdp, address, addresses[0]!, cap);
  evidence("allowlisted_at_cap", allowed);
  if (allowed.action !== "accept" || allowed.matchedRule?.policy.id !== policyId || allowed.matchedRule.policy.scope !== "account") {
    throw new Error("account_policy_did_not_accept_bound_transfer");
  }
  const probes = [
    ["over_cap", addresses[0]!, cap + 1n, {}],
    ["non_allowlisted", outsider(addresses), 1n, {}],
    ["wrong_token", addresses[0]!, 1n, { to: outsider(addresses) }],
    ["native_value", addresses[0]!, 1n, { value: 1n }],
    ["wrong_network", addresses[0]!, 1n, { network: "base" as const }],
    ["wrong_function", addresses[0]!, 1n, { data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [addresses[0]!, 1n] }) }],
  ] as const;
  for (const [label, recipient, amount, override] of probes) {
    const result = await simulate(cdp, address, recipient, amount, override);
    evidence(label, result);
    if (result.action !== "reject") throw new Error(`policy_accepted_${label}`);
  }
}
