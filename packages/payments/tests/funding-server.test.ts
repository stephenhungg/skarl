import { afterEach, describe, expect, it, vi } from "vitest";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import type { PaymentPayload, PaymentRequirements, SupportedResponse } from "@x402/core/types";
import { PAYMENT_NETWORK, SOLANA_PAYMENT_NETWORK, SOLANA_USDC_MINT, USDC_ADDRESS } from "@skarl/contracts/chain";
import { FundingResourceServer, supportedSolanaFeePayers } from "../src/funding-server";

const OLD = "11111111111111111111111111111111";
const CURRENT = "CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5";
const OTHER = "5vrHh4EG9dChLEEAkgedPUEq2gjYj95822kSjsCXPshh";
const support = (feePayer = CURRENT): SupportedResponse => ({ kinds: [
  { x402Version: 2, scheme: "exact", network: PAYMENT_NETWORK },
  { x402Version: 2, scheme: "exact", network: SOLANA_PAYMENT_NETWORK, extra: { feePayer } },
], extensions: [], signers: {} });
const requirement = (feePayer = OLD): PaymentRequirements => ({ scheme: "exact", network: SOLANA_PAYMENT_NETWORK,
  asset: SOLANA_USDC_MINT, payTo: OTHER, amount: "1000000", maxTimeoutSeconds: 60,
  extra: { memo: "skarl:order-sol", feePayer } });
const payload = (accepted = requirement(CURRENT)): PaymentPayload => ({ x402Version: 2, accepted, payload: { transaction: "synthetic" } });

async function fixture(response = support()) {
  const client = { getSupported: vi.fn().mockResolvedValue(response),
    verify: vi.fn().mockResolvedValue({ isValid: true, payer: OTHER }),
    settle: vi.fn().mockResolvedValue({ success: true, transaction: "synthetic", network: SOLANA_PAYMENT_NETWORK }) };
  const server = new FundingResourceServer(client).register(PAYMENT_NETWORK, new ExactEvmScheme())
    .register(SOLANA_PAYMENT_NETWORK, new ExactSvmScheme());
  await server.initialize();
  return { server, client };
}

afterEach(() => vi.useRealTimers());

