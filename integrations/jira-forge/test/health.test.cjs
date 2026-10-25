const test = require('node:test');
const assert = require('node:assert/strict');
const { rememberSuccessfulSync, publishJiraHealth, uncertainActions } = require('../src/health.cjs');
const { createSync } = require('../src/sync.cjs');

const config = { convexSiteUrl: 'https://test.convex.site', feedSecret: 'synthetic-health-secret', projectKey: 'OPS' };
function storage(lastSyncAt = Date.now() - 1000) {
  const records = new Map(lastSyncAt ? [['health-last-successful-sync', lastSyncAt]] : []);
  return { records, kvs: { get: async key => records.get(key), set: async (key, value) => records.set(key, value) },
    exclusive: work => work(), listActions: async () => ({ actions: [], nextCursor: null }) };
}

test('counts canonical unresolved writes once because duplicate indexes overstate failures and pending writes may have reached Jira', async () => {
  const cursors = [];
  const count = await uncertainActions({ listActions: async filter => {
    cursors.push(filter);
    return filter.cursor ? { actions: [{ state: 'applied', rollback: { status: 'uncertain' } }, { state: 'uncertain', rollback: { status: 'uncertain' } }], nextCursor: null }
      : { actions: [{ state: 'uncertain' }, { state: 'applied' }, { state: 'pending' }], nextCursor: 'page2' };
  } });
  assert.deepEqual(count, { uncertainCount: 4, truncated: false });
  assert.deepEqual(cursors, [{}, { cursor: 'page2' }]);
});

test('bounded scans declare truncation because unseen audit pages may hold uncertain writes', async () => {
  let calls = 0;
  const count = await uncertainActions({ listActions: async () => { calls++; return { actions: [{ state: 'uncertain' }], nextCursor: `page${calls}` }; } });
  assert.equal(calls, 20);
  assert.deepEqual(count, { uncertainCount: 20, truncated: true });
});

test('a repeated cursor remains truncated because the storage provider did not prove inventory completion', async () => {
  const result = await uncertainActions({ listActions: async () => ({ actions: [], nextCursor: 'same' }) });
  assert.deepEqual(result, { uncertainCount: 0, truncated: true });
});

test('telemetry contains only allowlisted counts and successful time because audit bodies and sync errors are private', async () => {
  const store = storage(), lastSyncAt = store.records.get('health-last-successful-sync');
  store.listActions = async () => ({ actions: [{ state: 'uncertain', reason: 'PRIVATE AUDIT BODY' }], nextCursor: null });
  let request;
  const published = await publishJiraHealth({ config, store,
    fetcher: async (url, options) => { request = { url, ...options }; return { ok: true }; },
  });
  assert.equal(published, true);
  assert.equal(request.url, 'https://test.convex.site/health/jira');
  assert.equal(request.method, 'POST');
  assert.equal(request.redirect, 'error');
  assert.deepEqual(JSON.parse(request.body), { lastSyncAt, uncertainCount: 1, truncated: false });
  assert.equal(request.body.includes('PRIVATE'), false);
  assert.equal(request.body.includes(config.feedSecret), false);
  assert.equal(request.headers['x-skarl-feed-secret'], config.feedSecret);
  assert.ok(request.signal instanceof AbortSignal);
});

test('unknown audit inventory stays truncated because a failed scan does not prove zero uncertain writes', async () => {
  const store = storage(), lastSyncAt = store.records.get('health-last-successful-sync');
  store.listActions = async () => { throw new Error('private storage failure'); };
  await publishJiraHealth({ config, store, fetcher: async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), { lastSyncAt, uncertainCount: 0, truncated: true }); return { ok: true };
  } });
});

test('rejects alternate destinations because telemetry credentials must stay on the configured Convex origin', async () => {
  for (const convexSiteUrl of ['https://attacker.example', 'http://test.convex.site', 'https://test.convex.site/path', 'https://user:password@test.convex.site', 'https://test.convex.site?key=private']) {
    assert.equal(await publishJiraHealth({ config: { ...config, convexSiteUrl }, store: storage(), fetcher: () => assert.fail('must not send') }), false);
  }
});

test('failed health publishing preserves a completed sync because telemetry must never trigger Jira replay', async () => {
  const store = storage(null), result = await createSync({ config, store,
    jira: {}, fetcher: async (url, options) => {
      if (url.endsWith('/jira/feed')) return { ok: true, text: async () => JSON.stringify({ version: 1, generatedAt: 1, items: [] }) };
      assert.equal(store.records.has('last-sync'), true);
      assert.equal(options.method, 'POST');
      throw new Error('private network failure');
    },
  }).sync();
  assert.deepEqual(result.errors, []);
  assert.equal(result.created, 0);
  assert.equal(store.records.get('last-sync'), result);
  assert.equal(store.records.get('health-last-successful-sync'), result.at);
});

test('failed current sync reports the earlier success because a new attempt is not proof of a new sync', async () => {
  const store = storage(), lastSyncAt = store.records.get('health-last-successful-sync');
  let published;
  await assert.rejects(createSync({ config, store, jira: {}, fetcher: async (url, options) => {
    if (url.endsWith('/jira/feed')) return { ok: false, status: 503 };
    published = JSON.parse(options.body); return { ok: true };
  } }).sync(), /feed unavailable/);
  assert.deepEqual(published, { lastSyncAt, uncertainCount: 0, truncated: false });
});

test('partial sync cannot overwrite the successful timestamp because its Jira writes still need reconciliation', async () => {
  const store = storage(), prior = store.records.get('health-last-successful-sync');
  await rememberSuccessfulSync(store, { at: Date.now(), errors: [{ reason: 'uncertain write' }] });
  assert.equal(store.records.get('health-last-successful-sync'), prior);
});

test('legacy success can supply evidence but failed or absent history cannot invent a last success', async () => {
  const store = storage(null), at = Date.now() - 1000;
  store.records.set('last-sync', { at, errors: [] });
  assert.equal(await publishJiraHealth({ store, config, fetcher: async (_url, options) => {
    assert.equal(JSON.parse(options.body).lastSyncAt, at); return { ok: true };
  } }), true);
  for (const prior of [undefined, { at, errors: ['failed'] }, { at: Date.now() + 100000, errors: [] }]) {
    store.records.set('last-sync', prior);
    assert.equal(await publishJiraHealth({ store, config, fetcher: () => assert.fail('unknown success must not publish') }), false);
  }
});

test('failed success bookkeeping cannot make completed writes retry because health has no business authority', async () => {
  await rememberSuccessfulSync({ kvs: { set: async () => { throw new Error('private storage failure'); } } }, { at: Date.now(), errors: [] });
  assert.equal(await publishJiraHealth({ store: storage(), config: { ...config, feedSecret: '' }, fetcher: () => assert.fail('missing telemetry credential must not send') }), false);
});
