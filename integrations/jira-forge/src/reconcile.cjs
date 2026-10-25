const { fullAdfText, hash } = require('./core.cjs');
const { sourceKey } = require('./sync.cjs');

const SETTLE_MS = 5 * 60 * 1000;

// Reconciliation only reads Jira. A missing comment never authorizes another
// POST, including after a failed observation; the original event stays deduped.
function createReconciler({ store, jira, config, now = Date.now }) {
  async function reconcile(id) {
    return store.exclusive(async () => {
      const entry = await store.kvs.get(store.auditKey(id));
      if (!entry) throw new Error('Audit action not found.');
      if (!entry.allowed || !['pending', 'uncertain'].includes(entry.state)) return { status: 'skipped', reason: 'Only unresolved allowed writes need reconciliation.' };
      if (!RECONCILABLE.includes(entry.action.type)) return { status: 'uncertain', reason: 'Only comments and source syncs carry app-owned provenance. Field writes require independent changelog review.' };
      const at = now();
      // Pending intents can belong to a crashed invocation. Let the global write
      // lock and settling interval expire before treating absence as evidence.
      if (at - entry.timestamp < SETTLE_MS) return { status: 'uncertain', reason: 'Wait five minutes for the original Jira request to settle.' };
      if (entry.action.type === 'sync_source') return record(entry, at, await sourceOutcome(entry));
      let state, reason, comment;
      try {
        const issue = await jira.getIssue(entry.issueKey);
        if (issue.fields.project.key !== config.projectKey) return { status: 'uncertain', reason: 'Issue moved outside the configured project; independent review required.' };
        {
          const accountId = await jira.appAccountId();
          if (typeof accountId !== 'string' || !accountId || accountId === 'unknown') throw new Error('App identity unavailable.');
          const matches = [];
          let startAt = 0, complete = false, propertyReads = 0;
          for (let page = 0; page < 10; page++) {
            const result = await jira.readCommentPage(entry.issueKey, startAt);
            if (!Array.isArray(result.comments) || result.comments.length > 100 || !Number.isSafeInteger(result.total) || result.total < 0 || result.startAt !== startAt || startAt + result.comments.length > result.total) throw new Error('Incomplete comment page.');
            for (const item of result.comments) {
              if (item.author?.accountId !== accountId) continue;
              if (item.id === entry.after?.commentId) { matches.push(item); continue; }
              // The comments API documents renderedBody expansion only. Read
              // properties through their explicit API rather than assuming a
              // missing expansion means the original write never happened.
              if (++propertyReads > 50) throw new Error('Property read budget exceeded.');
              const actionId = await jira.readCommentProperty(item.id, 'skarl.guard.action');
              let exactLegacy = false;
              if (actionId === null && fullAdfText(item.body) === entry.after?.text && entry.after?.text?.includes(`Guard run: ${entry.runId}`)) {
                if (++propertyReads > 50) throw new Error('Property read budget exceeded.');
                exactLegacy = await jira.readCommentProperty(item.id, 'skarl.guard.comment') === true;
              }
              if (actionId === entry.id || exactLegacy) matches.push(item);
            }
            startAt += result.comments.length;
            if (startAt >= result.total) { complete = true; break; }
            if (!result.comments.length) break;
          }
          if (!complete || matches.length > 1) return { status: 'uncertain', reason: 'Comment read-back is incomplete or ambiguous; no write was retried.' };
          comment = matches[0];
          state = comment ? 'applied' : 'failed';
          reason = comment ? 'Confirmed original app-owned comment by read-back; no comment was posted.' : 'Complete Jira read-back found no original comment after the settling interval. No retry is authorized.';
        }
      } catch {
        // A failed/partial read is never proof that a write failed. Do not record
        // provider response text, which can contain issue contents or secrets.
        return { status: 'uncertain', reason: 'Jira read-back unavailable; original intent retained and no write retried.' };
      }
      if (comment) entry.after = { ...entry.after, commentId: comment.id, updated: entry.after.updated || comment.updated || comment.created };
      return record(entry, at, { state, reason });
    });
  }
  // Source syncs are idempotent by source id: Jira's issue property is the provenance.
  // Read-back only; a stuck pending source is linked or released, never re-created here.
  async function sourceOutcome(entry) {
    const key = sourceKey(entry.action.sourceId), source = await store.kvs.get(key);
    if (source?.state === 'applied' && source.issueKey && (source.syncedAt ?? 0) > entry.timestamp)
      return { state: 'superseded', reason: `A later sync applied this source to ${source.issueKey}; nothing to retry.` };
    if (entry.before?.issueKey) return { state: 'requeued', reason: 'Idempotent source update; the next sync re-applies the full snapshot. Reconciliation retried no write.' };
    let issueKey;
    try { issueKey = await jira.findSource(config.projectKey, entry.action.sourceId); }
    catch { return { status: 'uncertain', reason: 'Jira source read-back unavailable or ambiguous; no write retried.' }; }
    if (issueKey && source?.issueKey && source.issueKey !== issueKey) return { status: 'uncertain', reason: 'Stored and Jira source identities disagree; independent review required.' };
    if (issueKey) {
      if (source && !source.issueKey) await store.kvs.set(key, { ...source, issueKey });
      return { state: 'applied', reason: `Confirmed ${issueKey} by source property read-back; no issue was created.`, issueKey };
    }
    // Complete settled search found nothing: the create never landed, so the next sync may create it once.
    if (source?.state === 'pending' && !source.issueKey) await store.kvs.set(key, { ...source, state: 'failed' });
    return { state: 'failed', reason: 'Complete settled search found no issue for this source. The next sync may create it once.' };
  }
  async function record(entry, at, outcome) {
    if (outcome.status) return outcome;
    const { state, reason } = outcome;
    const reconciliation = { status: ['applied', 'superseded'].includes(state) ? 'confirmed' : state, at, reason };
    const event = { id: `reconcile-${hash(entry.id)}`, timestamp: at, runId: entry.runId, issueKey: outcome.issueKey || entry.issueKey,
      action: { type: 'reconcile_write', originalActionId: entry.id }, before: { state: entry.state }, after: { state },
      allowed: true, decision: 'allowed', state: 'applied', inputsHash: entry.inputsHash, guardFindings: [], modelReasoning: 'Deterministic Jira read-back only; no model or write authority.', reason };
    // A deterministic event id makes recovery from either storage write safe.
    await store.saveAudit(event);
    entry.state = state; entry.reason = reason; entry.reconciliation = reconciliation;
    if (outcome.issueKey) entry.issueKey = outcome.issueKey;
    await store.saveAudit(entry);
    return { status: reconciliation.status, reason };
  }
  // Scheduled pass: settled, read-confirmable entries only, bounded per run.
  async function reconcileOpen(limit = OPEN_LIMIT) {
    const at = now(), ids = [], summary = { scanned: 0, attempted: 0, results: {} };
    let cursor;
    for (let page = 0; page < 20 && ids.length < limit; page++) {
      const result = await store.listActions({ cursor });
      for (const entry of result.actions) {
        summary.scanned++;
        if (ids.length < limit && entry.allowed && ['pending', 'uncertain'].includes(entry.state) && RECONCILABLE.includes(entry.action?.type) && at - entry.timestamp >= SETTLE_MS) ids.push(entry.id);
      }
      if (!(cursor = result.nextCursor)) break;
    }
    for (const id of ids) {
      let status;
      try { ({ status } = await reconcile(id)); }
      catch (error) { if (error.code === 'GUARD_BUSY') break; status = 'error'; }
      summary.attempted++; summary.results[status] = (summary.results[status] || 0) + 1;
    }
    return summary;
  }
  return { reconcile, reconcileOpen };
}
const RECONCILABLE = ['add_comment', 'request_human_review', 'sync_source'];
const OPEN_LIMIT = 10;
module.exports = { createReconciler, SETTLE_MS };
