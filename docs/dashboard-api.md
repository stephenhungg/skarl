# Controller dashboard API

Handoff for MatthewKim323. Snapshot queried with `pnpm exec convex run` on October 25, 2026 against **https://keen-marmot-986.convex.cloud**; no deployment performed. Examples below omit metadata and long evidence strings. Mutation success shapes are **source-derived, not live executions** unless stated otherwise.

## Live state and identities

- Default order: `kh7531zdrt7bn8vrs5qsw3c8bs8gy0cg` (`skarl-red-cup-demo-v2`), funded **10 USDC**, accepted `0/4`; contributor rate **1.875 USDC**.
- Funding is reconciled at [BaseScan](https://sepolia.basescan.org/tx/0x28b3f88d593c02a669cb95f4bdc6a23ab3d24bb5d1260e6c4ae54554155cd757), Transfer log `18`. One funding journal, no reconciliation exceptions.
- One stored submission, `mn7fw2rqwx4dbd2gcnfd8ekw3h8gzs3j`, is a **synthetic verification-only upload**, not a licensed contributor sample. Real inference ran; all three criteria are `unobservable`, recommendation/pipeline `needs_review`. No accept-eligible submission exists. Never turn its evaluation projection into payment authority.
- Payables, deliveries and payment approvals are empty. Four finance-agent runs exist: one completed read-only trial-balance call, two `gemini_timeout`, one `gemini_incomplete`; no money proposed. No live payout or approval-refusal example exists yet.
- Pass `demoIdentity: "controller"` for dashboard reads, acceptance and approval; `"finance-agent"` for proposal and refusal demo. These are impersonable demo selectors, not production authentication. Exceptions below: funding service uses `"buyer"`; evaluation-run lookup uses `"contributor"`.

Source: [dashboard](../convex/dashboard.ts), [finance](../convex/finance.ts), [payments](../convex/payments.ts), [agent](../convex/financeAgent.ts), [agent runs](../convex/financeAgentData.ts), [statements](../convex/statements.ts), [submissions](../convex/submissions.ts).

## Exact arguments

`Q` = query, `M` = mutation, `A` = action. Every field is required. `Id<T>` means `v.id(T)`; `string` means `v.string()`. Order-scoped queries share **`{demoIdentity: string, orderId: Id<"orders">}`**.

| Function | Kind | Exact args / identity |
| --- | --- | --- |
| `dashboard:demoContext` | Q | `{demoIdentity: string}`; controller |
| `dashboard:orderSummary` | Q | Order-scoped; controller |
| `dashboard:submissions` | Q | Order-scoped; controller |
| `dashboard:payables` | Q | Order-scoped; controller |
| `dashboard:journal` | Q | Order-scoped; controller |
| `dashboard:auditEvents` | Q | Order-scoped; controller |
| `financeAgentData:runs` | Q | Order-scoped; controller |
| `statements:forOrder` | Q | Order-scoped; controller |
| `payments:reconciliation` | Q | Order-scoped; controller |
| `submissions:getReport` | Q | `{demoIdentity: string, submissionId: Id<"submissions">}`; controller |
| `submissions:evaluationRun` | Q | `{demoIdentity: string, orderId: Id<"orders">, evalRunId: string}`; **contributor only**, controller gets `forbidden` |
| `finance:acceptAndPublish` | M | `{demoIdentity: string, submissionId: Id<"submissions">}`; controller |
| `finance:proposePayment` | M | `{demoIdentity: string, payableId: Id<"payables">}`; finance-agent |
| `finance:approve` | M | `{demoIdentity: string, intentId: Id<"paymentIntents">}`; independent controller |
| `financeAgent:run` | A | `{demoIdentity: string, orderId: Id<"orders">, requestId: string, prompt: string}`; controller or finance-agent |
| `payments:fundingStatus` | Q | `{serviceSecret: string, orderId: string, demoIdentity: string}`; buyer; ID or public order ID |
| `payments:payoutAttempt` | Q | `{serviceSecret: string, intentId: Id<"paymentIntents">, demoIdentity: string, claimId: string}`; controller or finance-agent |
| `payments:claimPayout` | M | `{serviceSecret: string, intentId: Id<"paymentIntents">, demoIdentity: string, senderAddress: string, treasuryAddress: string, claimId: string}`; controller or finance-agent |
| `payments:recordPayoutObservation` | M | `{serviceSecret: string, attemptId: Id<"paymentAttempts">, observation: Observation}`; service, **no demoIdentity** |

`Observation` is exactly `v.object({network:v.string(), tokenAddress:v.string(), txHash:v.string(), logIndex:v.number(), blockNumber:v.int64(), blockHash:v.string(), fromAddress:v.string(), toAddress:v.string(), amountAtomic:v.int64(), confirmations:v.number(), succeeded:v.boolean(), observedAt:v.number()})`.

The four service-secret functions have public Convex visibility but are **server-only integration endpoints**. Never put `serviceSecret` in React or `NEXT_PUBLIC_*`. Use the browser payout hook below. Funding UI can use `orderSummary` plus `reconciliation`, or `GET /api/orders/<orderId>/fund` with demo buyer identity. Receipt facts come from the server RPC, never browser-supplied observations.

Additional runtime constraints: `requestId` matches `[a-zA-Z0-9_-]{1,100}`, prompt is nonblank and at most 2,000 characters; replay requires the same order/prompt/requester. `evalRunId` matches `[A-Za-z0-9._:-]{1,64}`. `claimId` matches `[a-zA-Z0-9-]{16,80}` and is generated by the payout HTTP route.

**Deployment/source drift:** `submissions:evaluationRun` and the extra `getReport` fields `verificationOnly`/`evalRunId` are deployed but absent from this worktree's current `submissions.ts`. Validators were read from the main checkout's `convex/submissions.ts:245` and verified live. Coordinate the backend merge; do not deploy this older worktree to restore them. Controller dashboards should use `dashboard:submissions`/`getReport`; `evaluationRun` is a contributor evaluation-harness lookup.

## Return shapes and trimmed live examples

Documents also include `_id`, `_creationTime` and their stored metadata. Use generated API return types rather than duplicating database types. `undefined` from a React query means loading; `null`/`[]` are resolved empty states.

| Query | Return shape / live example |
| --- | --- |
| `dashboard:demoContext` | Object or `null`. Live: `{demoOnly:true,network:"eip155:84532",orderId:"kh7531zdrt7bn8vrs5qsw3c8bs8gy0cg",organizationId:"ms722m5gn6qc6b4s665thg10h58gy8a2",taskVersionId:"md78ty4bvzzkybvhxd0chfyv6h8gyqrx"}` |
| `dashboard:orderSummary` | `{order,rubric,balances,demoOnly,realFundingRequired}`. Live: `order:{status:"funded",budgetAtomic:"10000000",quantityRequested:"4",acceptedCount:"0",pricePerSampleAtomic:"2500000",contributorRateAtomic:"1875000"}`, `balances:{"asset:usdc":"10000000","liability:customer_prepayments":"10000000",…}`, `realFundingRequired:false`. Rubric has `taskPrompt`, `criteria:[{criterionId,description,modality}]`, `frozenAt`. |
| `dashboard:submissions` | Array of submission documents extended with `analysis`, `decision`, `delivery` (nullable). Live: `[{_id:"mn7fw2rqwx4dbd2gcnfd8ekw3h8gzs3j",status:"needs_review",verificationOnly:true,analysis:{implementation:"inference",pipelineStatus:"needs_review",recommendation:"needs_review",processingElapsedMs:9766,…},decision:null,delivery:null,…}]`. Analysis also contains report/observation JSON strings; use `getReport` for parsed evidence. |
| `dashboard:payables` | Live `[]`. Source-derived row: `{_id,submissionId,recipientAddress,amountAtomic,status,dispatchReady,intent,command,approval}`; last three nullable. Intent includes `_id,kind,paymentCommandId,requesterTokenIdentifier,bindingHash,sourceVersion,expiresAt,status,amountAtomic,recipientAddress,network,tokenAddress`. Command includes `_id,status,approvalId?,attemptCount`; approval includes `_id,status,approverTokenIdentifier,expiresAt`. |
| `dashboard:journal` | Array of entries with `lines`. Live: `[{kind:"funding",status:"posted",eventKey:"funding:kh7531zdrt7bn8vrs5qsw3c8bs8gy0cg",lines:[{lineNumber:0,account:"asset:usdc",side:"debit",amountAtomic:"10000000"},{lineNumber:1,account:"liability:customer_prepayments",side:"credit",amountAtomic:"10000000"}],…}]`. `sourceReference` is the network/tx/log identity. |
| `dashboard:auditEvents` | Newest first, order-linked events. Live: `[{action:"analysis_stored",actor:{kind:"service",identity:"gemini-verifier"},entityId:"mn7fw2rqwx4dbd2gcnfd8ekw3h8gzs3j",reason:"needs_review: red-cup-pickup=unobservable, coaster-placement=unobservable, narration-alignment=unobservable",evidenceReferences:["j571jkt4m2qnvw7j0nzz10rca98gzkh5"],occurredAt:1792918771043,…},…]`. Also `submission_queued`, `demo_seeded`. |
| `financeAgentData:runs` | Latest 20, newest first. Live newest: `{_id:"mx73x9mwd5qg366srgvygh5t098gy0hq",model:"gemini-3.8-flash",status:"completed",maxBatchAtomic:"10000000",proposedAtomic:"0",transcript:[{call:{id:"call_1104575",name:"getTrialBalance",arguments:{}},result:{balanced:true,totalDebitAtomic:"10000000",totalCreditAtomic:"10000000",accounts:[…]}}],explanation:"### Trial Balance Summary…",…}`. Failed rows have `failureCode`; statuses `running/completed/failed/capped`. Explanations are advisory text. |
| `statements:forOrder` | Live: `{orderId:"kh7531zdrt7bn8vrs5qsw3c8bs8gy0cg",currency:"USDC",network:"eip155:84532",tokenAddress:"0x036CbD53842c5426634e7929541eC2318f3dCF7e",cashAtomic:"10000000",deferredRevenueAtomic:"10000000",revenueAtomic:"0",contributorExpenseAtomic:"0",netIncomeAtomic:"0",payablesByContributor:[],trialBalance:{balanced:true,totalDebitAtomic:"10000000",totalCreditAtomic:"10000000",accounts:[{account:"asset:usdc",debitAtomic:"10000000",creditAtomic:"0",netDebitAtomic:"10000000"},…]}}`. Net income excludes unposted inference, fees and tax. |
| `payments:reconciliation` | `{matches,exceptions}`. Live: `{exceptions:[],matches:[{eventKey:"funding:kh7531zdrt7bn8vrs5qsw3c8bs8gy0cg",orderId:"kh7531zdrt7bn8vrs5qsw3c8bs8gy0cg",chainIdentity:"eip155:84532:0x28b3f88d593c02a669cb95f4bdc6a23ab3d24bb5d1260e6c4ae54554155cd757:18",amountAtomic:10000000n}]}`. **Current live return is bigint**, CLI encodes it as `{"$integer":"gJaYAAAAAAA="}`. Exceptions contain `code,detail,eventKey?,orderId?,chainIdentity?`. |
| `submissions:getReport` | `{status,sourceHash?,perceptualHashSource?,processingElapsedMs?,report,observations}`; last two nullable. Live also has `verificationOnly:true,evalRunId:"eval-dcf1ae08-f3c5-4afb-a196-6216414fd712"`; `report:{recommendation:"needs_review",pipeline:{implementation:"inference",status:"needs_review",modelRuns:[…],…},criteria:[{criterionId:"red-cup-pickup",status:"unobservable",reason:"The pickup is not clearly observable.",evidence:[]},…],duplicate:{status:"clear",matches:[]},warnings:["Verification-only development upload; no training license, dataset sale, or payable may be created."],…}`; `observations.audio` has `transcript,segments:[{startMs,endMs,text}],claims`; `observations.video:{visibility:"uncertain",observations:[]}`. |
| `submissions:evaluationRun` | Live with contributor identity and run ID above: `{submissions:[{_id:"mn7fw2rqwx4dbd2gcnfd8ekw3h8gzs3j",clientRequestId:"eval:dcf1ae08-f3c5-4afb-a196-6216414fd712:d8ba7ea7d0e2fd66ee8249b29e8b5e37",sourceHash:"8047a87afedc01a0a54ebcffd301d39970dfc965f657c407c6c08572f9a5a57d"}],truncated:false}`. At most 200 rows; not a report query. |
| `payments:fundingStatus` | Server-only `{order,intent,attempt}`, latter two nullable. Live: `{order:{status:"funded",budgetAtomic:10000000n,…},intent:{_id:"m57cw1hs5wpkk0xckm588n371h8gy4jf",kind:"funding",status:"confirmed",amountAtomic:10000000n,…},attempt:{_id:"kx7836711mbwf7axxwvbrddja18gyh0z",status:"confirmed",txHash:"0x28b3f88d593c02a669cb95f4bdc6a23ab3d24bb5d1260e6c4ae54554155cd757",…}}`. Raw documents contain bigint; HTTP adapter converts to decimal strings. |
| `payments:payoutAttempt` | Server-only `{intent,attempt}` raw documents, money bigint. No live payout exists; missing/non-payout intent throws `payout_not_found`; missing/wrong claim throws `claim_not_found`. |

| Write | Source-derived return; no successful live example available in this snapshot |
| --- | --- |
| `finance:acceptAndPublish` | `{ok:true,payableId,deliveryId,journalEntryId,replayed}` or `{ok:false,code,matchingSubmissionId?}`. Duplicate block code is **`duplicate_submission`**, not a generic `duplicate`. |
| `finance:proposePayment` | `{ok:true,intentId,paymentCommandId,replayed}` or `{ok:false,code}`. Derived entirely from stored payable; no UI amount/destination argument. |
| `finance:approve` | `{ok:true,approvalId,paymentCommandId,replayed}` or `{ok:false,code}`. Approval queues workflow; payable becomes `payout_in_progress`, **not paid**. |
| `financeAgent:run` | `{runId,replayed}`. This does not mean the model succeeded; read `financeAgentData:runs` for status, tools, explanation and failure code. Existing completed run above proves live read-only inference, not proposal/signing. |
| `payments:claimPayout` | `{intentId,recipientAddress,amountAtomic:string,network,tokenAddress,senderAddress,claimId,attemptId}`. Creates durable attempt, consumes pending dispatch and marks intent/command `reconciling`. Reclaiming is not a retry mechanism. |
| `payments:recordPayoutObservation` | `{observationId,replayed}`. Verified observation atomically posts journal and changes payable to `paid`; deduplicated by network/tx/log. |

Report criterion evidence uses `{modality,startMs,endMs,claim,sourceId?}`; seek the authorized player to `startMs / 1000`. Audio segments also use milliseconds. The report does not provide a public original-media URL; keep originals private. See the [canonical report schema](../packages/contracts/schemas/verification-report.schema.json).

Reproduce a read without changing deployment:

```sh
pnpm exec convex run dashboard:orderSummary '{"demoIdentity":"controller","orderId":"kh7531zdrt7bn8vrs5qsw3c8bs8gy0cg"}'
pnpm exec convex run submissions:evaluationRun '{"demoIdentity":"contributor","orderId":"kh7531zdrt7bn8vrs5qsw3c8bs8gy0cg","evalRunId":"eval-dcf1ae08-f3c5-4afb-a196-6216414fd712"}'
```

## React wiring

For a file in `apps/web/features/dashboard/` (same relative depth as `app/dashboard/`), under the existing Convex provider:

```tsx
"use client";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export function useControllerData(submissionId?: Id<"submissions">) {
  const context = useQuery(api.dashboard.demoContext, { demoIdentity: "controller" });
  const args = context ? { demoIdentity: "controller", orderId: context.orderId } : "skip";
  const summary = useQuery(api.dashboard.orderSummary, args);
  const submissions = useQuery(api.dashboard.submissions, args);
  const payables = useQuery(api.dashboard.payables, args);
  const journal = useQuery(api.dashboard.journal, args);
  const audit = useQuery(api.dashboard.auditEvents, args);
  const runs = useQuery(api.financeAgentData.runs, args);
  const statements = useQuery(api.statements.forOrder, args);
  const reconciliation = useQuery(api.payments.reconciliation, args);
  const report = useQuery(api.submissions.getReport, submissionId
    ? { demoIdentity: "controller", submissionId } : "skip");
  const accept = useMutation(api.finance.acceptAndPublish);
  const propose = useMutation(api.finance.proposePayment);
  const approve = useMutation(api.finance.approve);
  const runAgent = useAction(api.financeAgent.run);
  return { context, summary, submissions, payables, journal, audit, runs,
    statements, reconciliation, report, accept, propose, approve, runAgent };
}
// In an event handler; always check result.ok before advancing:
// const result = await accept({ demoIdentity: "controller", submissionId });
// if (!result.ok) { setError(result.code); return; }
// await propose({ demoIdentity: "finance-agent", payableId: result.payableId });
// await runAgent({ demoIdentity: "controller", orderId, requestId,
//   prompt: "Inspect this order and propose eligible payables; request independent approval." });
```

Do not invoke the agent action during render. Keep one `requestId` per deliberate user request and reuse it on uncertain retries. Query errors throw to the nearest React error boundary; show a recoverable error state. Mutation refusals return successfully with `ok:false`; a `catch` alone misses them. The proposal requester must remain finance-agent if the same controller will approve.

For the separate contributor evaluation view, until the backend merge regenerates `api.submissions.evaluationRun`:

```tsx
import { makeFunctionReference } from "convex/server";
import { useQuery } from "convex/react";
import type { Id } from "../../../../convex/_generated/dataModel";
const evaluationRun = makeFunctionReference<"query", {
  demoIdentity: string; orderId: Id<"orders">; evalRunId: string;
}, { submissions: { _id: Id<"submissions">; clientRequestId?: string; sourceHash?: string }[];
     truncated: boolean }>("submissions:evaluationRun");
export function useEvaluationRun(orderId: Id<"orders">, evalRunId: string) {
  return useQuery(evaluationRun, { demoIdentity: "contributor", orderId, evalRunId });
}
```

## Approval and browser signing

1. Controller accepts eligible, licensed evidence; finance-agent proposes the payable.
2. Controller calls `finance.approve` with the **paymentIntents document `_id`**, not the business `intentId: "payout:…"` string or command ID.
3. Wait reactively for that payable's **`dispatchReady === true`**. Workflow queuing is asynchronous after approval.
4. Pass the connected Coinbase Wallet/Smart Wallet EIP-1193 provider to `usePayout`. The wallet must be the configured treasury and on Base Sepolia. The hook switches/checks chain, claims stored terms, saves recovery and asks the wallet to sign the USDC ERC-20 transfer. No signing key enters the app/agent.
5. Render `submitted` as submitted/reconciling; only reactive payable `status === "paid"` / confirmed reconciliation means paid. A timeout or closed wallet is not proof of failure.

```tsx
"use client";
import { usePayout } from "@/lib/payments/use-payout";
import { getPayoutRecovery } from "@/lib/payments/payout";
import type { EIP1193Provider } from "viem";

export function SignPayout({ intentId, dispatchReady, provider }: {
  intentId: string; dispatchReady: boolean; provider: EIP1193Provider | null;
}) {
  const payout = usePayout({ demoIdentity: "controller", provider });
  async function sign() {
    try { await payout.execute(intentId); } catch { /* rendered below */ }
  }
  async function reconcile() {
    try {
      const saved = payout.recovery ?? getPayoutRecovery(intentId);
      if (saved?.txHash) await payout.recover({ ...saved, txHash: saved.txHash });
    } catch { /* preserve recovery; never resubmit the transfer */ }
  }
  return <>
    <button disabled={!dispatchReady || !provider || payout.busy} onClick={sign}>Sign payout</button>
    <button disabled={payout.busy} onClick={reconcile}>Reconcile saved transaction</button>
    <p>{payout.status}</p>
    {payout.error && <p role="alert">{payout.error.message}</p>}
    {payout.result && <a href={payout.result.explorerUrl}>View transaction</a>}
  </>;
}
```

Hook statuses: `idle → connecting → claiming → awaiting_signature → recording → submitted`, or `error`; returns `busy`, `result?`, `error?`, `recovery?`, `execute(intentId)`, `recover({intentId,claimId,txHash})`. Recovery is persisted under `skarl:payout:<intentId>`. If a claim exists without a hash, inspect wallet/backend before any new send; the hook deliberately refuses another claim. `recover` only reports the same transaction hash through `/api/payments/payout` and never signs again.

## Codes the UI must retain

Always display the returned code and an actionable explanation; retain unrecognized codes as well. Do not reinterpret refusal as success. Refusal audits use `acceptance_refused`, `payment_proposal_refused`, `payment_approval_refused`; `reason` is the code and evidence references identify affected records.

| Surface | Codes / response |
| --- | --- |
| Shared authorization/query errors | `unknown_demo_identity`, `inactive_demo_identity`, `inactive_organization`, `forbidden`, `conflicting_roles`, `cross_organization_reference`, `order_not_found`, `order_not_owned`, `submission_not_found`, `submission_not_owned`, `analysis_reference_mismatch`, `submission_reference_mismatch`, `payment_reference_mismatch`; finance mutations may return `not_found`. |
| Acceptance blocks | `self_review_refused`, `verification_only_not_licensed`, `verified_source_required`, `noncanonical_perceptual_hash`, `copy_check_capacity_exceeded`, **`duplicate_submission`** (+ `matchingSubmissionId` for comparison), `task_version_mismatch`, `order_not_funded_or_open`, `quota_exhausted`, `order_expired`, `invalid_order_amounts`, `submission_not_reviewable`, `analysis_source_mismatch`, `acceptance_evidence_required`, `licensed_media_required`, `verified_contributor_wallet_required`. Do not offer accept for scaffold, incomplete, unavailable or verification-only analysis. |
| Proposal/approval | `payable_changed`, `payable_not_open`, `existing_payment_command_requires_reconciliation`, `not_a_payout_intent`, **`self_approval_refused`**, **`agent_approval_refused`**, **`proposal_binding_changed`**, `proposal_expired`, `approval_invalidated`, `payment_not_approvable`. A finance-agent approving its own proposal returns `self_approval_refused` first; agent approval of someone else's proposal returns `agent_approval_refused`. Read audit after refusal. Do not silently rebuild expired/bound proposals. |
| Agent | Action validation: `invalid_agent_request`, `agent_request_conflict`, `invalid_agent_model`. Persisted failures include observed `gemini_timeout`, `gemini_incomplete`, plus `agent_deadline`, `agent_response_invalid`, `agent_run_failed`, `agent_interrupted` and provider codes. Show `status`, `failureCode`, completed tools and explanation separately. |
| Evaluation | `invalid_eval_run_id`, `evaluation_scope_contaminated`; wrong role `forbidden`. |
| Payment claim | `payment_service_unauthorized`, `payout_not_found`, `payout_not_executable`, `approved_source_changed`, `approval_invalidated`, **`dispatch_not_ready`** (wait for workflow), `wrong_treasury_wallet`, `invalid_claim_id`, `claim_not_found`. |
| Receipt/reconciliation | `payout_attempt_not_found`, `payout_not_dispatched`, `transfer_predates_approval_claim`, `transaction_already_bound`, `transfer_already_claimed_or_changed`, `attempt_already_confirmed`; evidence validation `wrong_network`, `wrong_token`, `invalid_transfer_identity`, `invalid_block_identity`, `receipt_failed`, `insufficient_confirmations`, `wrong_sender`, `wrong_recipient`, `wrong_amount`, `invalid_observation_time`, `invalid_hash`. No error authorizes a replacement send. |
| Reconciliation exception cards | `wrong_amount`, `unknown_transfer`, `missing_transfer`, `late_settlement`, `ledger_mismatch`, `invalid_transfer`, `duplicate_transfer`, `duplicate_obligation`. Query covers imported observations, not every treasury transfer. |
| Statement integrity | `statement_entry_binding_mismatch`, `statement_line_binding_mismatch`, `payables_contributor_required` and ledger invariant errors: show unavailable/error, never a fabricated zero balance. |
| Browser HTTP | `treasury_not_configured`, `payment_service_not_configured` (503), `cross_origin_refused`, `intent_and_identity_required`, `sender_required`, `claim_and_hash_required`; other backend errors can be sanitized to `payment_request_refused` (409). Hook errors may wrap a cause and recovery object; keep the recovery. Receipt still pending returns HTTP 202 `{status:"reconciling",txHash,message}`, not failed. |

The local payment HTTP adapter preserves `dispatch_not_ready`, `approved_source_changed` and `approval_invalidated` as safe error codes. This web-server fix must ship with the dashboard; an older deployment may still collapse them to `payment_request_refused`. No Convex deployment is required for that adapter change.

## Re-running the live demo

Run `pnpm demo:e2e` from the repo root. It discovers the staged default order, reuses an accepted eligible path when available, accepts eligible licensed evidence, proposes via deterministic `finance:proposePayment` as `finance-agent`, proves an agent approval refusal with its durable audit, approves as controller, then prints the exact intent once workflow dispatch is ready. This is **not a Gemini finance-agent inference run** and does not claim/sign/send a payout. Acceptance, proposal and approval replay stored business identities; an existing execution attempt stops for reconciliation.

Exit `0`: ready for wallet signing or already paid. Exit `2`: expected blocked/refused step (including missing seed or eligible evidence). Exit `1`: transport/unexpected error. Current live stop is before `acceptAndPublish`: the only submission is verification-only with `needs_review` evidence. The script does not fabricate media, reports or acceptability.

## Exact micro-USDC formatting

Most dashboard amounts are decimal integer strings; current reconciliation and server-only raw documents use bigint. Convert with `BigInt`, never `Number`, `parseFloat` or floating division. Preserve all six decimals so 1.875 USDC stays exact. JSON boundaries must serialize bigint to decimal integer strings.

```ts
import { USDC_DECIMALS } from "@skarl/contracts/chain";
export function formatUsdc(value: string | bigint) {
  const amount = BigInt(value), absolute = amount < 0n ? -amount : amount;
  const scale = 10n ** BigInt(USDC_DECIMALS);
  return `${amount < 0n ? "-" : ""}${absolute / scale}.${
    (absolute % scale).toString().padStart(USDC_DECIMALS, "0")
  } USDC`;
}
// formatUsdc("1875000") === "1.875000 USDC"
// formatUsdc("-10000000") === "-10.000000 USDC"
```

Use `PAYMENT_NETWORK`, `PAYMENT_CHAIN_ID`, `USDC_ADDRESS`, `USDC_DECIMALS` from `@skarl/contracts/chain` for implementation. ETH gas remains a separate asset and never enters USDC totals.
