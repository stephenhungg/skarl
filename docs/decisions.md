# Engineering Decisions

Status as of October 25, 2026 (post-audit). These are design decisions, not claims of completed integrations.

| Decision | Status | Reason / revisit trigger |
| --- | --- | --- |
| Build one live demo path in 8 hours | Required | The deadline is Oct 25, 9:00 AM PDT. Everything not on the [workstreams](workstreams.md) path is deferred design. |
| Base Sepolia USDC only (`eip155:84532`) | Chosen (pivot from Solana) | Targets Coinbase Best Use of x402 ($500 USDC + recruiter call per member) over MLH Solana (swag). Mainnet needs a separate launch decision. |
| No custom smart contract | Chosen | Controller-approved USDC transfers plus durable application accounting satisfy the demo. Revisit only for a real enforceable escrow requirement. |
| Coinbase Wallet MCP for agent payments | Chosen | Supports Base Sepolia x402 and `send`; every write needs approval in Coinbase Wallet, which matches the independent-controller rule. The Coinbase retail MCP (Base mainnet, 5 USDC cap) is optional. |
| Platform-held refundable prepayment | Demo assumption | Do not call it noncustodial escrow. Real custody and customer terms need review before launch. |
| Skarl acts as principal for dataset sales | Explicit accounting assumption | Recognize gross revenue on actual licensed delivery, contributor acquisition cost separately. A pure brokerage business needs a different net model. |
| Convex is authoritative | Chosen | Transactions, storage, reactive views and Workflow for the approval wait; avoid dual writes into a second database. |
| Gemini via a Convex action, two calls | Chosen | A silent-video call and a separate audio call keep the evidence independent without deploying a second service. The model ID is configurable. |
| SHA-256 + sampled-frame perceptual hash for duplicates | Chosen for the demo | Catches the staged re-encoded copy. SSCD temporal checks are deferred (they need labeled calibration data). |
| Seeded demo identities, server-checked roles | Chosen | Auth0 has no prize at Cal Hacks 13.0 and costs setup time. Label the identities as demo. |
| Python worker on Railway, HMAC gateway, leasing, faster-whisper | Deferred | Revisit when media processing outgrows a Convex action. |
| Refunds, period close, eval split protocol | Deferred | Refunds only if funding and payout both work by hour 6. There is no labeled data for an eval split. |
| No model fine-tuning | Deferred | Build labels and evaluate before choosing a learned head. |
| Finance agent has typed bounded tools | Required | The model can propose and explain; authorization, policy, approvals and signing stay outside it. |
| x402 funding is short and asynchronous | Required | Never wait for video analysis inside a paid route; grant work only after settlement observation. |
| pnpm, not Bun | Deliberate exception | The repo is already pinned to pnpm 10.19.0; switching mid-event costs time. |
| Public repository license | Unselected | Public visibility does not grant an open-source license. |

## Open questions that affect live implementation

- What exact license/consent text is acceptable to both buyer and contributor? Define withdrawal/deletion and already delivered data behavior before actual collection.
- Is every team member eligible for the Coinbase prize (18+, US/Canada resident excluding Quebec, verified Coinbase account)? See the [checklist](sponsor-tracks.md#team-eligibility-checklist).
- What are the exact maximum payout, batch threshold, approver identities and posting/finality policy? Document a demo policy before enabling a signer.
- Who owns each hosted account and secret? The scaffold creates no deployments or credentials.
- What measured quality, false-positive tolerance and latency does the buyer require? Freeze thresholds on training/validation sessions and reserve held-out sessions for reporting.

Routine folder and implementation choices can proceed without waiting on these. Real contributor collection, live signing and claims of sponsor eligibility depend on resolving their respective questions.


## Verify on-chain

**Chosen: EAS report commitments on Base Sepolia; still no custom contract.**
Use the existing EAS predeploy `0x4200000000000000000000000000000000000021` and
SchemaRegistry `0x4200000000000000000000000000000000000020`, confirmed in the
[official deployment list](https://docs.attest.org/docs/quick--start/contracts).
EAS documents a [Spearbit audit of its contracts](https://docs.attest.org/docs/quick--start/faqs).
Skarl registers one revocable schema with the zero resolver; it deploys no
Solidity, escrow or resolver contract.

Attestations commit to canonical report/source/rubric hashes and bounded metadata,
including the existing recommendation and license flag. Failed reports remain
eligible records and verification-only uploads remain unlicensed for delivery.
A separate CDP account with an account-scoped EAS-only policy signs these records;
it is not a treasury or payout signer. Convex retains durable per-analysis intent,
retry and reconciliation state. The asynchronous sweep cannot accept work or
create payment authority, and its failure cannot block verification. See
[build status](status.md) for observed rollout and chain evidence.
