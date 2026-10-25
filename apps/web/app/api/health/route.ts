export function GET() {
  return Response.json({ service: "skarl-web", status: "scaffold", network: "solana-devnet", capabilities: { contracts: true, authentication: false, databaseConnected: false, mediaCapture: false, inference: false, payments: false } });
}
