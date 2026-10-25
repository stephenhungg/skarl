/** Discover the public x402 challenge, inspect its Bazaar declaration, then buy. */
import { evidencePayTo } from "./evidence-payee.ts";
import { pathToFileURL } from "node:url";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { validateVerificationReport } from "@skarl/contracts/verification";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "@skarl/contracts/chain";
import { buyerAppUrl, buyerJson, CdpBuyerError, EVIDENCE_PRICE_ATOMIC, existingAttempt, isRecord, payWithCdp, saveEvidenceResult } from "./cdp-buyer.ts";

export function evidenceResource(sampleId: string, app = buyerAppUrl()): URL {
  if (!/^[a-zA-Z0-9_-]+$/.test(sampleId)) throw new CdpBuyerError("Usage: pnpm agent:buy-evidence <sampleId>");
  return new URL(`/api/samples/${sampleId.startsWith("sample-") ? sampleId : `sample-${sampleId}`}/evidence`, app);
}

export async function buyEvidence(args = process.argv.slice(2)) {
  if (args.length !== 1) throw new CdpBuyerError("Usage: pnpm agent:buy-evidence <sampleId>");
  const resource = evidenceResource(args[0]);
  if (existingAttempt(resource)) throw new CdpBuyerError("Evidence purchase already attempted. Inspect its saved transaction/authorization and reconcile; this command will not charge twice.");
  // The unauthenticated 402 is the authoritative per-resource discovery response.
  // A local declaration does not prove that CDP Bazaar has indexed the resource.
  const probe = await fetch(resource, { redirect: "error", signal: AbortSignal.timeout(20_000) });
  const encoded = probe.headers.get("PAYMENT-REQUIRED");
  if (probe.status !== 402 || !encoded) throw new CdpBuyerError(`Evidence discovery expected HTTP 402 with PAYMENT-REQUIRED, got ${probe.status}.`);
  const challenge = decodePaymentRequiredHeader(encoded);
  const bazaar = challenge.extensions?.bazaar;
  if (!isRecord(bazaar) || !isRecord(bazaar.info) || !isRecord(bazaar.schema)) throw new CdpBuyerError("Evidence endpoint did not declare Bazaar discovery metadata.");
  const revenueAddress = evidencePayTo();
  if (challenge.x402Version !== 2 || !challenge.accepts.some(requirement => requirement.scheme === "exact" &&
    requirement.network === PAYMENT_NETWORK && requirement.asset.toLowerCase() === USDC_ADDRESS.toLowerCase() &&
    requirement.amount === EVIDENCE_PRICE_ATOMIC.toString() && requirement.payTo.toLowerCase() === revenueAddress)) {
    throw new CdpBuyerError("Evidence quote must be exactly 0.25 canonical USDC on Base Sepolia to the approved evidence revenue wallet.");
  }
  console.log("Discovered endpoint Bazaar declaration; catalog indexing is not established by this probe.");
  const response = await payWithCdp(resource, EVIDENCE_PRICE_ATOMIC, { method: "GET" }, revenueAddress);
  const result = await buyerJson(response);
  if (response.status === 202) {
    console.log("Evidence settlement is pending reconciliation; no delivery or new charge inferred."); return;
  }
  validateEvidenceResult(result, resource);
  // The original report/media bearer URL remains in the response, never printed to
  // a shared terminal. Summaries and tx hashes are safe public demo evidence.
  const savedPath = saveEvidenceResult(resource, result);
  console.log(`Evidence saved privately: ${savedPath}`);
  console.log(`Evidence received for ${String(result.sampleId)}; report validated and short-lived media URL received privately.`);
  console.log(`Facilitator: ${String(isRecord(result.settlement) ? result.settlement.facilitator : "not reported")}`);
  return result;
}

export function validateEvidenceResult(result: Record<string, unknown>, resource: URL): void {
  const sampleId = resource.pathname.split("/")[3];
  if (result.sampleId !== sampleId || !isRecord(result.report) || !validateVerificationReport(result.report).valid || result.report.submissionId !== sampleId.slice("sample-".length) ||
    !isRecord(result.report.pipeline) || result.report.pipeline.implementation !== "inference" || result.report.pipeline.status !== "completed" || !isRecord(result.media) ||
    typeof result.media.url !== "string" || typeof result.media.mimeType !== "string" || !/^video\/[a-zA-Z0-9.+-]+$/.test(result.media.mimeType) || typeof result.media.expiresAt !== "number" ||
    !Number.isSafeInteger(result.media.expiresAt) || result.media.expiresAt <= Date.now()) throw new CdpBuyerError("Paid evidence response failed sample/report/media validation; do not pay again.");
  if (!isRecord(result.settlement) || result.settlement.status !== "confirmed" || typeof result.settlement.txHash !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(result.settlement.txHash) || !["cdp", "x402.org", "custom"].includes(String(result.settlement.facilitator)) ||
    result.accountingTreatment !== "evidence_sale_inflow") throw new CdpBuyerError("Paid evidence lacks confirmed settlement identity; reconcile before paying again.");
  const media = new URL(result.media.url, resource);
  if (media.origin !== resource.origin || media.pathname !== `/api/samples/${sampleId}/media` || media.username || media.password ||
    !media.searchParams.get("token") || result.media.expiresAt > Date.now() + 5 * 60_000 + 10_000) throw new CdpBuyerError("Evidence media URL must be a short-lived same-origin gateway URL.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buyEvidence().catch(error => {
    console.error(error instanceof CdpBuyerError ? error.message : "Evidence buyer stopped. Check private configuration and reconcile any saved attempt before retrying.");
    process.exitCode = 1;
  });
}
