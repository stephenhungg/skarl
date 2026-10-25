import { PAYMENT_CHAIN_ID, USDC_ADDRESS } from "../../packages/contracts/src/chain";
import { createNessieClient } from "./nessie";
import type { Infer } from "convex/values";
import type { healthProbe } from "../healthSchema";
import { digest } from "./finance";

export type Probe = Infer<typeof healthProbe>;
export const probeBinding = (kind: Probe["kind"], subject: string | null | undefined) =>
  digest({ kind, subject: kind === "nessie" ? subject ?? "" : subject?.toLowerCase() ?? "" });
export async function probeBalance(kind: "agent_wallet" | "treasury", address: string | null | undefined,
  rpcUrl: string | undefined, fetchImpl: typeof fetch = fetch): Promise<Probe> {
  const checkedAt = Date.now();
  if (!address || !/^0x[\da-fA-F]{40}$/.test(address) || /^0x0{40}$/i.test(address)) return { kind, checkedAt, outcome: "unconfigured" };
  async function rpc(method: string, params: unknown[]) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetchImpl(rpcUrl || "https://sepolia.base.org", { method: "POST", redirect: "error",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: controller.signal });
      if (!response.ok) throw new Error("rpc_failed");
      const body = await response.json() as { result?: unknown; error?: unknown };
      if (body.error || typeof body.result !== "string" || !/^0x[\da-fA-F]{1,64}$/.test(body.result)) throw new Error("rpc_invalid");
      return body.result;
    } finally { clearTimeout(timer); }
  }
  try {
    if (BigInt(await rpc("eth_chainId", [])) !== BigInt(PAYMENT_CHAIN_ID)) throw new Error("wrong_chain");
    const block = await rpc("eth_blockNumber", []);
    const [eth, usdc] = await Promise.all([
      rpc("eth_getBalance", [address, block]),
      rpc("eth_call", [{ to: USDC_ADDRESS, data: `0x70a08231${address.slice(2).toLowerCase().padStart(64, "0")}` }, block]),
    ]);
    return { kind, checkedAt, outcome: "success", bindingHash: probeBinding(kind, address), blockNumber: BigInt(block).toString(), ethWei: BigInt(eth).toString(), usdcMicro: BigInt(usdc).toString() };
  } catch {
    // RPC URLs and thrown errors can contain credentials; return only a closed code.
    return { kind, checkedAt, outcome: "failed" };
  }
}

export async function probeNessie(accountId: string | null, apiKey: string | undefined, enabled: boolean,
  fetchImpl: typeof fetch = fetch): Promise<Probe> {
  const checkedAt = Date.now(), kind = "nessie" as const;
  if (!accountId || !apiKey?.trim() || !enabled) return { kind, checkedAt, outcome: "unconfigured" };
  try {
    // A GET [] with an invalid key is not proof of authenticated reachability.
    await createNessieClient({ apiKey, fetchImpl: (url, init) => fetchImpl(url, { ...init, redirect: "error" }) }).verifyAccount(accountId);
    return { kind, checkedAt, outcome: "success", bindingHash: probeBinding(kind, accountId) };
  } catch { return { kind, checkedAt, outcome: "failed" }; }
}
