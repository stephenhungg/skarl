import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { parseAtomicUsdc } from "@skarl/contracts";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "@skarl/contracts/chain";

export type FundingAutoPayRule = {
  enabled: boolean;
  maxPerClipAtomic: string;
  requireAllChecks: true;
};
export type FundingTerms = {
  orderId: string;
  amountAtomic: string;
  payTo: string;
  autoPay: FundingAutoPayRule | null;
};

function positiveAmount(value: unknown): string {
  if (typeof value !== "string") throw new Error("invalid_funding_terms_amount");
  const amount = parseAtomicUsdc(value);
  if (amount <= 0n) throw new Error("invalid_funding_terms_amount");
  return amount.toString();
}

/** Public reviewed terms commitment, not authorization. No Node APIs: also runs in Convex. */
export function fundingTermsHash(terms: FundingTerms): string {
  if (!terms || typeof terms !== "object" || typeof terms.orderId !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(terms.orderId) || typeof terms.payTo !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(terms.payTo) || /^0x0{40}$/i.test(terms.payTo)) throw new Error("invalid_funding_terms");
  const amount = positiveAmount(terms.amountAtomic);
  const rule = terms.autoPay;
  if (rule !== null && (!rule || typeof rule !== "object" || Array.isArray(rule) ||
    typeof rule.enabled !== "boolean" || rule.requireAllChecks !== true)) throw new Error("invalid_funding_terms_rule");
  // The ordered, versioned tuple deliberately excludes rule author/time metadata.
  // Preserve disabled policies and their caps rather than collapsing them to no rule.
  const tuple = ["skarl-funding-terms-v1", PAYMENT_NETWORK, USDC_ADDRESS.toLowerCase(),
    terms.orderId, amount, terms.payTo.toLowerCase(),
    rule === null ? null : [rule.enabled, positiveAmount(rule.maxPerClipAtomic), true]];
  return bytesToHex(sha256(utf8ToBytes(JSON.stringify(tuple))));
}
