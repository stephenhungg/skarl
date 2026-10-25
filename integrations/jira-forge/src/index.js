const Resolver = require('@forge/resolver').default;
const { fetch } = require('@forge/api');
const store = require('./storage');
const jira = require('./jira');
const { createAgent } = require('./agent.cjs');
const { createSync, sourceKey, receiptKey } = require('./sync.cjs');
const { policy, hash } = require('./core.cjs');
const { randomUUID } = require('node:crypto');

function configuration() {
  const projectKey = process.env.SKARL_JIRA_PROJECT_KEY || '';
  if (projectKey && !/^[A-Z][A-Z0-9_]{1,30}$/.test(projectKey)) throw new Error('Invalid SKARL_JIRA_PROJECT_KEY.');
  const budget = Number(process.env.SKARL_HOURLY_ACTION_BUDGET || 40);
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > 500) throw new Error('SKARL_HOURLY_ACTION_BUDGET must be an integer from 1 to 500.');
  return { projectKey, hourlyBudget: budget, issueType: process.env.SKARL_JIRA_ISSUE_TYPE || 'Task',
    convexSiteUrl: process.env.SKARL_CONVEX_SITE_URL || '', feedSecret: process.env.SKARL_FEED_SECRET || '', anthropicKey: process.env.ANTHROPIC_API_KEY || '' };
}
function services() {
  const deps = { config: configuration(), store, jira, fetcher: fetch };
  return { ...deps, agent: createAgent(deps), sync: createSync(deps) };
}
const resolver = new Resolver();
resolver.define('getStatus', async ({ context }) => {
  await jira.requireAdmin(context);
  const config = configuration();
  return { projectKey: config.projectKey, configured: { feed: Boolean(config.convexSiteUrl && config.feedSecret), anthropic: Boolean(config.anthropicKey) }, hourlyBudget: config.hourlyBudget, lastSync: await store.kvs.get('last-sync') || null };
});
resolver.define('syncNow', async ({ context }) => { await jira.requireAdmin(context); return services().sync.sync(); });
resolver.define('listActions', async ({ context, payload }) => {
  await jira.requireAdmin(context);
  const filter = payload || {};
  if (filter.issueKey && !/^[A-Z][A-Z0-9_]+-\d+$/.test(filter.issueKey)) throw new Error('Invalid issue filter.');
  return store.listActions({ issueKey: filter.issueKey, decision: ['allowed', 'refused'].includes(filter.decision) ? filter.decision : undefined, runId: filter.runId, cursor: filter.cursor });
});
resolver.define('revertAction', async ({ context, payload }) => { await jira.requireAdmin(context); if (typeof payload?.id !== 'string') throw new Error('Action id is required.'); return store.exclusive(() => services().agent.revert(payload.id)); });
resolver.define('revertRun', async ({ context, payload }) => {
  await jira.requireAdmin(context);
  if (typeof payload?.runId !== 'string' || !/^[a-f0-9-]{36}$/.test(payload.runId)) throw new Error('Valid run id is required.');
  return store.exclusive(async () => {
    const { actions, nextCursor } = await store.listActions({ runId: payload.runId });
    if (nextCursor) throw new Error('Run exceeds safe rollback batch. Revert individual actions.');
    const agent = services().agent, results = [];
    // Reverse each run's explicit action sequence. Compare only the field the
    // action changed; unrelated edits/comments must survive selective rollback.
    for (const entry of actions.sort((a, b) => (b.sequence ?? -1) - (a.sequence ?? -1) || b.timestamp - a.timestamp)) {
      const result = await agent.revert(entry.id);
      results.push({ id: entry.id, ...result });
    }
    return { results };
  });
});
resolver.define('issueSummary', async ({ context }) => {
  const key = await jira.requireIssueRead(context), config = configuration();
  const issue = await jira.getIssue(key);
  if (issue.fields.project.key !== config.projectKey) return { receipt: null, actions: [], nextCursor: null };
  const property = await jira.getProperty(key);
  const source = property?.id ? await store.kvs.get(sourceKey(property.id)) : null;
  const receipt = source?.issueKey === key ? await store.kvs.get(receiptKey(property.id)) : null;
  return { receipt: receipt || null, ...await store.listActions({ issueKey: key }) };
});
resolver.define('testBulkRefusal', async ({ context }) => {
  await jira.requireAdmin(context);
  const config = configuration(), runId = randomUUID(), action = { type: 'add_label', label: 'skarl-triaged' };
  const decision = policy(action, { projectKey: config.projectKey, issueProject: config.projectKey, issueCount: 6, recentIssueCount: 6, usedActions: 0, hourlyBudget: config.hourlyBudget, priorityIds: [], guard: { flagged: false } });
  await store.saveAudit(store.newAudit({ runId, issueKey: 'policy-demo', action: { type: 'bulk_triage', requestedIssueCount: 6 }, before: null, after: null, inputsHash: hash({ requestedIssueCount: 6 }), guardFindings: [], modelReasoning: 'Deterministic policy demonstration; no Jira or model request.', allowed: false, decision: 'refused', state: 'refused', reason: decision.reason }));
  return { status: 'refused', reason: decision.reason, runId };
});
exports.handler = resolver.getDefinitions();
exports.scheduledSync = async () => services().sync.sync();
exports.issueEvent = async event => {
  try { return await services().agent.triage(event); }
  catch (error) {
    // Retry only contention before any run/action intent exists. Replaying an
    // uncertain Jira write is unsafe; completed/started event ids dedupe it.
    if (error.code === 'GUARD_BUSY') {
      const { InvocationError, InvocationErrorCode } = require('@forge/events');
      return new InvocationError({ retryAfter: 60, retryReason: InvocationErrorCode.FUNCTION_RETRY_REQUEST, retryData: { reason: 'Guard operation active; no work started.' } });
    }
    throw error;
  }
};
