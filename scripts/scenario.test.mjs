import assert from "node:assert/strict";
import { test } from "node:test";
import { runScenarios, SCENARIOS } from "./scenario.mjs";

// Synthetic CLI tests: no deployment, network call, inference, or transfer.
function harness(respond = input => ({ status: 0, stdout: JSON.stringify({
  scenario: input.scenario, simulated: true, passed: true,
  expectedControl: "recorded control", observedOutcome: "control observed",
  evidenceIds: ["audit-id", "observation-id"], labOrderId: "lab-order",
}) })) {
  const calls = [], logs = [], tables = [];
  return { calls, logs, tables, api: {
    execute: (command, args, options) => {
      calls.push({ command, args, options });
      return respond(JSON.parse(args[4]));
    },
    log: value => logs.push(value),
    table: value => tables.push(value),
  } };
}

test("calls only deployed scenarios:run as controller with optional order scope", () => {
  const h = harness();
  assert.equal(runScenarios(["wrong_amount_transfer", "source-order"], h.api), 0);
  assert.equal(h.calls.length, 1);
  const call = h.calls[0];
  assert.equal(call.command, "pnpm");
  assert.deepEqual(call.args.slice(0, 4), ["exec", "convex", "run", "scenarios:run"]);
  assert.deepEqual(JSON.parse(call.args[4]), { demoIdentity: "controller", scenario: "wrong_amount_transfer", orderId: "source-order" });
  assert.equal(call.options.shell, false);
  assert.deepEqual(call.options.stdio, ["ignore", "pipe", "pipe"]);
  assert.equal(h.tables[0][0].result, "PASS");
  assert.equal(h.tables[0][0].evidenceIds, "audit-id, observation-id");
  assert.ok(h.logs.some(line => line.includes("SIMULATED CONTROL TEST — NO TRANSFER")));
  assert.ok(h.logs.some(line => line.includes("lab order: lab-order")));
});

test("all runs every scenario after a recorded failure and returns nonzero", () => {
  const h = harness(input => ({ status: 0, stdout: JSON.stringify({
    scenario: input.scenario, simulated: true, passed: input.scenario !== "duplicate_submission",
    expectedControl: "recorded control", observedOutcome: input.scenario === "duplicate_submission" ? "accepted original required" : "control observed",
    evidenceIds: ["audit-id"],
  }) }));
  assert.equal(runScenarios(["all"], h.api), 1);
  assert.deepEqual(h.calls.map(call => JSON.parse(call.args[4]).scenario), SCENARIOS);
  assert.ok(h.calls.every(call => !("orderId" in JSON.parse(call.args[4]))));
  assert.equal(h.tables[0].length, SCENARIOS.length);
  assert.deepEqual(h.tables[0].filter(row => row.result === "FAIL").map(row => row.scenario), ["duplicate_submission"]);
  assert.ok(h.logs.some(line => line.includes("accepted original required")));
});

test("all returns zero only when every backend result passes", () => {
  const h = harness();
  assert.equal(runScenarios(["all"], h.api), 0);
  assert.equal(h.tables[0].length, 6);
  assert.ok(h.tables[0].every(row => row.result === "PASS"));
});

for (const args of [[], ["bogus"], ["all", ""], ["all", "order", "extra"]]) {
  test(`invalid usage never invokes Convex: ${JSON.stringify(args)}`, () => {
    const h = harness();
    assert.equal(runScenarios(args, h.api), 2);
    assert.equal(h.calls.length, 0);
    assert.equal(h.tables.length, 0);
    assert.ok(h.logs[0].startsWith("usage:"));
  });
}

for (const response of [
  { status: 1, stdout: "", stderr: "deployed function unavailable" },
  { status: null, error: new Error("spawn failed"), stdout: "" },
  { status: 0, stdout: "not JSON" },
  { status: 0, stdout: "null" },
  { status: 0, stdout: JSON.stringify({ scenario: "unknown_transfer", simulated: false, passed: true, expectedControl: "control", observedOutcome: "outcome", evidenceIds: [] }) },
  { status: 0, stdout: JSON.stringify({ scenario: "unknown_transfer", simulated: true, passed: "true", expectedControl: "control", observedOutcome: "outcome", evidenceIds: [] }) },
  { status: 0, stdout: JSON.stringify({ scenario: "wrong_amount_transfer", simulated: true, passed: true, expectedControl: "control", observedOutcome: "outcome", evidenceIds: [] }) },
  { status: 0, stdout: JSON.stringify({ scenario: "unknown_transfer", simulated: true, passed: true, expectedControl: "control", observedOutcome: "outcome", evidenceIds: [42] }) },
]) {
  test(`does not claim a pass for execution or result failure: ${JSON.stringify(response)}`, () => {
    const h = harness(() => response);
    assert.equal(runScenarios(["unknown_transfer"], h.api), 1);
    assert.equal(h.tables[0][0].result, "FAIL");
    assert.equal(h.tables[0][0].evidenceIds, "");
    if (response.stderr) assert.ok(h.logs.includes(response.stderr));
  });
}
