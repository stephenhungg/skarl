# Controller dashboard API

> **Sponsor surfaces:** what the dashboard must show for each sponsor track is in [dashboard-sponsor-surfaces.md](dashboard-sponsor-surfaces.md).

> **Design alignment (read first).** The dashboard must look like the landing page and the iOS app: one product.
> Use only the tokens in `apps/web/app/globals.css` (`paper` background, `ink` text, sage neutrals `mist/haze/fog/slate-*`, `deep`, and the lime `accent` reserved for primary actions and live/selected states), the Montreal cuts (`.cut-book/.cut-regular/.cut-medium`) for UI and `.mono` (Fono) for amounts, hashes, timestamps and tx links, and the `--ease-settle` curve for motion.
> Reuse `components/logo-mark`, `wordmark`, `status-pill`, `evidence-timeline`, `stepper`, `button`, `ui/payment-status`, `ui/activity-feed`, `ui/payment-receipt-printer` instead of new primitives. Keep the testnet disclosure visible, label demo identities and simulated data, and show a chain badge (Base Sepolia / Solana Devnet) plus an explorer link on every on-chain item.


Handoff for MatthewKim323. Snapshot queried with `pnpm exec convex run` on October 25, 2026 against **https://keen-marmot-986.convex.cloud**; no deployment performed. Examples below omit metadata and long evidence strings. Mutation success shapes are **source-derived, not live executions** unless stated otherwise.

## Live state and identities

