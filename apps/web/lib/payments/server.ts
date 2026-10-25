import { ConvexHttpClient } from "convex/browser";
import { isAddress } from "viem";
import { NextResponse } from "next/server";
export { api } from "../../../../convex/_generated/api";
export type { Id } from "../../../../convex/_generated/dataModel";

export function paymentService() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  const serviceSecret = process.env.SKARL_PAYMENTS_SERVICE_SECRET;
  if (!url || !serviceSecret || serviceSecret.length < 32) throw new Error("payment_service_not_configured");
  return { db: new ConvexHttpClient(url), serviceSecret };
}
export function treasuryAddress() {
  const address = process.env.SKARL_TREASURY_ADDRESS;
  if (!address || !isAddress(address) || /^0x0{40}$/i.test(address)) throw new Error("treasury_not_configured");
  return address;
}
/** Missing configuration leaves the primary Base route available. */
export function solanaTreasuryAddress() {
  const address = process.env.SKARL_SOLANA_TREASURY_ADDRESS;
  if (!address) return undefined;
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    console.error("solana_treasury_not_configured");
    return undefined;
  }
  return address;
}
export function paymentJson(value: unknown, status = 200) {
  return NextResponse.json(JSON.parse(JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v)),
    { status, headers: { "Cache-Control": "private, no-store" } });
}
export function paymentError(error: unknown) {
  // Convex error wrappers can carry request details. Never echo them (or secrets) to a browser.
  const message = error instanceof Error ? error.message : "";
  const code = ["solana_treasury_not_configured", "treasury_not_configured", "payment_service_not_configured", "wrong_treasury_wallet", "payout_not_executable",
    "dispatch_not_ready", "approved_source_changed", "approval_invalidated",
    "claim_not_found", "order_not_found", "order_not_fundable", "transaction_already_bound", "funding_already_pending_reconcile_first"]
    .find(c => message.includes(c)) ?? "payment_request_refused";
  return paymentJson({ ok: false, error: code,
    ...(code === "treasury_not_configured" ? {
      message: "Set SKARL_TREASURY_ADDRESS in the web server environment to the human controller's Coinbase Wallet receiving address before funding.",
    } : {}),
  }, code.endsWith("not_configured") ? 503 : 409);
}
