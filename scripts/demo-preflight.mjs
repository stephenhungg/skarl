import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";
import { REQUIRED_ENV } from "../convex/lib/health.ts";

export const DEMO_CRITICAL_IDS = [...REQUIRED_ENV.filter(([, critical]) => critical).map(([name]) => `env.${name}`),
  "site_url", "cron.reconcile", "cron.finance", "gemini", "claude", "agent_wallet", "treasury", "licensed_clip"];
const URL_ENV = ["CONVEX_URL", "NEXT_PUBLIC_CONVEX_URL", "CONVEX_SITE_URL", "NEXT_PUBLIC_CONVEX_SITE_URL"];
const validTime = value => Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;

/** Select only public deployment origins, without exporting credentials or changing process.env. */
export async function preflightEnv({ env = process.env, cwd = process.cwd(), read = path => readFile(path, "utf8") } = {}) {
  const selected = {};
  for (const file of [".env", "apps/web/.env.local", ".env.local"]) {
    let contents;
    try { contents = await read(join(cwd, file)); }
    catch (error) {
      if (error?.code === "ENOENT") continue;
      throw new Error("could not read preflight configuration");
    }
    if (contents === undefined) continue;
    let parsed;
    try { parsed = parseEnv(contents); } catch { throw new Error("invalid preflight configuration"); }
    for (const name of URL_ENV) if (Object.hasOwn(parsed, name)) selected[name] = parsed[name];
  }
  for (const name of URL_ENV) if (Object.hasOwn(env, name)) selected[name] = env[name];
  return selected;
}

/** Credentials, query strings and arbitrary paths must not enter requests or logs. */
export function healthUrl({ args = [], env = process.env } = {}) {
  try {
    if (args.length && (args.length !== 2 || args[0] !== "--url")) throw new Error();
    const explicit = args[1] || env.CONVEX_SITE_URL || env.NEXT_PUBLIC_CONVEX_SITE_URL;
    const value = explicit || env.CONVEX_URL || env.NEXT_PUBLIC_CONVEX_URL;
    if (!value) throw new Error();
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new Error();
    if (url.username || url.password || url.search || url.hash || !["/", "/health"].includes(url.pathname)) throw new Error();
    if (!explicit) {
      if (!/^[a-z0-9-]+\.convex\.cloud$/.test(url.hostname) || url.pathname !== "/" || url.port) throw new Error();
      url.hostname = url.hostname.replace(/\.cloud$/, ".site");
    }
    return `${url.origin}/health`;
  } catch { throw new Error("invalid preflight URL; configure a Convex site origin or pass --url"); }
}

/** Validate the complete critical inventory; server flags may add gates but cannot remove ours. */
export function healthReport(report) {
  const invalid = () => { throw new Error("invalid health report"); };
  if (!report || report.version !== 1 || !validTime(report.generatedAt) || !Array.isArray(report.items) || report.items.length > 100) invalid();
  const ids = new Set();
  const items = report.items.map(row => {
    if (!row || typeof row.id !== "string" || !/^[a-zA-Z0-9_.]{1,80}$/.test(row.id) || ids.has(row.id) ||
      !["ok", "degraded", "missing"].includes(row.status) || typeof row.demoCritical !== "boolean" ||
      typeof row.reason !== "string" || typeof row.fix !== "string" || row.reason.length > 500 || row.fix.length > 500 ||
      !row.evidence || typeof row.evidence !== "object" || Array.isArray(row.evidence)) invalid();
    const observedAt = Object.hasOwn(row, "observedAt") ? row.observedAt : row.lastSuccessAt;
    if (observedAt !== null && (!validTime(observedAt) || observedAt > report.generatedAt + 60_000)) invalid();
    if (Object.hasOwn(row, "checkedAt") && (!validTime(row.checkedAt) || row.checkedAt > report.generatedAt + 60_000)) invalid();
    ids.add(row.id);
    // Return only the fields displayed by the CLI; evidence can contain nested private provider data.
    return { id: row.id, status: row.status, demoCritical: row.demoCritical, observedAt,
      reason: row.reason, fix: row.fix };
  });
  if (DEMO_CRITICAL_IDS.some(id => !ids.has(id))) invalid();
  return { version: 1, generatedAt: report.generatedAt, items };
}

/** Read-only GET. Passing means no missing critical prerequisite, not successful settlement. */
export async function runPreflight({ args = [], env = process.env, fetchImpl = fetch, log = console.log, table = console.table } = {}) {
  try {
    const url = healthUrl({ args, env });
    const response = await fetchImpl(url, { method: "GET", signal: AbortSignal.timeout(10_000), redirect: "error" });
    if (!response.ok) throw new Error();
    const report = healthReport(await response.json());
    log(`health evidence as of ${new Date(report.generatedAt).toISOString()}`);
    table(report.items.map(row => ({ integration: row.id, status: row.status,
      observed: row.observedAt === null ? "unverified" : new Date(row.observedAt).toISOString(), reason: row.reason, fix: row.fix })));
    const missing = report.items.filter(row => (DEMO_CRITICAL_IDS.includes(row.id) || row.demoCritical) && row.status === "missing");
    for (const row of missing) log(`demo blocked: ${row.id}`);
    if (missing.some(row => row.id === "licensed_clip")) log("needs a licensed accepted clip");
    log("preflight is not end-to-end payment proof; review degraded rows and rehearse the live path separately");
    return missing.length ? 1 : 0;
  } catch {
    // Never echo URLs, local env, remote bodies, or errors (which may include secrets).
    log("health unavailable or invalid; deploy the Convex health endpoint and configure the site origin");
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await runPreflight({ args: process.argv.slice(2), env: await preflightEnv() }); }
  catch { console.error("could not read preflight configuration; set a public Convex site origin"); process.exitCode = 1; }
}
