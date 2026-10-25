#!/usr/bin/env node
/** Keep task vocabulary, deployment identities and model choices out of runtime logic. */
import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOTS = ["convex", "apps/web", "apps/mobile", "services", "packages", "scripts"];
const EXTENSIONS = /\.(?:[cm]?[jt]sx?|py|json|html|txt)$/;
// Fixtures must be explicit data boundaries; whole product folders are never exempt.
export function isProductionPath(path) {
  const normalized = path.replaceAll("\\", "/");
  if (/(?:^|\/)(?:node_modules|\.next|\.expo|\.venv|venv|__pycache__|_generated|dist|build|docs|tests?|fixtures?|examples?)(?:\/|$)/.test(normalized)) return false;
  if (/(?:^|\/)(?:config\.[cm]?[jt]s|config\.py|.*\.config\.[cm]?[jt]s|.*\.(?:test|spec)\.[cm]?[jt]sx?|no-hardcode\.mjs|.*\.d\.ts)$/.test(normalized)) return false;
  return ROOTS.some(root => normalized.startsWith(`${root}/`)) && EXTENSIONS.test(normalized);
}
const DENYLIST = [
  ["task vocabulary", /\b(?:red[ _-]cup|blue[ _-]cup|coaster)\b/gi],
  ["demo order", /skarl-red-cup-demo[\w-]*/gi],
  ["deployment domain", /\b(?:skarl\.vercel\.app|skarl\.devshardat\.work|keen-marmot-986(?:\.convex\.(?:site|cloud))?)\b/gi],
  ["model choice", /\b(?:gemini-[0-9][a-z0-9.-]*|claude-(?:sonnet|opus|haiku)-[a-z0-9][a-z0-9.-]*)\b/gi],
  ["stored order/submission ID", /["'`]kh7[a-z0-9]{29}["'`]/g],
];

export function findHardcodes(path, source) {
  if (!isProductionPath(path)) return [];
  return DENYLIST.flatMap(([rule, pattern]) => [...source.matchAll(pattern)].map(match => ({
    path, line: source.slice(0, match.index).split("\n").length, rule, value: match[0],
  }))).filter(item => !(
    // Finance integration retains this existing default pending its shared-config migration.
    // Retire this exact existing exception when that owner adopts typed config.
    item.path === "convex/financeAnalystData.ts" && item.value === "claude-sonnet-5-5"
  ));
}
async function files(root, directory) {
  let entries;
  try { entries = await readdir(join(root, directory), { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  return (await Promise.all(entries.filter(entry => !["node_modules", ".git", ".next", ".expo", ".venv", "venv", "__pycache__"].includes(entry.name)).map(async entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(root, path) : entry.isFile() && isProductionPath(path) ? [path] : [];
  }))).flat();
}
export async function checkHardcodes(root = process.cwd()) {
  const paths = (await Promise.all(ROOTS.map(path => files(root, path)))).flat().sort();
  const results = await Promise.all(paths.map(async path => findHardcodes(path, await readFile(join(root, path), "utf8"))));
  return results.flat();
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const violations = await checkHardcodes();
  for (const item of violations) console.error(`${item.path}:${item.line}: ${item.rule}: ${item.value}`);
  if (violations.length) {
    console.error(`${violations.length} hardcoded task/domain/model values; use order data, typed config or environment.`);
    process.exitCode = 1;
  } else console.log("no-hardcode: production task/domain/model check passed");
}
