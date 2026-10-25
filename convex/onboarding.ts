"use node";
import { CdpClient } from "@coinbase/cdp-sdk";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { baseRpcUrl } from "./lib/config";
import { probeBalance } from "./lib/healthProbe";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "../packages/contracts/src/chain";

const EVM_ADDRESS = /^0x[\da-fA-F]{40}$/;
const isUsableAddress = (address: string) => EVM_ADDRESS.test(address) && !/^0x0{40}$/i.test(address);

/** Read-only wallet readiness for a buyer agent: the x402 `exact` scheme needs USDC only, not ETH (the facilitator pays gas). */
export const walletStatus = internalAction({
  args: { address: v.string() },
  handler: async (_ctx, args) => {
    if (!isUsableAddress(args.address)) return { ok: false as const, code: "invalid_address" as const };
    const probe = await probeBalance("agent_wallet", args.address, baseRpcUrl());
    if (probe.outcome !== "success") return { ok: false as const, code: "balance_unavailable" as const };
    const usdcMicro = BigInt(probe.usdcMicro ?? "0");
    return { ok: true as const, address: args.address, network: PAYMENT_NETWORK, usdcContract: USDC_ADDRESS,
      usdcAtomic: usdcMicro.toString(), ethWei: probe.ethWei ?? "0", blockNumber: probe.blockNumber,
      readyToPay: usdcMicro > 0n, testnetOnly: true };
  },
});

type FaucetResult =
  | { ok: false; code: "invalid_address" | "faucet_unavailable" | "faucet_request_failed" }
  | { ok: false; code: "faucet_rate_limited"; retryAfterSeconds: number }
  | { ok: true; network: string; token: "USDC"; transactionHash: string; explorerUrl: string; testnetOnly: true; next: string };

/** Sends Base Sepolia test USDC from the CDP faucet to a caller-chosen address. Testnet only; rate limited per address, caller and globally. */
export const requestTestnetUsdc = internalAction({
  args: { address: v.string(), ipDigest: v.string() },
  handler: async (ctx, args): Promise<FaucetResult> => {
    if (!isUsableAddress(args.address)) return { ok: false as const, code: "invalid_address" as const };
    if (!process.env.CDP_API_KEY_ID || !process.env.CDP_API_KEY_SECRET) return { ok: false as const, code: "faucet_unavailable" as const };
    const reserved = await ctx.runMutation(internal.onboardingData.reserveFaucet, { address: args.address, ipDigest: args.ipDigest });
    if (!reserved.ok) return reserved;
    try {
      const result = await new CdpClient().evm.requestFaucet({ address: args.address as `0x${string}`, network: "base-sepolia", token: "usdc" });
      return { ok: true as const, network: PAYMENT_NETWORK, token: "USDC", transactionHash: result.transactionHash,
        explorerUrl: `https://sepolia.basescan.org/tx/${result.transactionHash}`, testnetOnly: true,
        next: "Wait for confirmation, then call skarl_wallet_status to confirm the balance before paying an order." };
    } catch (error) {
      console.error("faucet_request_failed", { network: PAYMENT_NETWORK, message: error instanceof Error ? error.message.slice(0, 200) : "unknown" });
      return { ok: false as const, code: "faucet_request_failed" as const };
    }
  },
});
