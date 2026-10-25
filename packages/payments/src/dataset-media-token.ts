import { paymentConfig } from "./config.ts";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

const TTL_MS = paymentConfig.mediaTokenTtlMs;
export type DatasetMediaGrant = {
  demoIdentity: string;
  orderId: string;
  submissionId: string;
  binding: string;
  expiresAt: number;
};
function validGrant(value: unknown, now: number): value is DatasetMediaGrant {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const grant = value as Record<string, unknown>;
  return Object.keys(grant).sort().join(",") === "binding,demoIdentity,expiresAt,orderId,submissionId" &&
    (grant.demoIdentity === "buyer" || grant.demoIdentity === "controller") &&
    typeof grant.orderId === "string" && /^[A-Za-z0-9]+$/.test(grant.orderId) && grant.orderId.length <= 128 &&
    typeof grant.submissionId === "string" && /^[A-Za-z0-9]+$/.test(grant.submissionId) && grant.submissionId.length <= 128 &&
    typeof grant.binding === "string" && /^[a-f0-9]{64}$/.test(grant.binding) &&
    typeof grant.expiresAt === "number" && Number.isSafeInteger(grant.expiresAt) &&
    grant.expiresAt > now && grant.expiresAt <= now + TTL_MS;
}
function signature(body: string, secret: string) {
  if (secret.length < 32) throw new Error("payment_service_not_configured");
  return hmac(sha256, utf8ToBytes(secret), utf8ToBytes(`skarl-dataset-media-v1:${body}`));
}
export function createDatasetMediaToken(grant: Omit<DatasetMediaGrant, "expiresAt">, secret: string, now = Date.now()) {
  const complete = { ...grant, expiresAt: now + TTL_MS };
  if (!Number.isSafeInteger(now) || now < 0 || !validGrant(complete, now)) throw new Error("invalid_dataset_media_grant");
  const body = bytesToHex(utf8ToBytes(JSON.stringify(complete)));
  return { token: `${body}.${bytesToHex(signature(body, secret))}`, expiresAt: complete.expiresAt };
}
export function verifyDatasetMediaToken(token: string, secret: string, now = Date.now()): DatasetMediaGrant {
  if (typeof token !== "string" || token.length > 2048 || !Number.isSafeInteger(now) || now < 0) {
    throw new Error("invalid_dataset_media_grant");
  }
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra !== undefined || !/^(?:[a-f0-9]{2})+$/.test(body) || !/^[a-f0-9]{64}$/.test(mac)) {
    throw new Error("invalid_dataset_media_grant");
  }
  const expected = signature(body, secret), actual = hexToBytes(mac);
  // Both signatures have a fixed length. Inspect every byte before deciding.
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected[i]! ^ actual[i]!;
  if (mismatch) throw new Error("invalid_dataset_media_grant");
  let grant: unknown;
  try { grant = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(hexToBytes(body))); }
  catch { throw new Error("invalid_dataset_media_grant"); }
  if (!validGrant(grant, now)) throw new Error("invalid_dataset_media_grant");
  return grant;
}
