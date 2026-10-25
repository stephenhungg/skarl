// @ts-check
import React, { useState } from 'react';
import {
  Box, Button, Code, CodeBlock, Heading, Inline, Lozenge, Stack, Text,
} from '@forge/react';

export const displayTime = (value) => {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
};

const json = (value) => JSON.stringify(value ?? null, null, 2);

export function AuditCard({ entry, busy = false, onRevert = null, onRevertRun = null, onReconcile = null }) {
  const [expanded, setExpanded] = useState(false);
  const allowed = entry.allowed === true;
  const action = typeof entry.action === 'string'
    ? entry.action
    : entry.action?.type || entry.action?.name || 'Attempt';
  const reverted = Boolean(entry.revertedAt || entry.state === 'reverted' || entry.rollback?.status === 'reverted');
  const reversibleType = ['add_label', 'set_priority', 'add_comment', 'request_human_review'].includes(action);
  const canRevert = allowed && entry.state === 'applied' && !reverted && reversibleType;
  return (
    <Box padding="space.200" backgroundColor="color.background.neutral">
      <Stack space="space.100">
        <Inline space="space.100" alignBlock="center" shouldWrap>
          <Heading as="h4">{entry.issueKey || 'Policy check'} · {action}</Heading>
          <Lozenge appearance={allowed ? 'success' : 'removed'}>{allowed ? 'Allowed' : 'Refused'}</Lozenge>
          {reverted && <Lozenge appearance="moved">Reverted</Lozenge>}
          {entry.state && !reverted && <Lozenge>{entry.state}</Lozenge>}
        </Inline>
        <Text>{displayTime(entry.timestamp)}</Text>
        {entry.reason && <Text>{String(entry.reason)}</Text>}
        {entry.rollback?.reason && <Text>Rollback: {String(entry.rollback.reason)}</Text>}
        {entry.modelReasoning && <Text>Agent explanation: {String(entry.modelReasoning)}</Text>}
        {entry.guardFindings?.length > 0 && (
          <Text>Guard findings: {entry.guardFindings.map((finding) => typeof finding === 'string' ? finding : json(finding)).join('; ')}</Text>
        )}
        <Inline space="space.100" shouldWrap>
          <Button appearance="subtle" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Hide evidence' : 'View evidence'}
          </Button>
          {onRevert && canRevert && (
            <Button isDisabled={busy} onClick={() => onRevert(entry.id)}>Revert action</Button>
          )}
          {onReconcile && allowed && ['pending', 'uncertain'].includes(entry.state) && ['add_comment', 'request_human_review'].includes(action) && (
            <Button isDisabled={busy} onClick={() => onReconcile(entry.id)}>Reconcile write</Button>
          )}
          {onRevertRun && entry.runId && reversibleType && allowed && (
            <Button isDisabled={busy} onClick={() => onRevertRun(entry.runId)}>Revert all by this run</Button>
          )}
        </Inline>
        {expanded && (
          <Stack space="space.100">
            <Text>Run: <Code>{entry.runId || 'Not recorded'}</Code></Text>
            <Text>Inputs SHA-256: <Code>{entry.inputsHash || 'Not recorded'}</Code></Text>
            <Text>Proposed action</Text>
            <CodeBlock language="json" text={json(entry.action)} />
            <Text>Before</Text>
            <CodeBlock language="json" text={json(entry.before)} />
            <Text>After</Text>
            <CodeBlock language="json" text={json(entry.after)} />
          </Stack>
        )}
      </Stack>
    </Box>
  );
}
