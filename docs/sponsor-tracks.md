# Sponsor track strategy and evidence

Skarl is a Kled-inspired human demonstration marketplace with multimodal acceptance checks and an autonomous finance workflow. Optimize the same product for relevant tracks. Do not add unrelated transactions or infrastructure solely to show another sponsor name.

Current scope is **Solana Devnet only**. Payments are a planned integration; the payment package explicitly reports that no runtime adapter is implemented. Repository documentation and fixture tests are not evidence of a working sponsor integration. Check current event rules and eligibility before submitting.

## Primary: Hyphenate — Autonomous Systems for Finance

Financial seats: settlement accountant and accounts-payable clerk. The independent human controller approves money movement. The company is skarl itself, selling verified data and buying contributor work.

The official brief judges realism, whether the system could be hired, novelty, and a memorable catch/recovery/defended decision. It requires code, a video opening with that moment, a working live demo, seats filled, and evidence distinguishing real from simulated work. Judges may introduce a scenario. [Official Hyphenate brief](https://docs.google.com/document/d/1u4iN8R97ILY3kfHTPKC82zdutHrGx4ze5eCAP-J92w4/edit)

Evidence to build:

- One accepted clip, one duplicate requiring review, and one speech/action mismatch.
- The duplicate's changed filename/hash does not generate a second payable after adjudication.
- Buyer prepayments remain liabilities until fulfillment; earned contributor payables survive cancellation.
- Correct payout, partial-order refund, and reconciled double-entry books.
- Independent approval, rejected/stale approval handling, and traceable decisions.
- A lost-response/replayed-event scenario that recovers without duplicate money movement.
- A planted-error answer key, held-out AI evaluation, and actual test results. Do not present hand-selected clips as a benchmark.

The multimodal model supplies grounded evidence for a financial decision. The complete payable/refund/accounting outcome must work; a clip classifier with a simulated balance widget is insufficient evidence for this track.

## Solana / MLH: meaningful chain usage

The intended flow uses x402 v2 `exact` with the SVM adapter, Solana Devnet USDC funding, a supported Solana wallet, confirmed contributor payouts, and confirmed buyer refunds. Use Wallet Standard-compatible interfaces and the official Solana SDK ecosystem. A custom Solana program is not currently implemented and must not appear in the architecture as a completed escrow contract. [Solana payment integration](https://solana.com/docs/payments/accept-payments), [x402 SVM implementation](https://github.com/x402-foundation/x402/tree/main/typescript/packages/mechanisms/svm)

Submission evidence should include the deployed endpoint, cluster/mint configuration, real Devnet transaction signatures, verified token movements, error handling, and a reproducible setup. Explain which wallet signs each operation. Label test tokens and any seed history. Confirm the event's specific Solana/MLH judging and eligibility requirements rather than assuming a transfer automatically qualifies.

## Convex: the authoritative application backend

Use Convex for orders, rubric versions, submission evidence, acceptance decisions, contributor earnings, approvals, journals, payment attempts, and live order/controller views. Every financial transition should execute in a bounded mutation that preserves invariants. Schedule outside work from persistent state and reconcile uncertain outcomes.

Evidence should show live state propagation between buyer, contributor, and controller; a duplicate event being rejected/idempotently reused; and atomic update of acceptance, payable, journal, and audit history. This is substantial backend usage. Keeping the financial source of truth elsewhere while mirroring it into Convex solely for a dashboard would weaken the integration. [Convex mutations](https://docs.convex.dev/functions/mutation-functions), [Convex scheduled functions](https://docs.convex.dev/scheduling/scheduled-functions)

## Conditional: Coinbase Payment Agents

Target the payment-agent category if eligible; skarl has no trading feature. The event brief must be checked directly for required product usage, member eligibility, and submission evidence. [Official Coinbase track brief](https://drive.google.com/file/d/12TnPLguduV3gh1zY_TJ176XmVDz2RGW9/view)

A technical distinction affects eligibility:

| Integration | Current documented behavior | Fit with this Solana-only prototype |
| --- | --- | --- |
| CDP facilitator / x402 SVM SDK | Solana mainnet and Devnet are supported in the facilitator's documented matrix | Technically relevant planned payment infrastructure; not proof of Coinbase MCP usage |
| Coinbase retail MCP | Account-funded x402 fetch uses curated catalog resources on Base; payment cap is 5 USDC | Does not establish a route for the Solana funding flow |
| Coinbase Wallet MCP | Its x402 calls support Base/Base Sepolia, with wallet approval | Not a Solana x402 buyer adapter |

Sources: [CDP facilitator](https://docs.cdp.coinbase.com/x402/seller/facilitator), [Coinbase MCP](https://docs.cdp.coinbase.com/ai-agents/coinbase-for-agents/coinbase-mcp), [Wallet MCP](https://docs.cdp.coinbase.com/ai-agents/coinbase-for-agents/wallet-mcp).

**Coinbase prize eligibility remains conditional.** Ask the sponsor whether a Solana x402 payment agent built with CDP qualifies when the brief mentions Coinbase for Agents/MCP. Do not claim that x402 SDK use alone satisfies an MCP requirement. Do not add Base or create an unrelated paid market-data call merely to imply product usage. A low-level Coinbase MCP payment-header tool exists, but its presence does not establish support for a Solana payment or a newly deployed skarl endpoint.

If a qualifying path is confirmed, make the integration part of the actual buyer purchase and document the exact tool, network, authorization, and settlement outcome. Otherwise submit honestly for the tracks whose requirements the product demonstrates.

## Supporting tracks: Gemini and Auth0

Gemini is central visual reasoning rather than a token API call: show timestamped silent-video evidence, independent speech comparison and schema-validated reports. Include model/version, prompts, measured latency and held-out results. The current stable Gemini 3.8 Flash model supports video, audio and structured output, but not the Live API; the proposed pipeline is asynchronous. [Gemini model capabilities](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)

Auth0 protects real buyer/contributor/controller boundaries. Demonstrate verified identity plus backend organization membership and independent controller authorization; a login button alone is weak evidence. [Convex Auth0 integration](https://docs.convex.dev/auth/auth0)

The live event prize cards should be checked for the exact MLH Gemini/Auth0 submission requirements and eligibility. Cartesia remains optional: add a responsive spoken coaching loop only if it helps contributors complete a task and the core pipeline works. Batch transcription alone does not demonstrate a compelling real-time voice application. Do not add a second database or an unrelated Claude call to pursue extra categories. [Live event prize cards](https://hive.hackberkeley.org/prizes)

## Shared submission evidence

Maintain a concise package of real evidence:

1. Product summary, roles, architecture, setup instructions, and current limitations.
2. An opening demo moment: duplicate detection with evidence, followed by the correct financial consequence.
3. Actual model evaluation results and a clear inventory of real versus simulated data/services.
4. Payment trace linking one order to its incoming payment, approved payable, payout, refund, and journal.
5. Spending controls, independent approvals, idempotency behavior, and recovery from an uncertain transaction.
6. Developer feedback based on observed SDK/MCP/facilitator behavior. A doc-only incompatibility finding should be described as research, not a reproduced runtime failure.

Prepare feedback as a submission artifact. Do not automatically send feedback or contact sponsors through messaging tools without the user's authorization. Prize categories, eligibility, and award stacking follow the event's current rules; architecture choices do not establish eligibility on their own.
