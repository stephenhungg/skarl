import { describe, expect, it } from "vitest";
import { issueMediaToken, verifyMediaToken } from "../../../apps/web/lib/payments/media-token";
const secret = "synthetic-test-secret-32-characters";
describe("paid media grant", () => {
  it("binds a grant to the sample and stored evidence for exactly five minutes", () => {
    const grant = issueMediaToken("sample-test", "binding", secret, 1_000);
    expect(grant.expiresAt).toBe(301_000);
    expect(verifyMediaToken(grant.token, "sample-test", secret, 300_999)).toEqual({ sampleId: "sample-test", binding: "binding", expiresAt: 301_000 });
    expect(() => verifyMediaToken(grant.token, "sample-test", secret, 301_000)).toThrow();
  });
  it("refuses tampering, another sample and another service secret", () => {
    const grant = issueMediaToken("sample-test", "binding", secret, 1_000);
    expect(() => verifyMediaToken(`${grant.token}x`, "sample-test", secret, 1_001)).toThrow();
    expect(() => verifyMediaToken(grant.token, "sample-other", secret, 1_001)).toThrow();
    expect(() => verifyMediaToken(grant.token, "sample-test", `${secret}other`, 1_001)).toThrow();
    const altered = Buffer.from(JSON.stringify({ sampleId: "sample-test", binding: "other", expiresAt: 301_000 })).toString("base64url");
    expect(() => verifyMediaToken(`${altered}.${grant.token.split(".")[1]}`, "sample-test", secret, 1_001)).toThrow();
  });
});
