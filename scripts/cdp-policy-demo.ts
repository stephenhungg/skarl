import { createPublicClient, erc20Abi, http } from "viem";
import { baseSepolia } from "viem/chains";
import { PAYMENT_CHAIN_ID, USDC_ADDRESS } from "../packages/contracts/src/chain.ts";
import { PROBE_NAME, assertNoProjectOverride, capAtomic, convexRun, credentials, outsider,
  requestId, safeError, transfer, verifiedAllowlist, verifyPolicy } from "./cdp-policy.ts";

async function main() {
  const cdp = credentials();
  const addresses = verifiedAllowlist(), cap = capAtomic(), policyId = process.env.CDP_AGENT_POLICY_ID;
  if (!policyId) throw new Error("CDP_AGENT_POLICY_ID_required_run_cdp_policy_apply_first");
  await assertNoProjectOverride(cdp);
  const policy = await cdp.policies.getPolicyById({ id: policyId });
  if (policy.scope !== "account" || policy.status !== "active") throw new Error("active_account_policy_required");
  const probe = await cdp.evm.getOrCreateAccount({ name: PROBE_NAME });
  await cdp.evm.updateAccount({ address: probe.address, update: { accountPolicy: policyId } });
  await verifyPolicy(cdp, probe.address, policyId, addresses, cap);
  const rpc = createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL) });
  if (await rpc.getChainId() !== PAYMENT_CHAIN_ID) throw new Error("wrong_rpc_network");
  async function assertUnfunded() {
    const [eth, usdc] = await Promise.all([rpc.getBalance({ address: probe.address }),
      rpc.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [probe.address] })]);
    if (eth !== 0n || usdc !== 0n) throw new Error("policy_probe_must_have_zero_ETH_and_USDC_do_not_fund_it");
  }
  for (const [label, recipient, amount] of [
    ["over_cap", addresses[0]!, cap + 1n], ["non_allowlisted", outsider(addresses), 1n],
  ] as const) {
    await assertUnfunded();
    try {
      const result = await cdp.evm.sendTransaction({ address: probe.address, network: "base-sepolia",
        transaction: transfer(recipient, amount), idempotencyKey: requestId(`${probe.address}:${policyId}:${label}:${recipient}:${amount}`) });
      // This probe cannot transfer: it holds no tokens and no gas. Do not claim
      // insufficient balance or any other error as a successful policy rejection.
      console.error(JSON.stringify({ label, unexpectedResponse: result }));
      throw new Error("policy_rejection_not_observed");
    } catch (error) {
      const detail = safeError(error);
      console.log(JSON.stringify({ label, simulated: false, account: "unfunded_policy_probe", address: probe.address, cdpError: detail }));
      if (detail.errorType !== "policy_violation") throw new Error(`${label}_did_not_return_CDP_policy_violation`);
    }
  }
  await assertUnfunded();
  const intentId = process.argv[2];
  if (!intentId) {
    console.log("negative CDP calls verified; approved payout not attempted: pass an existing approved intent ID to this command");
    process.exitCode = 2;
    return;
  }
  // The action accepts only an ID. Recipient and amount never come from this CLI.
  const result = convexRun("agentWallet:execute", { intentId }) as { status?: string; txHash?: string };
  console.log(JSON.stringify({ label: "stored_approved_payout", simulated: false, intentId, result }));
  const final = result.status === "confirmed" ? result
    : convexRun("agentWallet:reconcile", { intentId }) as { status?: string; txHash?: string };
  console.log(JSON.stringify({ label: "payout_reconciliation", simulated: false, intentId, result: final }));
  if (final.status !== "confirmed") {
    console.log("payout remains pending; keep the existing claim and reconcile its transaction, never resend");
    process.exitCode = 2;
  }
}

main().catch(error => { console.error(JSON.stringify({ error: safeError(error) })); process.exitCode = 1; });
