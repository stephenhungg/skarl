import { internalAction, query } from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import { PAYMENT_NETWORK, SOLANA_PAYMENT_NETWORK } from "../packages/contracts/src/chain";
import { envConfigured, evidenceStatus, publicSiteUrl, REQUIRED_ENV, type HealthItem } from "./lib/health";
import { probeBalance, probeNessie, probeBinding, type Probe } from "./lib/healthProbe";

const probeInputs = makeFunctionReference<"query", {}, { treasury: string | null; bankAccountId: string | null }>("healthData:probeInputs");

/** Public non-sensitive capability check, not proof of settlement or real authentication. */
export const status = query({
  args: {},
  handler: () => ({
    service: "skarl" as const,
    stage: "demo_backend" as const,
    network: PAYMENT_NETWORK,
    financialMutationsImplemented: true,
    demoIdentityOnly: true,
    productionAuthenticationImplemented: false,
    workerGatewayImplemented: false,
    livePaymentsImplemented: true,
    paymentsServiceConfigured: (process.env.SKARL_PAYMENTS_SERVICE_SECRET?.length ?? 0) >= 32,
    inferenceConfigured: !!process.env.GEMINI_API_KEY?.trim(),
    inferenceImplemented: true,
    mediaUploadsImplemented: true,
    modelAvailabilityCheckedByHealth: false,
    visualInput: "timestamped_jpeg_frames" as const,
  }),
});

/** Operator/cron only: no inference, signing, writes to banks, or public probe amplification. */
export const refresh = internalAction({ args: {}, handler: async ctx => {
  const input = await ctx.runQuery(probeInputs, {});
  const probes = await Promise.all([
    probeBalance("agent_wallet", process.env.CDP_AGENT_ADDRESS, process.env.BASE_SEPOLIA_RPC_URL),
    probeBalance("treasury", input.treasury, process.env.BASE_SEPOLIA_RPC_URL),
    probeNessie(input.bankAccountId, process.env.NESSIE_API_KEY, process.env.NESSIE_ENABLED === "true"),
  ]);
  await ctx.runMutation(makeFunctionReference<"mutation", { probes: Probe[] }, null>("healthData:storeProbes"), { probes });
  return { checkedAt: Date.now() };
} });

