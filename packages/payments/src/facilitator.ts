import { createCdpFacilitatorClient } from "@coinbase/cdp-sdk/x402";
import { HTTPFacilitatorClient } from "@x402/core/server";

/** Never downgrade to the public facilitator after a CDP authentication/settlement failure. */
export function paymentFacilitator(env: NodeJS.ProcessEnv = process.env) {
  const apiKeyId = env.CDP_API_KEY_ID, apiKeySecret = env.CDP_API_KEY_SECRET;
  if (!!apiKeyId !== !!apiKeySecret) throw new Error("payment_service_not_configured");
  if (apiKeyId && apiKeySecret) return {
    id: "cdp" as const,
    url: "https://api.cdp.coinbase.com/platform/v2/x402",
    client: createCdpFacilitatorClient({ apiKeyId, apiKeySecret }),
  };
  const url = env.X402_FACILITATOR_URL || "https://x402.org/facilitator";
  return { id: url === "https://x402.org/facilitator" ? "x402.org" as const : "custom" as const,
    url, client: new HTTPFacilitatorClient({ url }) };
}
