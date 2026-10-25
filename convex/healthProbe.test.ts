// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { PAYMENT_CHAIN_ID, USDC_ADDRESS } from "../packages/contracts/src/chain";
import { probeBalance, probeNessie } from "./lib/healthProbe";

// Synthetic transports only: these checks establish probe behavior, not live balances or banking.
const ADDRESS = `0x${"Ab".repeat(20)}`;
const BLOCK = "0x123456";
const ETH_WEI = 18_446_744_073_709_551_615n;
const USDC_MICRO = 9_007_199_254_740_993n;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const chainId = `0x${PAYMENT_CHAIN_ID.toString(16)}`;

function rpcFixture(overrides: Record<string, unknown> = {}) {
  const calls: { url: string; options: RequestInit; method: string; params: unknown[] }[] = [];
  const values: Record<string, unknown> = { eth_chainId: chainId, eth_blockNumber: BLOCK,
    eth_getBalance: `0x${ETH_WEI.toString(16)}`, eth_call: `0x${USDC_MICRO.toString(16).padStart(64, "0")}`, ...overrides };
  const fetcher = vi.fn<typeof fetch>(async (input, options) => {
    const { method, params } = JSON.parse(String(options?.body));
    calls.push({ url: String(input), options: options!, method, params });
    return json({ jsonrpc: "2.0", id: 1, result: values[method] });
  });
  return { fetcher, calls };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("health balance probes preserve read-only financial evidence", () => {
  it("uses only read RPCs on canonical Base Sepolia and the canonical USDC contract at one block", async () => {
    const { fetcher, calls } = rpcFixture();
    const result = await probeBalance("agent_wallet", ADDRESS, undefined, fetcher);
    expect(result).toMatchObject({ kind: "agent_wallet", outcome: "success", ethWei: ETH_WEI.toString(), usdcMicro: USDC_MICRO.toString() });
    expect(Number.isSafeInteger(result.checkedAt)).toBe(true);
    expect(calls.map(call => call.method)).toEqual(["eth_chainId", "eth_blockNumber", "eth_getBalance", "eth_call"]);
    expect(calls.every(call => call.url === "https://sepolia.base.org" && call.options.method === "POST" && call.options.redirect === "error")).toBe(true);
    expect(calls[2]!.params).toEqual([ADDRESS, BLOCK]);
    expect(calls[3]!.params).toEqual([{ to: USDC_ADDRESS, data: `0x70a08231${ADDRESS.slice(2).toLowerCase().padStart(64, "0")}` }, BLOCK]);
    expect(JSON.stringify(result)).not.toContain(ADDRESS);
  });

  it("keeps zero balances as observed facts so status derivation can distinguish unfunded from unavailable", async () => {
    const { fetcher } = rpcFixture({ eth_getBalance: "0x0", eth_call: `0x${"0".repeat(64)}` });
    expect(await probeBalance("treasury", ADDRESS, undefined, fetcher)).toMatchObject({ outcome: "success", ethWei: "0", usdcMicro: "0" });
  });

  it.each([null, undefined, "", "not-an-address", "0x1234", `0x${"0".repeat(40)}`])(
    "does not probe a missing or invalid address (%s), avoiding false configured evidence", async address => {
      const fetcher = vi.fn<typeof fetch>();
      expect(await probeBalance("agent_wallet", address, undefined, fetcher)).toMatchObject({ outcome: "unconfigured" });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("rejects a healthy RPC on the wrong chain before reading balances because testnet identity is part of the evidence", async () => {
    const { fetcher, calls } = rpcFixture({ eth_chainId: "0x1" });
    expect(await probeBalance("agent_wallet", ADDRESS, undefined, fetcher)).toMatchObject({ outcome: "failed" });
    expect(calls.map(call => call.method)).toEqual(["eth_chainId"]);
  });

  it.each(["0x", "0xzz", "1000000", "0x1.2", `0x${"f".repeat(65)}`, 123, null])(
    "rejects malformed balance evidence (%s) instead of coercing it to a monetary value", async value => {
      const { fetcher } = rpcFixture({ eth_call: value });
      const result = await probeBalance("treasury", ADDRESS, undefined, fetcher);
      expect(result).toMatchObject({ outcome: "failed" });
      expect(result).not.toHaveProperty("usdcMicro");
      expect(result).not.toHaveProperty("ethWei");
    },
  );

  it("never returns RPC URLs, provider bodies, or thrown errors because all may carry credentials", async () => {
    const secret = "synthetic-private-rpc-sentinel";
    for (const fetcher of [
      vi.fn<typeof fetch>(async () => { throw new Error(`request to https://rpc.example/${secret} failed`); }),
      vi.fn<typeof fetch>(async () => new Response(secret, { status: 401 })),
      vi.fn<typeof fetch>(async () => json({ error: { message: secret } })),
      vi.fn<typeof fetch>(async () => new Response(secret)),
    ]) {
      const result = await probeBalance("treasury", ADDRESS, `https://rpc.example/${secret}`, fetcher);
      expect(result).toMatchObject({ outcome: "failed" });
      expect(JSON.stringify(result)).not.toContain(secret);
    }
  });

  it("aborts a stalled read after five seconds rather than leaving the health action waiting indefinitely", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>((_input, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new Error("synthetic-private-timeout")), { once: true });
    }));
    const pending = probeBalance("agent_wallet", ADDRESS, undefined, fetcher);
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ outcome: "failed" });
    expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });
});

describe("health Nessie probe requires bound simulated-bank evidence", () => {
  it("uses one GET of the known account without creating a customer, account, deposit, or transfer", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json({ _id: "synthetic-treasury" }));
    const result = await probeNessie("synthetic-treasury", "synthetic-private-key", true, fetcher);
    expect(result).toMatchObject({ kind: "nessie", outcome: "success" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0]!;
    expect(new URL(String(url)).pathname).toBe("/accounts/synthetic-treasury");
    expect(options?.method).toBe("GET");
    expect(options?.body).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("synthetic-private-key");
    expect(JSON.stringify(result)).not.toContain("synthetic-treasury");
  });

  it.each([[], { _id: "foreign-account" }, null])(
    "refuses HTTP 200 without the expected account binding (%j) because bad Nessie keys can return []", async body => {
      expect(await probeNessie("synthetic-treasury", "synthetic-private-key", true, async () => json(body))).toMatchObject({ outcome: "failed" });
    },
  );

  it.each([
    [null, "key", true], ["synthetic-treasury", undefined, true], ["synthetic-treasury", "   ", true], ["synthetic-treasury", "key", false],
  ] as const)("does not call the simulator with an absent prerequisite (%s, configured key, %s)", async (account, key, enabled) => {
    const fetcher = vi.fn<typeof fetch>();
    expect(await probeNessie(account, key, enabled, fetcher)).toMatchObject({ outcome: "unconfigured" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns only a closed failure code when Nessie errors include the API key or a provider body", async () => {
    const secret = "synthetic-private-nessie-sentinel";
    for (const fetcher of [
      vi.fn<typeof fetch>(async () => { throw new Error(`https://nessie.example?key=${secret}`); }),
      vi.fn<typeof fetch>(async () => new Response(secret, { status: 403 })),
      vi.fn<typeof fetch>(async () => new Response(secret)),
    ]) {
      const result = await probeNessie("synthetic-treasury", secret, true, fetcher);
      expect(result).toMatchObject({ outcome: "failed" });
      expect(JSON.stringify(result)).not.toContain(secret);
    }
  });
});
