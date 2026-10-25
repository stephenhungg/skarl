import { declareDiscoveryExtension, bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import { fundingRouteConfig } from "./funding.ts";
export { bazaarResourceServerExtension };
export const EVIDENCE_PRICE_ATOMIC = 250_000n;

export function evidenceRouteConfig(revenueAddress: string) {
  return { ...fundingRouteConfig(EVIDENCE_PRICE_ATOMIC, revenueAddress),
    description: "Skarl accepted sample verification evidence: stored multimodal report and five-minute licensed media access. Base Sepolia testnet USDC; accepted, delivered samples only.",
    extensions: declareDiscoveryExtension({ input: {},
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      output: { example: { sampleId: "sample-example", report: {},
        media: { url: "https://example.invalid/api/samples/sample-example/media?token=illustrative", expiresAt: 2000000000000, mimeType: "video/mp4" },
        settlement: { status: "confirmed", txHash: `0x${"0".repeat(64)}`, facilitator: "cdp" }, accountingTreatment: "evidence_sale_inflow" },
        schema: { type: "object", required: ["sampleId", "report", "media", "settlement", "accountingTreatment"], properties: {
        sampleId: { type: "string" }, report: { type: "object", description: "Stored Skarl verification report; model evidence is advisory." },
        media: { type: "object", required: ["url", "expiresAt", "mimeType"], properties: {
          url: { type: "string", format: "uri" }, expiresAt: { type: "integer", description: "Unix milliseconds" }, mimeType: { type: "string" } } },
        settlement: { type: "object", required: ["status", "txHash", "facilitator"], properties: {
          status: { const: "confirmed" }, txHash: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" }, facilitator: { enum: ["cdp", "x402.org", "custom"] } } },
        accountingTreatment: { const: "evidence_sale_inflow" },
      } } },
    }),
  };
}
