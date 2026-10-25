/** Conservative capability gate over the authorized request only. Retrieved prose
 * never enters this function. Ambiguous questions stay read-only. */
export function financeProposalAuthorized(request: string): boolean {
  if (/\b(?:do\s+not|don't|never|cannot|can't|without)\b[^.!?]{0,100}\b(?:propos\w*|request\s+(?:\w+\s+)?approval)\b/i.test(request)) return false;
  // A quoted instruction is evidence to inspect, not an instruction to execute.
  const direct = request.replace(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g, "[quoted data]");
  return /(?:^|[.!?;,]\s+|\band\s+|\bthen\s+)(?:please\s+|(?:can|could|would)\s+you\s+(?:please\s+)?|i(?:'d| would)?\s+(?:like|want)\s+you\s+to\s+)?(?:propose\b|prepare\s+(?:a\s+|the\s+)?(?:payment\s+|payout\s+)?batch\b|request\s+(?:independent\s+|buyer\s+|policy\s+)?approval\b)/i.test(direct);
}