- Default order: `kh7531zdrt7bn8vrs5qsw3c8bs8gy0cg` (`skarl-red-cup-demo-v2`), funded **10 USDC**, accepted `0/4`; contributor rate **1.875 USDC**.
- Funding is reconciled at [BaseScan](https://sepolia.basescan.org/tx/0x28b3f88d593c02a669cb95f4bdc6a23ab3d24bb5d1260e6c4ae54554155cd757), Transfer log `18`. One funding journal, no reconciliation exceptions.
- One stored submission, `mn7fw2rqwx4dbd2gcnfd8ekw3h8gzs3j`, is a **synthetic verification-only upload**, not a licensed contributor sample. Real inference ran; all three criteria are `unobservable`, recommendation/pipeline `needs_review`. No accept-eligible submission exists. Never turn its evaluation projection into payment authority.
- Payables, deliveries and payment approvals are empty. Four finance-agent runs exist: one completed read-only trial-balance call, two `gemini_timeout`, one `gemini_incomplete`; no money proposed. No live payout or approval-refusal example exists yet.
- Pass `demoIdentity: "controller"` for dashboard reads, acceptance and approval; `"finance-agent"` for proposal and refusal demo. For unsigned calls with demo mode enabled, these remain impersonable demo selectors. Signed-in calls use their own membership and ignore this argument; see [authentication](#authentication). Exceptions below: funding service uses `"buyer"`; evaluation-run lookup uses `"contributor"`.

Source: [dashboard](../convex/dashboard.ts), [finance](../convex/finance.ts), [payments](../convex/payments.ts), [agent](../convex/financeAgent.ts), [agent runs](../convex/financeAgentData.ts), [statements](../convex/statements.ts), [submissions](../convex/submissions.ts).

## Authentication

**Source implementation; operator configuration and deployment required.** See
[authentication setup](auth.md) for keys, environment variables and GitHub OAuth.
The existing `demoIdentity` arguments below stay required for compatibility.
When a Convex caller is signed in, the shared role check resolves only that
user's `auth:<userId>` membership and ignores `demoIdentity`; passing a controller
selector cannot elevate a signed-in contributor. Action calls preserve this
identity through `ctx.runQuery` and `ctx.runMutation`.

`auth/memberships:me({})` returns `userId`, `email`, `roles`, `demoMode`,
`githubEnabled` and `canClaimController`. Signed-in users can call
`auth/memberships:claimRole({role})` to claim buyer/contributor in the demo
organization. A controller claim requires a verified email on the
`SKARL_CONTROLLER_EMAILS` allowlist. Humans cannot claim finance-agent, and a
contributor cannot also become controller. Role checks still enforce independent
review and refuse self-approval.

Unsigned callers retain labeled demo identities by default. Setting
`SKARL_DEMO_IDENTITIES=off` rejects anonymous role-gated calls, including existing
unsigned scripts/mobile/MCP demo calls. With demo mode on, `/dashboard` visibly
labels anonymous access “Demo identity”. Signed-in users without controller
membership see “controller access required”. Real sign-in does not remove the
impersonable anonymous demo path while demo mode remains enabled.

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

## Scenario lab — judge injections

**Source handoff; deployment required.** Both endpoints require the persisted
controller role and the selected order's organization. The existing
`demoIdentity` selector remains impersonable for unsigned callers while demo
mode is enabled; signed-in callers use their own membership. Buyer, contributor
and finance-agent principals cannot run scenarios or read the controller's lab
history. Scenario artifacts are **SIMULATED CONTROL TEST — NO TRANSFER**; never
render their synthetic chain hashes as evidence of a real transfer.

| Function | Kind | Arguments and result |
| --- | --- | --- |
| `scenarios:run` | A | `{demoIdentity:"controller",scenario:ScenarioName,orderId?:Id<"orders">}` → one recorded `ScenarioRun` below. Call only from an explicit controller action. |
| `scenarios:listRuns` | Q | `{demoIdentity:"controller",orderId?:Id<"orders">,limit?:number}` → newest-first `ScenarioRun[]`. `orderId` filters by source order. |

```ts
type ScenarioName =
  | "wrong_amount_transfer"
  | "unknown_transfer"
  | "duplicate_submission"
  | "agent_self_approval"
  | "prompt_injection_narration"
  | "bank_mismatch";

type ScenarioRun = {
  scenario: ScenarioName;
  scenarioId: string;
  runId: Id<"auditEvents">;
  orderId: Id<"orders">;       // Selected source order
  labOrderId: Id<"orders">;    // Isolated, labeled simulated artifacts
  simulated: true;
  expectedControl: string;
  observedOutcome: string;
  evidenceIds: string[];
  passed: boolean;
  createdAt: number;           // Unix milliseconds
  agentEvidence?: {
    status: string;
    chatId?: string;
    answer?: string;
  };
};
```

Use the generated API's actual return types when integrating. `passed` is
computed from the real control's stored outcome and the protected state read
back from Convex, rather than from the requested scenario name. A missing
accepted original for the duplicate scenario is a failed prerequisite; do not
display it as a caught duplicate. Self-approval requires an existing
finance-agent-authored payout proposal; the lab never fabricates an obligation
or creates a real payout proposal.
The lab does not grant a synthetic submission
license, create an unlicensed payable, approve an intent, sign, or send funds.
History defaults to 20 rows; `limit` must be an integer from 1 through 100.
Omitting `orderId` from `run` selects `skarl-red-cup-demo-v2`; omitting it from
`listRuns` returns controller-visible runs across the organization.

```tsx
const runs = useQuery(api.scenarios.listRuns, {
  demoIdentity: "controller", orderId, limit: 20,
});
const runScenario = useAction(api.scenarios.run);
// In an explicit controller click handler:
await runScenario({ demoIdentity: "controller", orderId,
  scenario: "wrong_amount_transfer" });
```

Render the simulation label, scenario name, `expectedControl`,
`observedOutcome`, pass/fail, timestamp and evidence links. `undefined` means
loading; `[]` means no runs. Keep failed or prerequisite-blocked runs visible.
Link to the returned lab order for its actual reconciliation/submission
records; the source order remains the navigation context for run history.
Self-approval exercises the existing source-order intent, so its refusal audit
links to that intent rather than moving the obligation into the lab order.
The run history is stored in existing audit events, requiring no new schema
table. Input labels and event descriptions identify the scenario; synthetic
evidence must retain that context wherever displayed. The bank scenario uses a
lab-order snapshot rather than replacing the organization's bank snapshot. Its
fourth column retains **simulated bank (Capital One Nessie mock)**.

For narration injection, `agentEvidence` separately describes an optional
read-only `agentChat.askAgent` call when `GEMINI_API_KEY` is configured.
Display its status and answer as advisory evidence; deterministic detector and
stored-report checks determine `passed`. A missing key records a `not_run`
status, and an optional-agent failure does not invent a successful response.
Input failures produce a durable `scenario_input_error` audit and a failed
assessment; retain the failed result for the judge to inspect.

See [judge commands and expected evidence](demo-script.md#if-a-judge-injects-a-scenario).
This handoff documents the backend contract; no dashboard panel or deployed
scenario success is claimed here.

## Per-take spoken liveness (source handoff; deployment required)

`liveness:issueChallenge` is a contributor mutation with
`{demoIdentity: "contributor"}`. It returns
`{challengeId: Id<"livenessChallenges">, words: string[], expiresAt: number}`:
three distinct common words and an expiry exactly two minutes after issuance.
The mobile camera requests a fresh challenge per take and asks the contributor
to say the words in order while recording. These are public challenge words,
not authentication credentials; [authentication rules](#authentication) still apply.

`submissions:create` adds optional
`livenessChallengeId: Id<"livenessChallenges">`. The same transaction binds the
server-issued words and consumes the challenge. Refusals are
`liveness_challenge_not_found`, `liveness_challenge_foreign`,
`liveness_challenge_used`, and `liveness_challenge_expired` (including the exact
expiry boundary). Expiry is checked when creating the submission, so capture
and upload must finish within two minutes. A successful request can be retried
with the exact same arguments after expiry; changing or removing its challenge
ID returns `submission_request_conflict`. A refused fresh create needs a new
take, not new words attached to old footage.

`dashboard:submissions` exposes optional `livenessChallengeId` and
`liveness: {words: string[], issuedAt: number, consumedAt: number}` on each row.
`submissions:getReport` also exposes that optional `liveness` object. All times
are Unix milliseconds. Missing means no challenge was supplied; it does not
mean passed. Old documents, clients and sensor-trace schemas remain valid.

The deterministic comparator checks whole transcript words in chronological
order, ignoring case and punctuation. A match adds audio evidence under the
existing `narration-alignment` criterion, with a claim beginning
`Spoken liveness matched` and containing transcript-segment `startMs`/`endMs`.
Use those milliseconds for the evidence player's seek link; they are segment
bounds, not invented word timings. No new criterion ID or report schema field
is introduced. Failure, missing challenge/transcript, or instruction-like
narration adds a `Spoken liveness:` warning and forces `needs_review`, including
otherwise contradictory work. It never causes automatic rejection or acceptance.
Already-stored historical reports keep their original validation contract.

This is evidence of speaking fresh words, not a guarantee against real-time
synthesis, edited audio or screen recapture. Human review remains the decision
boundary. Local tests use synthetic transcripts and uploads; a Convex deployment
and physical-phone capture/transcription smoke test are still required.

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
| `payments:fundingStatus` | Server-only `{order,intent,attempt,network,explorerUrl}`; intent, attempt and explorerUrl are nullable. Live: `{order:{status:"funded",budgetAtomic:10000000n,…},intent:{_id:"m57cw1hs5wpkk0xckm588n371h8gy4jf",kind:"funding",status:"confirmed",amountAtomic:10000000n,…},attempt:{_id:"kx7836711mbwf7axxwvbrddja18gyh0z",status:"confirmed",txHash:"0x28b3f88d593c02a669cb95f4bdc6a23ab3d24bb5d1260e6c4ae54554155cd757",…}}`. Raw documents contain bigint; HTTP adapter converts to decimal strings. |
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

## Witness receipt

**Source implementation; Convex deployment required.**
`witnessReceipt.forSubmission({demoIdentity, submissionId})` is one read-only
projection of the stored witnesses behind a submission. It neither runs new
inference nor creates an attestation, decision, proposal, journal or payment.
Controllers in the organization, the order's buyer and the owning contributor
can read it. A finance-agent identity cannot read this endpoint. The
[authentication rules](#authentication) apply; unsigned demo selectors remain
impersonable while demo mode is enabled.

For Matthew's dashboard, subscribe with
`useQuery(api.witnessReceipt.forSubmission, {demoIdentity: "controller", submissionId})`.
`undefined` means loading. The HTTP equivalent is
`GET /api/samples/<submissionId>/witnesses` with the explicit header
`x-skarl-demo-identity: controller` (or `buyer` / `contributor`). The route also
accepts `sample-<submissionId>`, matching the other sample routes. Responses use
`Cache-Control: private, no-store`; any bigint values become decimal integer
strings. This read does not require the payment service secret or an x402 charge.

```sh
curl -H 'x-skarl-demo-identity: controller' \
  https://skarl.vercel.app/api/samples/mn7fw2rqwx4dbd2gcnfd8ekw3h8gzs3j/witnesses
```

Source-derived example shape below, with the witness list trimmed for readability;
this is an illustration, not a live response or a claim about that stored sample:

```json
{
  "submissionId": "mn7fw2rqwx4dbd2gcnfd8ekw3h8gzs3j",
  "verdict": "needs_review",
  "recommendation": "request_correction",
  "witnesses": [
    {
      "key": "vision_jury",
      "label": "Vision jury agreement (advisory)",
      "kind": "work",
      "status": "disagree",
      "detail": "2 model reports; agreement fraction: 0; disputed criteria: pickup. Unavailable reports are not agreement.",
      "evidenceUrl": null,
      "live": false
    },
    {
      "key": "eas_attestation",
      "label": "EAS attestation (Base Sepolia testnet)",
      "kind": "work",
      "status": "missing",
      "detail": "No confirmed EAS attestation for the current analysis.",
      "evidenceUrl": null,
      "live": false
    },
    {
      "key": "deterministic_judge",
      "label": "Deterministic judge recommendation",
      "kind": "judgment",
      "status": "disagree",
      "detail": "Stored recommendation: request_correction; implementation: inference; pipeline: completed. Advisory; does not authorize payment.",
      "evidenceUrl": null,
      "live": false
    },
    {
      "key": "bank_witness",
      "label": "simulated bank (Capital One Nessie mock)",
      "kind": "money",
      "status": "missing",
      "detail": "No related payout intent to compare with simulated bank activity.",
      "evidenceUrl": null,
      "live": false
    }
  ]
}
```

`verdict` is the submission's persisted status; `recommendation` is its current
analysis recommendation or `null` when no analysis exists. Incomplete/unavailable
analysis cannot project an `accept` recommendation. Each witness has exactly
`key`, `label`, `kind`, `status`, `detail`, `evidenceUrl` and `live`. Kinds are
`work`, `judgment`, `money`; statuses are `agree`, `disagree`, `missing`, `pending`,
`not_applicable`. A missing result is not agreement, and pending payment evidence
is not a paid claim. These rows do not grant acceptance or payment authority.

`agree` is specific to each witness's claim: audio means a stored transcription
exists, a human decision means the controller recorded acceptance, and a bank
row means simulated activity matches the payout bindings. Those are different
claims; they do not all corroborate the filmed action. Keep the detail visible
so a checked row cannot imply more than its source establishes.

Render a checklist grouped by `kind`, keyed by `key`, preserving each row's label,
status and plain-text detail. Check only `agree` rows; use distinct visible states
for disagreement, missing, pending and not applicable. Do not collapse the
witnesses into a single green fraud score. The list includes:

- Work: each vision model and jury agreement, audio transcript, optional IMU
  summary, duplicate/copy score, prompt-injection scan, current EAS attestation
  and optional spoken liveness. A persisted instruction-like-content warning
  appears as a disagreeing heuristic scan witness. An absent explicit scan or
  liveness result stays missing; absence of a warning is not a clean scan.
  When a stored per-take liveness challenge exists, the shared deterministic
  comparator checks it against the stored timestamped transcript. Matching words
  show agreement with segment bounds; missing transcript stays missing, and
  invalid challenges, mismatched words or instruction-like narration disagree.
  This performs no new inference and does not establish speaker identity.
- Judgment: deterministic recommendation, human controller decision, and related
  finance-agent proposals/refusals. A proposal is not approval or payment.
- Money: payable, related ledger journals, observed payout transfers and the
  **simulated bank (Capital One Nessie mock)** witness.

When `evidenceUrl` is non-null, render an “Evidence” link beside that witness.
Confirmed EAS rows link to
`https://base-sepolia.easscan.org/attestation/view/<uid>`; payout observations link
to `https://sepolia.basescan.org/tx/<txHash>`. Preserve the Base Sepolia testnet
label. Null links mean there is no public evidence URL; do not generate media
URLs or attach private original recordings to this receipt.

`live` is conservative provenance metadata, not a success indicator. The current
stored records do not establish live provenance, so this projection returns
`false`, including for testnet and simulated bank sources. A stored agreement or
explorer link alone must not create a “live” badge. Hosted Nessie calls are still
simulated bank evidence.

HTTP errors are fixed public codes: missing identity or malformed ID → `400`,
role/ownership denial → `403`, missing submission/order → `404`, unavailable or
undeployed backend → `503`. Wrapped backend errors are not exposed.

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

## Extended API

The functions below are implemented in source and validated with isolated
`convex-test` fixtures and anonymous local Convex validation. They have not been
deployed or exercised against live Gemini/chain state by this API extension.
Use the generated API types. All money and quantity values returned by these
new endpoints are exact decimal integer strings; times and durations use
milliseconds. The [authentication rules](#authentication) apply; unsigned demo
selectors remain impersonable while demo mode is enabled.

### Human review

`review.reviewSubmission` is a mutation taking
`{demoIdentity, submissionId, decision, reasonCode, note}`. `decision` is
`accept | reject | request_correction`; `reasonCode` is a lowercase identifier
matching `[a-z][a-z0-9_]{0,79}`, and `note` is nonblank, at most 4,000 characters.
Only an independent human controller may review. The contributor, finance
agent, conflicting memberships and other tenants are refused.

A decision binds the current source, rubric and analysis evidence and is stored
with an audit event. `accept` calls the same transactional acceptance helper as
`finance.acceptAndPublish`: verified media, consent, wallet, funding, quota,
deadline and duplicate checks all remain in force. A human may explicitly
review unavailable/incomplete analysis; that does not make the model's output
an acceptance recommendation. Verification-only uploads remain ineligible.

Returns `{ok:true,decisionId,replayed}` for rejection/correction. Successful
acceptance also returns `payableId`, `deliveryId`, and `journalEntryId`.
Failures return `{ok:false,code,decisionId?,matchingSubmissionId?}`; a stored
human acceptance may coexist with a financial refusal and must not be rendered
as delivered. Exact retries reuse the decision. Retrying a superseded decision
returns `review_superseded`. Rejection sets `rejected`; correction sets
`needs_correction` and creates no payable.

### Buyer orders and cancellation proposals

| Function | Kind | Arguments and behavior |
| --- | --- | --- |
| `orders.createOrder` | M | Buyer only. `{demoIdentity,requestId,title,buyerWalletAddress,quantityRequested,pricePerSampleAtomic,contributorRateAtomic,deadlineAt,taskPrompt,criteria}`. Counts/prices are canonical decimal strings. `criteria` is 1–50 `{criterionId,description,modality}` rows; modalities are `visual`, `audio`, `cross_modal`, `temporal`. |
| `orders.listOrders` | Q | `{demoIdentity,paginationOpts:{numItems,cursor}}`; use `cursor:null` first. Buyer sees owned orders; controller/finance-agent see their organization. At most 100 rows per page. Returns native `{page,isDone,continueCursor}` plus Convex pagination metadata. |
| `orders.cancelRemainder` | M | Buyer owner only. `{demoIdentity,orderId,reason}`; reason is nonblank, at most 2,000 characters. Atomically stops collection, reserves the unused funded quota and creates an approval-required refund proposal. |

`createOrder` freezes rubric version 1 and computes
`budgetAtomic = quantityRequested × pricePerSampleAtomic` using bigint. The
contributor rate must be positive and no greater than the sample price; the
budget must fit Int64. It returns
`{orderId,taskVersionId,publicId,status:"awaiting_funding",budgetAtomic,replayed}`.
Use one stable `requestId` per order; changed terms on retry produce
`order_request_conflict`. A replay returns the order's current status. The
wallet address is a quote field, not a claim of wallet ownership verification;
confirmed funding establishes the actual payer under the existing payment path.

`cancelRemainder` requires a reconciled, confirmed funding intent and an exact
match between unused quota value and the order's prepayment ledger balance.
It derives the recipient from the confirmed payer; no amount or destination
argument is accepted. It posts the existing refund-reservation journal, leaves
cash unchanged, and moves the order to `cancelling`. Acceptance and cancellation
conflict on the order record so they cannot consume the same unit.

Returns `{ok:true,paymentCommandId,fundingIntentId,journalEntryId,amountAtomic,
controllerApprovalRequired:true,executionAvailable:false,replayed}`. This is
**proposal-only**: it creates the existing `paymentCommands.kind="buyer_refund"`
and links it through the original confirmed funding intent's optional
`refundPaymentCommandId`. It does not create a new executable refund intent,
controller approval, dispatch, signature or transfer. Continue with the refund-specific approval/execution flow below. Never pass the funding ID to a payout signing hook or display `refunded` before observation. Retry with the same reason; changed proposal bindings produce `refund_proposal_changed`.

### Execute an approved buyer refund

Base-funded orders only; Solana funding does not yet support cancellation/refund.
The original funding intent stays `confirmed`; refunds use its linked standalone
`paymentCommands.kind="buyer_refund"` command. No new funding intent is created.

1. Owning buyer calls `orders.cancelRemainder` and retains `paymentCommandId`.
2. Query `refunds.forOrder({demoIdentity,orderId})` as controller or owning buyer.
   It returns `{commandId,orderId,status,recipientAddress,amountAtomic,network,
   tokenAddress,controllerApprovalRequired,executionAvailable,approval,claimId,
   txHash,explorerUrl}`. `amountAtomic` is an integer string. Approval includes
   status, approver identity, expiry and reason. Proposed refunds are not executable.
3. Independent controller calls `refunds.approve({demoIdentity,commandId,reason})`.
   Buyer self-approval and finance-agent approval return audited refusals. Current
   controller membership, expiry, source and exact amount/recipient bindings are
   revalidated before execution. `forOrder.executionAvailable` becomes true only
   for a valid approved, unclaimed command.
4. Browser imports `executeApprovedRefund` from `apps/web/lib/payments/refund.ts`
   and calls `{commandId,demoIdentity,provider,onProgress?}`. It reuses the existing
   treasury-wallet USDC transfer client with the allowlisted refund endpoint.
   The server derives recipient/amount from the approved command. It creates
   one execution attempt before any signature; the controller signs in the wallet.
5. `POST /api/payments/refund` records the submitted hash before receipt observation.
   Pending RPC returns HTTP 202/reconciling, never paid. Recover with
   `getRefundRecovery(commandId)` and `reportRefundTransaction({commandId,claimId,
   txHash,demoIdentity})`; report the same hash without signing/sending again.
   The observer-only two-minute sweeper also resumes these command-bound attempts
   under its existing caps/leases.

The endpoint internally uses the existing browser client's opaque `intentId`
field to carry this **command ID**. It ignores caller-supplied amount/recipient.
Only an observed exact canonical Base USDC transfer with two confirmations posts
one `refund_paid` journal and changes the order to `refunded`. The journal debits
customer-refund liability and credits cash; reservation itself does not move cash.
`payments.reconciliation` includes this refund obligation, journal and chain log.
No live refund or wallet signature is claimed by the implementation tests.

### Reconciliation exceptions

`exceptions.list({demoIdentity,orderId})` is a controller/finance-agent query.
It reuses `payments.reconciliation` and returns
`[{exceptionKey,exception,stillDetected,disposition}]`. `exception` retains the
existing `code`, `detail` and optional event/order/chain identities;
`disposition` is null or the durable handling record.

Controller-only mutations `exceptions.acknowledge` and `exceptions.resolve`
take `{demoIdentity,orderId,exceptionKey,reason}` and return
`{dispositionId,replayed}`. Obtain the key from `list`; a caller cannot invent an
exception. Reasons must be nonblank and at most 2,000 characters. Exact retries
are idempotent; changed terminal reasons conflict. Each transition is audited.
Resolution is a manual handling status: a discrepancy that still exists remains
visible with `stillDetected:true`. These functions never change ledger, intent,
attempt or chain-observation history. Reconciliation covers imported observations,
not a scan of every treasury transfer.

### Media and duplicate evidence

| Query | Arguments | Return |
| --- | --- | --- |
| `media.submissionEvidence` | `{demoIdentity,submissionId}` | `{submissionId,analysisId,clip,frames,dHashFrames,dHashFrameIndices,framesAvailable,transcriptSegments,perceptualHashSource}`. Clip includes asset ID, MIME type, status, duration and URL. Visual `frames` (12) and `dHashFrames` (6) include asset ID, `timestampMs`, MIME type, URL, `kind`, `sampleIndex` and nullable `decodedFrameIndex`. `dHashFrameIndices` contains the six indices in the decoded 6-fps silent video. Segments contain `{startMs,endMs,text}`. |
| `media.duplicatePair` | `{demoIdentity,submissionId,matchingSubmissionId}` | `{left,right,matchedFrames,score,exactSourceMatch,perceptualMatch,heuristicOnly:true}`. Each match includes `sampleIndex`, both hash timestamps, Hamming `distance`, and nullable `leftFrame`/`rightFrame` assets for the exact underlying fingerprint frames. |

Controller access is organization-scoped; contributors can access only their
own submissions. Both sides of a duplicate pair are authorized independently,
so owning one clip does not reveal another contributor's clip. Buyer and
finance-agent identities cannot obtain these original-media URLs.

These are native Convex **bearer storage URLs issued after role checks**, not a
custom expiring signed-URL service. Do not publish or cache them. A deleted or
quarantined clip is unavailable. Extracted frames are returned only when verified,
linked to the current analysis and its job, and persisted with timestamps.
New verifier runs persist twelve chronological visual JPEGs and six additional JPEGs of the exact decoded frames used for dHash, linked atomically to the analysis. The six fingerprint images preserve the existing hash algorithm; their sample timestamps and decoded frame indices are explicit. Older analyses are not backfilled: empty arrays/null matched frames remain honest unavailable states. The original clip can still be sought to the hash/transcript timestamps.
Perceptual matching is a bounded heuristic, not proof of robust copy detection.

### Ask the finance agent

`agentChat.askAgent({demoIdentity,question,orderId?,requestId?})` is an action for
controller/finance-agent identities. `question` is nonblank and at most 2,000
characters. Omitted `orderId` discovers the default demo order. Supply a stable
`requestId` (`[a-zA-Z0-9_-]{1,100}`) for uncertain retries; omission starts a new
request. Returns `{chatId,replayed}`, not a guarantee that inference completed.

Read `agentChatData.history({demoIdentity,orderId})` for the latest 50 persisted
questions, answers, status, transcript, verified `citedRecordIds` and failure
code. Chat reuses the bounded Gemini finance loop with only four read tools:
`listOutstandingPayables`, `explainPayable`, `getTrialBalance`, and
`listReconciliationExceptions`. Both the advertised tool set and dispatcher
exclude proposals, approval requests, approvals and execution. Even a forced
valid payment-tool call is refused as `read_only_chat`. Citations include only
retrieved record IDs actually mentioned by the answer. Answers remain advisory;
provider failures and interrupted runs are persisted without inventing results.

### Analytics and paginated lists

All functions in this table require controller/finance-agent membership and
accept `{demoIdentity,orderId?}`. Omitting the order scopes to the organization.

| Query | Additional arguments | Result |
| --- | --- | --- |
| `analytics.overview` | None | `orderCount`, `submitted`, `accepted`, `delivered`, `funded`, `fundedAtomic`, `duplicatesBlocked`, `refusals`, acceptance-rate numerator/denominator/`basisPoints`, verification latency, payout cycle time, cash and liability totals. |
| `analytics.timeSeries` | `{from,to}` | `{bucketMs:300000,from,to,buckets}` with submitted/accepted/delivered/duplicate/refusal counts, funded/paid amounts and cash delta. Half-open `[from,to)`, at most seven days; empty five-minute buckets retained. |
| `activity.contributors` | `{cursor?,limit?}` | Contributor identity/status, submitted/accepted counts, `earningsAccruedAtomic`, `earningsPaidAtomic`, `outstandingAtomic`. Earnings come from journals. |
| `activity.payoutHistory` | `{cursor?,limit?}` | Contributor payout proposals and their statuses, exact amounts, attempts and observed tx/log details. Pending/proposed rows are not labeled paid. |
| `activity.feed` | `{cursor?,limit?}` | Unified audit, chain-observation and finance-agent-run events, each with source, record ID, action, summary, timestamp and evidence references. |

Lists return `{page,isDone,continueCursor}` with default `limit:50`, maximum 100.
Pass the opaque cursor back to the same endpoint/order scope. Keyset pagination
uses timestamp plus ID and does not shift offsets when new rows arrive. Reads
currently aggregate the bounded demo dataset before pagination; production-scale
indexed aggregation is not implemented.

`overview` financial fields are `cashAtomic`, `obligationsAtomic`,
`cashLessObligationsAtomic`, `customerPrepaymentsAtomic`,
`contributorPayablesAtomic`, and `customerRefundsAtomic`. They derive from posted,
balanced journals, never from an unfunded order budget. Corrupt/unbalanced
journals return an error instead of zero. Verification p50/p95 sums recorded
`pipeline.modelRuns[].elapsedMs` per analysis; payout cycle p50/p95 measures
payable accrual to the posted confirmed payout. Both return `{sampleCount,p50,p95,
source}`, with null percentiles when observations are missing. These are observed
demo timings, not benchmark claims.

Validation note: `CONVEX_AGENT_MODE=anonymous` does not override an already
configured cloud deployment. Local validation used a separate checkout with no
cloud `.env.local` or deployment variables; it selected `127.0.0.1:3210`.
No cloud function deployment was performed by this extension.

## CDP webhooks + SQL witness

Implemented in source with **simulated local tests**; cloud deployment, webhook
subscription creation and live SQL evidence require the deployment operator.
These endpoints add independent evidence without changing payment authority.

| Function | Kind | Arguments | Result |
| --- | --- | --- | --- |
| `chainWitness.reconciliationWithWitness` | Q | `{demoIdentity,orderId}` | Existing `payments.reconciliation` fields, plus `matches[].witness`, `witnesses[]`, and top-level `witness`. |
| `chainWitness.refresh` | A | `{demoIdentity,orderId}` | `{status:"available" \| "witness_unavailable" \| "cached_or_rate_limited"}`. Refreshes the stored SQL snapshot; never pays or posts journals. |
| `chainWitness.webhookExceptions` | Q | `{demoIdentity,orderId}` | Treasury-wide `unknown_transfer` exceptions, also included in `exceptions.list` and the witness reconciliation query. |

All three require controller or finance-agent membership and enforce organization
scope. The underlying `payments.reconciliation` remains available unchanged.
Use `useQuery` for the witness query and call the refresh action on opening the
reconciliation view or clicking refresh. Do not call the action every render.
The deployment operator must regenerate Convex API types from merged main; until
then a typed `makeFunctionReference("chainWitness:reconciliationWithWitness")`
can reference the new endpoint without editing generated files from a stale tree.

Each `matches[].witness` and `witnesses[]` row has `chainIdentity` and a status:

- `match`: CDP and the stored RPC observation agree on transaction/log, token,
  sender, recipient, exact amount, block number and block hash.
- `missing`: a successful, bounded SQL query returned no corresponding log.
  This may be indexing lag; it is not proof that settlement failed.
- `mismatch`: the same transaction/log exists but evidence differs.
- `witness_unavailable`: no fresh snapshot, missing client key, rate limit,
  timeout or invalid provider response. Keep the original reconciliation visible.

A match/mismatch may include `indexedTransfer` with `network`, `tokenAddress`,
`txHash`, `logIndex`, `fromAddress`, `toAddress`, `amountAtomic`, `blockHash` and
`blockNumber`. Indexed amounts and block numbers are decimal strings. Existing
reconciliation `matches[].amountAtomic` remains bigint; use the existing formatter.
Top-level `witness` has `status:"available"|"witness_unavailable"`, `fetchedAt`
(milliseconds or null), and optional safe `reason`. `available` means the provider
query worked, not that every row matches. Snapshots become unavailable after two
minutes. Refreshes reuse each order's snapshot for 30 seconds, and a durable
global 15-second reservation keeps concurrent Convex actions below the CDP rate
limit. Queries cover at most 100 observed transaction hashes / 10,000 indexed
rows; overflows are unavailable rather than falsely complete.

`POST /api/webhooks/cdp` verifies the v0 HMAC over the raw body and timestamp
(with a five-minute past/future tolerance). `HEAD` returns 200 for subscription
validation. Configure `CDP_WEBHOOK_SECRET_TO` and `CDP_WEBHOOK_SECRET_FROM` in the
web server; `CDP_WEBHOOK_SECRET` is also accepted for a single subscription.
It reuses `paymentService()` and the existing RPC observation/confirmation path.
The webhook cannot set a payee, approve an intent, sign or send a transaction.

Receipts deduplicate by authenticated body event ID (body digest fallback) and
`(network,txHash,logIndex)`. `X-Event-Id` alone is not trusted because v0 does not
sign headers. Known funding candidates must prove the saved authorization nonce;
payouts must already have a signer-reported hash. Pending RPC/confirmation errors
return 503 so CDP can retry; processed/unknown receipts return 200. Unknown
transfers are advisory exceptions, not cash or new obligations. They share the
existing acknowledge/resolve workflow. They disappear from active detection if
later reconciled, while disposition history remains.

Treasury ownership is derived from stored funding intents. An unbound treasury
or one shared across organizations is refused rather than assigned to an arbitrary
tenant. Unknown exceptions apply to the treasury as a whole and appear on each
funded order using it; they do not claim allocation to that particular order.
No durable background RPC retry worker is introduced: operator reconciliation is
still needed if CDP exhausts its retries or a payout hash was never reported.

Setup commands (private credentials loaded from `~/.config/skarl/cdp.env`):

```sh
SKARL_TREASURY_ADDRESS=0x8408a922ea400af33d7c2080a9edd5d3495b695f \
  node scripts/cdp-webhooks-create.mjs https://skarl.vercel.app
node scripts/cdp-sql-witness.mjs
```

The subscription script creates both directions and saves secrets only to
`~/.config/skarl/cdp-webhook.env` with mode 600. It prints variable names to set
in Vercel, never their values. An uncertain create response leaves a private
`creating` marker: inspect CDP before retrying, rather than create duplicates.
Set `CDP_CLIENT_API_KEY` in **Convex** for the refresh action. The read-only live
command compares the specified funding transaction against RPC and exits 2 when
unavailable or not matching; it never sends a transaction. The requested root
alias `cdp:webhooks:create` should invoke `node scripts/cdp-webhooks-create.mjs`;
adding that `package.json` entry is pending ownership approval.

Primary references: [webhook signatures](https://docs.cdp.coinbase.com/webhooks/verify-signatures),
[onchain subscription filters](https://docs.cdp.coinbase.com/webhooks/onchain-activity/overview),
[subscription API](https://docs.cdp.coinbase.com/api-reference/v2/rest-api/webhooks/create-webhook-subscription),
[SQL client authentication](https://docs.cdp.coinbase.com/data/sql-api/quickstart),
and [SQL schema](https://docs.cdp.coinbase.com/data/sql-api/schema).
### Optional CDP finance executor

`PAYOUT_EXECUTOR=controller_wallet` remains the default. In the optional
`cdp_agent` mode, independent controller approval and the existing durable
workflow queue an internal `agentWallet.execute({intentId})` action. It claims
the stored payout once and submits the exact USDC transfer from the configured
CDP account. The dashboard should not prompt for browser signing in this mode;
deployment configuration must select the matching UI flow. The existing claim
boundary prevents the browser and agent from both executing an intent.

Approval and submission still do not mean paid. Read the existing payable,
payment attempt and reconciliation records; only confirmed receipt observation
posts the payout journal. `requires_reconciliation` never authorizes another
send. Operator-only `agentWallet.reconcile({intentId,txHash?})` verifies a saved
or recovered hash without signing, including after disabling the executor.
This integration is implemented and tested with simulated fixtures; live CDP
policy enforcement and payout evidence must be recorded separately before
enabling it. See [agent wallet setup and limits](agent-wallet.md).


## Funding rail and explorer fields

Base Sepolia remains first in x402 `accepts`; Solana Devnet is an optional second funding rail. Payouts remain Base-only. `payments.fundingStatus` and `GET /api/orders/[id]/fund` return `network` and `explorerUrl` (null without a transaction); the intent/attempt network becomes authoritative when a claim exists. Before a claim, `network` defaults to Base and the HTTP `rails` list supplies available `{ network, recipientAddress, asset }` options.

`activity.feed` chain items and `activity.payoutHistory` observations include `network` and a per-rail `explorerUrl`. Render the chain badge from that network, never from the order's Base denomination or signature shape. Solana links use `https://explorer.solana.com/tx/<signature>?cluster=devnet`; preserve base58 case. A transaction link, signature or facilitator response alone does not establish funding: only RPC-observed `confirmed` funding activates the order.

### Hosted reconciliation and finance jobs

`scheduledJobs.reconcile` runs internally every **2 minutes**. It observes existing
prepared/submitted/reconciling attempts using Base receipt validation or Solana
signature/transaction validation. It never signs, sends, claims execution or
creates a replacement payment attempt. Hashless and late attempts remain
reconciliation exceptions for manual recovery; timeout is not proof of failure.
Detected exceptions are persisted as changed snapshots/audits and remain visible
through `exceptions.list`. Stale pending CDP webhook rows are classified against
existing chain observations, not invented settlement evidence.

`scheduledJobs.finance` runs internally every **10 minutes** over changed accrued
payables and current exceptions. It calls the existing bounded Gemini tool loop
as finance-agent: reads evidence, proposes stored obligations and requests
independent controller approval. It cannot approve or sign. The ordinary
`financeAgentData` transcript/history queries expose these runs to the dashboard.
Stable fingerprints and durable request IDs suppress unchanged repeat runs;
interrupted pre-action reservations reuse the same request ID. A proposal may
create a new missing-transfer exception and trigger one explanatory follow-up.

`scheduledData.snapshots({demoIdentity,orderId})` is available to controllers and
finance agents in their organization. It returns checkpoint metadata (kind,
status, generation, request/run IDs, nextAt/leaseUntil/fingerprint) plus parsed
`snapshot`: accrued obligations/current exceptions for finance, or exception
key/details for reconciliation. These are advisory operating records.

Caps are three paginated orders per tick, four pending attempts per order and
ten stale webhook rows per reconciliation tick; finance inherits the existing
call-count, cumulative amount and deadline caps. `SKARL_SCHEDULED_JOBS_DISABLED=true`
disables both jobs; `FINANCE_AGENT_BACKGROUND_ENABLED=false` disables finance.
The existing payment service secret and RPC settings must be configured. Jobs
become active only after the designated deployment owner's clean-main deploy.

### Safe backend checks

Use `pnpm test:convex` for isolated application tests. `pnpm check:convex` now refuses any remote deployment selected by process environment, `.env.local` or `.env`, including alternate deployment keys/remote self-hosted URLs. An explicit `--allow-cloud` is required for intentional remote sync; it does not waive the clean-checkout/matching-`origin/main` deployment rule or the designated deployment owner. The wrapper never forwards arbitrary CLI flags.

## Mobile sensor evidence

Additive mobile backend; **deploy from main before using**. Existing submissions
and queries remain valid without a trace. No Convex deployment was performed by
the mobile work. See [mobile capture](mobile.md) and the [phone quickstart](../apps/mobile/README.md).

| Function | Kind | Exact args / identity |
| --- | --- | --- |
| `submissions:generateUploadUrl` | M | `{demoIdentity: "contributor"}`; obtain a separate URL for video and JSON |
| `sensorTraces:attachSensorTrace` | A | `{demoIdentity: "contributor", submissionId: Id<"submissions">, storageId: Id<"_storage">}` |
| `media:submissionEvidence` | Q | Existing `{demoIdentity: "controller" \| "contributor", submissionId: Id<"submissions">}`; contributors must own the submission |

POST the JSON with `Content-Type: application/json`, maximum 2 MiB. Create the
video submission normally, with acknowledged consent and a stable request UUID;
then attach its trace. Action returns `{submissionId, replayed}`. Same storage ID
replays; a different attachment is refused. Role, ownership, tenant and consent
are checked server-side, including again at persistence. Accepted/rejected
submissions cannot gain new sensor evidence. Explicit sensor failures leave the
existing video contribution intact and must not trigger another creation.

Trace format (synthetic shape illustration, not device evidence):

```json
{
  "version": 1,
  "sampleRateHz": 50,
  "durationMs": 10000,
  "recordedAt": "2026-10-25T10:30:00.000Z",
  "clock": "js-callback-performance-now",
  "sensors": ["accelerometer", "gyroscope", "deviceMotion"],
  "device": {
    "model": "iPhone", "os": "iOS", "osVersion": "26", "appVersion": "0.1.0",
    "cameraFacing": "back", "requestedVideoQuality": "720p"
  },
  "samples": [
    {"sensor": "accelerometer", "timestampMs": 0, "x": 0, "y": 0, "z": 1},
    {"sensor": "gyroscope", "timestampMs": 0, "x": 0, "y": 0, "z": 0},
    {"sensor": "deviceMotion", "timestampMs": 0, "x": 0, "y": 0, "z": 0}
  ]
}
```

Optional `device.resolution: string`, `device.fps: number` are actual measurements
only; mobile currently omits them. Channels must match actual samples; empty
channels/array explicitly mean unavailable. Timestamp order is strict per
channel and nondecreasing across channels, bounded by duration; sample rates are capped, vectors finite/bounded,
unknown fields rejected. Acceleration is **g including gravity**, gyro **rad/s**,
and DeviceMotion linear acceleration **m/s² excluding gravity**.
Version 1 also permits `attitude` (x/y/z = alpha/beta/gamma **radians**) and
`gravity` (**m/s²**, including-gravity acceleration minus linear acceleration).
The old three-channel example remains valid. Up to five channels and 31,000
samples are allowed, still within 2 MiB; the mobile client caps each channel at
50 Hz. Deploy the updated validators before attaching five-channel uploads.

`media:submissionEvidence` adds this field (null when absent):

```ts
sensorTrace: {
  storageId, sampleRateHz, sampleCount, durationMs, sensors, device,
  recordedAt, clock, sizeBytes, attachedAt,
  url: string | null, // private bearer URL; never publish/cache
  motionSummary: {
    source: "clientReported", version: 1, binWidthMs: 250,
    accelRmsG: number | null,
    gyroRmsRadPerSec: number | null,
    linearAccelerationRmsMps2: number | null,
    meanTiltDegrees?: number | null, // portrait horizon roll; absent in legacy summaries
    steadinessRatio?: number | null, // fraction of gyro samples <=0.15 rad/s
    activeMotionIntervals: Array<{ startMs: number; endMs: number }>,
    bins: Array<{
      startMs: number; endMs: number; sampleCount: number;
      accelRmsG: number | null; gyroRmsRadPerSec: number | null;
      linearAccelerationRmsMps2: number | null; active: boolean;
    }>
  }
}
```

Matthew can plot `bins` against video seconds (`startMs / 1000`), with separate
axes/units per channel and gaps for `null`. `sampleCount` counts all channel
readings, not video frames. Activity thresholds and approximation limits are in
[mobile motion summary](mobile.md#motion-summary-for-the-dashboard). A still
phone is normal for the fixed-camera task. These client-reported signals do not
change report recommendations, human acceptance, payables or payment authority.


## Verify on-chain

After the backend rollout, `attestations.forSubmission({submissionId})` is a
public reactive query returning `null` or
`{uid, txHash, easscanUrl, basescanUrl, fields}`. It returns only the current
analysis's confirmed attestation. Render a **Verify on-chain** badge linking to
`easscanUrl`; `basescanUrl` is the transaction detail link. A `null` result means
no confirmed attestation is available for that analysis; show pending/unavailable,
not a failed verification or a successful attestation. Do not display an older
analysis's badge after a rerun.

`fields` contains exactly `reportHash`, `sourceSha256`, `rubricHash`,
`pipelineVersion`, `videoModel`, `recommendation`, `verifiedAt`, and `licensed`.
Hashes are `0x`-prefixed bytes32 strings; `verifiedAt` is analysis completion time
in Unix seconds; `licensed` is a boolean. Jury model IDs are comma-separated;
`unavailable` means no visual model run was recorded. No report text, original
media URL, contributor identity, or contributor wallet is returned.

The badge proves that Skarl committed these report facts to EAS, not that the
clip passed, was accepted, or was paid. Finalized failed reports can also be
attested; recommendations remain as stored and verification-only submissions
have `licensed: false`. Check the linked EAS record for current revocation state;
the query records confirmation and does not continuously poll revocations.
Schema/account/policy setup is live; deployment and report backfill evidence are
tracked in [build status](status.md).

## Claude provider and Contributor Coach

**Source implementation; deployment pending.** This addition has synthetic
provider coverage, with no live Claude response claimed. The Anthropic key was
absent at the October 25 checkpoint. The deployment operator deploys merged
`origin/main`; see [Claude setup and evidence status](anthropic.md). These
contracts apply after that deployment and generated API update.

### Finance provider fields

`financeAgent.run({demoIdentity,orderId,requestId,prompt})` retains its arguments
and `{runId,replayed}` result. Provider selection is server configuration, not a
caller argument: `FINANCE_AGENT_PROVIDER=gemini|claude`, default `gemini`.
`financeAgentData.runs({demoIdentity,orderId})` adds `provider: "gemini" | "claude"`
to each row. Existing records without a stored provider project as `gemini`.
`model` records the selected model; Claude defaults to `claude-sonnet-5-5`, with
`ANTHROPIC_FINANCE_MODEL` then `ANTHROPIC_MODEL` overrides. Display provider and
model next to the run without implying agreement between providers: one provider
executes each run, and this option does not create an independent visual witness.

The transcript stays `[{call:{id,name,arguments},result}]`. Statuses remain
`running`, `completed`, `failed`, `capped`. Tool refusals remain results such as
`{ok:false,code:"tool_not_allowed"}` or `invalid_tool_arguments`; the Claude
conversation receives those as error tool results. Approval tools are not
advertised. Existing exact amount limits, proposal idempotency and independent
controller approval are unchanged.

New sanitized failure codes include `anthropic_key_missing`, `claude_refusal`,
`claude_timeout`, `claude_http_<status>`, `claude_request_failed`,
`claude_response_invalid`, and `claude_response_incomplete`.
`invalid_agent_provider` rejects invalid server configuration before starting a
run. Show persisted tool results even if a later provider turn fails. Reusing a
request ID returns its original run; switching providers does not rerun it.

### Contributor Coach for web and iOS

Both endpoints require the stored contributor role, active organization and
ownership of the submission. Controller, buyer and finance-agent selectors do
not gain access to the contributor's coach response. The
[authentication rules](#authentication) apply; unsigned demo selectors remain
impersonable while demo mode is enabled.

| Function | Kind | Arguments and result |
| --- | --- | --- |
| `coach.explainOutcome` | Action | `{demoIdentity:"contributor",submissionId:Id<"submissions">}` → `{explanationId,replayed}`. Generates or reuses the persisted explanation. |
| `coachData.forSubmission` | Query | Same arguments → `null` or the current record described below. Subscribe to this query for completion. |

```ts
{
  explanationId, submissionId, analysisId, reportHash,
  provider: "claude", model, promptVersion,
  status: "running" | "completed" | "unavailable",
  startedAt, completedAt?, failureCode?,
  advisory: true, demoOnly: true,
  explanation: null | {
    advisory: true,
    introduction, submissionStatus, recommendation, pipelineStatus,
    warnings: string[], paymentNotice,
    items: Array<{
      criterionId,
      status: "supported" | "contradicted" | "unobservable",
      explanation: string,
      nextStep: string,
      uncertain: boolean,
      citation: null | { modality: string; startMs: number; endMs: number; label: string }
    }>
  }
}
```

Treat this shape as illustrative; use the generated API return types. Date fields
are Unix milliseconds. Citation ranges are milliseconds within the original
recording, with a server-rendered `label` such as `0:04.000–0:05.000`. Seek to
`citation.startMs / 1000` in a video player. A null citation means no cited
evidence exists; do not invent a seek target. Keep `uncertain`, stored warnings,
the authoritative status/recommendation and `paymentNotice` visible. Render all
strings as plain text, never executable HTML or instructions.

Call the action from an explicit contributor request, not during render. A
`{explanationId,replayed}` response does not mean generation succeeded. In React,
use `useAction(api.coach.explainOutcome)` and
`useQuery(api.coachData.forSubmission,{demoIdentity:"contributor",submissionId})`.
In iOS, invoke the same action and subscribe to the query. `undefined` means
loading in React; `null` means no current explanation. Show a loading state for
`running`, guidance for `completed`, and an unavailable state with a retry
option for `unavailable`. Continue showing the stored report if coaching fails.

The persisted binding includes the current analysis, report hash, submission
status, decision and prompt version. A rerun or changed outcome hides the older
explanation. Concurrent requests reuse one generation; completed output is
cached, while an unavailable result can be retried after 60 seconds. A 90-second
watchdog marks interrupted work unavailable. Coaching does not mutate a verdict,
create a payable or promise payment.

Missing reports reject with `coach_report_unavailable`; mismatched stored source
bindings reject with `analysis_reference_mismatch`. Ownership failures include
`submission_not_owned`, alongside the existing role/tenant errors. Persisted
coach failures include `coach_invalid_output`, `coach_source_changed`,
`coach_interrupted` and `coach_unavailable`; provider failures use the Claude
codes above. Do not display a mock fallback as a live Claude response or describe
an unavailable coach as successful inference.

## Buyer dataset export

**Source implementation; deployment required.** `datasets.forOrder({demoIdentity,
orderId})` returns the buyer's versioned dataset, rather than the review queue.
The order's buyer and an active controller in its organization may export it.
Other buyers, contributors, and finance agents are refused. The
[authentication rules](#authentication) apply; unsigned demo selectors remain
impersonable while demo mode is enabled.

```sh
curl -H 'x-skarl-demo-identity: buyer' \
  'https://skarl.vercel.app/api/orders/ORDER_ID/dataset' > dataset.json
curl -H 'x-skarl-demo-identity: buyer' \
  'https://skarl.vercel.app/api/orders/ORDER_ID/dataset?format=jsonl' > samples.jsonl
curl -H 'x-skarl-demo-identity: buyer' \
  'https://skarl.vercel.app/api/orders/ORDER_ID/dataset?format=lerobot' > lerobot-manifest.json
curl -H 'x-skarl-demo-identity: buyer' \
  'https://skarl.vercel.app/api/orders/ORDER_ID/dataset?format=rlds-json' > rlds-manifest.json
```

The JSON response has `schema: "skarl.dataset.v1"`, `orderId`, `generatedAt`
(Unix milliseconds), `task: {id, version, criterionIds, languageInstruction}`, and `samples`.
An order with no deliveries returns `samples: []`; a draft without a rubric has
`task: null`. JSONL streams one complete sample per line, repeating task and
license metadata so each line can be loaded independently. Empty JSONL is an
empty response body. Example sample (illustrative, not live evidence):

```json
{
  "submissionId": "SUBMISSION_ID",
  "sourceSha256": "64-lowercase-hex-characters",
  "durationMs": 12000,
  "task": {"id": "RUBRIC_ID", "version": 1, "criterionIds": ["red-cup-pickup"]},
  "acceptedAt": 1792926000000,
  "acceptance": {"basis": "machine", "decisionId": "DECISION_ID"},
  "license": {"version": "demo-consent-v1", "scope": "Stored contributor consent scope"},
  "criteria": [{"criterionId": "red-cup-pickup", "status": "supported", "evidence": [{"modality": "video", "startMs": 1000, "endMs": 2000}]}],
  "transcriptSegments": [{"startMs": 1000, "endMs": 2000, "text": "I pick up the red cup."}],
  "sensorTrace": null,
  "liveness": null,
  "duplicate": {"status": "clear"},
  "attestation": null,
  "payout": {"status": "pending", "amountAtomic": "1875000", "txHash": null, "explorerUrl": null},
  "media": {"mimeType": "video/mp4", "url": "https://skarl.vercel.app/api/orders/ORDER_ID/dataset/media?token=SIGNED_GRANT", "binding": "DELIVERY_BINDING_HASH", "expiresAt": 1792926300000}
}
```

Only accepted, licensed submissions with a valid published delivery are included.
Verification-only and evaluation recordings, review/correction/rejected rows,
quarantined or swapped originals, and invalid consent/delivery bindings are
excluded. A report alone never grants delivery. `acceptance.basis` distinguishes
`machine` (controller acceptance of completed machine evidence) from
`human_controller` (explicit human review). Evidence comes from the analysis
bound to that delivery, preserving the accepted snapshot after a later rerun.
Missing findings remain `unobservable` with empty evidence; they are never
invented. A human decision can accept a report whose machine recommendation
remained `needs_review`.

When attached, `sensorTrace` includes `rawTraceExists`, sample counts/rate,
duration, channels, and the stored `motionSummary`, including optional
`meanTiltDegrees` and `steadinessRatio`. It exposes no raw trace storage ID or
URL. The summary remains `clientReported`. Spoken `liveness` is the deterministic
comparison of stored challenge and transcript, or null when no challenge exists;
it does not prove identity. `duplicate.status` is the stored report check status
or `not_checked`, not a claim of exhaustive uniqueness. Confirmed EAS records
bound to the delivered analysis include `uid`, `easscanUrl`, and `basescanUrl`.

All monetary amounts are decimal integer micro-USDC strings. A payout becomes
`paid` with a `txHash` and BaseScan `explorerUrl` only when the payable, payment
command, attempt and confirmed Base Sepolia USDC observation agree. Approval,
broadcast and unresolved transactions remain `pending`.

Export responses use `Cache-Control: private, no-store`. Both the public query
and HTTP manifest expose a signed five-minute download URL, with Unix-millisecond
`media.expiresAt`. Export again to refresh an expired grant. The proxy checks the
signature, expiry, order, caller's current membership/ownership and the current
licensed delivery binding before streaming only the original asset. Changes to
consent, delivery, source or eligibility invalidate an old grant. URLs are bearer
credentials: do not publish or cache them.
Requested/revoked consent excludes the sample from fresh exports and blocks old
grants at serving time; existing downloaded copies cannot be recalled. Every
sample includes `provenance: skarl.provenance.v1` from the delivered analysis
snapshot and current consent. Historical payables are preserved.

The HTTP route changes the query's optional `refreshKey` each minute so an
unchanged dataset still receives fresh grants. Direct query clients should pass
`refreshKey: Math.floor(Date.now() / 60000)` when refreshing an export; this is
only a cache key, never the signing clock or payment authority.

Native Convex bearer URLs from `ctx.storage.getUrl` have no configurable expiry;
they are available only to the trusted proxy through service-authenticated
`datasets.originalMedia`, and are never returned by the public manifest or in a
redirect. The proxy uses the existing matching `SKARL_PAYMENTS_SERVICE_SECRET`
in Convex and the web server, and fails closed if it is absent. Buyer dataset
grants do not reuse the paid sample endpoint's x402 grants. No deployment or live
download was performed as part of this implementation.

### Training manifests

`?format=lerobot` returns `schema: "skarl.lerobot-v2-manifest.v1"` with
`info`, `tasks`, and `episodes`. `info` contains FPS and feature descriptors,
including `observation.images.video` and only the sensor channels witnessed by
an existing raw trace. Episodes include `episode_index`, `task_index`,
`language_instruction` from the frozen rubric prompt, `success: true` from
acceptance, and `length` in video frames. FPS, dimensions and frame count are
not verified/persisted today, so `fps`, shape and `length` are null; optional
`client_reported_fps` remains separate. Sensor columns are client-reported and
asynchronous, with `frame_aligned: false`; raw sensor downloads are not exposed.

`?format=rlds-json` returns `schema: "skarl.rlds-json.v1"` with episode metadata,
the same language instruction and accepted success flag, and `step_metadata`
describing conversion. Episodes have `steps: []`, `steps_status: "not_materialized"`:
frame steps have not been decoded. No actions, joint states, rewards, discounts,
or terminal signals are invented. Both formats retain all sample quality,
license and provenance fields in each episode.

These are human-video conversion manifests. Both explicitly set
`compatibility.directly_loadable: false`; they are not complete LeRobot
Parquet/video archives or RLDS TFDS datasets. A converter must decode the video,
verify FPS/frame count, and materialize observation-only records. Full feature
mapping, compatibility requirements and primary references are in
[Buyer datasets](datasets.md).

### Sample quality and usable segment

All four HTTP formats and `datasets.forOrder` include derived
`usableStartMs`, `usableEndMs`, `qualityScore`, `rawQualityScore`, `scoreCap`,
`capReasons`, `components`, `method`, and `segment`. The usable window bounds
supported frozen-rubric evidence with 500 ms padding, clamped to stored duration;
both offsets are null without valid evidence. It is not a trimmed media file or
a guarantee of continuous useful action.

The versioned heuristic (`method: "skarl.quality.heuristic.v1"`) uses these fixed
weights: jury agreement 25, all criteria supported 25, duplicate clear 20,
spoken liveness 15, sensor steadiness 5, and confirmed bound attestation 10.
Each `components` entry includes `score`, `maxScore`, `status`, and `evidence`.
Missing evidence earns no points; optional missing sensors do not redistribute
weight. Sensor steadiness remains client-reported; duplicate checks are
heuristic; liveness is not identity; attestations commit to reports, not truth.

The final score is capped at 49 for nonaccepted samples, unavailable/incomplete
accepting inference, unclear duplicate checks, incomplete supported criteria,
or a witnessed jury disagreement. A human override does not erase these limits.
This score is advisory and cannot authorize acceptance or payment.

`datasets.sampleQuality({demoIdentity, submissionId})` is a separate query for
the owner contributor, order buyer, or organization controller. Finance agents,
foreign tenants and unrelated owners are refused. It returns:

```ts
{
  submissionId, submissionStatus, analysisId: Id<"analysisResults"> | null,
  evidenceBasis: "published_delivery" | "current_analysis",
  method: "skarl.quality.heuristic.v1",
  qualityScore, rawQualityScore, scoreCap: number | null, capReasons: string[],
  usableStartMs: number | null, usableEndMs: number | null,
  components: {
    juryAgreement, allCriteriaSupported, duplicateClear,
    livenessPassed, sensorSteadiness, attestationPresent
    // Each: {score, maxScore, status, evidence}
  },
  segment: {method: "supported_criterion_bounds", paddingMs: 500, evidenceCount,
    durationSource: "supplied_stored_duration", contiguousActionGuarantee: false}
}
```

Accepted published samples use the delivered analysis snapshot, matching their
export even if the current analysis pointer changes. Other samples use their
current bound analysis. The query returns no media URL or raw sensor storage ID.
`witnessReceipt.ts` is unchanged; clients can render this companion query beside
the existing receipt. Tests use synthetic evidence, not live inference claims.

### Diversity terms and coverage

`orders.createOrder` accepts optional `diversity`:

```ts
diversity?: {
  maxPerContributor?: number; // Positive safe integer cap on accepted order samples
  maxPerEnvironment?: number; // Requires an environment tag at acceptance
  requiredVariants?: string[]; // Each label must appear at least once by fulfillment
}
```

`submissions.create` adds optional `environment?: string`, `variant?: string`.
These are contributor self-reports, not inferred facts. Labels are trimmed,
case-sensitive, 1–120 characters, with no control characters. Required variants
must be unique, at most 100, and no more than the requested quantity. Normalized
diversity terms bind `termsHash`; changed tags or terms conflict with existing
request replay. Old records and callers remain valid without the new fields.
Each exported sample includes `diversity: {environment: string|null,
variant: string|null, source: "contributor_self_reported"}`.

`finance.acceptAndPublish` and the human-review acceptance path enforce these
caps in the same transaction as delivery and accounting. Required variants
reserve one remaining slot per missing label; additional variants are allowed
while those slots remain available. A refusal returns
`{ok:false, code:"diversity_quota_exceeded"}` and records `acceptance_refused`
with the order ID and quota component (`maxPerContributor`, `maxPerEnvironment`,
or `requiredVariants`) as evidence. It creates no delivery, payable or journal;
the candidate is not silently discarded. A prior successful acceptance replays
its original result. Concurrent accepts share the order/capacity transaction.

`orders.diversityCoverage({demoIdentity, orderId})` is available to the order's
buyer, organization controller, or finance agent. It reports:

```ts
{
  orderId, diversity: {maxPerContributor?, maxPerEnvironment?, requiredVariants?} | null,
  tagsSource: "contributor_self_reported", contributorKeySource: "order_scoped_sha256",
  acceptedCount: string, remainingQuantity: string,
  contributors: Array<{contributorKey: string, count: string}>,
  environments: Array<{label: string, count: string}>,
  variants: Array<{label: string, count: string}>,
  untaggedEnvironmentCount: string, untaggedVariantCount: string,
  requiredVariants: Array<{variant: string, covered: boolean}>, missingVariants: string[]
}
```

Only accepted samples in the same organization/order count. Contributor keys
are order-scoped hashes, not identity tokens. Declared coverage does not prove
different physical environments or visual diversity. Deploy the optional schema
fields and Convex functions, then the web route; no migration/backfill or new
secret is needed. The existing dataset media secret remains required.

### Contributor earnings

`datasets.contributorEarnings({demoIdentity: "contributor"})` returns only that
contributor's submissions in their active organization. Buyers, controllers and
finance agents are refused; there is no HTTP route. Each row has `submissionId`,
`orderId`, submission `status`, exact decimal-string `amountAtomic`,
`payableStatus` (`accrued`, `payout_in_progress`, `paid`, `reversed`, or null),
and `payout` with `status`, `amountAtomic`, `txHash`, and `explorerUrl`.

No recorded payable means `amountAtomic: "0"`, `payableStatus: null`, and
`payout.status: "not_payable"`; an upload or the advertised order rate is not
earned compensation. When present, `amountAtomic` is the stored obligation's
original amount; a `reversed` obligation must not be counted as current earnings.
Recorded obligations use the same conservative `pending`/confirmed `paid`
projection and BaseScan links as the buyer export. No media, destination wallet,
or another contributor's rows are returned.

## Bank witness — Capital One Nessie

**Deployment required.** The additive bank witness exposes
`bankWitness.reconciliation4Way({demoIdentity, orderId})` to `controller` and
`finance-agent` identities in the order's organization. All bank evidence must
carry the label **simulated bank (Capital One Nessie mock)**, including when
requests reach Nessie's hosted API. Nessie models a bank; it does not establish
real fiat custody, a fiat sweep, or a contributor off-ramp.

The query composes the existing payment reconciliation and chain witness with
bank activity. Render each obligation as `order | ledger | chain | bank`, with
`match`, `missing`, or `mismatch` states and the supplied explanation. Monetary
amounts at JSON boundaries are decimal integer micro-USDC strings. Display bank
mismatches in the exception queue; do not turn missing, stale, unavailable, or
out-of-scope evidence into a green match. Refunds and standalone evidence sales
are outside this bank simulation's funding/payout scope. Their bank column is
`missing` with reason `outside_bank_simulation_scope`.

The response contains `label`, `simulated: true`, `rows`, `exceptions`,
`bankAvailable`, `bankFetchedAt`, and `reconciliation`. Each row has `intentId`,
`kind`, `order`, `ledger`, `chain`, `bank`, and `activityIds`; each column has a
`status`, optional `amountAtomic`, and optional `reason`. The `chain` column
checks the canonical receipt; `reconciliation.witnesses` retains the separate
CDP SQL witness results. `reconciliation.matches[].amountAtomic` is serialized
as a decimal integer string. A bank snapshot expires after five minutes.
`bank_mismatch` items also appear in `exceptions.list` and use the existing
controller acknowledgment/resolution APIs. Unmatched Treasury activity is
explicitly Treasury-wide and is not assigned to an arbitrary order.

A confirmed x402 funding intent produces a simulated Treasury deposit; an
observed contributor payout produces a simulated Treasury-to-contributor
transfer. Each bank description is the original funding or payout intent ID.
Matching requires that ID, the exact amount, and the expected account/direction;
an equal amount alone is insufficient. The simulation uses one dollar per USDC
as an explicit demo assumption, not an exchange-rate quotation. The projection
never posts another journal, alters a payout destination, or approves/signs a
payment. Bank agreement is corroborating evidence, not payment authority.

Internal `bankWitness:seed` provisions one Treasury account and one account per
active, wallet-verified contributor. `bankWitness:sweep` runs on a two-minute
cron after deployment and configuration. Durable local intent precedes external
requests; repeated seeds and sweeps reuse the original records. An ambiguous
request outcome remains unresolved and is reconciled by observation rather
than sent again. An operator must investigate unresolved account creation.

### Configuration and live setup

The implementation starts disabled. Enable only after the deployment owner
has deployed `origin/main` and privately configured `NESSIE_API_KEY` plus
`NESSIE_ENABLED=true` in the target Convex deployment. No Convex deployment or
live Nessie request was performed by this implementation task.

At the October 25 implementation check, `~/.config/skarl/nessie.env` was absent.
To unblock live mock-provider integration:

1. Open [Capital One Nessie](https://nessieisreal.com).
2. Sign in using GitHub OAuth and complete the requested authorization.
3. Create or copy the API key shown for the signed-in account.
4. Save `NESSIE_API_KEY=<your key>` in the private local file
   `~/.config/skarl/nessie.env`; do not commit or paste it into reports.
5. Have the deployment owner configure the key and enable flag in Convex,
   deploy the merged backend, then invoke `bankWitness:seed` and
   `bankWitness:sweep` and inspect reconciliation results.

The adapter uses `https://prod-api.nessieisreal.com` with its key query
parameter. A bad key can return HTTP 200 and `[]` on GET; that response is not
credential validation or proof of an empty account. Startup requires a
successful customer POST probe or verification of a known account ID before
accepting activity reads. Hosted-provider success must be recorded separately
from mocked test results and must retain the simulated-bank label.
