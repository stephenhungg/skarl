const test = require('node:test');
const assert = require('node:assert/strict');
const { createReconciler, SETTLE_MS } = require('../src/reconcile.cjs');
const { fullAdfText } = require('../src/core.cjs');
const adf = text => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

function fixture(extra = {}) {
  const entry = { id: 'action-1', timestamp: 1, runId: 'run-1', issueKey: 'OPS-1', allowed: true, decision: 'allowed', state: 'uncertain',
    action: { type: 'add_comment', text: 'Investigate.' }, inputsHash: 'hash', after: { text: 'Skarl Guard advisory.\nInvestigate.\nGuard run: run-1' }, ...extra };
  const records = new Map([[`audit:${entry.id}`, structuredClone(entry)]]), writes = [];
  const store = { exclusive: async work => work(), auditKey: id => `audit:${id}`, kvs: { get: async key => structuredClone(records.get(key)) }, saveAudit: async value => records.set(`audit:${value.id}`, structuredClone(value)) };
  const jira = { getIssue: async () => ({ fields: { project: { key: 'OPS' }, labels: [], priority: { id: '1' } } }), appAccountId: async () => 'guard-app',
    readCommentPage: async () => ({ startAt: 0, total: 0, comments: [] }), readCommentProperty: async (id, key) => key === 'skarl.guard.action' ? entry.id : true, addComment: async () => writes.push('POST') };
  const ownComment = (extra = {}) => ({ id: 'c1', author: { accountId: 'guard-app' }, body: adf(entry.after.text), updated: 'v2', properties: [{ key: 'skarl.guard.action', value: entry.id }], ...extra });
  const reconcile = () => createReconciler({ store, jira, config: { projectKey: 'OPS' }, now: () => SETTLE_MS + 2 }).reconcile(entry.id);
  return { entry, records, writes, store, jira, ownComment, reconcile };
}

