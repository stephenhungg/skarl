import { createHmac, timingSafeEqual } from "node:crypto";
import { PAYMENT_NETWORK, USDC_ADDRESS } from "@skarl/contracts/chain";

/** v0 authenticates the exact body bytes. Reject stale AND future timestamps. */
export function verifyCdpSignature(body: Uint8Array, header: string | null, secrets: readonly string[], now = Date.now()) {
  if (!header || header.length > 2048) return false;
  const fields = header.split(",").map(field => field.trim().split("="));
  const times = fields.filter(([key]) => key === "t");
  const signatures = fields.filter(([key]) => key === "v0").map(([, value]) => value);
  const timestamp = times[0]?.[1];
  if (times.length !== 1 || !timestamp || !/^\d{1,12}$/.test(timestamp) ||
    Math.abs(now - Number(timestamp) * 1000) > 300_000) return false;
  let valid = false;
  for (const secret of secrets.filter(Boolean)) {
    const expected = createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest();
    for (const signature of signatures) {
      if (signature && /^[0-9a-f]{64}$/i.test(signature)) valid = timingSafeEqual(expected, Buffer.from(signature, "hex")) || valid;
    }
  }
  return valid;
}

export type WebhookTransfer = { eventId: string; network: string; tokenAddress: string; txHash: string;
  logIndex: number; fromAddress: string; toAddress: string; amountAtomic: string };
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_webhook_payload");
  return value as Record<string, unknown>;
};
export function parseCdpTransfer(payload: unknown, treasury: string, fallbackEventId: string): WebhookTransfer {
  const envelope = object(payload), data = object(envelope.data ?? envelope);
  const params = object(data.parameters ?? data);
  if (envelope.type !== undefined && envelope.type !== "onchain.activity.detected") throw new Error("unsupported_webhook_event");
  if ((data.network ?? data.networkId) !== "base-sepolia" ||
    (data.event_name ?? data.eventName) !== "Transfer") throw new Error("unsupported_webhook_event");
  const token = data.contract_address ?? data.contractAddress;
  const txHash = data.transaction_hash ?? data.transactionHash;
  const logIndex = data.log_index ?? data.logIndex;
  const from = params.from, to = params.to, value = params.value;
  const eventId = envelope.id ?? fallbackEventId;
  if (typeof eventId !== "string" || !eventId || eventId.length > 200 ||
    typeof token !== "string" || token.toLowerCase() !== USDC_ADDRESS.toLowerCase() ||
    typeof txHash !== "string" || !/^0x[0-9a-f]{64}$/i.test(txHash) ||
    typeof logIndex !== "number" || !Number.isSafeInteger(logIndex) || logIndex < 0 ||
    typeof from !== "string" || !/^0x[0-9a-f]{40}$/i.test(from) ||
    typeof to !== "string" || !/^0x[0-9a-f]{40}$/i.test(to) ||
    typeof value !== "string" || !/^(0|[1-9]\d{0,77})$/.test(value) || BigInt(value) >= 2n ** 256n ||
    ![from.toLowerCase(), to.toLowerCase()].includes(treasury.toLowerCase())) throw new Error("invalid_webhook_transfer");
  return { eventId, network: PAYMENT_NETWORK, tokenAddress: USDC_ADDRESS, txHash: txHash.toLowerCase(),
    logIndex, fromAddress: from.toLowerCase(), toAddress: to.toLowerCase(), amountAtomic: value };
}
