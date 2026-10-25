const SUCCESS_KEY = 'health-last-successful-sync';
const MAX_AUDIT_PAGES = 20;

function siteOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.convex\.site$/.test(url.hostname) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('Invalid health destination.');
  return url.origin;
}
function timestamp(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= Date.now();
}

/** Called under the existing sync lock. A partial sync cannot replace success. */
async function rememberSuccessfulSync(store, result) {
  if (!timestamp(result?.at) || !Array.isArray(result.errors) || result.errors.length) return;
  try { await store.kvs.set(SUCCESS_KEY, result.at); }
  catch { /* Health bookkeeping cannot turn a completed Jira sync into a retry. */ }
}

/** Canonical audit pages only: issue/run indexes contain duplicate copies.
 * An incomplete inventory is a lower bound, never a clean bill of health. */
async function uncertainActions(store) {
  let cursor, uncertainCount = 0;
  try {
    for (let page = 0; page < MAX_AUDIT_PAGES; page++) {
      const result = await store.listActions(cursor ? { cursor } : {});
      if (!Array.isArray(result.actions)) break;
      // A pending durable write can have reached Jira before its worker died.
      uncertainCount += result.actions.filter(entry => ['pending', 'uncertain'].includes(entry.state) || ['pending', 'uncertain'].includes(entry.rollback?.status)).length;
      if (!result.nextCursor) return { uncertainCount, truncated: false };
      if (result.nextCursor === cursor) break;
      cursor = result.nextCursor;
    }
  } catch { /* Provider/storage errors stay private. */ }
  return { uncertainCount, truncated: true };
}

/** Advisory telemetry cannot fail or replay a Jira sync. No issue content,
 * audit reasons, provider bodies, identifiers or credentials enter the body. */
async function publishJiraHealth({ store, config, fetcher }) {
  try {
    if (!config.feedSecret) return false;
    const origin = siteOrigin(config.convexSiteUrl);
    let lastSyncAt = await store.kvs.get(SUCCESS_KEY);
    if (!timestamp(lastSyncAt)) {
      const prior = await store.kvs.get('last-sync');
      if (timestamp(prior?.at) && Array.isArray(prior.errors) && !prior.errors.length) lastSyncAt = prior.at;
      else return false; // An attempted sync is not a successful sync.
    }
    const { uncertainCount, truncated } = await uncertainActions(store);
    const response = await fetcher(`${origin}/health/jira`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-skarl-feed-secret': config.feedSecret },
      body: JSON.stringify({ lastSyncAt, uncertainCount, truncated }), redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch { return false; }
}

module.exports = { rememberSuccessfulSync, publishJiraHealth, uncertainActions };
