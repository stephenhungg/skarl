import { afterEach, describe, expect, it, vi } from "vitest";
import { PAYMENT_CHAIN_ID, PAYMENT_RAILS, PAYMENT_NETWORK } from "../packages/contracts/src/chain";
import { probeBalance, probeNessie } from "./lib/healthProbe";

// Synthetic RPC/Nessie responses only. These checks do not establish live balances or bank access.
const ADDRESS = `0x${"12".repeat(20)}`;
afterEach(() => vi.restoreAllMocks());

describe("read-only health probe boundaries", () => {
  it("pins chain, token and block because a different network or mixed-block balances cannot establish Base Sepolia readiness", async () => {
    const calls: { method: string; params: unknown[] }[] = [];
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)); calls.push(body);
      const result = { eth_chainId: `0x${PAYMENT_CHAIN_ID.toString(16)}`, eth_blockNumber: "0xabc",
        eth_getBalance: "0x20000000000001", eth_call: "0xffffffffffffffff" }[body.method as string];
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
    }) as typeof fetch;
    const probe = await probeBalance("agent_wallet", ADDRESS, "https://rpc.example/private-key", fetcher);
    expect(probe).toMatchObject({ outcome: "success", ethWei: "9007199254740993", usdcMicro: "18446744073709551615" });
    expect(calls.map(call => call.method)).toEqual(["eth_chainId", "eth_blockNumber", "eth_getBalance", "eth_call"]);
    expect(calls[2]!.params).toEqual([ADDRESS, "0xabc"]);
    expect(calls[3]!.params).toEqual([{ to: PAYMENT_RAILS[PAYMENT_NETWORK].token,
      data: `0x70a08231${ADDRESS.slice(2).padStart(64, "0")}` }, "0xabc"]);
    expect(JSON.stringify(probe)).not.toContain(ADDRESS);
    expect(JSON.stringify(probe)).not.toContain("private-key");
  });

  it("refuses wrong-chain RPC before reading balances because mainnet funds must not satisfy a testnet preflight", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ result: "0x2105" }))) as typeof fetch;
    expect(await probeBalance("agent_wallet", ADDRESS, undefined, fetcher)).toMatchObject({ outcome: "failed" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, "", "0x1234", `0x${"00".repeat(20)}`])(
    "does not contact RPC for invalid/unconfigured address %s because no wallet binding exists", async address => {
      const fetcher = vi.fn() as typeof fetch;
      expect(await probeBalance("agent_wallet", address, undefined, fetcher)).toMatchObject({ outcome: "unconfigured" });
      expect(fetcher).not.toHaveBeenCalled();
    });

  it.each(["provider-error", "malformed", "rejected"]) (
    "redacts %s because provider errors and RPC URLs can contain credentials", async failure => {
      const secret = "synthetic-secret-do-not-publish";
      const fetcher = vi.fn(async () => {
        if (failure === "rejected") throw new Error(secret);
        return new Response(JSON.stringify(failure === "provider-error" ? { error: { message: secret } } : { result: secret }));
      }) as typeof fetch;
      const probe = await probeBalance("treasury", ADDRESS, `https://rpc.example/${secret}`, fetcher);
      expect(probe).toMatchObject({ outcome: "failed" });
      expect(JSON.stringify(probe)).not.toContain(secret);
      expect(probe).not.toHaveProperty("usdcMicro");
      expect(probe).not.toHaveProperty("ethWei");
    });

  it("requires a known account GET because Nessie can answer invalid keys with HTTP 200 and an empty list", async () => {
    const requests: RequestInit[] = [];
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      requests.push(init!); return new Response("[]");
    }) as typeof fetch;
    const probe = await probeNessie("known-account", "synthetic-private-nessie-key", true, fetcher);
    expect(probe).toMatchObject({ kind: "nessie", outcome: "failed" });
    expect(requests.every(request => request.method === "GET" && request.body === undefined)).toBe(true);
    expect(JSON.stringify(probe)).not.toContain("synthetic-private");
  });

  it("recognizes a bound Nessie account without exporting it because bank account identifiers stay private", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ _id: "known-account" }))) as typeof fetch;
    const probe = await probeNessie("known-account", "synthetic-private-nessie-key", true, fetcher);
    expect(probe).toMatchObject({ outcome: "success" });
    expect(JSON.stringify(probe)).not.toContain("known-account");
    expect(JSON.stringify(probe)).not.toContain("synthetic-private");
  });

  it.each([[null, "key", true], ["account", undefined, true], ["account", "key", false]] as const)(
    "leaves Nessie unconfigured for %s/%s/%s because a missing prerequisite cannot prove reachability", async (account, key, enabled) => {
      const fetcher = vi.fn() as typeof fetch;
      expect(await probeNessie(account, key, enabled, fetcher)).toMatchObject({ outcome: "unconfigured" });
      expect(fetcher).not.toHaveBeenCalled();
    });
});
