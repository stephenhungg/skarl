# Demo Runbook

## The moment

A contributor uploads a re-encoded copy of an already accepted red-cup clip. Skarl matches its SHA-256/sampled-frame perceptual hash to the accepted original, **blocks the second payable** and shows the buyer both clips' evidence in Review. The finance agent then proposes the legitimate payout, but its request to approve its own proposal is refused. The buyer-signed policy approves the legitimate payout within its cap. The CDP executor applies its independent wallet cap, and the USDC transfer is reconciled by network, tx hash and log index.

This is a finance catch that the AI evidence makes possible: verified evidence determines what is owed, and controls determine what is paid. Do not spend the pitch on a generic chatbot conversation.

## Three-minute target

| Time | On-screen proof |
| --- | --- |
| 0:00–0:30 | **The moment:** the duplicate arrives, the second payable is blocked with its audit reason, and the agent's self-approval is refused. |
| 0:30–1:00 | Buyer order, signed auto-pay rule, rubric, and the buyer agent paying the x402 funding endpoint through Coinbase Wallet MCP; the observed Base Sepolia tx. |
| 1:00–1:40 | The red-cup recording and the two independent Gemini timelines (silent video, audio), with timestamped criteria. The narration-mismatch clip goes to review. |
| 1:40–2:30 | Acceptance creates the payable and journal. The agent explains it and proposes the payout; the deterministic policy approves within the buyer’s cap, then the CDP executor sends. |
| 2:30–3:00 | The observed payout tx on BaseScan, balanced journal, real-vs-simulated inventory and one limitation. |

Keep an already analysed consented clip ready in case inference is slower than the slot, and disclose the replay. Keep the fallback screen recording for network failure; do not present it as live settlement.

## Buyer-signed auto-pay

The agent proposes; the buyer-signed policy (or the buyer in review) approves; an independent CDP cap guards execution. The AI never approves itself. The buyer sets the rule when creating/funding the order: on by default, capped at the order’s per-clip price, and requiring every check. The buyer can change or disable it. The internal `policy-engine` accepts eligible clips and approves bound payout intents; the finance agent still proposes. Failed evidence, disabled policy, an over-cap amount or an unverified wallet goes to the buyer’s Review queue with exact reasons. The buyer can approve or reject exceptions. A CDP wallet cap is a second, independent guard.

Set `PAYOUT_EXECUTOR=cdp_agent` in Convex through the operator workflow before demonstrating automatic execution. Deployment, policy configuration and a live all-checks-pass payout must be verified separately; local tests are not a transfer.

## Staged clips

- **Valid:** correct action with truthful narration produces timestamped supported criteria.
- **Duplicate re-encode:** a cropped/re-encoded copy of the valid clip is flagged by hash, and no second payable is created.
- **Narration mismatch:** the narration claims done, but the action is missing, so it goes to review instead of acceptance.

Injected finance checks to have ready: a repeated funding event (one journal entry), a self-approval attempt (blocked), and a payout timeout (reconcile the original tx hash before any new transfer). Run `over_cap_payout` to show buyer review without approval and `policy_auto_pay` to show simulated acceptance/approval under `policy-engine`, with the audit trail. These are labeled replay control tests, not inference or chain sends: over-cap needs an accepted licensed inference clip/payable; auto-pay needs a separate unaccepted licensed completed-inference clip with an all-agree jury.

## Finance fixture

Use Base Sepolia test USDC only. Default order `skarl-red-cup-demo-v2` prepays 10 USDC for four samples at 2.50 each (`4n * 2_500_000n` micro-USDC). Run `pnpm agent:fund` or explicitly `pnpm agent:fund skarl-red-cup-demo-v2`. The buyer needs USDC only; the exact/EIP-3009 facilitator pays gas. Configure the treasury receiving address as `SKARL_TREASURY_ADDRESS` on the web server first; missing configuration blocks funding with an actionable error. Deliver one sample, accrue the 1.875 contributor cost/payable and confirm the 1.875 payout. The remaining 7.50 stays a buyer prepayment liability; refunding it is deferred unless time allows (cash would then be 0.625 with no remaining demo liabilities); this is **before** inference, fees, hosting and gas. It is not net profit. The original 100 USDC `skarl-red-cup-demo-v1` remains unchanged for compatibility. See [accounting](accounting.md) for the legacy illustrative entries and the principal-model assumption.

## Evidence before submission

1. Record exact Git commit, deployment URL, task/rubric/pipeline version and whether each segment is live, replayed or simulated.
2. Attach test commands/results, the staged-clip outcomes and actual model latency observations. These are demo cases, not a benchmark.
3. Save Base Sepolia explorer links for funding and payout and a reconciliation view showing expected versus observed transfers.
4. Capture actual permission checks, the buyer’s policy audit, over-cap refusal, duplicate prevention and the judge's injected scenario.
5. Check [sponsor requirements](sponsor-tracks.md) and [Devpost](https://cal-hacks-13-0.devpost.com/) (authoritative). The deadline is October 25, 2026, 9:00 AM PDT, and teams must be at the venue by 8:00 AM.
6. Ensure public repo/demo contains no private recordings, keys or user identity data. Submit only integrations that actually run. Auth0 and MLH Solana are not targeted; the Coinbase eligibility checklist must be complete before submitting to that track.

## Stop conditions

Missing consent blocks collection/delivery. Unavailable AI routes to review. Unconfirmed funding does not unlock budget. An unapproved or unreconciled payment is not executed again. If any core adapter is still unavailable at judging, explicitly demonstrate the boundary with labeled synthetic tests and state the limitation.
