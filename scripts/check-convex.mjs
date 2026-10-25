#!/usr/bin/env node
/** Convex dev sync is a write: refuse remote targets unless explicitly requested. */
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const convexPackage = require.resolve("convex/package.json");
// Match the pinned CLI's dotenv grammar, including `export`, quotes and `KEY: value`.
// Node's parseEnv omits colon assignments that the CLI would otherwise consume.
const { parse: parseEnv } = createRequire(convexPackage)("dotenv");
const CLI = resolve(dirname(convexPackage), "bin/main.js");
const REMOTE_KEYS = ["CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT_TOKEN"];

export function isLocalDeployment(value) {
  // Preserve raw whitespace: the CLI does not trim before splitting the type.
  // A quoted " local:cloud-name" would otherwise pass here and select cloud.
  return /^(?:local:[a-zA-Z0-9_-]+|(?:(?:dev|prod|preview):)?anonymous-[a-zA-Z0-9_-]+)$/.test(value);
}

function localUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch { return false; }
}

export function assertLocalSelection(values, source) {
  const deployment = values.CONVEX_DEPLOYMENT;
  if (typeof deployment === "string" && deployment.length > 0 && !isLocalDeployment(deployment)) {
    throw new Error(`check:convex refused remote or unknown CONVEX_DEPLOYMENT in ${source}. Use pnpm test:convex for isolated tests; deliberate cloud sync requires --allow-cloud after the clean-origin/main deployment gate.`);
  }
  if (REMOTE_KEYS.some(key => typeof values[key] === "string" && values[key].trim()) ||
    (values.CONVEX_SELF_HOSTED_URL?.trim() && !localUrl(values.CONVEX_SELF_HOSTED_URL))) {
    throw new Error(`check:convex refused remote credentials/URL in ${source}. Deliberate remote sync requires --allow-cloud after the clean-origin/main deployment gate.`);
  }
}

async function execute(command, args, options) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    child.once("error", () => reject(new Error("Convex check process failed to start.")));
    child.once("exit", (code) => resolve(Number.isInteger(code) ? code : 1));
  });
}

/** Injectable execution keeps tests from starting any real Convex backend. */
export async function runCheckConvex({ args = [], cwd = ROOT, env = process.env } = {}, injected = {}) {
  const options = args[0] === "--" ? args.slice(1) : args;
  if (options.some(value => value !== "--allow-cloud") || options.length > 1) {
    throw new Error("usage: pnpm check:convex [--allow-cloud]");
  }
  if (!options.includes("--allow-cloud")) {
    // Inspect every source independently: an explicit shell cloud target must not
    // be hidden by local file configuration, nor a file target by a shell override.
    assertLocalSelection(env, "process environment");
    for (const name of [".env.local", ".env"]) {
      let text;
      try { text = await (injected.readFile ?? readFile)(resolve(cwd, name), "utf8"); }
      catch (error) {
        if (error?.code === "ENOENT") continue;
        throw new Error(`check:convex could not safely inspect ${name}; refusing to sync.`);
      }
      assertLocalSelection(parseEnv(text), name);
    }
  }
  return await (injected.execute ?? execute)(process.execPath, [CLI, "dev", "--once", "--typecheck", "enable"], {
    cwd, env: { ...env, CONVEX_AGENT_MODE: "anonymous" }, stdio: "inherit", shell: false,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await runCheckConvex({ args: process.argv.slice(2) }); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
