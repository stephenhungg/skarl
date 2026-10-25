import { paymentConfig } from "./config.ts";
import { isDeepStrictEqual } from "node:util";
import { x402ResourceServer, type FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements, SupportedResponse } from "@x402/core/types";
import { SOLANA_PAYMENT_NETWORK } from "@skarl/contracts/chain";

const SUPPORTED_TTL_MS = paymentConfig.facilitatorCacheTtlMs;

/** Only the selected facilitator's current Devnet support can authorize a fee payer. */
export function supportedSolanaFeePayers(supported: SupportedResponse): Set<string> {
  const kinds = supported.kinds.filter(kind => kind.x402Version === 2 && kind.scheme === "exact" && kind.network === SOLANA_PAYMENT_NETWORK);
  if (!kinds.length) return new Set();
  return new Set([...kinds.map(kind => kind.extra?.feePayer),
    ...(supported.signers[SOLANA_PAYMENT_NETWORK] ?? []), ...(supported.signers["solana:*"] ?? [])]
    .filter((value): value is string => typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)));
}

/** Request-local cache: never accumulates historical fee payers across quotes. */
export class FundingResourceServer extends x402ResourceServer {
  private readonly currentSupport: () => { response: SupportedResponse; fetchedAt: number } | undefined;

  constructor(client: FacilitatorClient) {
    let cached: { response: SupportedResponse; fetchedAt: number } | undefined;
    const getSupported = async () => {
      if (!cached || Date.now() - cached.fetchedAt >= SUPPORTED_TTL_MS) {
        const response = await client.getSupported();
        cached = { response, fetchedAt: Date.now() };
      }
      return cached.response;
    };
    const validate = async (payload: PaymentPayload, requirements: PaymentRequirements) => {
      if (requirements.network !== SOLANA_PAYMENT_NETWORK) return;
      const feePayer = payload.accepted.extra?.feePayer;
      if (typeof feePayer !== "string" || requirements.extra?.feePayer !== feePayer ||
        !supportedSolanaFeePayers(await getSupported()).has(feePayer)) throw new Error("unsupported_solana_fee_payer");
    };
    super({ getSupported,
      verify: async (payload, requirements) => { await validate(payload, requirements); return client.verify(payload, requirements); },
      settle: async (payload, requirements) => { await validate(payload, requirements); return client.settle(payload, requirements); },
    });
    this.currentSupport = () => cached;
  }

  override findMatchingRequirements(available: PaymentRequirements[], payload: PaymentPayload): PaymentRequirements | undefined {
    if (payload.accepted?.network !== SOLANA_PAYMENT_NETWORK) return super.findMatchingRequirements(available, payload);
    const current = this.currentSupport();
    const feePayer = payload.accepted.extra?.feePayer;
    if (payload.x402Version !== 2 || !current || Date.now() - current.fetchedAt >= SUPPORTED_TTL_MS ||
      typeof feePayer !== "string" || !supportedSolanaFeePayers(current.response).has(feePayer)) return undefined;
    // Change only the server's fee-payer expectation, never the signed payload.
    // All other extras (including the order memo) and all core fields stay exact.
    const { feePayer: _acceptedFee, ...acceptedExtra } = payload.accepted.extra;
    const candidates = available.filter(requirement => {
      const { feePayer: _quotedFee, ...quotedExtra } = requirement.extra ?? {};
      return requirement.network === SOLANA_PAYMENT_NETWORK && isDeepStrictEqual(quotedExtra, acceptedExtra);
    }).map(requirement => ({ ...requirement, extra: { ...requirement.extra, feePayer } }));
    return super.findMatchingRequirements(candidates, payload);
  }
}
