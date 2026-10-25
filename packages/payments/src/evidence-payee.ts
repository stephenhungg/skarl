/** Operator configuration, never supplied by a buyer or model response. */
export function evidencePayTo(env: Record<string, string | undefined> = process.env): string {
  const address = env.SKARL_EVIDENCE_PAYTO;
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address) || /^0x0{40}$/i.test(address) ||
    address.toLowerCase() === env.SKARL_TREASURY_ADDRESS?.toLowerCase()) {
    throw new Error("evidence_payto_not_configured");
  }
  return address.toLowerCase();
}
