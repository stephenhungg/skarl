# Finance Agent Engineering

## Job and implementation status

The target agent fills two financial seats: settlement accountant and accounts-payable clerk. It explains obligations, proposes bounded payments, identifies reconciliation exceptions and prepares a period close. It does not decide whether a clip contains the right action, approve its own payment, hold a wallet key or rewrite the ledger.

Only the deterministic ledger helpers exist today. The agent loop, model adapter, tool endpoints, policy engine and approval workflow below are **planned work**. A successful journal test is not a working autonomous accountant.

## Bounded tool surface

Implement tools as typed application operations, not arbitrary SQL, shell, generic HTTP fetch or unrestricted Convex calls. Each tool resolves authenticated membership and organization on the server. Use one currently available tool-calling model, with the Gemini provider already needed for the verifier as a reasonable first choice; keep the provider configurable. No additional model SDK is installed for this component yet.

| Tool | Input and result | Authority |
| --- | --- | --- |
| `getOrderFinancials` | Order ID; returns funding, delivered allocations, unused prepayment and related event IDs | Read only, organization scoped |
| `listOpenObligations` | Organization, bounded page/cursor; returns payable/refund records with versions | Read only; exclude raw contributor media |
| `getReconciliation` | Payment command ID; returns expected facts versus observed transfers | Read only; no chain-status invention |
| `getPeriodReport` | Period ID; opening balances, activity, closing balances and unexplained differences | Deterministic ledger projection, not model arithmetic |
| `proposePayment` | Existing obligation IDs/versions and request ID | Server calculates recipient/amount/network from stored terms; returns proposal and policy findings |
| `requestIndependentApproval` | Proposal ID/version and explanation | Records a request to an authorized controller; cannot approve it |
| `requestReconciliation` | Existing unresolved attempt ID | Enqueues observation only; cannot build a new transfer |
| `prepareClose` | Period ID and immutable source versions | Reports blockers and draft close artifacts; no silent historical adjustments |

Do not expose signing or `approvePayment` as agent tools. The authenticated controller approves the exact proposal and signs using the planned wallet boundary. The payment executor consumes the approved command and stores the attempt before submission. Recipient, amount, mint, network or payable-version changes invalidate the prior approval.

## Reasoning loop and persistence

1. Parse the user's finance request into a supported intent. Ask for a specific order/period only when scope cannot be resolved from the current authorized view.
2. Fetch small, explicit financial snapshots using read tools. Provide event IDs and integer amount strings, not raw media, secrets or an unbounded journal dump.
3. Compute balances and policy findings deterministically. The model summarizes those outputs and identifies what evidence is missing.
4. For money-related requests, create a proposal against current obligation versions. The backend recomputes the amount and checks available funding, duplicate commands, recipient verification, limits and pending attempts inside the transaction.
5. Stop at approval-required/blocked status and explain the exact reason. A user's chat sentence cannot confer controller permission.
6. After external execution, retrieve reconciliation output. State `pending` or `unknown` when appropriate; never infer success from fluent prose or a timeout.
7. Persist run ID, model/configuration, tool name, argument digest, source versions, sanitized result summary and terminal outcome. Separate this operational audit from immutable accounting journals.

Use a finite step count, bounded tool result sizes, explicit timeouts and limited transient retries. Persist proposals and requests before yielding control; do not keep approval state solely in model conversation memory. A resumed run reads current records instead of repeating the previous payment instruction.

## Policy design for the demo

The initial policy requires an independent controller approval for every payout/refund. Add a proposal amount/batch limit, configured recipient allowlist, expiry and source-obligation version checks. The concrete limits and controller identities must be set before connecting a signer; none is hard-coded as an implied production policy.

A duplicate detection finding blocks automatic fulfillment pending review. Existing earned compensation survives cancellation. A transfer with an unresolved original attempt blocks replacement. A model may suggest investigating or adjusting an error, but corrections require an authorized linked reversal/adjustment; the original journal remains unchanged.

Store all cash/obligation arithmetic as exact micro-USDC. Display USDC and native SOL fees separately. Opening balances and prior-period activity are part of the report; the agent cannot assume a new period starts at zero.

## Demonstrating engineering quality

Create a synthetic answer-key dataset of finance cases independently from the model prompt. Include the full $100 lifecycle, prepayment incorrectly labeled revenue, duplicated payable/event, wrong recipient/mint, changed proposal after approval, requester self-approval, expired approval, over-refund, lost payout response, cancellation race and a prior-period reconciliation discrepancy.

Measure exact obligation and balance correctness, unauthorized tool attempts, policy-block correctness, reconciliation recovery and citations to the relevant business events. Count cases and failures. Compare a model answering from plain transaction text with the same model using deterministic projections and bounded tools. Preserve an untouched test subset; do not report a handpicked successful chat as an evaluation.

The demo's memorable output is a defended decision: "this narration conflicts with the video, so acceptance is held and no payable exists," or "this payout's response was lost, but its original signature is confirmed, so no replacement will be sent." The displayed statement must follow real persisted evidence, not a scripted claim.

## References

- [Hyphenate brief](https://docs.google.com/document/d/1u4iN8R97ILY3kfHTPKC82zdutHrGx4ze5eCAP-J92w4/edit)
- [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling)
- [Accounting model](accounting.md)
- [Solana payment boundaries](payments-solana.md)
- [Backend transactions](backend.md)
- [Identity and approval security](security.md)
