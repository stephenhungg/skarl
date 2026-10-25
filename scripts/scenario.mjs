#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SCENARIOS = [
  "wrong_amount_transfer",
  "unknown_transfer",
  "duplicate_submission",
  "agent_self_approval",
  "prompt_injection_narration",
  "bank_mismatch",
];

/** Calls only the deployed lab. No --push, dev, deploy, signing, or send command. */
export function runScenarios(args = process.argv.slice(2), { execute = spawnSync, log = console.log, table = console.table } = {}) {
  const [name, orderId] = args;
  if (args.length < 1 || args.length > 2 || (name !== "all" && !SCENARIOS.includes(name)) || (orderId !== undefined && !orderId.trim())) {
    log(`usage: pnpm scenario <${SCENARIOS.join("|")}|all> [orderId]`);
    return 2;
  }
  log("SIMULATED CONTROL TEST — NO TRANSFER | controller demo identity | deployed production controls");
  log("requires the scenario-lab backend deployment; this command does not deploy code");
  const rows = [];
  for (const scenario of name === "all" ? SCENARIOS : [name]) {
    log(`running ${scenario}...`);
    const input = { demoIdentity: "controller", scenario, ...(orderId ? { orderId } : {}) };
    const child = execute("pnpm", ["exec", "convex", "run", "scenarios:run", JSON.stringify(input)], {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: false,
      timeout: 180_000, maxBuffer: 4 * 1024 * 1024,
    });
    if (child.stderr?.trim()) log(child.stderr.trim());
    if (child.error || child.status !== 0) {
      rows.push({ scenario, result: "FAIL", expectedControl: "deployed control run", observedOutcome: child.error?.message ?? `convex run exited ${child.status ?? "without a status"}`, evidenceIds: "" });
      continue;
    }
    let result;
    try { result = JSON.parse(child.stdout); }
    catch {
      rows.push({ scenario, result: "FAIL", expectedControl: "recorded scenario result", observedOutcome: "convex run did not return JSON; inspect deployment and CLI output", evidenceIds: "" });
      continue;
    }
    const valid = result?.scenario === scenario && result.simulated === true && typeof result.passed === "boolean" &&
      typeof result.expectedControl === "string" && typeof result.observedOutcome === "string" &&
      Array.isArray(result.evidenceIds) && result.evidenceIds.every(id => typeof id === "string");
    rows.push({ scenario, result: valid && result.passed ? "PASS" : "FAIL",
      expectedControl: valid ? result.expectedControl : "recorded scenario result",
      observedOutcome: valid ? result.observedOutcome : "invalid scenario result; no pass claimed",
      evidenceIds: valid ? result.evidenceIds.join(", ") : "" });
    if (valid) log(`${result.passed ? "PASS" : "FAIL"} ${scenario}: ${result.observedOutcome}\n  evidence: ${result.evidenceIds.join(", ") || "none"}${result.labOrderId ? `\n  lab order: ${result.labOrderId}` : ""}`);
  }
  table(rows);
  return rows.every(row => row.result === "PASS") ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runScenarios();
}
