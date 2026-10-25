import { internalQuery } from "./_generated/server";
import { requireRole } from "./lib/demoAuth";
import { feedCode, receiptUrl, type JiraFeedItem } from "./lib/jiraFeed";

/** Internal, read-only projection. The HTTP credential is scoped to the seeded
 * active demo organization; request parameters cannot select a tenant or role. */
export const snapshot = internalQuery({
  args: {},
  handler: async (ctx) => {
    const principal = await requireRole(ctx, "finance-agent", "finance-agent");
    const orders = await ctx.db.query("orders").withIndex("by_org_status", q => q.eq("organizationId", principal.organizationId)).order("desc").take(20);
    const items: JiraFeedItem[] = [];
    const scopes = [];
    for (const order of orders) {
      const intents = await ctx.db.query("paymentIntents").withIndex("by_order", q => q.eq("orderId", order._id)).order("desc").take(100);
      const payables = await ctx.db.query("payables").withIndex("by_order", q => q.eq("orderId", order._id)).order("desc").take(100);
      const byPayable = new Map(payables.filter(row => row.organizationId === principal.organizationId).map(row => [row._id, row]));
      const linked: { eventKey: string; entityId: string; amountMicroUsdc?: string; witnessReceiptUrl?: string }[] = intents.filter(row => row.organizationId === principal.organizationId).map(intent => {
        const payable = intent.kind === "contributor_payout" ? byPayable.get(intent.payableId) : undefined;
        return { eventKey: intent.intentId, entityId: intent._id, amountMicroUsdc: intent.amountAtomic.toString(),
          ...(receiptUrl(payable?.submissionId) ? { witnessReceiptUrl: receiptUrl(payable?.submissionId)! } : {}) };
      });
      for (const intent of intents) {
        if (intent.organizationId !== principal.organizationId || intent.kind !== "contributor_payout" || intent.requesterTokenIdentifier !== "demo:skarl:finance-agent") continue;
        const link = linked.find(row => row.entityId === intent._id)!;
        items.push({ id: `proposal:${intent._id}`, kind: "agent_proposal", status: intent.status,
          orderId: order._id, createdAt: intent._creationTime, amountMicroUsdc: link.amountMicroUsdc,
          ...(link.witnessReceiptUrl ? { witnessReceiptUrl: link.witnessReceiptUrl } : {}), simulated: false,
          description: "Skarl finance-agent payout proposal. Independent controller approval and wallet signing are required; this record grants no payment authority. Base Sepolia test assets." });
      }
      // Refused proposals have no intent yet: canonical finance refusals point
      // at the payable/submission instead. Preserve those links without exposing
      // the source documents or contributor identity in the HTTP response.
      for (const payable of byPayable.values()) linked.push({ eventKey: payable.sourceEventKey,
        entityId: payable._id, amountMicroUsdc: payable.amountAtomic.toString(),
        ...(receiptUrl(payable.submissionId) ? { witnessReceiptUrl: receiptUrl(payable.submissionId)! } : {}) });
      const submissions = await ctx.db.query("submissions").withIndex("by_order_status", q => q.eq("orderId", order._id)).order("desc").take(100);
      for (const submission of submissions) {
        if (submission.organizationId !== principal.organizationId) continue;
        linked.push({ eventKey: `submission:${submission._id}`, entityId: submission._id,
          ...(receiptUrl(submission._id) ? { witnessReceiptUrl: receiptUrl(submission._id)! } : {}) });
      }
      const runs = await ctx.db.query("financeAgentRuns").withIndex("by_order", q => q.eq("orderId", order._id)).order("desc").take(20);
      for (const run of runs) {
        if (run.organizationId !== principal.organizationId) continue;
        let steps: unknown;
        try { steps = JSON.parse(run.transcriptJson); } catch { continue; }
        if (!Array.isArray(steps)) continue;
        steps.slice(0, 24).forEach((step, index) => {
          if (!step || typeof step !== "object" || !step.result || typeof step.result !== "object" || step.result.ok !== false) return;
          items.push({ id: `refusal:${run._id}:${index}`, kind: "agent_refusal", status: "refused",
            orderId: order._id, createdAt: run.startedAt, simulated: false,
            description: `Skarl finance-agent tool refused: ${feedCode(step.result.code)}. Model text cannot authorize financial actions.` });
        });
      }
      const simulated = order.publicId.startsWith("scenario:");
      scopes.push({ orderId: order._id, createdAt: order.updatedAt, linked, simulated });
      if (simulated) for (const item of items) if (item.orderId === order._id) item.simulated = true;
    }
    const events = await ctx.db.query("auditEvents").withIndex("by_org_time", q => q.eq("organizationId", principal.organizationId)).order("desc").take(300);
    // Scenario runs store durable starts/results in the existing audit table.
    // Read only their small, validated envelope; never export observed model text.
    const scenarioNames = ["wrong_amount_transfer", "unknown_transfer", "duplicate_submission", "agent_self_approval", "prompt_injection_narration", "bank_mismatch"];
    const scenarios = new Map<string, JiraFeedItem>();
    for (const event of events) {
      if (!["scenario_started", "scenario_finished"].includes(event.action) || event.entityType !== "orders") continue;
      let data: Record<string, unknown>;
      try { data = JSON.parse(event.reason); } catch { continue; }
      if (!data || data.simulated !== true || !scenarioNames.includes(String(data.scenario)) ||
        data.orderId !== event.entityId || typeof data.scenarioId !== "string" ||
        event.eventKey !== `scenario:${data.scenarioId}:${event.action === "scenario_started" ? "started" : "finished"}`) continue;
      const orderId = ctx.db.normalizeId("orders", event.entityId);
      const order = orderId ? await ctx.db.get(orderId) : null;
      if (!order || order.organizationId !== principal.organizationId) continue;
      const runId = event.action === "scenario_started" ? event._id : typeof data.runId === "string" ? ctx.db.normalizeId("auditEvents", data.runId) : null;
      if (!runId || scenarios.has(runId)) continue;
      const start = await ctx.db.get(runId);
      if (!start || start.organizationId !== principal.organizationId || start.action !== "scenario_started" || start.eventKey !== `scenario:${data.scenarioId}:started`) continue;
      const status = event.action === "scenario_started" ? "running" : data.passed === true ? "control_passed" : "needs_review";
      scenarios.set(runId, { id: `scenario:${runId}`, kind: "scenario_run", status, orderId: order._id,
        createdAt: start.occurredAt, simulated: true,
        description: `SIMULATED Skarl scenario: ${feedCode(data.scenario)}. Recorded control result: ${status}. Synthetic inputs; no external transfer or live inference is claimed.` });
    }
    items.push(...scenarios.values());
    for (const event of events) {
      if (event.actor.identity !== "demo:skarl:finance-agent" || !event.action.endsWith("_refused")) continue;
      const scope = scopes.find(row => row.orderId === event.entityId || row.linked.some(link => link.entityId === event.entityId));
      if (!scope) continue;
      const link = scope.linked.find(row => row.entityId === event.entityId);
      items.push({ id: `refusal:${event._id}`, kind: "agent_refusal", status: "refused", orderId: scope.orderId,
        createdAt: event.occurredAt, simulated: scope.simulated || event.evidenceReferences.some(value => value.startsWith("SIMULATED ")),
        ...(link?.amountMicroUsdc ? { amountMicroUsdc: link.amountMicroUsdc } : {}),
        ...(link?.witnessReceiptUrl ? { witnessReceiptUrl: link.witnessReceiptUrl } : {}),
        description: `Skarl finance-agent action refused: ${feedCode(event.action)} (${feedCode(event.reason)}). Independent human review required.` });
    }
    return { items, scopes };
  },
});
