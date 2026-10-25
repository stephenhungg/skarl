import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findHardcodes, isProductionPath, checkHardcodes } from "./no-hardcode.mjs";

test("runtime denylist catches task, domain, model and persisted identity literals", () => {
  const matches = findHardcodes("convex/orders.ts", 'const object="red_cup"; const target="coaster";\nconst host="skarl.vercel.app"; const model="gemini-4-argon"; const order="kh7c6cy844fyjxzpsg945v0c618gzsha";');
  assert.equal(matches.length, 5);
  assert.equal(matches.at(-1).line, 2);
  assert.equal(isProductionPath("scripts/eval-clips.mjs"), true);
  assert.equal(isProductionPath("convex/seed.ts"), true);
});
test("only explicit fixtures/tests/docs/config defaults are allowed", () => {
  for (const path of ["apps/web/fixtures/evidence.ts", "convex/orders.test.ts", "convex/lib/config.ts", "services/verifier/tests/test_task.py", "docs/config.md", "packages/contracts/schemas/fixtures/example.json"]) {
    assert.deepEqual(findHardcodes(path, '"red_cup" "skarl.vercel.app" "gemini-4-argon"'), [], path);
  }
  assert.equal(isProductionPath("convex/lib/finance.ts"), true);
  assert.equal(isProductionPath("apps/mobile/configure.ts"), true);
});
test("CI traversal scans production scripts and nested services without scanning dependencies", async t => {
  const root = await mkdtemp(join(tmpdir(), "skarl-hardcodes-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of ["scripts/product.mjs", "services/verifier/src/runtime.py", "apps/web/node_modules/vendor/index.js"]) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), '"red cup"');
  }
  assert.equal((await checkHardcodes(root)).length, 2);
});

test("finance ownership exception is restricted to one existing model literal", () => {
  assert.deepEqual(findHardcodes("convex/financeAnalystData.ts", '"claude-sonnet-5-5"'), []);
  assert.equal(findHardcodes("convex/financeAgent.ts", '"claude-sonnet-5-5"').length, 1);
  assert.equal(findHardcodes("convex/financeAnalystData.ts", '"claude-opus-6"').length, 1);
  assert.equal(findHardcodes("convex/financeAnalystData.ts", '"red_cup"').length, 1);
});
