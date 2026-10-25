import { describe, expect, it, vi } from "vitest";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "../../packages/contracts/src/chain";
import { buildCdpTransferSql, compareCdpWitness, createCdpSqlClient, parseCdpTransfers } from "./cdpSql";

const treasury = `0x${"1".repeat(40)}`;
const sender = `0x${"2".repeat(40)}`;
const hash = `0x${"a".repeat(64)}`;
const row = { transaction_hash: hash, log_index: 2, address: USDC_ADDRESS,
  block_hash: `0x${"b".repeat(64)}`, block_number: "123", from_address: sender,
  to_address: treasury, amount_atomic: "9007199254740993" };
const payload = { result: [row] };

describe("CDP SQL witness (simulated provider responses)", () => {
  it("pins Base Sepolia USDC and treasury, preserves precision and removes reorged logs", () => {
    const sql = buildCdpTransferSql({ treasury, txHashes: [hash] });
    expect(sql).toContain("FROM base_sepolia.events");
    expect(sql).toContain(USDC_ADDRESS.toLowerCase());
    expect(sql).toContain("toString(parameters['value']) AS amount_atomic");
    expect(sql).toContain("HAVING sum(toInt8(action)) > 0");
    expect(sql).toContain(hash);
    expect(parseCdpTransfers(payload, { treasury })[0]!.amountAtomic).toBe("9007199254740993");
    expect(() => buildCdpTransferSql({ treasury: "'; DROP TABLE events; --" })).toThrow();
    expect(() => buildCdpTransferSql({ treasury, txHashes: ["bad"] })).toThrow();
  });
  it("refuses unsafe numeric money, foreign tokens, malformed and conflicting observations", () => {
    for (const changed of [{ amount_atomic: 9007199254740993 }, { address: sender }, { log_index: -1 }, { to_address: sender }]) {
      expect(() => parseCdpTransfers({ result: [{ ...row, ...changed }] }, { treasury })).toThrow();
    }
    expect(() => parseCdpTransfers({ result: [row, { ...row, amount_atomic: "1" }] }, { treasury })).toThrow();
    expect(parseCdpTransfers({ result: [row, row] }, { treasury })).toHaveLength(1);
  });
  it("compares exact transfer identity and evidence without changing reconciliation", () => {
    const indexed = parseCdpTransfers(payload, { treasury });
    const result = { status: "available" as const, transfers: indexed, fetchedAt: 1 };
    const rpc = { ...indexed[0]!, amountAtomic: 9007199254740993n };
    expect(compareCdpWitness(rpc, result).status).toBe("match");
    expect(compareCdpWitness({ ...rpc, logIndex: 3 }, result).status).toBe("missing");
    expect(compareCdpWitness({ ...rpc, amountAtomic: 9007199254740992n }, result).status).toBe("mismatch");
    expect(compareCdpWitness({ ...rpc, network: "eip155:8453" }, result).status).toBe("mismatch");
    expect(compareCdpWitness({ ...rpc, blockHash: hash }, result).status).toBe("mismatch");
    expect(compareCdpWitness(rpc, { status: "witness_unavailable", reason: "timeout", fetchedAt: 1 }).status).toBe("witness_unavailable");
    expect(rpc.network).toBe(PAYMENT_NETWORK);
  });
  it("caches repeated filters in one call and uses client bearer authentication", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    const client = createCdpSqlClient({ apiKey: "test-key", fetchImpl });
    const [one, two] = await Promise.all([client.fetchTransfers({ treasury, txHashes: [hash] }), client.fetchTransfers({ treasury, txHashes: [hash, hash] })]);
    expect(one).toEqual(two);
    expect(one.status).toBe("available");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]![1]!.headers).toMatchObject({ Authorization: "Bearer test-key" });
  });
  it("does not expose provider messages and never interprets unavailable as missing", async () => {
    const absent = await createCdpSqlClient({}).fetchTransfers({ treasury });
    expect(absent).toMatchObject({ status: "witness_unavailable", reason: "client_key_not_configured" });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("private upstream message", { status: 429 }));
    const result = await createCdpSqlClient({ apiKey: "test-key", fetchImpl }).fetchTransfers({ treasury });
    expect(result).toMatchObject({ status: "witness_unavailable", reason: "rate_limited" });
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("spaces concurrent requests by at least 500ms", async () => {
    const starts: number[] = [];
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      starts.push(Date.now());
      return new Response(JSON.stringify({ result: [] }), { status: 200 });
    });
    const client = createCdpSqlClient({ apiKey: "test-key", fetchImpl });
    await Promise.all([client.fetchTransfers({ treasury }), client.fetchTransfers({ treasury, txHashes: [hash] })]);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(500);
  });
});
