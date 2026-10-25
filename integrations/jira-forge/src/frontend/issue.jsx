// @ts-check
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Button, Code, Heading, Link, Lozenge, SectionMessage, Spinner, Stack, Text,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import { AuditCard, displayTime } from './audit';

function formatUsdc(value) {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return null;
  const amount = BigInt(value);
  const absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? '-' : ''}${absolute / 1000000n}.${(absolute % 1000000n).toString().padStart(6, '0')} USDC`;
}

function IssuePanel() {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const load = async () => {
    setBusy(true);
    setError('');
    try { setResult(await invoke('issueSummary')); }
    catch (failure) { setError(failure.message || 'Could not load Skarl evidence.'); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(); }, []);
  const receipt = result?.receipt;
  const amount = formatUsdc(receipt?.amountMicroUsdc);
  const receiptUrl = receipt?.witnessReceiptUrl;
  const safeUrl = typeof receiptUrl === 'string' && /^https:\/\//i.test(receiptUrl) ? receiptUrl : null;
  return (
    <Stack space="space.200">
      <Heading as="h3">Skarl witness</Heading>
      {busy && <Spinner label="Loading witness evidence" />}
      {error && <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage>}
      {receipt ? (
        <Stack space="space.100">
          <Lozenge appearance={receipt.simulated ? 'moved' : 'default'}>{receipt.simulated ? 'Simulated' : 'Skarl record'}</Lozenge>
          <Text>{receipt.kind} · {receipt.status}</Text>
          <Text>{receipt.description}</Text>
          {amount && <Text>Amount: {amount}</Text>}
          {receipt.orderId && <Text>Order: <Code>{receipt.orderId}</Code></Text>}
          <Text>Created: {displayTime(receipt.createdAt)}</Text>
          <Text>Source ID: <Code>{receipt.id}</Code></Text>
          {safeUrl && <Link href={safeUrl} openNewTab>Open witness receipt</Link>}
          <Text>Evidence supports human review. Jira labels and agent comments do not approve a payout.</Text>
        </Stack>
      ) : !busy && !error && <Text>This issue has no linked Skarl receipt. Agent decisions for this issue appear below.</Text>}
      <Heading as="h3">Agent audit trail</Heading>
      {result?.actions?.map((entry) => <AuditCard key={entry.id} entry={entry} />)}
      {!busy && !error && result?.actions?.length === 0 && <Text>No agent actions recorded for this issue.</Text>}
      {result?.nextCursor && <Text>More actions are available in the Skarl Guard administration page.</Text>}
      <Button isDisabled={busy} onClick={load}>Refresh evidence</Button>
    </Stack>
  );
}

ForgeReconciler.render(<IssuePanel />);