describe("current Solana facilitator fee-payer membership", () => {
  it("accepts only Devnet exact v2 fee payers and applicable signer lists", () => {
    const response = support();
    response.kinds.push({ x402Version: 1, scheme: "exact", network: SOLANA_PAYMENT_NETWORK, extra: { feePayer: OLD } },
      { x402Version: 2, scheme: "upto", network: SOLANA_PAYMENT_NETWORK, extra: { feePayer: OLD } },
      { x402Version: 2, scheme: "exact", network: "solana:other", extra: { feePayer: OLD } });
    response.signers = { [SOLANA_PAYMENT_NETWORK]: [OTHER, "invalid"], "solana:*": [CURRENT],
      "solana:other": [OLD], "eip155:*": [OLD] };
    expect(supportedSolanaFeePayers(response)).toEqual(new Set([CURRENT, OTHER]));
    response.kinds = response.kinds.filter(kind => kind.scheme !== "exact" || kind.x402Version !== 2 || kind.network !== SOLANA_PAYMENT_NETWORK);
    expect(supportedSolanaFeePayers(response)).toEqual(new Set());
  });

  it("uses a supported rotated payer without mutating the quote or payload", async () => {
    const { server, client } = await fixture();
    const quote = requirement();
    const signed = payload();
    const matched = server.findMatchingRequirements([quote], signed);
    expect(matched).toEqual(requirement(CURRENT));
    expect(quote.extra.feePayer).toBe(OLD);
    await expect(server.verifyPayment(signed, matched!)).resolves.toMatchObject({ isValid: true });
    await expect(server.settlePayment(signed, matched!)).resolves.toMatchObject({ success: true });
    expect(client.getSupported).toHaveBeenCalledTimes(1);
    expect(client.verify.mock.calls[0]?.[1]).toEqual(requirement(CURRENT));
    expect(signed).toEqual(payload());
  });

  it("rejects missing, unsupported or case-mutated fee payers", async () => {
    const { server, client } = await fixture();
    for (const feePayer of [undefined, OTHER, CURRENT.toLowerCase()]) {
      const signed = payload({ ...requirement(), extra: { memo: "skarl:order-sol", feePayer } });
      expect(server.findMatchingRequirements([requirement()], signed)).toBeUndefined();
    }
    await expect(server.verifyPayment(payload(), requirement())).rejects.toThrow("unsupported_solana_fee_payer");
    expect(client.verify).not.toHaveBeenCalled();
  });

  it.each([
    { scheme: "upto" }, { network: "solana:other" }, { asset: OTHER }, { payTo: CURRENT },
    { amount: "1000001" }, { maxTimeoutSeconds: 61 },
    { extra: { feePayer: CURRENT, memo: "skarl:other" } },
    { extra: { feePayer: CURRENT } },
    { extra: { feePayer: CURRENT, memo: "skarl:order-sol", arbitrary: true } },
  ])("rejects every non-fee-payer requirement change: %j", async changes => {
    const { server } = await fixture();
    const changed = { ...requirement(CURRENT), ...changes } as PaymentRequirements;
    expect(server.findMatchingRequirements([requirement()], payload(changed))).toBeUndefined();
  });

  it("leaves Base exact matching and facilitator verification unchanged", async () => {
    const { server, client } = await fixture();
    const base: PaymentRequirements = { scheme: "exact", network: PAYMENT_NETWORK, asset: USDC_ADDRESS,
      payTo: `0x${"22".repeat(20)}`, amount: "1000000", maxTimeoutSeconds: 300, extra: { name: "USDC", version: "2" } };
    expect(server.findMatchingRequirements([base], payload(base))).toBe(base);
    expect(server.findMatchingRequirements([base], payload({ ...base, amount: "1000001" }))).toBeUndefined();
    await expect(server.verifyPayment(payload(base), base)).resolves.toMatchObject({ isValid: true });
    expect(client.verify).toHaveBeenCalledTimes(1);
    expect(client.getSupported).toHaveBeenCalledTimes(1);
  });

  it("refuses expired matching data and refreshes membership before dispatch", async () => {
    vi.useFakeTimers();
    const { server, client } = await fixture();
    const signed = payload();
    const matched = server.findMatchingRequirements([requirement()], signed)!;
    vi.advanceTimersByTime(29_999);
    await expect(server.verifyPayment(signed, matched)).resolves.toMatchObject({ isValid: true });
    expect(client.getSupported).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(server.findMatchingRequirements([requirement()], signed)).toBeUndefined();
    client.getSupported.mockResolvedValue(support(OTHER));
    await expect(server.settlePayment(signed, matched)).rejects.toThrow("unsupported_solana_fee_payer");
    expect(client.getSupported).toHaveBeenCalledTimes(2);
    expect(client.settle).not.toHaveBeenCalled();
    expect(server.findMatchingRequirements([requirement()], signed)).toBeUndefined();
    expect(server.findMatchingRequirements([requirement()], payload(requirement(OTHER)))).toEqual(requirement(OTHER));
  });

  it("fails closed on support refresh errors without retaining expired authorization", async () => {
    vi.useFakeTimers();
    const { server, client } = await fixture();
    const signed = payload();
    const matched = server.findMatchingRequirements([requirement()], signed)!;
    vi.advanceTimersByTime(30_000);
    client.getSupported.mockRejectedValue(new Error("supported_unavailable"));
    await expect(server.verifyPayment(signed, matched)).rejects.toThrow("supported_unavailable");
    await expect(server.settlePayment(signed, matched)).rejects.toThrow("supported_unavailable");
    expect(server.findMatchingRequirements([requirement()], signed)).toBeUndefined();
    expect(client.verify).not.toHaveBeenCalled();
    expect(client.settle).not.toHaveBeenCalled();
  });
});
