import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { runCheckConvex } from "./check-convex.mjs";

// All backend execution is injected. These tests never spawn Convex or read real env files.
function harness({ env = {}, files = {}, args = [], code = 0, readError } = {}) {
  const calls = [], reads = [], cwd = resolve("/synthetic/check-convex");
  const promise = runCheckConvex({ env, args, cwd }, {
    readFile: async (path) => {
      reads.push(path);
      if (readError) throw readError;
      if (Object.hasOwn(files, path)) return files[path];
      if (Object.hasOwn(files, path.slice(cwd.length + 1))) return files[path.slice(cwd.length + 1)];
      throw Object.assign(new Error("synthetic missing file"), { code: "ENOENT" });
    },
    execute: async (...call) => { calls.push(call); return code; },
  });
  return { promise, calls, reads, cwd };
}

for (const value of ["dev:synthetic-cloud", "prod:synthetic-cloud", "preview:synthetic-cloud", "legacy-cloud-name", "unknown:target", " local:synthetic-cloud", "local:fixture ", " anonymous-fixture", "   "]) {
  test(`blocks process cloud/unknown deployment before spawn: ${value}`, async () => {
    const h = harness({ env: { CONVEX_DEPLOYMENT: value }, files: { ".env.local": "CONVEX_DEPLOYMENT=local:fixture" } });
    await assert.rejects(h.promise, /refused.*CONVEX_DEPLOYMENT in process environment/);
    assert.deepEqual(h.calls, []);
  });
}

for (const [file, text] of [
  [".env.local", 'export CONVEX_DEPLOYMENT="dev:synthetic-cloud" # generated\n'],
  [".env.local", "  export CONVEX_DEPLOYMENT = 'prod:synthetic-cloud' # quote\r\n"],
  [".env.local", "CONVEX_DEPLOYMENT: preview:synthetic-cloud\n"],
  [".env.local", 'export CONVEX_DEPLOYMENT=" local:synthetic-cloud"\n'],
  [".env.local", 'CONVEX_DEPLOYMENT=`dev:synthetic-cloud`\n'],
  [".env", "CONVEX_DEPLOYMENT=legacy-cloud-name\n"],
]) {
  test(`blocks dotenv grammar from ${file}: ${JSON.stringify(text)}`, async () => {
    const h = harness({ env: { CONVEX_DEPLOYMENT: "local:fixture" }, files: { [file]: text } });
    await assert.rejects(h.promise, /refused.*CONVEX_DEPLOYMENT/);
    assert.deepEqual(h.calls, []);
  });
}

test("checks .env even when .env.local selects a local backend", async () => {
  const h = harness({ files: { ".env.local": "CONVEX_DEPLOYMENT=local:fixture", ".env": "CONVEX_DEPLOYMENT=dev:synthetic-cloud" } });
  await assert.rejects(h.promise, /CONVEX_DEPLOYMENT in \.env\./);
  assert.deepEqual(h.calls, []);
});

for (const value of [undefined, "", "local:fixture", "anonymous-fixture", "dev:anonymous-fixture", "prod:anonymous-fixture", "preview:anonymous-fixture", "local:anonymous-fixture"]) {
  test(`permits absent/local/anonymous selection: ${value}`, async () => {
    const h = harness({ env: { ...(value === undefined ? {} : { CONVEX_DEPLOYMENT: value }), PRESERVED: "fixture" } });
    assert.equal(await h.promise, 0);
    assert.equal(h.calls.length, 1);
    const [command, args, options] = h.calls[0];
    assert.equal(command, process.execPath);
    assert.match(args[0], /convex\/bin\/main\.js$/);
    assert.deepEqual(args.slice(1), ["dev", "--once", "--typecheck", "enable"]);
    assert.equal(options.cwd, h.cwd);
    assert.equal(options.env.CONVEX_AGENT_MODE, "anonymous");
    assert.equal(options.env.PRESERVED, "fixture");
    assert.equal(options.env.CONVEX_DEPLOYMENT, value);
    assert.equal(options.shell, false);
  });
}

test("permits quoted/export anonymous and local file configuration without changing files", async () => {
  const h = harness({ files: { ".env.local": 'export CONVEX_DEPLOYMENT="local:fixture" # comment\n', ".env": "CONVEX_DEPLOYMENT=anonymous-fixture" } });
  assert.equal(await h.promise, 0);
  assert.equal(h.reads.length, 2);
  assert.equal(h.calls.length, 1);
});

test("explicit cloud opt-in is consumed by wrapper and preserves CLI exit code", async () => {
  const h = harness({ env: { CONVEX_DEPLOYMENT: "dev:synthetic-cloud" }, args: ["--allow-cloud"], code: 7 });
  assert.equal(await h.promise, 7);
  assert.equal(h.calls.length, 1);
  assert.equal(h.reads.length, 0);
  assert.ok(!h.calls[0][1].includes("--allow-cloud"));
  assert.equal(h.calls[0][2].env.CONVEX_DEPLOYMENT, "dev:synthetic-cloud");
});

test("supports pnpm's optional separator before explicit opt-in", async () => {
  const h = harness({ env: { CONVEX_DEPLOYMENT: "dev:synthetic-cloud" }, args: ["--", "--allow-cloud"] });
  assert.equal(await h.promise, 0);
  assert.equal(h.calls.length, 1);
});

for (const args of [["--env-file", "other.env"], ["--url", "https://example.invalid"], ["--allow-cloud", "--allow-cloud"], ["--allow-cloud=true"]]) {
  test(`rejects unrecognized CLI forwarding: ${JSON.stringify(args)}`, async () => {
    const h = harness({ args });
    await assert.rejects(h.promise, /usage: pnpm check:convex/);
    assert.deepEqual(h.calls, []);
  });
}

for (const key of ["CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT_TOKEN", "CONVEX_SELF_HOSTED_URL"]) {
  test(`blocks alternate remote selector ${key} without revealing values`, async () => {
    const sentinel = "synthetic-sensitive-value";
    for (const options of [{ env: { [key]: sentinel } }, { files: { ".env.local": `${key}=${sentinel}` } }]) {
      const h = harness(options);
      await assert.rejects(h.promise, error => /remote credentials\/URL/.test(error.message) && !error.message.includes(sentinel));
      assert.deepEqual(h.calls, []);
    }
  });
}

test("permits a loopback self-hosted target", async () => {
  const h = harness({ env: { CONVEX_SELF_HOSTED_URL: "http://127.0.0.1:3210", CONVEX_SELF_HOSTED_ADMIN_KEY: "synthetic-local-key" } });
  assert.equal(await h.promise, 0);
  assert.equal(h.calls.length, 1);
});

test("unreadable config fails closed before spawn without exposing error details", async () => {
  const h = harness({ readError: Object.assign(new Error("synthetic-sensitive-details"), { code: "EACCES" }) });
  await assert.rejects(h.promise, error => /could not safely inspect \.env.local/.test(error.message) && !error.message.includes("sensitive"));
  assert.deepEqual(h.calls, []);
});
