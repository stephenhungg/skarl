import assert from "node:assert/strict";
import { test } from "node:test";
import { runDemo } from "./demo-e2e.mjs";

// Synthetic orchestration tests, not evidence of inference or chain execution.
function harness({ verificationOnly = false, pipeline = "completed", recommendation = "accept", auditMissing = false,
  attemptCount = 0, refusal = "self_approval_refused", dispatchReady = true, wrongSource = false } = {}) {
  let accepted = false, approved = false, proposed = false;
  const calls = [], logs = [];
  const submission = { _id: "submission", _creationTime: 1, status: "needs_review", sourceHash: "source", taskVersionId: "rubric", verificationOnly,
    analysis: { implementation: "inference", pipelineStatus: pipeline, recommendation } };
  const report = { submissionId: "submission", source: { sha256: wrongSource ? "other" : "source" }, taskVersionId: "rubric",
    pipeline: { implementation: "inference", status: pipeline }, recommendation };
  const api = {
    log: line => logs.push(line), sleep: async () => {},
    query: async (name) => {
      switch (name) {
        case "dashboard:demoContext": return { orderId: "order", network: "eip155:84532" };
        case "dashboard:orderSummary": return { order: { status: "funded", budgetAtomic: "10000000" } };
        case "payments:reconciliation": return { matches: [{}], exceptions: [] };
        case "dashboard:submissions": return [{ ...submission, status: accepted ? "accepted" : "needs_review" }];
        case "submissions:getReport": return { report };
        case "dashboard:payables": return accepted ? [{ _id: "payable", status: "accrued", command: { attemptCount },
          dispatchReady: approved && dispatchReady, intent: { _id: "intent", amountAtomic: "1875000", network: "eip155:84532", expiresAt: 1 } }] : [];
        case "dashboard:auditEvents": return auditMissing ? [] : [{ _id: "audit", entityId: "intent", action: "payment_approval_refused",
          reason: refusal, actor: { identity: "demo:skarl:finance-agent" } }];
        default: throw new Error(`unexpected query ${name}`);
      }
    },
    mutation: async (name, args) => {
      calls.push({ name, args });
      switch (name) {
        case "finance:acceptAndPublish": { const replayed = accepted; accepted = true; return { ok: true, payableId: "payable", replayed }; }
        case "finance:proposePayment": { const replayed = proposed; proposed = true; return { ok: true, intentId: "intent", paymentCommandId: "command", replayed }; }
        case "finance:approve":
          if (args.demoIdentity === "finance-agent") return refusal === "unexpected_success" ? { ok: true } : { ok: false, code: refusal };
          { const replayed = approved; approved = true; return { ok: true, approvalId: "approval", replayed }; }
        default: throw new Error(`unexpected mutation (must never claim or send) ${name}`);
      }
    },
  };
  return { api, calls, logs };
}

for (const options of [{ verificationOnly: true }, { pipeline: "needs_review" }, { recommendation: "needs_review" }, { wrongSource: true }]) {
  test(`blocks unlicensed/incomplete/mismatched evidence: ${JSON.stringify(options)}`, async () => {
    const h = harness(options);
    assert.equal(await runDemo(h.api), 2);
    assert.deepEqual(h.calls, []);
    assert.ok(h.logs.some(line => line.includes("no accept-eligible submission")));
  });
}

test("reuses one path on rerun, requires refused agent approval and audit before controller approval, never claims", async () => {
  const h = harness();
  assert.equal(await runDemo(h.api), 0);
  assert.equal(await runDemo(h.api), 0);
  assert.deepEqual(h.calls.map(call => [call.name, call.args.demoIdentity]), Array(2).fill([
    ["finance:acceptAndPublish", "controller"], ["finance:proposePayment", "finance-agent"],
    ["finance:approve", "finance-agent"], ["finance:approve", "controller"],
  ]).flat());
  assert.equal(new Set(h.calls.filter(call => call.args.submissionId).map(call => call.args.submissionId)).size, 1);
  assert.ok(h.logs.some(line => line.includes('"replayed":true')));
});

for (const options of [{ auditMissing: true }, { refusal: "unexpected_success" }, { refusal: "not_found" }, { attemptCount: 1 }]) {
  test(`stops before controller approval on unsafe state: ${JSON.stringify(options)}`, async () => {
    const h = harness(options);
    assert.equal(await runDemo(h.api), 2);
    assert.ok(!h.calls.some(call => call.name === "finance:approve" && call.args.demoIdentity === "controller"));
  });
}

test("does not claim wallet readiness until Workflow dispatch exists", async () => {
  const h = harness({ dispatchReady: false });
  assert.equal(await runDemo(h.api), 2);
  assert.ok(!h.logs.some(line => line.includes("ready for browser wallet signing")));
});
