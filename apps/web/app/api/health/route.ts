import { PAYMENT_NETWORK } from "@skarl/contracts/chain";

export function GET() {
  return Response.json({ service: "skarl-web", status: "scaffold", network: PAYMENT_NETWORK, capabilities: { contracts: true, authentication: false, databaseConnected: false, mediaCapture: false, inference: false, payments: false } });
}
