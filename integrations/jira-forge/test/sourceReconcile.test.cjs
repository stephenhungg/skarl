const test = require('node:test');
const assert = require('node:assert/strict');
const { createReconciler, SETTLE_MS } = require('../src/reconcile.cjs');
const { createSync, sourceKey } = require('../src/sync.cjs');

// Sync errors used to stay "uncertain" forever, so every 5-minute retry of one bad source
// inflated Jira health. These tests pin that source syncs resolve by read-back, never by re-creating.
function fixture({ entry: entryExtra = {}, source } = {}) {
  const entry = { id: 'sync-1', timestamp: 1, runId: 'run-1', issueKey: 'pending', allowed: true, decision: 'allowed', state: 'uncertain',
    action: { type: 'sync_source', sourceId: 'src-1' }, before: null, inputsHash: 'fp', ...entryExtra };
  const records = new Map([[`audit:${entry.id}`, structuredClone(entry)]]), writes = [];
  if (source) records.set(sourceKey('src-1'), structuredClone(source));
  const store = { exclusive: async work => work(), auditKey: id => `audit:${id}`,
    kvs: { get: async key => structuredClone(records.get(key)), set: async (key, value) => records.set(key, structuredClone(value)) },
    saveAudit: async value => records.set(`audit:${value.id}`, structuredClone(value)),
    listActions: async () => ({ actions: [...records].filter(([key]) => key.startsWith('audit:')).map(([, value]) => structuredClone(value)), nextCursor: null }) };
  const jira = { findSource: async () => null, createIssue: async () => writes.push('create') };
  const reconciler = (at = SETTLE_MS + 2) => createReconciler({ store, jira, config: { projectKey: 'OPS' }, now: () => at });
  return { entry, records, writes, store, jira, reconciler, reconcile: () => reconciler().reconcile(entry.id) };
}

test('a lost create response is confirmed by source property and links the stuck pending source without creating', async () => {
  const f = fixture({ source: { id: 'src-1', state: 'pending', fingerprint: 'fp' } });
  f.jira.findSource = async () => 'OPS-7';
  assert.equal((await f.reconcile()).status, 'confirmed');
  assert.equal(f.records.get('audit:sync-1').state, 'applied');
  assert.equal(f.records.get(sourceKey('src-1')).issueKey, 'OPS-7', 'next sync must update OPS-7 instead of blocking on "prior creation is uncertain"');
  assert.deepEqual(f.writes, []);
});
test('a later successful sync supersedes an old uncertain attempt without any Jira read', async () => {
  const f = fixture({ source: { id: 'src-1', state: 'applied', issueKey: 'OPS-7', syncedAt: 50 } });
  f.jira.findSource = async () => { throw new Error('must not read'); };
  assert.equal((await f.reconcile()).status, 'confirmed');
  assert.equal(f.records.get('audit:sync-1').state, 'superseded');
});
test('complete settled absence fails the attempt and releases the pending source for exactly one future create', async () => {
  const f = fixture({ source: { id: 'src-1', state: 'pending', fingerprint: 'fp' } });
  assert.equal((await f.reconcile()).status, 'failed');
  assert.equal(f.records.get(sourceKey('src-1')).state, 'failed');
  assert.deepEqual(f.writes, [], 'reconciliation itself never creates the issue');
  assert.equal((await f.reconcile()).status, 'skipped');
});
test('ambiguous or unavailable read-back stays uncertain and leaves the source untouched', async () => {
  for (const findSource of [async () => { throw new Error('Multiple issues claim the same Skarl source'); }, async () => 'OPS-9']) {
    const f = fixture({ source: { id: 'src-1', state: 'pending', issueKey: 'OPS-7', fingerprint: 'fp' } });
    f.jira.findSource = findSource;
    assert.equal((await f.reconcile()).status, 'uncertain');
    assert.equal(f.records.get('audit:sync-1').state, 'uncertain');
    assert.equal(f.records.get(sourceKey('src-1')).issueKey, 'OPS-7');
  }
});
test('update attempts on a linked issue are requeued because the next sync re-applies the idempotent snapshot', async () => {
  const f = fixture({ entry: { before: { id: 'src-1', issueKey: 'OPS-7', state: 'applied' } }, source: { id: 'src-1', state: 'pending', issueKey: 'OPS-7', fingerprint: 'fp2' } });
  assert.equal((await f.reconcile()).status, 'requeued');
});
test('the scheduled pass reconciles only settled read-confirmable entries and never field writes', async () => {
  const f = fixture({ source: { id: 'src-1', state: 'applied', issueKey: 'OPS-7', syncedAt: 50 } });
  f.records.set('audit:field', { id: 'field', timestamp: 1, allowed: true, state: 'uncertain', action: { type: 'add_label' } });
  f.records.set('audit:fresh', { id: 'fresh', timestamp: SETTLE_MS, allowed: true, state: 'uncertain', action: { type: 'sync_source', sourceId: 'src-1' } });
  const summary = await f.reconciler().reconcileOpen();
  assert.equal(summary.attempted, 1); assert.deepEqual(summary.results, { confirmed: 1 });
  assert.equal(f.records.get('audit:field').state, 'uncertain');
  assert.equal(f.records.get('audit:fresh').state, 'uncertain');
});
test('a sync that fails before any Jira write records failed, not uncertain', async () => {
  const records = new Map();
  const store = { exclusive: async work => work(), kvs: { get: async key => records.get(key), set: async (key, value) => records.set(key, value) },
    saveAudit: async value => records.set(`audit:${value.id}`, structuredClone(value)), newAudit: data => ({ id: `a-${records.size}`, timestamp: 1, ...data }),
    rateContext: async () => ({ usedActions: 0, recentIssueCount: 0 }), rekeyRateIssue: async () => {}, listActions: async () => ({ actions: [], nextCursor: null }) };
  const item = { id: 'src-1', kind: 'reconciliation_exception', status: 'open', createdAt: 1, description: 'Held payout', simulated: true };
  const fetcher = async url => url.endsWith('/jira/feed') ? { ok: true, text: async () => JSON.stringify({ version: 1, generatedAt: 1, items: [item] }) } : { ok: true };
  const jira = { findSource: async () => { throw new Error('search unavailable'); }, createIssue: async () => { throw new Error('must not create'); } };
  const config = { projectKey: 'OPS', feedSecret: 'secret', convexSiteUrl: 'https://keen-marmot-986.convex.site', hourlyBudget: 40, issueType: 'Task' };
  const result = await createSync({ store, jira, config, fetcher }).sync();
  assert.equal(result.errors.length, 1);
  const attempt = [...records.values()].find(value => value.action?.type === 'sync_source');
  assert.equal(attempt.state, 'failed');
});
