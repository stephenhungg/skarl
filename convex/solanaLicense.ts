"use node";
import { CdpClient } from "@coinbase/cdp-sdk";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { envString } from "./lib/config";
import { mintLicenseWithCdp } from "../packages/payments/src/solana-license";
import { solanaRpc } from "../packages/payments/src/solana";

type MintResult = { ok: false; code: string } | { ok: true; status: "minted" | "unconfirmed"; mintAddress: string; signature: string };

/** Mints the devnet Token-2022 license for one published delivery. Testnet only; never moves treasury or payout funds. */
export const mintForDelivery = internalAction({
  args: { deliveryId: v.id("deliveries") },
  handler: async (ctx, args): Promise<MintResult> => {
    const prepared = await ctx.runMutation(internal.solanaLicenseData.prepare, { deliveryId: args.deliveryId });
    if (!prepared.ok) return prepared;
    if (!process.env.CDP_API_KEY_ID || !process.env.CDP_API_KEY_SECRET || !process.env.CDP_WALLET_SECRET) {
      await ctx.runMutation(internal.solanaLicenseData.record, { licenseId: prepared.licenseId, outcome: { status: "skipped", error: "cdp_unconfigured" } });
      return { ok: false, code: "cdp_unconfigured" };
    }
    try {
      const minted = await mintLicenseWithCdp({ solana: new CdpClient().solana, rpc: solanaRpc(), terms: prepared.terms,
        accountName: envString("SKARL_CDP_SOLANA_LICENSE_ACCOUNT", "skarl-license-devnet"), idempotencyKey: prepared.idempotencyKey });
      const status = "unconfirmed" in minted ? "unconfirmed" as const : "minted" as const;
      await ctx.runMutation(internal.solanaLicenseData.record, { licenseId: prepared.licenseId,
        outcome: { status, mintAddress: minted.mint, signature: minted.signature, holderAddress: minted.holder } });
      return { ok: true, status, mintAddress: minted.mint, signature: minted.signature };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      console.error("solana_license_mint_failed", { deliveryId: args.deliveryId, message: message.slice(0, 200) });
      await ctx.runMutation(internal.solanaLicenseData.record, { licenseId: prepared.licenseId, outcome: { status: "failed", error: message } });
      return { ok: false, code: "mint_failed" };
    }
  },
});
