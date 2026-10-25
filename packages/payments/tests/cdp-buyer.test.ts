import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySpendControls } from "@coinbase/cdp-sdk/x402";
import { x402Client } from "@x402/core/client";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "@skarl/contracts/chain";
import { buyerClientConfig, buyerSpendControls, FileSpendStore } from "../src/cdp-buyer";
const verificationCases = JSON.parse(readFileSync(new URL("../../contracts/schemas/fixtures/verification-cases.json", import.meta.url), "utf8"));
import { evidenceResource, validateEvidenceResult } from "../src/agent-buy-evidence";

const TREASURY = `0x${"22".repeat(20)}`;
const amount = 250_000n;
const temporary: string[] = [];
function store() {
  const path = mkdtempSync(join(tmpdir(), "skarl-cdp-spend-test-")); temporary.push(path);
  return new FileSpendStore(join(path, "spend.jsonl"));
}
function clientWithStore(spendStore = store()) {
  const signer = vi.fn(async () => ({ x402Version: 2, payload: { fixture: "simulated, no signature or chain transfer" } }));
  const client = new x402Client().setSpendControls(false).register(PAYMENT_NETWORK, { scheme: "exact", createPaymentPayload: signer });
  applySpendControls(client, buyerSpendControls(TREASURY, amount, spendStore));
  return { client, signer, spendStore };
}
function challenge(overrides = {}) {
  return { x402Version: 2, resource: { url: "https://skarl.example/api/samples/sample-test/evidence", description: "fixture", mimeType: "application/json" },
    accepts: [{ scheme: "exact", network: PAYMENT_NETWORK, asset: USDC_ADDRESS, payTo: TREASURY, amount: amount.toString(), maxTimeoutSeconds: 300, extra: {}, ...overrides }] };
}
afterEach(() => { vi.unstubAllEnvs(); for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("CDP buyer spend controls (simulated signer)", () => {
  it("configures only Base Sepolia exact with treasury and canonical USDC restrictions", () => {
    const config = buyerClientConfig(TREASURY, amount, store());
    expect(config.environment).toBe("development");
    expect(config.networkSchemes).toHaveLength(1);
    expect(config.networkSchemes![0]).toMatchObject({ network: "base-sepolia", scheme: { exact: true, upto: false, authCapture: false, batchSettlement: false } });
    expect(config.spendControls).toMatchObject({ allowedPayees: [TREASURY], allowedNetworks: [PAYMENT_NETWORK], allowedAssets: [USDC_ADDRESS],
      maxAmountPerPayment: { atomic: amount, asset: USDC_ADDRESS }, maxCumulativeSpend: { atomic: 20_000_000n, asset: USDC_ADDRESS }, maxCumulativeSpendWindow: "24h" });
  });
  it.each([
    { payTo: `0x${"33".repeat(20)}` }, { asset: `0x${"44".repeat(20)}` }, { network: "eip155:8453" }, { amount: "250001" },
  ])("refuses an unapproved quote before signing: %j", async overrides => {
    const { client, signer } = clientWithStore();
    await expect(client.createPaymentPayload(challenge(overrides))).rejects.toThrow();
    expect(signer).not.toHaveBeenCalled();
  });
  it("persists exact reservations before signing and enforces cumulative spend after restart", async () => {
    vi.stubEnv("SKARL_CDP_MAX_CUMULATIVE_ATOMIC", "250000");
    const first = clientWithStore();
    first.signer.mockImplementation(async () => {
      expect(await first.spendStore.load()).toMatchObject([{ atomicAmount: amount, asset: USDC_ADDRESS.toLowerCase() }]);
      return { x402Version: 2, payload: { fixture: "simulated" } };
    });
    await first.client.createPaymentPayload(challenge());
    const second = clientWithStore(new FileSpendStore(first.spendStore.path));
    await expect(second.client.createPaymentPayload(challenge())).rejects.toThrow(/cumulative spend/);
    expect(second.signer).not.toHaveBeenCalled();
    expect(readFileSync(first.spendStore.path, "utf8")).toContain('"atomicAmount":"250000"');
  });
  it("keeps a reservation after ambiguous signer failure", async () => {
    const { client, signer, spendStore } = clientWithStore();
    signer.mockRejectedValue(new Error("unknown signing response"));
    await expect(client.createPaymentPayload(challenge())).rejects.toThrow();
    expect(await spendStore.load()).toHaveLength(1);
  });
  it("rejects invalid treasury and floating cap values", () => {
    expect(() => buyerSpendControls("", amount)).toThrow(/SKARL_TREASURY_ADDRESS/);
    vi.stubEnv("SKARL_CDP_MAX_CUMULATIVE_ATOMIC", "0.25");
    expect(() => buyerSpendControls(TREASURY, amount)).toThrow(/positive integer/);
  });
});

describe("evidence buyer output boundaries", () => {
  const validResult = () => ({ sampleId: "sample-abc", report: { ...structuredClone(verificationCases.bases.accept), submissionId: "abc" },
    media: { url: "https://skarl.example/api/samples/sample-abc/media?token=fixture-only", expiresAt: Date.now() + 300_000, mimeType: "video/webm" },
    settlement: { status: "confirmed", txHash: `0x${"aa".repeat(32)}`, facilitator: "cdp" }, accountingTreatment: "funding_like_inflow" });
  const resource = new URL("https://skarl.example/api/samples/sample-abc/evidence");
  it("accepts bound completed fixture evidence with a short-lived gateway and known settlement", () => {
    expect(() => validateEvidenceResult(validResult(), resource)).not.toThrow();
  });
  it.each(["sample", "report", "pipeline", "media_path", "media_expiry", "media_type", "facilitator", "accounting"]) ("refuses invalid paid evidence binding: %s", field => {
    const result = validResult();
    if (field === "sample") result.sampleId = "sample-other";
    if (field === "report") result.report.submissionId = "other";
    if (field === "pipeline") result.report.pipeline.status = "needs_review";
    if (field === "media_path") result.media.url = "https://skarl.example/private?token=fixture";
    if (field === "media_expiry") result.media.expiresAt = Date.now() + 600_000;
    if (field === "media_type") result.media.mimeType = "text/html";
    if (field === "facilitator") result.settlement.facilitator = "invented";
    if (field === "accounting") result.accountingTreatment = "revenue";
    expect(() => validateEvidenceResult(result, resource)).toThrow();
  });
  it("normalizes the Bazaar sample prefix and rejects path injection", () => {
    const app = new URL("https://skarl.example");
    expect(evidenceResource("abc", app).href).toBe("https://skarl.example/api/samples/sample-abc/evidence");
    expect(evidenceResource("sample-abc", app).href).toBe("https://skarl.example/api/samples/sample-abc/evidence");
    expect(() => evidenceResource("../../private", app)).toThrow();
  });
  it("rejects arbitrary reports and media without treating a paid response as valid evidence", () => {
    expect(() => validateEvidenceResult({ sampleId: "sample-abc", report: {}, media: { url: "https://evil.example/private", expiresAt: Date.now() + 1000 } }, evidenceResource("abc", new URL("https://skarl.example")))).toThrow(/validation/);
  });
});
