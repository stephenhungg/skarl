import assert from "node:assert/strict";
import { test } from "node:test";
import { DEMO_CRITICAL_IDS, healthReport, healthUrl, preflightEnv, runPreflight } from "./demo-preflight.mjs";

const timestamp = 1_800_000_000_000;
function report() {
  return { version: 1, generatedAt: timestamp, items: DEMO_CRITICAL_IDS.map(id => ({
    id, status: "ok", observedAt: timestamp, demoCritical: true,
    reason: "observed", fix: "none", evidence: {},
  })) };
}
function harness(body = report(), response = {}) {
  const requests = [], logs = [], tables = [];
  return { requests, logs, tables, options: {
    now: () => timestamp,
    env: { CONVEX_URL: "https://synthetic.convex.cloud" },
    fetchImpl: async (...args) => { requests.push(args); return { ok: true, json: async () => body, ...response }; },
    log: line => logs.push(line), table: rows => tables.push(rows),
  } };
}

test("derives the site endpoint without sending cloud API requests or credentials", () => {
  assert.equal(healthUrl({ env: { CONVEX_URL: "https://synthetic.convex.cloud" } }), "https://synthetic.convex.site/health");
  assert.equal(healthUrl({ env: { CONVEX_SITE_URL: "https://site.example", CONVEX_URL: "https://other.convex.cloud" } }), "https://site.example/health");
  assert.equal(healthUrl({ args: ["--url", "https://override.example/health"], env: {} }), "https://override.example/health");
  assert.equal(healthUrl({ args: ["--url", "http://localhost:3211"] }), "http://localhost:3211/health");
});

for (const url of ["https://user:secret@site.example", "https://site.example?key=secret", "https://site.example/#secret", "http://remote.example", "https://site.example/private", "not a URL"]) {
  test(`refuses credential-bearing or unsuitable URL shape ${url.indexOf(":")}`, () => {
    assert.throws(() => healthUrl({ args: ["--url", url] }), error => !error.message.includes("secret") && /invalid preflight URL/.test(error.message));
  });
}

test("configuration is read with dotenv syntax and shell precedence without mutating env", async () => {
  const env = { CONVEX_URL: "https://shell.convex.cloud", SECRET: "never selected" };
  const original = { ...env };
  const files = {
    ".env": 'CONVEX_URL="https://base.convex.cloud"\nSECRET=never-selected\n',
    "apps/web/.env.local": "NEXT_PUBLIC_CONVEX_URL=https://web.convex.cloud\n",
    ".env.local": 'export CONVEX_URL="https://local.convex.cloud" # operator setting\n',
  };
  const selected = await preflightEnv({ env, cwd: "/fixture", read: async path => files[path.replace("/fixture/", "")] });
  assert.deepEqual(selected, { CONVEX_URL: env.CONVEX_URL, NEXT_PUBLIC_CONVEX_URL: "https://web.convex.cloud" });
  assert.deepEqual(env, original);
});

test("missing local files are optional but read errors never include contents or credentials", async () => {
  assert.deepEqual(await preflightEnv({ env: {}, read: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); } }), {});
  await assert.rejects(preflightEnv({ env: {}, read: async () => { throw new Error("private-sentinel"); } }), error => !error.message.includes("private-sentinel"));
});

test("preflight uses only GET and prints a table with timestamps and repairs", async () => {
  const h = harness();
  assert.equal(await runPreflight(h.options), 0);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0][0], "https://synthetic.convex.site/health");
  assert.equal(h.requests[0][1].method, "GET");
  assert.equal(h.requests[0][1].redirect, "error");
  assert.equal(h.tables[0].length, DEMO_CRITICAL_IDS.length);
  assert.equal(h.tables[0][0].observed, new Date(timestamp).toISOString());
  assert.equal(h.tables[0][0].fix, "none");
});

