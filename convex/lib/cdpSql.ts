import { PAYMENT_NETWORK, USDC_ADDRESS } from "../../packages/contracts/src/chain.ts";

/** Read-only indexed evidence; this module cannot authorize or settle a payment. */
export type CdpTransfer = {
  network: typeof PAYMENT_NETWORK;
  tokenAddress: string;
  txHash: string;
  logIndex: number;
  fromAddress: string;
  toAddress: string;
  amountAtomic: string;
  blockHash: string;
  blockNumber: string;
};
export type CdpWitnessResult =
  | { status: "available"; transfers: CdpTransfer[]; fetchedAt: number }
  | { status: "witness_unavailable"; reason: string; fetchedAt: number };
export type CdpTransferRequest = { treasury: string; txHashes?: readonly string[] };
export type CdpSqlOptions = { apiKey?: string; fetchImpl?: typeof fetch };
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const INTEGER = /^(0|[1-9][0-9]*)$/;
const MAX_ROWS = 10_000;
const ENDPOINT = "https://api.cdp.coinbase.com/platform/v2/data/query/run";

// The action also reserves a durable project-wide slot: module state alone cannot
// enforce a project quota across Convex isolates/serverless instances.
let nextRequestAt = 0;
async function rateLimit() {
  const now = Date.now();
  const start = Math.max(now, nextRequestAt);
  nextRequestAt = start + 510;
  if (start > now) await new Promise(resolve => setTimeout(resolve, start - now));
}

/** Validated hexadecimal inputs only; model/user text never becomes SQL. */
export function buildCdpTransferSql(input: CdpTransferRequest): string {
  if (!ADDRESS.test(input.treasury)) throw new Error("invalid_treasury");
  const hashes = input.txHashes === undefined ? undefined : [...new Set(input.txHashes.map(hash => hash.toLowerCase()))].sort();
  if (hashes && (hashes.length > 100 || hashes.some(hash => !HASH.test(hash)))) throw new Error("invalid_transaction_filter");
  const treasury = input.treasury.toLowerCase();
  // Aggregate actions, rather than only selecting added rows: an added row may
  // subsequently have a corresponding removal after a reorganization.
  return `SELECT transaction_hash, log_index, address, block_hash, toString(block_number) AS block_number,
  lower(toString(parameters['from'])) AS from_address,
  lower(toString(parameters['to'])) AS to_address,
  toString(parameters['value']) AS amount_atomic
FROM base_sepolia.events
WHERE address = '${USDC_ADDRESS.toLowerCase()}'
  AND event_name = 'Transfer'
  AND event_signature = 'Transfer(address,address,uint256)'
  AND (lower(toString(parameters['from'])) = '${treasury}' OR lower(toString(parameters['to'])) = '${treasury}')${hashes ? `\n  AND ${hashes.length ? `transaction_hash IN (${hashes.map(hash => `'${hash}'`).join(", ")})` : "1 = 0"}` : ""}
GROUP BY log_id, transaction_hash, log_index, address, block_hash, block_number, from_address, to_address, amount_atomic
HAVING sum(toInt8(action)) > 0
LIMIT ${MAX_ROWS + 1}`;
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_response");
  return value as Record<string, unknown>;
}
function hex(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error("invalid_response");
  return value.toLowerCase();
}
function decimal(value: unknown): string {
  // Never recover money from a JS number, even if this particular value is small.
  if (typeof value !== "string" || !INTEGER.test(value)) throw new Error("invalid_response");
  return value;
}
export function parseCdpTransfers(payload: unknown, input: CdpTransferRequest): CdpTransfer[] {
  const rows = record(payload).result;
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) throw new Error("incomplete_or_invalid_response");
  const hashes = input.txHashes && new Set(input.txHashes.map(hash => hash.toLowerCase()));
  const treasury = input.treasury.toLowerCase();
  const transfers = new Map<string, CdpTransfer>();
  for (const row of rows) {
    const raw = record(row);
    const logIndex = typeof raw.log_index === "string" && INTEGER.test(raw.log_index) ? Number(raw.log_index) : raw.log_index;
    if (typeof logIndex !== "number" || !Number.isSafeInteger(logIndex) || logIndex < 0) throw new Error("invalid_response");
    const transfer: CdpTransfer = {
      network: PAYMENT_NETWORK,
      tokenAddress: hex(raw.address, ADDRESS),
      txHash: hex(raw.transaction_hash, HASH),
      logIndex,
      fromAddress: hex(raw.from_address, ADDRESS),
      toAddress: hex(raw.to_address, ADDRESS),
      amountAtomic: decimal(raw.amount_atomic),
      blockHash: hex(raw.block_hash, HASH),
      blockNumber: decimal(raw.block_number),
    };
    if (transfer.tokenAddress !== USDC_ADDRESS.toLowerCase() ||
        (transfer.fromAddress !== treasury && transfer.toAddress !== treasury) ||
        (hashes && !hashes.has(transfer.txHash))) throw new Error("out_of_scope_response");
    const key = `${transfer.txHash}:${transfer.logIndex}`;
    const previous = transfers.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(transfer)) throw new Error("conflicting_indexed_rows");
    transfers.set(key, transfer);
  }
  return [...transfers.values()];
}

