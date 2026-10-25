# Every claim has a witness

**Skarl is the autonomous settlement desk for human-data companies. Independent witnesses must agree before anything moves: agents argue the case, deterministic code decides, and humans approve exceptions.** Every payout requires independent human approval.

Seats: **settlement accountant + AP clerk**. Did the work happen, is it a new obligation, and did payment settle?

## The witness table

**October 25, 2026, 04:40 PDT** — [04:40 evidence refresh](status.md#submission-evidence-refresh--october-25-2026-0440-pdt). **Live** = observed provider/testnet operation; **simulated** = local/mocked controls; **pending** = missing live proof. Deployment is not execution.

| Layer | Witness | Evidence status |
| --- | --- | --- |
| WORK | **Gemini Argon + Flash vision jury:** silent frames; disagreement goes to review. | **Live:** stored negative jury run; both found criteria unobservable. Accuracy unmeasured. |
| WORK | **Gemini Transcribe audio:** independently transcribe and compare narration. | **Live:** negative-smoke inference; task accuracy unmeasured. |
| WORK | **Trim-tolerant copy witness:** server hashes and monotonic frame alignment. | **Simulated:** re-encode/shifted-frame regressions; real trim recall and retake false positives unmeasured. |
| WORK | **EAS public receipt:** report/source/rubric commitment, without original media. | **Live:** 11 reports attested by cron; EASScan/RPC verified. All remain `needs_review`. |
| MONEY | **Contract = Convex order:** frozen terms, quota and price. | **Live:** funded orders; accept-eligible licensed work pending. |
| MONEY | **Ledger = Convex double-entry:** exact micro-USDC obligations and cash. | **Live:** funding journals/trial balance; payout lifecycle simulated. |
| MONEY | **Chain = x402 via CDP facilitator + CDP webhooks + Base/Solana RPC.** | **Live:** Base funding/signed webhook/reconciliation; Solana Devnet funding/RPC. Payouts Base-only and pending. |
| MONEY | **Bank = Capital One Nessie mock:** compare funding activity. | **Live mock API:** 10-USDC order/ledger/chain/bank match. No fiat movement or payout match. |
| JUDGMENT | **Deterministic judge:** rubric, consent, source and financial invariants. | **Live:** negative inference stays review-only; duplicate/payable refusals simulated. |
| JUDGMENT | **Claude + Gemini finance agents:** argue/explain; cannot approve. | **Both live:** stored read-only tool loops; neither proposed or paid in those runs. |
| JUDGMENT | **CDP Policy Engine; human controller in Coinbase Wallet.** | **Policy live:** actual cap/recipient `403`s. **Payout pending:** independent approval and signing still required. |
| NERVOUS SYSTEM | **Convex live queries, Workflow component, scheduler, crons, storage, Node actions, typed validators.** | **Live:** stored queries/uploads/scheduled inference/finance action/EAS cron. Workflow installed; wait/resume tested. Settlement/finance cron observations pending. |

Cartesia and physical iPhone IMU remain unverified. EAS proves recorded provenance, not correctness. Same-family models and shared infrastructure can fail together: separated checks are not statistical independence.

## The moment

**Duplicate caught → second payable blocked → agent self-approval refused → controller approves in Coinbase Wallet → chain + ledger agree.** Full live sequence: **pending**. Label simulations and funding receipts explicitly. Funding also matches the **mock bank**; payout agreement remains pending.

Target: fewer duplicate obligations and less reconciliation work. No measured savings or customer adoption claimed. Preserve private originals, evaluate consented clips, and replace impersonable demo identities before production. [Submission](devpost.md) · [Demo](demo-script.md) · [Judge scenarios](hyphenate-scenarios.md).
