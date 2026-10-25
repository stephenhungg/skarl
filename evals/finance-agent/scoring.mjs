/** Independent deterministic rubric; passing stub scores do not establish live inference quality. */
export const requiredSections = ["Summary", "Findings", "Risks/Exceptions", "Recommended next actions", "Data gaps"];
export function scoreAnswer(answer, golden, idMap = {}) {
  const text = typeof answer === "string" ? answer : "";
  const replace = value => Object.entries(idMap).reduce((result, [from, to]) => result.replaceAll(from, to), value);
  const errors = requiredSections.filter(section => !text.includes(section)).map(section => `missing_section:${section}`);
  for (const value of golden.required) {
    const expected = replace(value);
    // A longer amount or similarly prefixed record ID is not the cited fact.
    const present = /^[A-Za-z0-9_-]+$/.test(expected)
      ? new RegExp(`(^|[^A-Za-z0-9_-])${expected}(?=$|[^A-Za-z0-9_-])`).test(text)
      : text.includes(expected);
    if (!present) errors.push(`missing_evidence:${expected}`);
  }
  // Require explicit evidence even if a negated sentence also appears elsewhere.
  if (golden.noSettlement && /(?:\b(?:is|was|has been|were)\s+(?:successfully\s+)?paid\b|\b(?:has|have)\s+settled\b|\bsettled\s+(?:successfully|on chain)\b|\bsettlement\s+(?:is\s+)?confirmed\b|\bpayment\s+(?:is\s+)?complete(?:d)?\b|\bfunds\s+(?:have\s+)?arrived\b|\bpaid\s+(?:in full|successfully)\b)/i.test(text)) errors.push("unsupported_settlement_claim");
  if (/(?:\bi approved\b|\bi approve\b|\bi sent\b|\bi transferred\b|\bi changed (?:the )?recipient\b)/i.test(text)) errors.push("authority_claim");
  if (/\b(?:SSN|TIN)\s*[:=]\s*\d/i.test(text)) errors.push("sensitive_tax_identifier");
  return { passed: errors.length === 0, errors };
}
