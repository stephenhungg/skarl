const { kvs, WhereConditions } = require('@forge/kvs');
const { randomUUID } = require('node:crypto');
const { hash, rateWindow, rekeyRateWindow } = require('./core.cjs');

const LOCK_KEY = 'guard-write-lock';
// An atomic create prevents concurrent invocations bypassing rate checks, event
// dedupe and sync issue creation. A crashed invocation fails closed until Forge
// expires the lock (TTL deletion may be delayed). Never steal a live lock.
async function exclusive(work) {
  const owner = randomUUID();
  try { await kvs.set(LOCK_KEY, { owner }, { keyPolicy: 'FAIL_IF_EXISTS', ttl: { unit: 'MINUTES', value: 5 } }); }
  catch { const error = new Error('Another Guard operation is active (or recovering). Retry later; no action was taken.'); error.code = 'GUARD_BUSY'; throw error; }
  try { return await work(); }
  finally { await kvs.delete(LOCK_KEY); }
}
const auditKey = id => `audit:${id}`;
async function saveAudit(entry) {
  await kvs.set(auditKey(entry.id), entry);
  await kvs.set(`issue-audit:${entry.issueKey}:${entry.id}`, entry);
  await kvs.set(`run-audit:${entry.runId}:${entry.id}`, entry);
}
function newAudit(data) {
  const timestamp = Date.now();
  return { id: `${String(9999999999999 - timestamp)}-${randomUUID()}`, timestamp, ...data };
}
async function listActions(filter = {}) {
  const prefix = filter.issueKey ? `issue-audit:${filter.issueKey}:` : filter.runId ? `run-audit:${filter.runId}:` : 'audit:';
  let query = kvs.query().where('key', WhereConditions.beginsWith(prefix)).limit(50);
  if (filter.cursor) query = query.cursor(filter.cursor);
  const page = await query.getMany();
  const actions = page.results.map(result => result.value).filter(entry => (!filter.decision || entry.decision === filter.decision)
    && (!filter.runId || entry.runId === filter.runId));
  return { actions, nextCursor: page.nextCursor || null };
}
async function rateContext(issueKey, now = Date.now(), reserve = false) {
  // Serialized by exclusive(): rolling windows, including concurrent events.
  const prior = await kvs.get('guard-rate-window') || { actions: [], issues: [] };
  const next = rateWindow(prior, issueKey, now, reserve);
  if (reserve) await kvs.set('guard-rate-window', next.window);
  return next.context;
}
async function rekeyRateIssue(from, to) {
  // Called under exclusive() as soon as creation returns an authoritative Jira
  // key, so sync and triage count the same issue, not two different identities.
  const prior = await kvs.get('guard-rate-window') || { actions: [], issues: [] };
  await kvs.set('guard-rate-window', rekeyRateWindow(prior, from, to));
}

const eventKey = value => `event:${hash(value)}`;
module.exports = { kvs, exclusive, auditKey, saveAudit, newAudit, listActions, rateContext, rekeyRateIssue, eventKey };