test("each missing critical integration blocks independently so an old partial endpoint cannot pass", async () => {
  for (const id of DEMO_CRITICAL_IDS) {
    const body = report();
    Object.assign(body.items.find(item => item.id === id), { status: "missing", observedAt: null, demoCritical: false });
    const h = harness(body);
    assert.equal(await runPreflight(h.options), 1, id);
    assert.ok(h.logs.some(line => line.includes(`demo blocked: ${id}`)), id);
  }
});

test("licensed clip blocker is explicit because provider health does not establish a payable demo path", async () => {
  const body = report();
  body.items.find(item => item.id === "licensed_clip").status = "missing";
  const h = harness(body);
  assert.equal(await runPreflight(h.options), 1);
  assert.ok(h.logs.some(line => line.includes("needs a licensed accepted clip")));
});

test("degraded and optional missing rows stay visible without claiming end-to-end payment proof", async () => {
  const body = report();
  body.items[0].status = "degraded";
  body.items.push({ id: "optional", status: "missing", observedAt: null, demoCritical: false, reason: "not observed", fix: "configure optional rail", evidence: {} });
  const h = harness(body);
  assert.equal(await runPreflight(h.options), 0);
  assert.equal(h.tables[0].find(item => item.integration === "optional").status, "missing");
  assert.ok(h.logs.some(line => line.includes("not end-to-end payment proof")));
});

test("new server-designated critical integrations also block without a CLI release", async () => {
  const body = report();
  body.items.push({ id: "new_gate", status: "missing", observedAt: null, demoCritical: true, reason: "not observed", fix: "repair", evidence: {} });
  assert.equal(await runPreflight(harness(body).options), 1);
});

test("malformed, duplicate, incomplete, or missing critical checks fail closed", async () => {
  const malformed = [null, {}, { ...report(), version: 2 }, { ...report(), generatedAt: "yesterday" },
    { ...report(), items: report().items.slice(1) }, { ...report(), items: [...report().items, report().items[0]] }];
  for (const field of [{ status: "green" }, { observedAt: "now" }, { observedAt: Number.MAX_SAFE_INTEGER }, { demoCritical: "true" }, { evidence: [] }, { reason: null }, { fix: null }]) {
    const body = report(); Object.assign(body.items[0], field); malformed.push(body);
  }
  for (const body of malformed) {
    const h = harness(body);
    assert.equal(await runPreflight(h.options), 1);
    assert.equal(h.tables.length, 0);
    assert.throws(() => healthReport(body));
  }
});

test("network errors, response bodies, nested evidence, and local env values never reach output", async () => {
  const sentinel = "secret-sentinel-never-print";
  for (const failure of [new Error(sentinel), new Error(`invalid health report; ${sentinel}`), new SyntaxError(sentinel)]) {
    const h = harness();
    h.options.env.UNRELATED_SECRET = sentinel;
    h.options.fetchImpl = async () => { throw failure; };
    assert.equal(await runPreflight(h.options), 1);
    assert.ok(!JSON.stringify([h.logs, h.tables]).includes(sentinel));
  }
  const unavailable = harness(null, { ok: false, json: async () => { throw new Error(sentinel); } });
  assert.equal(await runPreflight(unavailable.options), 1);
  assert.ok(!JSON.stringify(unavailable.logs).includes(sentinel));
  const body = report(); body.items[0].evidence = { providerBody: sentinel };
  const h = harness(body);
  assert.equal(await runPreflight(h.options), 0);
  assert.ok(!JSON.stringify([h.logs, h.tables]).includes(sentinel));
});

test("a missing target or invalid arguments cannot silently run against another deployment", async () => {
  for (const options of [{ env: {} }, { args: ["--deploy"], env: {} }]) {
    const h = harness();
    Object.assign(h.options, options);
    assert.equal(await runPreflight(h.options), 1);
    assert.equal(h.requests.length, 0);
  }
});

test("stale or future green reports cannot pass because cached health is not evidence of current cron activity", async () => {
  for (const at of [timestamp - 300001, timestamp + 60001]) {
    const body = report(); body.generatedAt = at;
    for (const item of body.items) item.observedAt = at;
    const h = harness(body);
    assert.equal(await runPreflight(h.options), 1);
    assert.equal(h.tables.length, 0);
  }
});
