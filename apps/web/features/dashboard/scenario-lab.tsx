"use client";

import Link from "next/link";
import { useAction, useQuery } from "convex/react";
import { useState } from "react";
import { Button } from "@/components/glaze/ui/button";
import { Status } from "@/components/glaze/ui/status";
import { api, CONTROLLER, useOrderId } from "./data";
import { formatTime, humanize } from "./format";
import { ConfirmDialog, Loading, PageHeader, Section, Unavailable } from "./ui";
import { scenarioPresentation } from "./witness-presentation";

const SCENARIOS = [
  { key: "wrong_amount_transfer", label: "Wrong transfer amount", detail: "The observed amount must match before funding or a journal is posted." },
  { key: "unknown_transfer", label: "Unknown transfer", detail: "An unrelated transfer must become an exception, not revenue." },
  { key: "duplicate_submission", label: "Duplicate contribution", detail: "Requires an accepted original. A matching copy must not create another payable." },
  { key: "agent_self_approval", label: "Agent self-approval", detail: "Requires an agent-authored proposal. The real approval policy must refuse the agent." },
  { key: "prompt_injection_narration", label: "Instructions inside narration", detail: "Untrusted narration must not grant financial authority. May also run a read-only model probe." },
  { key: "bank_mismatch", label: "Mock-bank mismatch", detail: "A conflicting bank amount must remain a discrepancy, without a journal adjustment." },
  { key: "over_cap_payout", label: "Over-cap payout", detail: "Requires a licensed accepted payable. The buyer cap must refuse excessive payment without approval or dispatch." },
  { key: "policy_auto_pay", label: "Buyer-rule approval", detail: "Requires an eligible licensed clip. Replays evidence into a labeled lab order to test the buyer rule without sending money." },
] as const;
type Scenario = typeof SCENARIOS[number];

export function ScenarioLab() {
  const orderId = useOrderId();
  const runs = useQuery(api.scenarios.listRuns, orderId ? { demoIdentity: CONTROLLER, orderId, limit: 20 } : "skip");
  const run = useAction(api.scenarios.run);
  const [selected, setSelected] = useState<Scenario | null>(null);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  async function execute() {
    if (!selected || !orderId || running) return;
    setRunning(true); setNotice(null);
    try {
      const result = await run({ demoIdentity: CONTROLLER, scenario: selected.key, orderId });
      setNotice(`${scenarioPresentation(result).label}: ${result.observedOutcome}`);
    } catch {
      setNotice("The result is unavailable. Inspect the audit log and stored run history before retrying; a timeout does not prove the action failed.");
    } finally { setRunning(false); }
  }
  if (orderId === null) return <Unavailable title="No order selected" description="Create or select an order before opening its scenario history." />;
  return <>
    <PageHeader title="Scenario lab" description="Plant a labeled exception and inspect the actual control response." actions={<Link href="/dashboard/audit" className="type-label underline underline-offset-4">Audit log</Link>} />
    <Section title="Simulated inputs, real policy checks" meta="Owning buyer or legacy controller">
      <p className="mb-4 type-body-sm text-text-2">Each run creates a separately labeled lab order and audit evidence. These probes do not send money or establish live settlement. Missing source prerequisites remain blocked; no accepted work or proposal is invented.</p>
      <div className="grid gap-3 md:grid-cols-2">
        {SCENARIOS.map(scenario => <div key={scenario.key} className="flex flex-col items-start gap-3 rounded-panel border border-line-faint p-4">
          <h3 className="type-label">{scenario.label}</h3>
          <p className="flex-1 type-body-sm text-text-2">{scenario.detail}</p>
          <Button variant="secondary" disabled={!orderId || running} onClick={() => setSelected(scenario)}>Run simulated scenario</Button>
        </div>)}
      </div>
      {notice && <p role="status" className="mt-4 type-body-sm text-text-2">{notice}</p>}
    </Section>
    <Section title="Stored outcomes" meta="Latest 20 completed runs" className="mt-6">
      {runs === undefined ? <Loading rows={4} /> : runs.length === 0 ? <p className="type-body-sm text-text-2">No completed scenario runs for this order. No result is implied.</p> : <ol className="flex flex-col divide-y divide-line-faint">
        {runs.map(result => { const presentation = scenarioPresentation(result); return <li key={result.runId} className="py-4">
          <div className="mb-2 flex flex-wrap justify-between gap-2"><h3 className="type-label">{humanize(result.scenario)} · simulated</h3><Status status={presentation.status}>{presentation.label}</Status></div>
          <p className="type-body-sm text-text-2">Expected: {result.expectedControl}</p>
          <p className="mt-1 type-body-sm text-text-2">Observed: {result.observedOutcome}</p>
          {result.agentEvidence && <p className="mt-1 type-body-sm text-text-2">Optional read-only model probe: {humanize(result.agentEvidence.status)}. Its text does not change the policy outcome.</p>}
          <details className="mt-2 type-label-sm text-text-3"><summary className="cursor-pointer">Audit evidence · {formatTime(result.createdAt)}</summary><p className="mt-2 break-all">Run: {result.runId}<br />Lab order: {result.labOrderId}<br />Evidence: {result.evidenceIds.join(", ")}</p></details>
        </li>; })}
      </ol>}
    </Section>
    <ConfirmDialog open={selected !== null} onOpenChange={open => { if (!open) setSelected(null); }} title={`Run ${selected?.label ?? "scenario"}?`} actionLabel="Run simulated scenario" onConfirm={execute}
      description="This writes a labeled lab order and audit records to the configured deployment. No chain transfer is sent. The narration scenario may call a configured model and incur usage. Inspect prior runs before repeating." />
  </>;
}
