import { AGENT_NAME, PROBE_NAME, assertNoProjectOverride, buildPolicy, capAtomic, credentials,
  requestId, safeError, verifiedAllowlist, verifyPolicy } from "./cdp-policy.ts";

async function main() {
  const cdp = credentials();
  const addresses = verifiedAllowlist(), cap = capAtomic();
  await assertNoProjectOverride(cdp);
  const probe = await cdp.evm.getOrCreateAccount({ name: PROBE_NAME });
  let verifiedPolicyId: string | undefined;
  let selectedMode: "in" | "equals" = "in";
  for (const mode of ["in", "equals"] as const) {
    try {
      const policy = buildPolicy(addresses, cap, mode);
      const created = await cdp.policies.createPolicy({ policy, idempotencyKey: requestId(JSON.stringify(policy)) });
      await cdp.evm.updateAccount({ address: probe.address, update: { accountPolicy: created.id } });
      await verifyPolicy(cdp, probe.address, created.id, addresses, cap);
      verifiedPolicyId = created.id;
      selectedMode = mode;
      break;
    } catch (error) {
      console.error(JSON.stringify({ stage: `policy_${mode}_simulation`, error: safeError(error) }));
      if (mode === "equals") throw new Error("policy_verification_failed_agent_policy_not_changed");
      console.log("testing one equality rule per verified recipient; no agent payout has been sent");
    }
  }
  if (!verifiedPolicyId) throw new Error("verified_policy_required");
  // Validate the candidate on the probe before attaching it to the finance account.
  const account = await cdp.evm.getOrCreateAccount({ name: AGENT_NAME });
  if (process.env.CDP_AGENT_ADDRESS && process.env.CDP_AGENT_ADDRESS.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error("configured_agent_address_changed");
  }
  await cdp.evm.updateAccount({ address: account.address, update: { accountPolicy: verifiedPolicyId } });
  await verifyPolicy(cdp, account.address, verifiedPolicyId, addresses, cap);
  console.log(JSON.stringify({ policyApplied: true, accountName: AGENT_NAME, address: account.address,
    policyId: verifiedPolicyId, recipientOperator: selectedMode, recipientCount: addresses.length,
    capAtomic: cap.toString(), network: "base-sepolia", livePayoutVerified: false }));
  console.log(`CDP_AGENT_ADDRESS=${account.address}\nCDP_AGENT_POLICY_ID=${verifiedPolicyId}`);
}

main().catch(error => { console.error(JSON.stringify({ error: safeError(error) })); process.exitCode = 1; });