/** Fixed demo scope and an explicit allowlist: never return source documents or errors. */
export const integrations = query({ args: {}, handler: async ctx => {
  const now = Date.now(), items: HealthItem[] = [];
  const item = (id: string, status: HealthItem["status"], demoCritical: boolean, reason: string, fix: string,
    lastSuccessAt: number | null, evidence: HealthItem["evidence"] = {}) =>
    items.push({ id, status, demoCritical, reason, fix, checkedAt: now, lastSuccessAt, evidence });
  for (const [name, critical] of REQUIRED_ENV) {
    const configured = envConfigured(name, process.env);
    item(`env.${name}`, configured ? "ok" : "missing", critical, configured ? "configured; value withheld" : "not configured or invalid",
      `set ${name} on the Convex deployment; never put credentials in client env`, null, { name, configured });
  }
  const siteUrl = publicSiteUrl(process.env.SITE_URL);
  item("site_url", siteUrl ? "ok" : "missing", true, siteUrl ? "public web origin configured" : "public web origin missing or invalid",
    "set SITE_URL to the deployed web origin", null, { value: siteUrl });
  const google = ["AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET", "JWT_PRIVATE_KEY", "JWKS", "SITE_URL"].every(name => envConfigured(name, process.env));
  item("auth.google", google ? "ok" : "missing", false, google ? "google provider configured; sign-in not exercised" : "google provider configuration incomplete",
    "configure AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, JWT_PRIVATE_KEY, JWKS and SITE_URL; verify sign-in separately", null, { provider: "google", configured: google });

  for (const job of ["reconcile", "attest", "bank", "finance"] as const) {
    const runs = await ctx.db.query("healthCronRuns").withIndex("by_job", q => q.eq("job", job)).order("desc").take(20);
    const run = runs[0], success = runs.find(row => row.outcome === "complete");
    const freshMs = job === "finance" ? 25 * 60_000 : 5 * 60_000;
    const state = evidenceStatus(now, run?.startedAt ?? null, run?.outcome === "complete", freshMs);
    item(`cron.${job}`, state, job === "reconcile" || job === "finance",
      !run ? "no observed cron run since health instrumentation deployed" : state === "ok" ? "cron invocation completed; downstream evidence reported separately" : "cron stale, running, disabled or failed",
      "deploy the cron wrappers, enable the integration and inspect Convex cron logs", success?.completedAt ?? null,
      { lastRunAt: run?.startedAt ?? null, completedAt: run?.completedAt ?? null, outcome: run?.outcome ?? null, freshMs });
  }

  const org = await ctx.db.query("organizations").withIndex("by_demo_key", q => q.eq("demoKey", "skarl-demo-v1")).unique();
  const orgId = org?._id;
  const realOrders = orgId ? (await ctx.db.query("orders").withIndex("by_org_status", q => q.eq("organizationId", orgId)).order("desc").take(100))
    .filter(order => !order.publicId.startsWith("scenario:")) : [];
  const realOrderIds = new Set(realOrders.map(order => order._id));
  const analyses = orgId ? await ctx.db.query("analysisResults").filter(q => q.eq(q.field("organizationId"), orgId)).order("desc").take(100) : [];
  const financeRuns = orgId ? await ctx.db.query("financeAgentRuns").filter(q => q.eq(q.field("organizationId"), orgId)).order("desc").take(100) : [];
  const chats = orgId ? await ctx.db.query("agentChats").filter(q => q.eq(q.field("organizationId"), orgId)).order("desc").take(100) : [];
  const coaches = orgId ? await ctx.db.query("coachExplanations").filter(q => q.eq(q.field("organizationId"), orgId)).order("desc").take(100) : [];
  for (const provider of ["gemini", "claude"] as const) {
    const times = financeRuns.filter(run => realOrderIds.has(run.orderId) && (run.provider ?? "gemini") === provider && run.status === "completed")
      .map(run => run.completedAt ?? 0);
    times.push(...chats.filter(chat => realOrderIds.has(chat.orderId) && chat.model.startsWith(provider) && chat.status === "completed").map(chat => chat.completedAt ?? 0));
    if (provider === "claude") for (const coach of coaches) {
      if (coach.status !== "completed" || !coach.model.startsWith("claude")) continue;
      const submission = await ctx.db.get(coach.submissionId);
      if (submission && !submission.simulationOnly && realOrderIds.has(submission.orderId)) times.push(coach.completedAt ?? 0);
    }
    if (provider === "gemini") for (const analysis of analyses) {
      if (analysis.implementation !== "inference") continue;
      const submission = await ctx.db.get(analysis.submissionId);
      if (!submission || submission.simulationOnly || !realOrderIds.has(submission.orderId)) continue;
      try {
        const report = JSON.parse(analysis.reportJson ?? "null");
        if (report?.pipeline?.implementation === "inference" && Array.isArray(report.pipeline.modelRuns) &&
          report.pipeline.modelRuns.some((run: { provider?: string; model?: string; elapsedMs?: number }) =>
            run?.provider === "google" && typeof run.model === "string" && run.model.startsWith("gemini") &&
            typeof run.elapsedMs === "number" && Number.isFinite(run.elapsedMs) && run.elapsedMs >= 0)) times.push(analysis.completedAt);
      } catch { /* Invalid/missing reports are not live-call proof. */ }
    }
    const at = Math.max(0, ...times) || null;
    const state = evidenceStatus(now, at, true, 24 * 60 * 60_000);
    item(provider, state, true, state === "ok" ? "stored successful inference/tool-loop run; not a new model probe" : at ? "last stored successful run is stale" : "no successful model run in the bounded recent inventory",
      `configure ${provider === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY"} and run the existing ${provider === "gemini" ? "verifier" : "finance agent"}; fixtures do not count`, at,
      { source: "stored runs", inventoryLimitPerTable: 100 });
  }

  const inputs = await ctx.runQuery(probeInputs, {});
  for (const kind of ["agent_wallet", "treasury", "nessie"] as const) {
    const probe = await ctx.db.query("healthProbes").withIndex("by_kind", q => q.eq("kind", kind)).unique();
    let state = !probe || probe.outcome === "unconfigured" ? "missing" as const : evidenceStatus(now, probe.checkedAt, probe.outcome === "success", 5 * 60_000);
    const empty = probe?.outcome === "success" && (kind === "agent_wallet" ? probe.ethWei === "0" || probe.usdcMicro === "0" : kind === "treasury" && probe.usdcMicro === "0");
    const expectedBinding = probeBinding(kind, kind === "agent_wallet" ? process.env.CDP_AGENT_ADDRESS : kind === "treasury" ? inputs.treasury : inputs.bankAccountId);
    const bindingChanged = probe?.outcome === "success" && probe.bindingHash !== expectedBinding;
    if (empty) state = "missing";
    if (bindingChanged) state = "missing";
    item(kind, state, kind !== "nessie", !probe ? "no read-only probe recorded" : probe.outcome === "unconfigured" ? "probe prerequisite missing" :
      bindingChanged ? "probe subject changed; cached evidence cannot establish this wallet/account" : empty ? "required testnet balance is zero" : state === "ok" ? kind === "nessie" ? "known Nessie account verified by GET; simulated banking" : "Base Sepolia balance observed by read-only RPC" : "read-only probe failed or is stale",
      kind === "nessie" ? "enable NESSIE_ENABLED, configure NESSIE_API_KEY and seed the simulated bank account; run health:refresh" :
        kind === "agent_wallet" ? "configure CDP_AGENT_ADDRESS; fund Base Sepolia gas and USDC; run health:refresh" : "fund the stored Base Sepolia treasury intent; run health:refresh",
      probe?.outcome === "success" && !bindingChanged ? probe.checkedAt : null,
      { probeAt: probe?.checkedAt ?? null, ethWei: !bindingChanged && kind === "agent_wallet" ? probe?.ethWei ?? null : null,
        usdcMicro: !bindingChanged ? probe?.usdcMicro ?? null : null, blockNumber: !bindingChanged ? probe?.blockNumber ?? null : null, simulated: kind === "nessie" });
  }

  const demoOrder = realOrders.find(order => order.publicId === "skarl-red-cup-demo-v2");
  const funding = demoOrder ? await ctx.db.query("paymentIntents").withIndex("by_order", q => q.eq("orderId", demoOrder._id))
    .filter(q => q.and(q.eq(q.field("network"), PAYMENT_NETWORK), q.neq(q.field("kind"), "contributor_payout"))).order("desc").first() : null;
  const webhooks = orgId && funding ? await ctx.db.query("cdpWebhookReceipts").withIndex("by_treasury", q =>
    q.eq("organizationId", orgId).eq("treasury", funding.recipientAddress.toLowerCase())).order("desc").take(100) : [];
  const webhook = webhooks.find(row => !row.eventId.startsWith("SIMULATED"));
  item("cdp_webhook", evidenceStatus(now, webhook?.receivedAt ?? null, true), false,
    webhook ? "stored verified-ingress receipt; not settlement authority" : "no CDP webhook received",
    "configure the web CDP webhook secret/subscription and verify delivery; never replay a payment to make health green", webhook?.receivedAt ?? null,
    { receivedAt: webhook?.receivedAt ?? null });
  const bank = orgId ? await ctx.db.query("bankSnapshots").withIndex("by_org", q => q.eq("organizationId", orgId)).order("desc").first() : null;
  item("bank_snapshot", evidenceStatus(now, bank?.fetchedAt ?? null, bank?.status === "available", 5 * 60_000), false,
    bank ? "latest stored Nessie snapshot; simulated banking" : "no simulated bank snapshot",
    "enable and run the existing bank sweep; Nessie is a mock bank", bank?.status === "available" ? bank.fetchedAt : null,
    { fetchedAt: bank?.fetchedAt ?? null, available: bank?.status === "available", simulated: true });
  const jira = await ctx.db.query("healthJira").first();
  item("jira", evidenceStatus(now, jira?.lastSyncAt ?? null, !!jira && !jira.truncated && jira.uncertainCount === 0, 15 * 60_000), false,
    !jira ? "Forge sync telemetry not received; uncertain count unknown" : jira.truncated ? "uncertain inventory unavailable or capped" :
      jira.uncertainCount ? "Jira uncertain writes require reconciliation" : "Forge successful-sync heartbeat recorded; inspect timestamp for freshness",
    "deploy the Forge health publisher and Convex receiver using the existing feed secret; reconcile uncertain writes without replay",
    jira?.lastSyncAt ?? null,
    { lastSyncAt: jira?.lastSyncAt ?? null, receivedAt: jira?.receivedAt ?? null,
      uncertainCount: jira && !jira.truncated ? jira.uncertainCount : null, uncertainCountLowerBound: jira?.uncertainCount ?? null, truncated: jira?.truncated ?? null });
  const confirmed = await ctx.db.query("attestations").filter(q => q.eq(q.field("status"), "confirmed")).order("desc").take(100);
  let eas: typeof confirmed[number] | undefined;
  for (const candidate of confirmed) {
    const submission = await ctx.db.get(candidate.submissionId);
    if (candidate.attestationUid && candidate.txHash && submission && !submission.simulationOnly && realOrderIds.has(submission.orderId)) { eas = candidate; break; }
  }
  item("eas", evidenceStatus(now, eas?.updatedAt ?? null, true), false, eas ? "stored confirmed EAS attestation" : "no confirmed EAS attestation",
    "enable EAS_ATTESTATIONS_ENABLED and configure EAS_ATTESTOR_ADDRESS/EAS_ATTESTOR_POLICY_ID; run the existing sweep", eas?.updatedAt ?? null,
    { confirmedAt: eas?.updatedAt ?? null });
  const solana = orgId ? await ctx.db.query("chainObservations").filter(q => q.and(q.eq(q.field("organizationId"), orgId),
    q.eq(q.field("network"), SOLANA_PAYMENT_NETWORK))).order("desc").first() : null;
  item("solana", evidenceStatus(now, solana?.observedAt ?? null, solana?.succeeded === true), false,
    solana ? "stored Solana Devnet observation; optional funding-only rail" : "no Solana Devnet observation; optional funding-only rail",
    "use the existing Solana funding flow if demonstrating the optional rail; payouts stay on Base", solana?.succeeded ? solana.observedAt : null,
    { observedAt: solana?.observedAt ?? null, fundingOnly: true });

  const order = await ctx.db.query("orders").withIndex("by_public_id", q => q.eq("publicId", "skarl-red-cup-demo-v2")).unique();
  const deliveries = order && order.organizationId === orgId ? await ctx.db.query("deliveries").withIndex("by_order", q => q.eq("orderId", order._id)).order("desc").take(100) : [];
  let licensedAt: number | null = null;
  for (const delivery of deliveries) {
    const manifest = delivery.manifest;
    if (!manifest || delivery.organizationId !== orgId) continue;
    const [consent, submission, original] = await Promise.all([
      ctx.db.get(manifest.consentRecordId), ctx.db.get(delivery.submissionId), ctx.db.get(manifest.originalAssetId),
    ]);
    if (submission?.status === "accepted" && !submission.verificationOnly && !submission.simulationOnly && submission.organizationId === orgId &&
      consent?.organizationId === orgId && consent.submissionId === submission._id && !consent.revocationStatus &&
      consent.licenseVersion.trim() && consent.scope.trim() && original?.status === "verified" && original.purpose === "original" &&
      original.submissionId === submission._id && original.organizationId === orgId && original.contentHash === submission.sourceHash &&
      manifest.sourceHash === submission.sourceHash && manifest.licenseVersion === consent.licenseVersion) {
      licensedAt = delivery.publishedAt; break;
    }
  }
  item("licensed_clip", licensedAt === null ? "missing" : "ok", true,
    licensedAt === null ? "needs a licensed accepted clip" : "stored accepted clip with verified original and current consent",
    "record a consented original clip for the demo order, complete verification and acceptance; do not fabricate evidence", licensedAt);
  return { version: 1, service: "skarl", network: PAYMENT_NETWORK, generatedAt: now,
    scope: "demo integration telemetry; bounded stored evidence plus cached read-only probes", items,
    demoReady: items.filter(row => row.demoCritical).every(row => row.status === "ok") };
} });
