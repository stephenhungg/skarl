import { execFileSync } from "node:child_process";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";

test("auth key script prints only two commands for a matching RS256 pair", () => {
  // Capture generated secrets in memory; never print or save them during tests.
  const output = execFileSync(process.execPath, [new URL("./auth-keys.mjs", import.meta.url).pathname], { encoding: "utf8" });
  const lines = output.trimEnd().split("\n");
  assert.equal(lines.length, 2);
  const privateMatch = /^pnpm exec convex env set -- JWT_PRIVATE_KEY '(.*)'$/.exec(lines[0]);
  const publicMatch = /^pnpm exec convex env set -- JWKS '(.*)'$/.exec(lines[1]);
  assert.ok(privateMatch);
  assert.ok(publicMatch);
  const pem = privateMatch[1].replace("-----BEGIN PRIVATE KEY----- ", "-----BEGIN PRIVATE KEY-----\n")
    .replace(" -----END PRIVATE KEY-----", "\n-----END PRIVATE KEY-----");
  const privateKey = createPrivateKey(pem);
  const jwks = JSON.parse(publicMatch[1]);
  assert.equal(jwks.keys.length, 1);
  const jwk = jwks.keys[0];
  assert.equal(jwk.kty, "RSA");
  assert.equal(jwk.use, "sig");
  assert.equal(jwk.alg, "RS256");
  assert.equal(jwk.d, undefined);
  const publicKey = createPublicKey({ key: jwk, format: "jwk" });
  const message = Buffer.from("auth-key-pair-regression");
  assert.equal(verify("RSA-SHA256", message, publicKey, sign("RSA-SHA256", message, privateKey)), true);
});

test("production key commands keep deployment options before the option terminator", () => {
  const output = execFileSync(process.execPath, [new URL("./auth-keys.mjs", import.meta.url).pathname, "--prod"], { encoding: "utf8" });
  const lines = output.trimEnd().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(lines[0].startsWith("pnpm exec convex env set --prod -- JWT_PRIVATE_KEY '"), true);
  assert.equal(lines[1].startsWith("pnpm exec convex env set --prod -- JWKS '"), true);
});
