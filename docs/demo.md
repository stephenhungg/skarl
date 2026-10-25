# Demo Runbook

## The moment

A contributor says they completed the task. The video shows a missed step. Skarl points to the exact conflicting visual evidence, holds acceptance, and explains why no payable was created. A corrected demonstration is delivered; the finance agent prepares a bounded contributor payment and reconciles it on Solana.

This unifies the thesis: trustworthy evidence determines what work qualifies, and controlled finance determines what is owed and paid. Do not spend the pitch on a generic chatbot conversation.

## Three-minute target

| Time | On-screen proof |
| --- | --- |
| 0:00–0:20 | Buyer order, clear rubric, funded Devnet amount and actual observed signature. State the human-data customer. |
| 0:20–0:55 | Short narrated recording or clearly identified pre-recorded input. Show the independent visual and speech timeline. |
| 0:55–1:25 | Bad narration/omitted action receives grounded correction; genuine retake passes; transformed copied input is flagged if ready. |
| 1:25–2:15 | Actual accepted delivery produces revenue and contributor payable. Ask the finance agent to explain and propose the payout; show approval/policy. |
| 2:15–2:45 | Observed Solana transfer, balanced journal and cancellation/refund of unused work. Show remaining cash versus outstanding liabilities. |
| 2:45–3:00 | Measured evaluation summary, one limitation and the sponsor integrations actually used. |

Keep an already analysed consented clip available if inference takes longer than the slot. Clearly disclose replayed analysis. Keep a screen recording for network failure; do not present it as live settlement. The current repository cannot run this full demo yet.

## Required scenario set

- Correct performance and truthful narration: timestamped supported criteria.
- Missing action with confident narration: contradiction/correction rather than blind acceptance.
- Occlusion or no useful audio: unobservable/review rather than hallucinated evidence.
- Cropped/re-encoded duplicate versus a fresh valid retake: distinguish copying from semantic similarity.
- Repeated job completion and repeated funding event: one business effect and one journal event.
- Payout timeout: reconcile the old attempt before any new transfer.
- Cancellation racing acceptance: one budget allocation outcome and no negative customer prepayment.
- Wrong recipient/mint, over-limit payment or self-approved exception: blocked with an audit reason.
- Prior-period opening balance plus current-period transactions: explain the closing balance and outstanding obligations.

## Finance fixture

Use synthetic Devnet units only: buyer prepays 100 USDC for ten samples at 10 each. Deliver one sample, accrue 7.5 contributor cost/payable, confirm the 7.5 payout and refund the remaining 90. Final cash is 2.5 with no remaining demo liabilities; this is **before** inference, fees, hosting and gas. It is not net profit. See [accounting](accounting.md) for entries and the principal-model assumption.

## Evidence before submission

1. Record exact Git commit, deployment URL, task/rubric/pipeline version and whether each segment is live, replayed or simulated.
2. Attach test commands/results, labeled evaluation counts, error examples and actual model latency/cost observations.
3. Save Devnet explorer links for funding/payout/refund and a reconciliation view showing expected versus observed transfers.
4. Capture actual permission checks, independent approval, duplicate prevention and the judge's injected scenario.
5. Check [sponsor requirements](sponsor-tracks.md) and current event submission details on [Hive](https://hive.hackberkeley.org/prizes) / [Devpost](https://cal-hacks-13-0.devpost.com/). The researched deadline is October 25, 2026, 9:00 AM PDT; recheck organizer instructions before submission.
6. Ensure public repo/demo contains no private recordings, keys or user identity data. Submit only integrations that actually run; Coinbase MCP eligibility remains unresolved under the Solana requirement.

## Stop conditions

Missing consent blocks collection/delivery. Unavailable AI routes to review. Unconfirmed funding does not unlock budget. An unapproved or unreconciled payment is not executed again. If any core adapter is still unavailable at judging, explicitly demonstrate the boundary with labeled synthetic tests and state the limitation.
