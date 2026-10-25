import { createHmac, timingSafeEqual } from "node:crypto";

const TTL_MS = 5 * 60_000;
type MediaGrant = { sampleId: string; binding: string; expiresAt: number };
function mac(body: string, secret: string) {
  if (secret.length < 32) throw new Error("payment_service_not_configured");
  return createHmac("sha256", secret).update(`skarl-evidence-media-v1:${body}`).digest();
}
export function issueMediaToken(sampleId: string, binding: string, secret: string, now = Date.now()) {
  const grant: MediaGrant = { sampleId, binding, expiresAt: now + TTL_MS };
  const body = Buffer.from(JSON.stringify(grant)).toString("base64url");
  return { token: `${body}.${mac(body, secret).toString("base64url")}`, expiresAt: grant.expiresAt };
}
export function verifyMediaToken(token: string, sampleId: string, secret: string, now = Date.now()): MediaGrant {
  if (token.length > 2048) throw new Error("invalid_media_grant");
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) throw new Error("invalid_media_grant");
  const actual = Buffer.from(signature, "base64url"), expected = mac(body, secret);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("invalid_media_grant");
  const grant: MediaGrant = JSON.parse(Buffer.from(body, "base64url").toString());
  if (grant.sampleId !== sampleId || typeof grant.binding !== "string" || !Number.isSafeInteger(grant.expiresAt) ||
      grant.expiresAt <= now || grant.expiresAt > now + TTL_MS) throw new Error("invalid_media_grant");
  return grant;
}