test('a lost POST response is confirmed by action property across pages without posting a duplicate', async () => {
  const f = fixture();
  f.jira.readCommentPage = async (key, startAt) => startAt === 0 ? { startAt, total: 2, comments: [{ id: 'human', author: { accountId: 'human' } }] } : { startAt, total: 2, comments: [f.ownComment()] };
  assert.equal((await f.reconcile()).status, 'confirmed');
  const original = f.records.get('audit:action-1');
  assert.equal(original.state, 'applied'); assert.equal(original.after.commentId, 'c1');
  assert.equal([...f.records.values()].filter(item => item.action.type === 'reconcile_write').length, 1);
  assert.equal((await f.reconcile()).status, 'skipped');
  assert.equal(f.records.size, 2, 'repeated admin clicks must retain one original intent and one reconciliation event');
  assert.deepEqual(f.writes, [], 'read-back must never retry the original comment POST');
});
test('historical comments without action ids require own app author, app property and exact run text', async () => {
  const f = fixture();
  f.jira.readCommentProperty = async (id, key) => key === 'skarl.guard.action' ? null : true;
  f.jira.readCommentPage = async () => ({ startAt: 0, total: 1, comments: [f.ownComment({ properties: [{ key: 'skarl.guard.comment', value: true }] })] });
  assert.equal((await f.reconcile()).status, 'confirmed');
});
test('human text or a copied action marker cannot impersonate the app comment', async () => {
  const f = fixture();
  f.jira.readCommentPage = async () => ({ startAt: 0, total: 1, comments: [f.ownComment({ author: { accountId: 'human' } })] });
  assert.equal((await f.reconcile()).status, 'failed');
  assert.deepEqual(f.writes, [], 'an observed missing original still cannot authorize a replacement comment');
});
test('complete settled read-back marks a missing comment failed and replay remains a no-op', async () => {
  const f = fixture();
  assert.equal((await f.reconcile()).status, 'failed');
  assert.equal((await f.reconcile()).status, 'skipped');
  assert.equal(f.records.get('audit:action-1').state, 'failed'); assert.deepEqual(f.writes, []);
});
test('timeouts, partial pagination and duplicate markers preserve uncertainty instead of inventing success or failure', async () => {
  for (const reader of [async () => { throw new Error('provider body must never be saved'); }, async () => ({ startAt: 0, total: 1001, comments: [] }), async () => ({ startAt: 0, total: 2, comments: [fixture().ownComment(), fixture().ownComment({ id: 'c2' })] })]) {
    const f = fixture(); f.jira.readCommentPage = reader;
    assert.equal((await f.reconcile()).status, 'uncertain'); assert.equal(f.records.get('audit:action-1').state, 'uncertain');
    assert.equal(f.records.size, 1); assert.deepEqual(f.writes, []);
  }
});
test('a request still within its settling interval is not called failed from an early empty read', async () => {
  const f = fixture({ timestamp: SETTLE_MS }); let reads = 0;
  f.jira.getIssue = async () => { reads++; throw new Error('too early'); };
  assert.equal((await f.reconcile()).status, 'uncertain'); assert.equal(reads, 0);
});
test('reconciliation honors the configured project boundary', async () => {
  const f = fixture(); f.jira.getIssue = async () => ({ fields: { project: { key: 'OTHER' } } });
  assert.equal((await f.reconcile()).status, 'uncertain'); assert.equal(f.records.size, 1);
});
test('unknown app identity, malformed totals and exhausted property budget cannot prove a missing comment', async () => {
  const identity = fixture(); identity.jira.appAccountId = async () => 'unknown';
  assert.equal((await identity.reconcile()).status, 'uncertain');
  const malformed = fixture(); malformed.jira.readCommentPage = async () => ({ startAt: 0, total: -1, comments: [] });
  assert.equal((await malformed.reconcile()).status, 'uncertain');
  const capped = fixture(); capped.jira.readCommentProperty = async () => null;
  capped.jira.readCommentPage = async () => ({ startAt: 0, total: 51, comments: Array.from({ length: 51 }, (_, i) => capped.ownComment({ id: `other-${i}`, body: adf('Different run') })) });
  assert.equal((await capped.reconcile()).status, 'uncertain');
  assert.equal(capped.records.size, 1); assert.deepEqual(capped.writes, []);
});
test('edited app comments confirm delivery but preserve expected text so selective rollback cannot delete a human edit', async () => {
  const f = fixture(); f.jira.readCommentPage = async () => ({ startAt: 0, total: 1, comments: [f.ownComment({ body: adf('A human edited this comment.') })] });
  assert.equal((await f.reconcile()).status, 'confirmed');
  assert.equal(f.records.get('audit:action-1').after.text, f.entry.after.text);
  assert.notEqual(fullAdfText(f.ownComment({ body: adf('A human edited this comment.') }).body), f.records.get('audit:action-1').after.text);
});
test('field writes remain uncertain because a matching human edit must never become eligible for agent rollback', async () => {
  for (const failureStatus of [400, 503, undefined]) {
    const f = fixture({ action: { type: 'add_label', label: 'skarl-triaged' }, after: { labels: ['skarl-triaged'] }, failureStage: 'write', failureStatus });
    assert.equal((await f.reconcile()).status, 'uncertain');
  }
  const f = fixture({ action: { type: 'set_priority', priorityId: '1' }, after: { priorityId: '1' } });
  assert.equal((await f.reconcile()).status, 'uncertain');
  assert.equal(f.records.get('audit:action-1').state, 'uncertain');
});

test('a failed post-write read must not be mistaken for a definitive rejection of the write', async () => {
  const f = fixture({ action: { type: 'add_label', label: 'skarl-triaged' }, after: { labels: ['skarl-triaged'] }, failureStage: 'read-back', failureStatus: 403, writeAcknowledged: true });
  assert.equal((await f.reconcile()).status, 'uncertain');
});

test('Jira adapter sends ADF and durable action identity and records only HTTP status on rejection', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  let request, requestedUrl, status = 201;
  const fakeApi = { default: { asApp: () => ({ requestJira: async (url, options) => { request = options; requestedUrl = url; return { ok: status === 201, status, json: async () => ({ id: 'c1' }) }; } }) }, route: (parts, ...values) => parts.reduce((out, part, i) => out + part + (values[i] ?? ''), '') };
  const sandbox = { module: { exports: {} }, require: name => name === '@forge/api' ? fakeApi : require('../src/core.cjs') };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/jira.js'), 'utf8'), sandbox);
  await sandbox.module.exports.addComment('OPS-1', 'Line one\nLine two', 'action-1');
  const body = JSON.parse(request.body);
  assert.equal(body.body.type, 'doc'); assert.equal(fullAdfText(body.body), 'Line one\nLine two');
  assert.equal(body.properties.find(item => item.key === 'skarl.guard.action').value, 'action-1');
  status = 400;
  await assert.rejects(sandbox.module.exports.addComment('OPS-1', 'Text', 'action-1'), error => error.status === 400 && !error.message.includes('Text'));
  status = 404;
  assert.equal(await sandbox.module.exports.readCommentProperty('c1', 'skarl.guard.action'), null);
  assert.equal(requestedUrl, '/rest/api/3/comment/c1/properties/skarl.guard.action', 'comment ownership uses the documented properties API, not an unsupported expansion');
});
