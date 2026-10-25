/** Operator-only identity defaults. Runtime deployment URLs must be supplied explicitly. */
const positiveBigInt = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`invalid_config:${name}`);
  return BigInt(value);
};
export const scriptConfig = {
  agentAccountName: process.env.SKARL_CDP_AGENT_ACCOUNT || "skarl-finance-agent",
  policyProbeAccountName: process.env.SKARL_CDP_POLICY_PROBE_ACCOUNT || "skarl-policy-probe",
  easRegistrarAccountName: process.env.SKARL_EAS_REGISTRAR_ACCOUNT || "skarl-eas-registrar",
  get attestorFaucetMinimumWei() { return positiveBigInt("SKARL_ATTESTOR_FAUCET_MINIMUM_WEI", "20000000000000"); },
  buyerIdentity: process.env.SKARL_BUYER_IDENTITY || "buyer",
  contributorIdentity: process.env.SKARL_CONTRIBUTOR_IDENTITY || "contributor",
  financeIdentity: process.env.SKARL_FINANCE_IDENTITY || "finance-agent",
  financeTokenIdentifier: process.env.SKARL_FINANCE_TOKEN_IDENTIFIER || "demo:skarl:finance-agent",
};
