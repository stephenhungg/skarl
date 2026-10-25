# Finance Agent Engineering

## Job and implementation status

The target agent fills two financial seats: settlement accountant and accounts-payable clerk. It explains obligations, proposes bounded payments and identifies reconciliation exceptions (period close is deferred). It does not decide whether a clip contains the right action, approve its own payment, hold a wallet key or rewrite the ledger.

The Convex `financeAgent.run` action implements a configurable Gemini/Claude function-calling loop over the same shared registry of 24 allowlisted tools. Tool results, provider/model and the final advisory explanation persist in `financeAgentRuns` for buyer Review. Server mutations enforce cumulative exact proposal limits and existing independent-approval rules. A Convex Workflow waits for separate policy or buyer exception approval, revalidates the stored proposal and releases the execution outbox; wallet execution remains separate. Mocked responses test policy boundaries; live Gemini measurements are recorded in [status](status.md). The expanded registry and prompt have synthetic provider coverage only; historical live observations do not establish the expanded path. See the [Anthropic handoff](anthropic.md).

## Shared tool surface

`convex/lib/financeToolRegistry.ts` is the single tool catalogue for `financeAgent.run`, `agentChat.askAgent` and the scheduled analyst. All 22 reads use the same internal, order/organization-scoped query backend; only the run has proposal and approval-request callbacks. The [dashboard API tools table](dashboard-api.md#shared-finance-agent-tools) lists all 24 definitions and arguments. The registry validates arguments independently of provider schemas, caps each result with an explicit truncation marker and refuses scope-changing fields. Providers wrap every result as untrusted JSON data. No original media URLs, signing credentials or contributor identity tokens enter this context.

A run advertises proposal tools only when its authorized request explicitly asks to propose a batch or request approval. Ambiguous questions stay read-only; quoted narration/Jira instructions cannot enable that capability. Even a provider-forced valid proposal is refused when the trusted request is read-only. Chat and analyst refuse proposal/request tools regardless of user wording. These are additional capability checks; independent approval and execution remain server-enforced.

Finance reads include frozen order terms/rubric, journals/statements, four-way reconciliation, mock-bank exceptions, funding stages, payout attempts, wallet health, jury and other submission witnesses, duplicates, held items, audit history, pseudonymous earnings and prior notes. Missing HTTP/facilitator stages or historical executor facts are explicit data gaps rather than invented milestones. No-exception and stored confirmed labels alone establish neither chain settlement nor bank completion. Tax tools retain the existing exact journal projections and demo disclosures.

Do not expose signing or `approvePayment` as agent tools. The internal `policy-engine` applies the buyer-signed rule to the exact proposal in Convex; failures go to the order’s buyer for review. A separate authorized legacy executor may then call Coinbase Wallet MCP `send` **only for that stored, approved intent** (exact recipient, amount and token; no other parameters), as a legacy signing path. The happy path uses the existing CDP executor with its independent wallet cap. The Coinbase retail MCP's x402 tools run on Base mainnet with a 5 USDC cap and are not used on the demo path. An attempt to approve its own proposal is refused and logged; this refusal is part of the demo moment. The payment executor consumes the approved command and stores the attempt before submission. Recipient, amount, token, network or payable-version changes invalidate the prior approval.

The tax tools support plain-language year-end summaries and forms-needed notes labeled **Not tax advice — demo data**. They return deterministic journal-derived payouts and advisory country notes, under the explicit USDC-to-USD 1:1 assumption. They cannot update a contributor's tax status, approve a payout, compute or withhold real tax, or file anything. Null fields preserve Claude's strict tool schema while selecting the current authenticated scope; supplied years must be integral UTC calendar years (1970–9999). Source implementation and synthetic provider tests do not establish live Claude inference or external reporting compliance. See [Tax-ready ledger](tax.md).

## Reasoning loop and persistence

1. Parse the user's finance request into a supported intent. Ask for a specific order/period only when scope cannot be resolved from the current authorized view.
2. Fetch small, explicit financial snapshots using read tools. Provide event IDs and integer amount strings, not raw media, secrets or an unbounded journal dump.
3. Compute balances and policy findings deterministically. The model summarizes those outputs and identifies what evidence is missing.
4. For money-related requests, create a proposal against current obligation versions. The backend recomputes the amount and checks available funding, duplicate commands, recipient verification, limits and pending attempts inside the transaction.
5. Stop at approval-required/blocked status and explain the exact reason. A user’s chat sentence cannot confer approval authority.
6. After external execution, retrieve reconciliation output. State `pending` or `unknown` when appropriate; never infer success from fluent prose or a timeout.
7. Persist run ID, model/configuration, tool name, argument digest, source versions, sanitized result summary and terminal outcome. Separate this operational audit from immutable accounting journals.

Use a finite step count, bounded tool result sizes, explicit timeouts and limited transient retries. Persist proposals and requests before yielding control; do not keep approval state solely in model conversation memory. A resumed run reads current records instead of repeating the previous payment instruction.

## Policy design for the demo

The buyer signs an auto-pay rule when creating/funding the order: enabled by default, cap equal to per-clip price, every check required. Buyers can change or disable it; changes are audited. Legacy orders without a rule remain manual until the buyer enables one. `policy-engine` is a distinct internal service, never a model-selected identity. Acceptance and approval reuse existing ledger/Workflow logic; the agent’s self-approval attempt still refuses even if the rule would pass. The buyer cap and CDP wallet cap are independent guards. Failed checks and over-cap intents go to buyer Review. Refunds retain their separate stored-approval path.

A duplicate detection finding blocks automatic fulfillment pending review. Existing earned compensation survives cancellation. A transfer with an unresolved original attempt blocks replacement. A model may suggest investigating or adjusting an error, but corrections require an authorized linked reversal/adjustment; the original journal remains unchanged.

Store all cash/obligation arithmetic as exact micro-USDC. Display USDC and gas (ETH) separately.

## Demonstrating engineering quality

**Not yet run as a formal evaluation.** Current evidence is `pnpm eval:finance` (golden questions with negative controls) and the scripted checks in [demo](demo.md): duplicate payable blocked, self-approval refused, repeated funding event posted once.

Create a synthetic answer-key dataset of finance cases independently from the model prompt. Include the full $100 lifecycle, prepayment incorrectly labeled revenue, duplicated payable/event, wrong recipient/token, changed proposal after approval, requester self-approval, expired approval, over-refund, lost payout response, cancellation race and a prior-period reconciliation discrepancy.

Measure exact obligation and balance correctness, unauthorized tool attempts, policy-block correctness, reconciliation recovery and citations to the relevant business events. Count cases and failures. Compare a model answering from plain transaction text with the same model using deterministic projections and bounded tools. Preserve an untouched test subset; do not report a handpicked successful chat as an evaluation.

The demo's memorable output is one defended decision: "this clip is a re-encoded copy of an accepted submission, so no second payable exists; I've proposed the legitimate payout, and I can't approve my own proposal." The displayed statement must follow real persisted evidence, not a scripted claim. See [demo](demo.md).

## References

- [Hyphenate brief](https://docs.google.com/document/d/1u4iN8R97ILY3kfHTPKC82zdutHrGx4ze5eCAP-J92w4/edit)
- [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling)
- [Accounting model](accounting.md)
- [Payment boundaries](payments.md)
- [Backend transactions](backend.md)
- [Identity and approval security](security.md)

## Running the implemented agent

```sh
pnpm exec convex run financeAgent:run '{"demoIdentity":"controller","orderId":"<order-id>","requestId":"finance-demo-1","prompt":"Inspect payables, trial balance and reconciliation exceptions. Propose eligible obligations and request independent approval."}'
```

The action pins every tool to `finance-agent`; model arguments cannot select an
identity, recipient, amount, network, organization or arbitrary Convex function.
For the refusal demo, an unadvertised `approve`/`approvePayment` function call is
routed solely to `finance.approve` with that same agent identity. The server
records its self/agent-approval refusal. Unknown tools and extra fields are
refused. Natural-language requests do not guarantee a model will attempt the
forbidden call; the mocked policy test exercises that exact attempted call.

Convex environment configuration: `GEMINI_FINANCE_MODEL` defaults to
`gemini-3.8-flash`; read-only `askAgent` follows the shared finance provider/model selection. Video
verification defaults separately to `gemini-4-argon`; the finance model stays
Flash for interactive latency. `FINANCE_AGENT_MAX_TOOL_CALLS` defaults to 24
(range 1–24);
`FINANCE_AGENT_CONTEXT_CHARS` defaults to 80,000 (range 32,000–100,000 serialized request characters);
`FINANCE_AGENT_MAX_BATCH_ATOMIC` defaults to `10000000` micro-USDC. The existing
server-only `GEMINI_API_KEY` is reused. No key reaches model input or transcript.
The run has a two-minute overall budget, at most 30 seconds per provider round,
parallel independent reads (writes remain serialized), a bounded transcript and a three-minute interruption watchdog. The Gemini
transport permits at most three transient attempts within that single 30-second
round deadline, including response reads and backoff; retries do not restart the
clock. Claude disables automatic SDK retries. Billing is now enabled for Gemini; the latest 3.8 Flash Interactions probe returned
HTTP 200 with a correct visual response in about 2.1 seconds. Earlier free-tier
stalls are historical, not a current availability blocker. This probe is not a
finance-agent benchmark. Reusing the same
request ID returns the original run and never repeats proposals; use a new ID
for a deliberate new attempt. Proposal replay does not consume the run's cap
twice. The cap applies to the whole run, including multiple batches.

Query `financeAgentData.runs({demoIdentity:"controller",orderId})` for the latest
20 runs, typed tool calls/results, terminal status, failure code and explanation.
Amounts are decimal micro-USDC strings. Oldest tool results are summarized deterministically when context grows; complete retained IDs, statuses and atomic amounts are labelled as partial evidence. Raw provider call signatures remain transient. A hard serialized provider-request cap prevents oversized requests, and deadline/call-budget wrap-up produces the required Summary, Findings, Risks/Exceptions, Recommended next actions and Data gaps sections. The scheduled analyst preserves its JSON contract with these sections inside `summary`.

Claude marks its static system block and last tool definition for [prompt caching](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching); cache hits, cost and expanded live quality remain unmeasured. The prompt stays free of run-specific facts. Hidden model reasoning is kept only in
the provider conversation in action memory and is not persisted. Explanations
remain advisory model text; authoritative cash, proposal and approval state
comes from the deterministic query/tool results. A killed run is marked failed;
it does not resume money-related tools automatically.

## Durable approval wait

`@convex-dev/workflow` starts one `approvalWorkflow.awaitController` per payout
proposal. Proposal replay reuses its stored Workflow ID. `finance.approve` keeps
its buyer/legacy-controller authorization, independence and binding checks, records the approval and
sends `controllerApproved` in the same transaction. An early event is retained
until the Workflow reaches `awaitEvent`.

The event is a wake-up signal. The queue mutation reloads the approval, current
policy service or authorized buyer/legacy-controller membership, exact recipient/amount/asset, source version and expiry
before inserting `dispatch:<commandId>` once. The component never signs or
sends a transfer. A changed, revoked or expired approval cannot release dispatch.
Unanswered workflows remain suspended; payment expiry still blocks execution.
There is no automatic wallet retry or automatic re-approval.

Approval returns before the asynchronous queue step completes. Dashboard
clients should wait for `dashboard.payables[].dispatchReady === true` before
claiming execution. A premature claim returns `dispatch_not_ready` without
creating a payment attempt. Claiming consumes the outbox and creates the durable
attempt in one mutation; `delivered` means handed to the executor, never paid.
The existing wallet/reconciliation path remains responsible for settlement.

## Historical live read-only loop measurement

A real `gemini-3.8-flash` run selected
`getTrialBalance`, read the funded order's exact `10000000` micro-USDC debit and
credit totals, and persisted its final advisory explanation. Client time was
6,805 ms and backend run time 6,351 ms. It created no proposal, approval or
payment attempt. Proposal/refusal policy coverage remains the synthetic
regression suite; this measurement proves the native function-call/result/final
explanation loop against the shared cloud backend.

## Expanded synthetic evaluation

`pnpm eval:finance` runs ten golden questions plus scorer negative controls with stubbed providers and tools; it is part of `pnpm check`. Backend tests independently exercise every registered read as a Convex query, assert protected financial tables remain unchanged, and refuse cross-organization references. These checks establish deterministic orchestration and safety coverage, not live inference quality or external settlement.

`pnpm eval:finance-live <synthetic-manifest.json>` is opt-in and uses read-only chat against an explicitly configured isolated synthetic organization. See [the evaluation instructions](../evals/finance-agent/README.md). It is not run in CI and does not seed or deploy a backend. Deploy these source changes separately, set provider credentials server-side and record the resulting live scores before claiming expanded capabilities ran externally.
