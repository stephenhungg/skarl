import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("./mcp-key.mjs", import.meta.url));
const mint = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });

test("minting separates the one-time bearer secret from its shareable hash entry", () => {
  const result = mint("buyer", 'Personal "buyer" agent');
  assert.equal(result.status, 0);
  // Assertions deliberately avoid printing generated credentials on failure.
  assert.ok(/^skarl_mcp_[A-Za-z0-9_-]{43}\n$/.test(result.stdout));
  const key = result.stdout.trim();
  assert.ok(!result.stderr.includes(key), "the env entry must never repeat the bearer key");
  const entry = JSON.parse(result.stderr);
  const hash = createHash("sha256").update(key, "utf8").digest("hex");
  assert.deepEqual(entry, { [hash]: { identity: "buyer", label: 'Personal "buyer" agent' } });
  const second = mint("buyer");
  assert.equal(second.status, 0);
  assert.ok(second.stdout !== result.stdout, "separate clients must receive independent random credentials");
});

test("only the three bounded demo identities can be minted", () => {
  for (const identity of ["buyer", "contributor", "controller"]) {
    const result = mint(identity);
    assert.equal(result.status, 0);
    assert.equal(Object.values(JSON.parse(result.stderr))[0].identity, identity);
  }
  for (const args of [[], ["finance-agent"], ["admin"], ["buyer", " "], ["buyer", "x".repeat(121)], ["buyer", "label", "extra"]]) {
    const result = mint(...args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "", "invalid authority must fail before generating a secret");
    assert.match(result.stderr, /^usage:/);
  }
});
