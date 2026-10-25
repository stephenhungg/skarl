// @ts-check
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Button, Heading, Inline, Label, SectionMessage, Select, Spinner, Stack, Text, Textfield,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import { AuditCard, displayTime } from './audit';

const decisions = [
  { label: 'All decisions', value: '' },
  { label: 'Allowed', value: 'allowed' },
  { label: 'Refused', value: 'refused' },
];

function Admin() {
  const [status, setStatus] = useState(null);
  const [actions, setActions] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [issueKey, setIssueKey] = useState('');
  const [runId, setRunId] = useState('');
  const [decision, setDecision] = useState(decisions[0]);
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState(null);
  const [activeFilters, setActiveFilters] = useState({});

  const load = async (filters = activeFilters, next = null) => {
    const [health, page] = await Promise.all([
      invoke('getStatus'),
      /** @type {Promise<{actions: any[], nextCursor?: string}>} */ (
        invoke('listActions', { ...filters, ...(next ? { cursor: next } : {}) })
      ),
    ]);
    setStatus(health);
    setActions((previous) => next ? [...previous, ...(page.actions || [])] : page.actions || []);
    setCursor(page.nextCursor || null);
  };

  useEffect(() => {
    load({}).catch((error) => setNotice({ type: 'error', text: error.message || 'Could not load the audit trail.' }))
      .finally(() => setBusy(false));
  }, []);

  const perform = async (work) => {
    setBusy(true);
    setNotice(null);
    try {
      const text = await work();
      await load();
      setNotice({ type: 'information', text });
    } catch (error) {
      setNotice({ type: 'error', text: error.message || 'The operation did not complete. Refresh to check its audit record.' });
    } finally {
      setBusy(false);
    }
  };

  const filter = async () => {
    const filters = {
      ...(issueKey.trim() ? { issueKey: issueKey.trim().toUpperCase() } : {}),
      ...(runId.trim() ? { runId: runId.trim() } : {}),
      ...(decision.value ? { decision: decision.value } : {}),
    };
    setBusy(true);
    setNotice(null);
    try {
      await load(filters);
      setActiveFilters(filters);
    } catch (error) {
      setNotice({ type: 'error', text: error.message || 'Could not filter actions.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack space="space.300">
      <Heading as="h1">Skarl Guard</Heading>
      <Text>Finance exceptions become Jira work. Every agent action has a policy decision and a reversible audit record.</Text>
      <SectionMessage appearance="information" title="Human authority stays with you">
        <Text>Suspicious instructions restrict the agent to comments and human review. The agent cannot approve finance work, transition issues, assign users, or edit descriptions.</Text>
      </SectionMessage>
      {notice && <SectionMessage appearance={notice.type}><Text>{notice.text}</Text></SectionMessage>}
      {status && (
        <Stack space="space.100">
          <Heading as="h2">Connection</Heading>
          <Text>Jira project: {status.projectKey || 'Not configured'} · Hourly action budget: {String(status.hourlyBudget ?? 'Not configured')}</Text>
          <Text>Skarl feed: {status.configured?.feed ? 'Configured' : 'Missing configuration'} · Claude: {status.configured?.anthropic ? 'Configured' : 'Missing API key'}</Text>
          <Text>Last sync: {displayTime(status.lastSync?.at || status.lastSync)}</Text>
          <Text>Project and credentials are set through Forge encrypted variables. Scheduled sync runs every five minutes.</Text>
        </Stack>
      )}
      <Inline space="space.100" shouldWrap>
        <Button appearance="primary" isDisabled={busy} onClick={() => perform(async () => {
          const result = /** @type {{created:number,updated:number,skipped:number,errors:any}} */ (await invoke('syncNow'));
          const errors = Array.isArray(result.errors) ? result.errors.length : Number(result.errors || 0);
          return `Sync finished: ${result.created || 0} created, ${result.updated || 0} updated, ${result.skipped || 0} skipped, ${errors} errors.`;
        })}>Sync now</Button>
        <Button isDisabled={busy} onClick={() => perform(async () => {
          await invoke('testBulkRefusal');
          return 'Bulk safety check recorded. A six-issue batch was refused; no Jira issue was changed.';
        })}>Test bulk refusal</Button>
        <Button isDisabled={busy} onClick={() => perform(async () => 'Audit trail refreshed.')}>Refresh</Button>
        {busy && <Spinner size="small" label="Loading Skarl Guard" />}
      </Inline>
      <Heading as="h2">Action audit</Heading>
      <Text>Revert restores only the agent’s changes. If the current value differs from its recorded result, the action is skipped to preserve subsequent edits.</Text>
      <Inline space="space.200" shouldWrap alignBlock="end">
        <Stack space="space.050">
          <Label labelFor="issue-key">Issue key</Label>
          <Textfield id="issue-key" value={issueKey} onChange={(event) => setIssueKey(event.target.value)} placeholder="SKARL-42" />
        </Stack>
        <Stack space="space.050">
          <Label labelFor="run-id">Run ID</Label>
          <Textfield id="run-id" value={runId} onChange={(event) => setRunId(event.target.value)} placeholder="Any run" />
        </Stack>
        <Stack space="space.050">
          <Label labelFor="decision">Decision</Label>
          <Select id="decision" value={decision} options={decisions} onChange={setDecision} />
        </Stack>
        <Button isDisabled={busy} onClick={filter}>Apply filters</Button>
      </Inline>
      {!busy && actions.length === 0 && <Text>No matching actions. Sync Skarl work or create an issue in the configured project to start an audit trail.</Text>}
      {actions.map((entry) => (
        <AuditCard key={entry.id} entry={entry} busy={busy}
          onReconcile={(id) => perform(async () => {
            const result = /** @type {{status:string,reason?:string}} */ (await invoke('reconcileAction', { id }));
            return `Reconciliation ${result.status}.${result.reason ? ` ${result.reason}` : ''}`;
          })}
          onRevert={(id) => perform(async () => {
            const result = /** @type {{status:string,reason?:string}} */ (await invoke('revertAction', { id }));
            return `Action ${result.status}.${result.reason ? ` ${result.reason}` : ''}`;
          })}
          onRevertRun={(id) => perform(async () => {
            const result = /** @type {{results:{status:string,reason?:string}[]}} */ (await invoke('revertRun', { runId: id }));
            const results = result.results || [];
            const reverted = results.filter((item) => item.status === 'reverted').length;
            return `Run rollback finished: ${reverted} reverted, ${results.length - reverted} skipped. ${results.filter((item) => item.status !== 'reverted').map((item) => item.reason).filter(Boolean).join('; ')}`;
          })}
        />
      ))}
      {cursor && <Button isDisabled={busy} onClick={async () => {
        setBusy(true);
        try { await load(activeFilters, cursor); }
        catch (error) { setNotice({ type: 'error', text: error.message || 'Could not load more actions.' }); }
        finally { setBusy(false); }
      }}>Load more actions</Button>}
    </Stack>
  );
}

ForgeReconciler.render(<Admin />);
