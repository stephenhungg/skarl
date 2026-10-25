#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";

const [identity, rawLabel = identity, ...extra] = process.argv.slice(2);
const label = rawLabel?.trim();
if (!["buyer", "contributor", "controller"].includes(identity) || extra.length || !label || label.length > 120) {
  process.stderr.write('usage: node scripts/mcp-key.mjs buyer|contributor|controller ["label, up to 120 characters"]\n');
  process.exitCode = 1;
} else {
  const key = `skarl_mcp_${randomBytes(32).toString("base64url")}`;
  const hash = createHash("sha256").update(key, "utf8").digest("hex");
  // stdout is the one-time secret; stderr is a non-secret JSON entry to merge
  // into SKARL_MCP_KEYS. Never persist a bearer credential or repeat it in logs.
  process.stderr.write(`${JSON.stringify({ [hash]: { identity, label } })}\n`);
  process.stdout.write(`${key}\n`);
}
