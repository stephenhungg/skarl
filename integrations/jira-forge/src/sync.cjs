const { hash, clean, validateFeed, policy } = require('./core.cjs');
const { randomUUID } = require('node:crypto');
const sourceKey = id => `source:${hash(id)}`;
const receiptKey = id => `receipt:${hash(id)}`;
function createSync({ store, jira, config, fetcher }) {
  async function sync() {
    if (!config.projectKey || !config.feedSecret || !config.convexSiteUrl) throw new Error('Set SKARL_JIRA_PROJECT_KEY, SKARL_CONVEX_SITE_URL and SKARL_FEED_SECRET before syncing.');
    const url = new URL(config.convexSiteUrl);
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.convex\.site$/.test(url.hostname) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('SKARL_CONVEX_SITE_URL must be an HTTPS *.convex.site origin.');
    return store.exclusive(async () => {
      const response = await fetcher(`${url.origin}/jira/feed`, { headers: { 'x-skarl-feed-secret': config.feedSecret }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`Skarl feed unavailable (${response.status}); no issue data was changed.`);
      const raw = await response.text();
      if (raw.length > 2_000_000) throw new Error('Skarl feed exceeds the 2 MB cap.');
      const items = validateFeed(JSON.parse(raw));
      const result = { created: 0, updated: 0, skipped: 0, errors: [], at: Date.now() };
      let touched = 0;
      for (const item of items) {
        const key = sourceKey(item.id), fingerprint = hash(item);
        let source = await store.kvs.get(key);
        if (source?.fingerprint === fingerprint && source?.state === 'applied') { result.skipped++; continue; }
        if (touched >= 5) { result.skipped++; continue; }
        const rateIssueKey = source?.issueKey || `source:${item.id}`;
        const rate = await store.rateContext(rateIssueKey);
        const decision = policy({ type: 'add_label', label: 'skarl-triaged' }, { ...rate, issueCount: 1, projectKey: config.projectKey, issueProject: config.projectKey, hourlyBudget: config.hourlyBudget, priorityIds: [], guard: { flagged: false } });
        if (!decision.allowed) { await store.saveAudit(store.newAudit({ runId: randomUUID(), issueKey: source?.issueKey || 'pending', action: { type: 'sync_source', sourceId: item.id }, before: source || null, after: null, inputsHash: fingerprint, guardFindings: [], modelReasoning: 'Deterministic sync rate policy.', allowed: false, decision: 'refused', state: 'refused', reason: decision.reason })); result.errors.push({ id: item.id, reason: decision.reason }); break; }
        touched++;
        const runId = randomUUID();
        const entry = store.newAudit({ runId, issueKey: source?.issueKey || 'pending', action: { type: 'sync_source', sourceId: item.id }, before: source || null,
          after: { sourceId: item.id, fingerprint }, inputsHash: fingerprint, guardFindings: [], modelReasoning: 'Deterministic authenticated feed sync; no model or finance authority.', allowed: true, decision: 'allowed', state: 'pending' });
        await store.saveAudit(entry);
        try {
          await store.rateContext(rateIssueKey, Date.now(), true);
          let issueKey = source?.issueKey;
          if (!issueKey) issueKey = await jira.findSource(config.projectKey, item.id);
          if (!issueKey && source?.state === 'pending') throw new Error('Prior creation is uncertain and not yet found in Jira. Reconcile before creating another issue.');
          await store.kvs.set(key, { ...source, id: item.id, state: 'pending', fingerprint, ...(issueKey ? { issueKey } : {}) });
          if (!issueKey) {
            const labels = ['skarl-exception', ...(item.simulated ? ['simulated'] : [])];
            const description = [`Skarl Guard source: ${item.id}`, `Kind: ${item.kind}; status: ${item.status}`, `Evidence: ${item.simulated ? 'SIMULATED / DEMO' : 'recorded Skarl event'}`,
              ...(item.amountMicroUsdc === undefined ? [] : [`Amount: ${item.amountMicroUsdc} micro-USDC (decimal integer; 6 decimals)`]),
              ...(item.orderId ? [`Order: ${item.orderId}`] : []), clean(item.description, 2000),
              ...(item.witnessReceiptUrl ? [`Witness receipt: ${item.witnessReceiptUrl} (requires authorized Skarl access)`] : []),
              'This issue is operational evidence. Financial decisions require independent controller authorization.'].join('\n');
            const issue = await jira.createIssue({ project: { key: config.projectKey }, issuetype: { name: config.issueType }, summary: clean(`[Skarl${item.simulated ? ' simulated' : ''}] ${item.kind}: ${item.status} — ${item.id}`, 250), description: jira.adf(description), labels }, { id: item.id, fingerprint });
            issueKey = issue.key;
            // Persist the returned Jira identity immediately. A lost create
            // response remains pending and is never automatically re-created.
            await store.kvs.set(key, { id: item.id, issueKey, state: 'pending', fingerprint });
            result.created++;
          } else {
            const issue = await jira.getIssue(issueKey);
            if (issue.fields.project.key !== config.projectKey) throw new Error('Linked Jira issue moved outside configured project.');
            const property = await jira.getProperty(issueKey);
            if (property?.id !== item.id) throw new Error('Linked Jira source property no longer matches.');
            // Keep the original issue content and human edits. Fresh source
            // snapshots live in the app-owned property and receipt panel.
            await jira.setProperty(issueKey, { id: item.id, fingerprint });
            if (!(issue.fields.labels || []).includes('skarl-exception')) await jira.addLabel(issueKey, 'skarl-exception');
            if (item.simulated && !(issue.fields.labels || []).includes('simulated')) await jira.addLabel(issueKey, 'simulated');
            result.updated++;
          }
          if (rateIssueKey !== issueKey) await store.rekeyRateIssue(rateIssueKey, issueKey);
          await store.kvs.set(receiptKey(item.id), item);
          await store.kvs.set(key, { id: item.id, issueKey, fingerprint, state: 'applied', syncedAt: Date.now() });
          entry.issueKey = issueKey; entry.state = 'applied'; entry.after = { sourceId: item.id, fingerprint, issueKey };
          await store.saveAudit(entry);
        } catch (error) {
          entry.state = 'uncertain'; entry.reason = clean(error.message, 500); await store.saveAudit(entry);
          result.errors.push({ id: item.id, reason: entry.reason });
        }
      }
      await store.kvs.set('last-sync', result);
      return result;
    });
  }
  return { sync };
}
module.exports = { sourceKey, receiptKey, createSync };
