# Accounting and settlement model

Skarl's prototype models a company selling verified, licensed human demonstration samples. The AI recommends acceptance and prepares financial work. Humans retain exception review and money-movement approval. This document defines the demo's business assumptions; it is not a claim of production accounting or regulatory compliance.

## Principal model and fulfillment trigger

The following legacy v1 illustration uses 100 USDC; the default v2 demo uses
10 USDC for four samples at 2.50 each with a 1.875 contributor rate. See the
[demo runbook](demo.md#finance-fixture) for current amounts.

For the demonstration, assume skarl is principal: it promises a verified sample to the buyer, controls acceptance and delivery before licensing it, sets the buyer price, and purchases contributor work at an agreed rate. A $10 fulfilled sample is $10 gross dataset revenue and $7.50 contributor acquisition cost. Gross margin is $2.50 **before inference, network fees, tax, and other operating costs**.

If the business merely arranges a contributor-to-buyer sale, an agent/net-fee revenue model may be appropriate instead. These presentations cannot be mixed. The IFRS Foundation's principal/agent framework turns on control of the specified good/service before transfer, not whether a payment used crypto. [Principal versus agent considerations](https://www.ifrs.org/news-and-events/updates/ifric/2021/ifric-update-november-2021/)

A raw upload, AI pass, or pending review is not automatically revenue. The simplified fulfillment event is: **an authorized acceptance decision exists, and the sample plus license manifest is available to the buyer**. If acceptance and delivery become separate business events, split their accounting transitions rather than calling the combined helper early.

## Exact $100 walkthrough

The buyer prepays $100 for ten accepted samples priced at $10 each. The contributor rate is $7.50 per accepted sample. One sample is fulfilled, the contributor is paid, and the buyer cancels the nine remaining samples.

| Event | Debit | Credit |
| --- | --- | --- |
| Buyer funding confirmed | USDC cash $100 | Customer prepayments $100 |
| One sample accepted and delivered | Customer prepayments $10 | Dataset sales revenue $10 |
| Contributor earns compensation | Contributor acquisition expense $7.50 | Contributor payables $7.50 |
| Contributor payout confirmed | Contributor payables $7.50 | USDC cash $7.50 |
| Remaining order canceled and refund approved | Customer prepayments $90 | Customer refunds payable $90 |
| Buyer refund confirmed | Customer refunds payable $90 | USDC cash $90 |

Final state: USDC cash $2.50; dataset revenue $10; contributor expense $7.50; customer prepayments, contributor payables, and refund payables all zero. Customer money received is not synonymous with earned revenue. Contributor payables and customer refunds remain liabilities until their transfers settle.

The helpers in `packages/ledger` implement these postings using integer micro-USDC. They provide deterministic replay and meaningful unit checks, not a wallet or a database transaction engine.

## Storage and accounting invariants

Use Convex as the authoritative ledger and workflow store. Each mutation that changes financial state must atomically write its business-event claim, journal transaction, all balanced journal lines, associated order/payable changes, and audit event. Scheduling follow-up work from that mutation is atomic with the write. A separate dashboard mirror is not a substitute for this boundary. [Convex atomicity](https://docs.convex.dev/database/advanced/occ), [transactional scheduling](https://docs.convex.dev/scheduling/scheduled-functions)

Core invariants:

1. Every journal's debits equal credits in one currency and integer precision.
2. Every event ID posts at most once; reusing it with different data is a conflict.
3. Each accepted submission/version creates at most one earned payable and one fulfillment allocation. A new event ID must not circumvent the submission business key.
4. One identified chain transfer is allocated once. Multiple HTTP success responses do not represent multiple payments.
5. Remaining customer obligation and contributor/refund payable balances cannot become negative.
6. An acceptance consumes one remaining order unit and its agreed price atomically.
7. Cancellations reserve only unfulfilled value. They cannot erase already earned contributor compensation.
8. A payable is discharged only by its approved, confirmed transfer or an authorized accounting correction.
9. Approval binds the exact recipient, token address, amount, chain ID, obligation reference, and proposal version.
10. The agent requesting a payment cannot approve it or hold the controller's signing authority.

Store money in `bigint` micro-units with `v.int64()` validators. Convert to decimal strings at ordinary JSON boundaries. Do not round input or calculate monetary totals using JavaScript floating-point dollars. [Convex data types](https://docs.convex.dev/database/types)

## Concurrency and external effects

Acceptance and cancellation must read and update the same order within their respective single mutations. Convex's optimistic concurrency retry then re-evaluates capacity against current state. Never read capacity in one request and spend it unconditionally in another. Check event uniqueness with an indexed lookup inside the mutation; an index declaration alone does not enforce a SQL-style unique constraint.

External model, RPC, and payment calls run in actions or the application server, outside the financial mutation. Scheduled actions can have side effects and are not automatically retried; persist execution state and reconcile before scheduling another attempt. Scheduled mutations have different execution guarantees. [Convex actions](https://docs.convex.dev/functions/actions)

Important races to exercise:

| Race or failure | Required result |
| --- | --- |
| Two callbacks claim the same accepted clip | One fulfillment and one payable |
| Acceptance races cancellation | The same unit is fulfilled or refunded, never both |
| Buyer payment settles, then server crashes | Reconciler records one prepayment and activates one order |
| Payout response is lost | Retain and inspect the original tx hash; no fresh payout |
| Recipient changes after approval | Prior proposal is invalidated |
| Model result changes on rerun | Preserve prior run; require a new decision version and explicit correction |
| Prior period is closed (period close deferred) | Preserve the original journal; record an authorized later-period adjustment |

## Corrections and audit evidence

Never rewrite a posted journal to make the current dashboard appear correct. Append a reversal or adjustment with a reason and reference to the original event. Reverse dependent obligations in the appropriate order; a reversal that would make an order's protected balance negative must be escalated, not forced through.

Each financial event should retain:

- Order, original rubric/rate/license version, buyer, contributor, and submission references.
- Model and verifier version, output evidence timestamps, uncertainty, and human review decision.
- Requesting actor, approving actor, proposal version, exact approved transfer details, and approval time.
- Chain ID, token address, tx hash, log index, block number, confirmation status, and the identified `Transfer`.
- Journal lines, business-event ID, original event for corrections, and reconciliation outcome.

Raw clips, personal data, and consent documents remain access-controlled offchain. A content hash supports integrity matching; it does not prove ownership, truthful consent, originality, or fitness for training. The payment record proves a transfer, not that a clip satisfies its acceptance rubric.

## Verification boundary

`packages/ledger/src/index.test.ts` checks exact amount parsing, balanced postings, the complete $100 lifecycle, event retries/conflicts, over-refunds, cross-order/contributor leakage, and append-only reversals. These are pure unit checks. They do not prove authentication, concurrent Convex behavior, correct AI acceptance, a working x402 integration, or successful Base settlement. Each of those requires its own integration evidence.

## Implemented journal-derived statements

`statements.forOrder({demoIdentity:"controller",orderId})` returns a reactive
finance-only projection for an order. `finance-agent` may also query it. All
monetary values are decimal integer micro-USDC strings, including signed net
amounts; no float-dollar conversion occurs.

The response contains `trialBalance` (account debit, credit and net debit,
total debits/credits, and an asserted balanced flag), `cashAtomic`,
`deferredRevenueAtomic`, `revenueAtomic`, `contributorExpenseAtomic`,
`netIncomeAtomic`, and sorted `payablesByContributor` rows with contributor token
identifier and `amountAtomic`. Cash is the USDC account's debit-minus-credit;
liabilities/revenue are credit-minus-debit; net income is revenue less contributor
expense under the demo's principal model. Paid contributors may remain with zero
liability. Gas, inference expense, taxes and other unposted costs are not inferred.

This projection reads posted journal entries and lines, not wallet balances or
estimated payable totals. Each entry must balance independently; offsetting
corrupt entries cannot make a valid trial balance. Entry/line tenant and source
bindings are checked, and contributor-payable lines require contributor
attribution. A broken invariant raises an error rather than displaying a false
balanced statement. The finance agent's `getTrialBalance` tool reads this same
query. No statement query posts, adjusts or reverses a journal.
