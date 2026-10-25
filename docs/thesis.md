# Every claim has a witness

**Skarl is the autonomous settlement desk for human-data companies. Independent witnesses must agree before anything moves: agents argue the case, deterministic code decides, and humans approve exceptions.** Today, every payout also requires independent human approval; “autonomous” describes bounded inspection, proposals and recovery, not unrestricted spending.

A company buying narrated demonstrations needs to know three things: did the work happen, is this a new obligation, and did the money settle? A fluent explanation cannot answer all three. Skarl fills two seats—**settlement accountant + AP clerk**—by making each claim answerable to evidence outside the agent's own explanation.

## The witness table

Evidence snapshot: **October 25, 2026, 03:53 PDT**, from the dated [build status](status.md). **Live** means observed provider/testnet behavior; **simulated** means local or mocked control tests; **pending** means live proof is missing. Deployment alone does not establish an end-to-end result.

| Layer | Witness and responsibility | Evidence status |
| --- | --- | --- |
| WORK | **Gemini Argon + Flash vision jury:** inspect silent timestamped frames; disagreement routes to review. | **Simulated / pending:** jury implemented and tested; live historical Flash inference and separate Argon probes do not prove a live jury. |
| WORK | **Gemini Transcribe audio:** independently transcribe speech, then compare it with observed actions. | **Live:** separate audio inference on negative smoke clips; task accuracy unmeasured. |
| WORK | **Trim-tolerant copy witness:** server hashes and monotonic frame alignment flag likely reuse before another payable. | **Simulated / pending:** local FFmpeg re-encode and shifted-frame regressions; real trim recall and independent-retake false positives unmeasured. |
| WORK | **EAS public receipt:** commit the report and source/rubric hashes without exposing original media. | **Live:** all 11 finalized reports attested by the two-minute cron; EASScan/RPC verified. All remain `needs_review`; provenance is not acceptance. |
| MONEY | **Contract = Convex order:** frozen rubric, budget, quota, license and rate establish what is owed. | **Live:** funded order records; a licensed accepted contribution remains pending. |
| MONEY | **Ledger = Convex double-entry:** exact micro-USDC journals and balanced statements establish recorded obligations and cash. | **Live:** funding journals and trial balance; payout lifecycle tests are simulated. |
| MONEY | **Chain = x402 via CDP facilitator + signed CDP webhooks + Base/Solana RPC:** verify actual transfers independently of an HTTP response. | **Live:** Base funding/webhook/reconciliation and Solana Devnet funding/RPC. No Solana webhook or payout claim; payouts are Base-only. |
| JUDGMENT | **Deterministic judge:** enforce rubric, source, consent, duplicate and financial invariants. | **Live:** negative inference stays review-only; duplicate/payable boundaries have simulated regression proof. |
| JUDGMENT | **Claude + Gemini finance agents:** argue and explain; cannot approve. | **Gemini live:** read-only trial-balance tool loop. **Claude pending:** no runtime finance-agent evidence in status. |
| JUDGMENT | **CDP Policy Engine; human controller in Coinbase Wallet:** enforce wallet limits and independent approval/signing. | **Policy live:** actual over-cap/recipient `403 policy_violation` responses. **Payout pending:** no completed controller-signed contributor payment. |
| NERVOUS SYSTEM | **Convex live queries, Workflow component, scheduler, crons, file storage, Node actions, typed validators:** persist evidence, coordinate waits and expose state. | **Live:** stored queries, uploads, scheduled inference and finance action. Workflow installed, wait/resume tested with its component adapter. Attestation cron/backfill live; settlement/finance cron observations and full approval-to-settlement flow pending. |

Cartesia, physical iPhone IMU capture and Nessie bank observations have no live evidence at this snapshot and are excluded as working witnesses. EAS hashes prove what was recorded, not that a model was correct. Same-family models and shared infrastructure can fail together; “independent” means separated inputs and checks, not statistical independence.

## The moment

**Duplicate caught → second payable blocked → agent self-approval refused → controller approves in Coinbase Wallet → chain + ledger agree.** Add a bank comparison only after live Nessie evidence exists, always labeled a mock bank. The complete moment is currently **pending**; show tested controls as simulated and existing funding receipts as funding. Never substitute funding for payout evidence.

The adoption test is fewer duplicate obligations and less reconciliation work without unauthorized payments. No customer interviews, time savings or production accuracy are claimed. Start with consented red-cup demonstrations, preserve private originals, measure false acceptance, and replace impersonable demo identities before real use. [Submission](devpost.md) · [Demo](demo-script.md) · [Judge scenarios](hyphenate-scenarios.md).
