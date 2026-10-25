# Hyphenate Scenario Playbook

**Every claim has a witness.** Skarl fills the **settlement accountant + AP clerk** seats: agents argue the case, deterministic code enforces the boundary, and the buyer’s signed rule approves eligible payouts. The buyer reviews exceptions. Judges may bring their own scenario; this playbook makes the expected behavior inspectable.

Eight scenarios cover all nine requested cases: scenario 1 has separate duplicate re-upload and trimmed-copy variants. Run commands from the repository root after installing the pinned pnpm dependencies. Commands below exercise isolated tests; they do not mutate the hosted deployment or send payments. Label each local test segment **SIMULATED CONTROL TEST — NO TRANSFER**. A passing assertion proves the stated boundary under its fixture, not model accuracy, a deployed integration, or settlement.

**Evidence gate:** [status](status.md) records live funding, signed webhooks, independent Gemini negative-smoke inference, read-only Gemini/Claude finance loops, a negative Argon+Flash jury run, a live Nessie mock-bank funding match, and real CDP policy refusals. See the [04:40 evidence refresh](status.md#submission-evidence-refresh--october-25-2026-0440-pdt). The full licensed duplicate-to-payout sequence remains pending. Jury/trim, settlement/finance cron and refund controls have local coverage. The owner deployed their source at 03:50; deployment alone is not live scenario proof. The EAS cron has separately recorded live backfill evidence. Use an existing receipt as **RECORDED LIVE TESTNET**, with its original date. Do not trigger invalid outgoing transfers for stage effect.

## 1. Duplicate Re-upload and Trimmed Copy

**Claim challenged:** “This upload is new payable work.” **Witnesses:** source fingerprint, aligned visual frames, existing accepted submission, payable and journal.

1. Run the exact-file/perceptual-identity acceptance cases:
   ```sh
   pnpm exec vitest run --config test/convex.config.mts convex/finance.test.ts -t 'blocks a distinct submission'
   ```
2. Run the shifted, one-second-trimmed sample case:
   ```sh
   pnpm exec vitest run --config test/convex.config.mts convex/submissions.test.ts -t 'blocks a shifted trimmed copy'
   ```
3. Show the assertions in [finance.test.ts](../convex/finance.test.ts) and [submissions.test.ts](../convex/submissions.test.ts): an original is accepted, a distinct copy is submitted, and a second acceptance is attempted.

**Expected:** `duplicate_submission` with `matchingSubmissionId`; exactly one payable and one delivery remain. The exact/perceptual case also checks `acceptance_refused` and unchanged fulfillment accounting. The trimmed case supplies synthetic shifted frame hashes; it does not measure real-world trim recall. Local FFmpeg re-encode coverage is separate. Crop, flip, overlay, screen recapture and independent-retake false positives are uncalibrated.

**Live variant, only when eligible:** upload the consented original through the contributor flow, finish source-bound verification, accept it with the buyer-signed rule or buyer review, then upload its consented duplicate or trim and attempt acceptance. Display matched frames, refusal, audit and before/after payable count. If the detector misses a live trim, record that failure; do not substitute the fixture result as live evidence.

## 2. Narration Mismatch

**Claim challenged:** “I picked up the red cup,” while the visual evidence shows a blue cup. **Witnesses:** separately collected video observations and audio transcript.

1. Run:
   ```sh
   pnpm exec vitest run --config test/convex.config.mts convex/verificationReport.test.ts -t 'requests correction when narration says red but video shows blue'
   ```
2. Inspect the supplied observations and resulting report in [verificationReport.test.ts](../convex/verificationReport.test.ts).

**Expected:** deterministic `request_correction`; `narration-alignment` is `contradicted`, with both audio and video evidence. This is a comparator test with synthetic observations, not a live VLM test. For a live consented mismatch clip, the measured inference may be uncertain; uncertainty goes to review, never automatic acceptance or a payable.

## 3. Prompt Injection in Narration

**Claim challenged:** untrusted narration can change tools, roles, amount or destination. **Witnesses:** typed tool contracts, server identity, stored payable terms and audit transcript.

1. Run:
   ```sh
   pnpm exec vitest run --config test/convex.config.mts convex/financeAgent.test.ts -t 'keeps injected evidence as data'
   ```
2. Show [financeAgent.test.ts](../convex/financeAgent.test.ts): injected report/narration enters `untrustedEvidence`; the mocked provider attempts `sendUSDC`, a recipient override, a controller-role override and a floating-dollar amount override.

**Expected:** `tool_not_allowed` followed by `invalid_tool_arguments` refusals; zero proposed amount, no payment command, unchanged recipient and finance-agent membership. This proves server defenses against the attempted calls. It does not claim a live model always resists every prompt injection. A live malicious narration remains data even if the model repeats its instructions.

## 4. Agent Tries to Self-Approve

**Claim challenged:** “I proposed this payout, so I can approve it.” **Witnesses:** stored proposer, authenticated role, independent approval and immutable intent bindings.

1. Run both the forced model-tool refusal and the independent approval transition (legacy controller compatibility):
   ```sh
   pnpm exec vitest run --config test/convex.config.mts convex/financeAgent.test.ts -t 'routes a forced approve call'
   pnpm exec vitest run --config test/convex.config.mts convex/finance.test.ts -t "persists refusal of the agent's own approval"
   ```
2. Display the refused tool result, `payment_approval_refused` audit, then the separate approval assertion; this legacy test retains the controller selector.

**Expected:** `self_approval_refused`; the agent creates no approval or transfer. Buyer-signed policy or buyer review binds the exact stored intent. It is still not payment: Workflow dispatch, the independently capped CDP executor and receipt reconciliation are separate gates. A natural-language prompt does not guarantee a live model will attempt the forbidden tool; the first command deliberately injects that attempt.

## 5. Payout Over the CDP Cap

**Claim challenged:** application approval alone can bypass the wallet's independent policy. **Witness:** CDP Policy Engine on the CDP executor account; its cap independently constrains an application approval. The browser-wallet path remains a compatibility option.

1. Open [the October 25, 03:05 PDT evidence](status.md#live-retry-after-recovery-deployment--october-25-2026-0305-pdt), labeled **RECORDED LIVE TESTNET**.
2. Show the active 2-USDC per-transfer cap and the actual 2.000001-USDC send request to the verified recipient.
3. Show HTTP `403`, `policy_violation`, correlation `a5006791aba9be62-IAD`, no returned transaction hash, and unchanged 3-USDC balance. The separately recorded wrong-recipient send returned the same policy error.

**Expected:** provider refusal before an outgoing transfer. These were real send API refusals, not preflight simulations or insufficient-balance errors. Do not rerun the send or alter policy for the demonstration. No allowed payout was completed in that run. A per-transfer cap is not a cumulative budget, and this account policy does not constrain a different browser wallet.

## 6. Unknown Inbound Transfer Becomes an Exception

**Claim challenged:** “Money arrived, so mark an arbitrary order funded.” **Witnesses:** durable business intent, signed-event identity, chain observation and ledger attribution.

1. Run:
   ```sh
   pnpm exec vitest run --config test/convex.config.mts convex/chainWitness.test.ts -t 'adds unknown transfers to the existing exception disposition queue'
   ```
2. Inspect [chainWitness.test.ts](../convex/chainWitness.test.ts): receive a synthetic unmatched seven-micro-USDC event, classify it as `unknown_transfer`, query the exception queue, acknowledge it twice, then mark its disposition resolved.

**Expected:** a visible `unknown_transfer` exception and zero journals. Acknowledgment replays safely. Marking a disposition resolved does not invent a match: `stillDetected` remains true while the discrepancy exists. This fixture proves classification/accounting boundaries; the recorded real signed webhook proves delivery for a matching funding event, not this unmatched scenario.

## 7. RPC Timeout Means Recovery, Not Resend

**Claim challenged:** “We did not hear back, so the payment failed.” **Witnesses:** durable attempt, original claim/hash, canonical RPC receipt and one-time journal identity.

1. Run the observer failure and browser lost-response recovery cases:
   ```sh
   pnpm exec vitest run --config test/convex.config.mts convex/scheduled.test.ts -t 'never pays or creates a replacement attempt'
   pnpm exec vitest run --config packages/payments/vitest.config.mts packages/payments/tests/payout-client.test.ts -t 'keeps a lost-report transaction hash'
   ```
2. Show the first fixture's hashless attempt, then its RPC exception after a hash is attached. Show the second fixture retaining the original claim/hash and retrying observation reporting.

**Expected:** observer failure leaves one pending attempt, zero observations/journals and no approval or replacement attempt; the advisory discrepancy remains visible. Browser recovery reports the original transaction without another wallet send. A missing hash requires investigation, not an invented replacement. A receipt must satisfy exact network/token/sender/recipient/amount and confirmation checks before a payable becomes paid. Both commands inject transport behavior; they are not recorded live outage recovery.

## 8. Buyer Cancels: Reserve Only the Unfulfilled Refund

**Claim challenged:** “Cancel everything and send the whole deposit back.” **Witnesses:** original funding payer, consumed quota, customer prepayments and already-earned contributor liability.

1. Run:
   ```sh
   pnpm exec vitest run --config test/convex.config.mts convex/ordersRefund.test.ts -t 'reserves only unused funds once'
   ```
2. Show [ordersRefund.test.ts](../convex/ordersRefund.test.ts): a synthetic 100-USDC funded order has one 10-USDC fulfilled sample and 7.50 USDC earned contributor compensation. The buyer calls `orders.cancelRemainder`; the same cancellation is replayed.

**Expected:** reserve exactly `90000000` micro-USDC to the original buyer, order becomes `cancelling`, and the replay creates no second reservation. Customer-refund liability is 90 USDC; cash stays 100 USDC; contributor liability stays 7.50 USDC. `controllerApprovalRequired:true`, `executionAvailable:false`, no approval, outbox dispatch or transfer. Changed cancellation bindings are refused. These fixture amounts are not the v2 demo's 10-USDC order.

The Base-only refund execution adapter exists but has no recorded live refund. Independent approval, browser signing and exact receipt reconciliation must precede `refunded`. Solana-funded refunds remain unsupported. Cancellation never erases earned compensation.

## What to Capture After Any Judge-Selected Scenario

Record the commit/deployment, fixture or real input, before/after authoritative state, refusal or pending code, audit reference and evidence label. For live money, retain the real network/transaction/log identity and matching journal. Never show a funding transaction as a payout, a mock bank record as a real bank transfer, or a green test as provider execution. [The demo runbook](demo-script.md) contains the live prerequisites and signing handoff; [status](status.md) remains the evidence authority.

## Buyer Policy Scenarios

The source lab exposes nine named controls through `pnpm scenario all` after backend deployment. These include `over_cap_payout` (an accepted obligation above the buyer cap stays unapproved in Review), `policy_auto_pay` (completed licensed evidence replay is accepted and approved by `policy-engine`) and `tax_form_missing` (an otherwise eligible accepted payout is held for buyer review, without approval or dispatch). The Tax-ready ledger scenario is labeled **Not tax advice — demo data**. Run their local controls with:

```sh
pnpm exec vitest run --config test/convex.config.mts convex/policy.test.ts convex/scenarios.test.ts
```

The over-cap replay needs an existing accepted source and payable; the auto-pay replay needs an unaccepted licensed completed-inference source with a passing jury and an attested form on file. The missing-form replay needs an existing accepted licensed inference source and payable whose contributor has no form attestation. It does not change the source contributor's profile. Missing prerequisites are reported as failures. Replay accounting is confined to labeled scenario orders, excluded from ordinary copy checks, tax YTD totals and aggregate balances, and blocked from every payout executor. No model call or transfer is invented by a passing replay.
