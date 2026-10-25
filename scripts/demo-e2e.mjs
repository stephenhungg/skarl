import { scriptConfig } from "./config.mjs";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

export const LIVE_DEPLOYMENT = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
const json = value => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);
const buyer = scriptConfig.buyerIdentity;
const agent = scriptConfig.financeIdentity;

// This is only a preflight. The server remains the acceptance/payment authority.
export function reportEligible(submission, report) {
  return !submission.verificationOnly && !["uploading", "rejected"].includes(submission.status) &&
    submission.analysis?.implementation === "inference" && submission.analysis.pipelineStatus === "completed" &&
    submission.analysis.recommendation === "accept" && report?.pipeline?.implementation === "inference" &&
    report.pipeline.status === "completed" && report.recommendation === "accept" &&
    report.submissionId === submission._id && report.source?.sha256 === submission.sourceHash &&
    report.taskVersionId === submission.taskVersionId;
}

/** No signer, service secret, media upload, fabricated report, or payment claim. */
export async function runDemo({ query, mutation, log = console.log, sleep = delay }) {
  const pass = message => log(`✓ ${message}`);
  const stop = message => { log(`✗ ${message}`); return 2; };
  const context = await query("dashboard:demoContext", { demoIdentity: buyer });
  if (!context) return stop("no staged order exists; operator must run the existing seed and fund it first");
  const scope = { demoIdentity: buyer, orderId: context.orderId };
  pass(`selected staged order ${context.orderId} (${context.network})`);
  const summary = await query("dashboard:orderSummary", scope);
  const reconciliation = await query("payments:reconciliation", scope);
  pass(`order status=${summary.order.status}; budget=${summary.order.budgetAtomic} micro-USDC; reconciliation matches=${reconciliation.matches.length}, exceptions=${reconciliation.exceptions.length}`);

  const submissions = await query("dashboard:submissions", scope);
  // Prefer an already accepted path so a rerun never accrues another sample.
  const sorted = [...submissions].sort((a, b) => Number(b.status === "accepted") - Number(a.status === "accepted") || a._creationTime - b._creationTime || a._id.localeCompare(b._id));
  let selected;
  for (const submission of sorted) {
    const { report } = await query("submissions:getReport", { demoIdentity: buyer, submissionId: submission._id });
    if (reportEligible(submission, report)) { selected = submission; break; }
    log(`  ${submission._id}: status=${submission.status}; verificationOnly=${!!submission.verificationOnly}; implementation=${report?.pipeline?.implementation ?? "unavailable"}; pipeline=${report?.pipeline?.status ?? "unavailable"}; recommendation=${report?.recommendation ?? "unavailable"}`);
  }
  if (!selected) {
    log("  acceptAndPublish → agent proposal → refused agent approval/audit → buyer approval → wallet intent: skipped");
    return stop("no accept-eligible submission exists yet; requires a licensed, source-bound completed inference report recommending accept (no reports fabricated)");
  }
  pass(`accept-eligible submission ${selected._id}`);
  const accepted = await mutation("finance:acceptAndPublish", { demoIdentity: buyer, submissionId: selected._id });
  if (!accepted.ok) return stop(`acceptAndPublish refused: ${json(accepted)}`);
  pass(`acceptAndPublish ${json(accepted)}`);
  let payable = (await query("dashboard:payables", scope)).find(row => row._id === accepted.payableId);
  if (!payable) return stop("accepted payable missing from dashboard projection");
  if (payable.status === "paid") { pass(`payable ${payable._id} already paid; no new proposal or wallet signing`); return 0; }
  if (payable.command?.attemptCount > 0) return stop(`existing payout attempt for ${payable.intent?._id}; reconcile the original transaction, never send again`);

  // Deterministic typed finance-agent operation; this is not a Gemini inference run.
  const proposed = await mutation("finance:proposePayment", { demoIdentity: agent, payableId: accepted.payableId });
  if (!proposed.ok) return stop(`finance-agent proposal refused: ${json(proposed)}`);
  pass(`finance-agent proposed via finance:proposePayment (no model inference) ${json(proposed)}`);
  const refused = await mutation("finance:approve", { demoIdentity: agent, intentId: proposed.intentId });
  if (refused.ok || !["self_approval_refused", "agent_approval_refused"].includes(refused.code)) {
    return stop(`expected agent approval refusal, received ${json(refused)}`);
  }
  const audits = await query("dashboard:auditEvents", scope);
  const audit = audits.find(row => row.entityId === proposed.intentId && row.action === "payment_approval_refused" &&
    row.reason === refused.code && row.actor?.identity === scriptConfig.financeTokenIdentifier);
  if (!audit) return stop(`agent approval refused (${refused.code}) but matching durable audit is missing`);
  pass(`agent approval refused; audit ${json(audit)}`);
  const approved = await mutation("finance:approve", { demoIdentity: buyer, intentId: proposed.intentId });
  if (!approved.ok) return stop(`buyer approval refused: ${json(approved)}`);
  pass(`buyer approved ${json(approved)}`);
  for (let attempt = 0; attempt < 20; attempt++) {
    payable = (await query("dashboard:payables", scope)).find(row => row._id === accepted.payableId);
    if (payable?.dispatchReady) break;
    if (attempt < 19) await sleep(500);
  }
  if (!payable?.dispatchReady) return stop(`approval stored, Workflow dispatch not ready for ${proposed.intentId}; rerun to inspect (no claim or transfer made)`);
  const intent = payable.intent;
  pass(`payout intent ready for browser wallet signing ${json({ intentId: intent._id, paymentCommandId: proposed.paymentCommandId,
    network: intent.network, tokenAddress: intent.tokenAddress, recipientAddress: intent.recipientAddress,
    amountAtomic: intent.amountAtomic, expiresAt: intent.expiresAt, dispatchReady: true })}`);
  log(`  buyer dashboard: usePayout({ demoIdentity: ${JSON.stringify(buyer)}, provider }).execute("${intent._id}"); no wallet claim/signing performed by this script`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!LIVE_DEPLOYMENT) throw new Error("set CONVEX_URL or NEXT_PUBLIC_CONVEX_URL for the intended deployment");
  console.log(`✓ live deployment ${LIVE_DEPLOYMENT}; demo identities; stops before wallet signing`);
  const client = new ConvexHttpClient(LIVE_DEPLOYMENT);
  try {
    process.exitCode = await runDemo({
      query: (name, args) => client.query(makeFunctionReference(name), args),
      mutation: (name, args) => client.mutation(makeFunctionReference(name), args),
    });
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}; stopped, no automatic retry (rerun reads stored state)`);
    process.exitCode = 1;
  }
}