/** Create once per action/request. Repeated filters reuse one in-flight result. */
export function createCdpSqlClient(options: CdpSqlOptions) {
  const cache = new Map<string, Promise<CdpWitnessResult>>();
  return {
    fetchTransfers(input: CdpTransferRequest): Promise<CdpWitnessResult> {
      const unavailable = (reason: string): CdpWitnessResult => ({ status: "witness_unavailable", reason, fetchedAt: Date.now() });
      if (!options.apiKey?.trim()) return Promise.resolve(unavailable("client_key_not_configured"));
      let sql: string;
      try { sql = buildCdpTransferSql(input); }
      catch { return Promise.resolve(unavailable("invalid_query_scope")); }
      const cached = cache.get(sql);
      if (cached) return cached;
      const pending = (async (): Promise<CdpWitnessResult> => {
        await rateLimit();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8_000);
        try {
          // Official quickstart uses a Client API key directly as the bearer token.
          // Never return provider bodies/errors: those may contain request details.
          const response = await (options.fetchImpl ?? fetch)(ENDPOINT, {
            method: "POST", headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ sql, cache: { maxAgeMs: 1_000 } }), signal: controller.signal,
          });
          if (!response.ok) return unavailable(response.status === 429 ? "rate_limited" : `http_${response.status}`);
          const transfers = parseCdpTransfers(await response.json(), input);
          return { status: "available", transfers, fetchedAt: Date.now() };
        } catch {
          return unavailable(controller.signal.aborted ? "timeout" : "query_or_response_failed");
        } finally { clearTimeout(timeout); }
      })();
      cache.set(sql, pending);
      return pending;
    },
  };
}
export function fetchCdpTransfers(input: CdpTransferRequest & CdpSqlOptions): Promise<CdpWitnessResult> {
  return createCdpSqlClient(input).fetchTransfers(input);
}

type RpcTransfer = Omit<CdpTransfer, "amountAtomic" | "blockNumber" | "network" | "blockHash"> & {
  network: string; amountAtomic: bigint | string; blockHash?: string; blockNumber?: bigint | string;
};
export function compareCdpWitness(rpc: RpcTransfer, result: CdpWitnessResult): {
  status: "match" | "missing" | "mismatch" | "witness_unavailable";
  indexedTransfer?: CdpTransfer;
} {
  if (result.status !== "available") return { status: "witness_unavailable" };
  const indexedTransfer = result.transfers.find(row => row.txHash === rpc.txHash.toLowerCase() && row.logIndex === rpc.logIndex);
  if (!indexedTransfer) return { status: "missing" };
  const matches = rpc.network === PAYMENT_NETWORK && rpc.tokenAddress.toLowerCase() === indexedTransfer.tokenAddress &&
    rpc.fromAddress.toLowerCase() === indexedTransfer.fromAddress && rpc.toAddress.toLowerCase() === indexedTransfer.toAddress &&
    String(rpc.amountAtomic) === indexedTransfer.amountAtomic &&
    (rpc.blockHash === undefined || rpc.blockHash.toLowerCase() === indexedTransfer.blockHash) &&
    (rpc.blockNumber === undefined || String(rpc.blockNumber) === indexedTransfer.blockNumber);
  return { status: matches ? "match" : "mismatch", indexedTransfer };
}
