# Build Status

Truthful state as of October 25, 2026, after the adversarial audit and the move from Solana to Base Sepolia. Task 1 now runs on the shared Convex cloud dev deployment below; payment adapters are now implemented but no live transfer is confirmed. Update this file when another integration becomes demonstrable.

| Area | Implemented now | Remaining for the [demo path](workstreams.md) |
| --- | --- | --- |
| Web | Server-rendered Next.js shell and `/api/health` | Recorder page, controller dashboard, Convex wiring, HTTPS deployment |
| Shared contracts | Base Sepolia chain constants (`chain.ts`), funding/payout status lists, JSON Schema, TS report validation, `parseAtomicUsdc` | Rubric-membership check wired into acceptance |
| Convex | Shared cloud dev deployment; idempotent seed; persisted demo-role checks; `acceptAndPublish` / `proposePayment` / `approve`; dashboard queries; committed generated API | Upload/media APIs, Gemini action, verified wallets, trusted funding/settlement import, Workflow approval wait; production auth is out of demo scope |
| Verifier | Python report models and validation CLI (scaffold, no inference) | Gemini runs in a Convex action for the demo; the Python worker is deferred |
| Evaluation | Scoring scaffolding | Deferred: no labeled corpus. Staged demo clips only |
| Ledger | Audited pure helpers plus atomic Convex journal/line persistence, fulfillment accrual, event fingerprints and replay protection | Real funding/payout import and chain reconciliation |
| Payments | Base Sepolia x402 exact route; nonce dedup; receipt/authorization-log validation; atomic funding and payout journals; three-way reconciliation; testnet buyer CLI; browser payout hook; prepared Wallet MCP calls; mock-backed tests | Deploy merged Convex backend; supply controller treasury address; complete Wallet MCP authentication; run real funding/payout. Live buyer balance verified at 20 USDC; no live transfer yet |
| Finance agent | Server payment proposal, independent approval, durable refused self/agent approval audit and exact dashboard projections | Model explanation/tool loop, Workflow wait, approved-command execution |
| Sponsors | Requirements checked against Devpost and the briefs | Working integrations; Coinbase eligibility checklist per member |

Local tests prove only the behavior they execute. They do not prove settlement, inference quality, authorization or sponsor eligibility.

## Initial scaffold verification (October 24, 2026)

The following ran under Node 22.21.1 on October 24:

- frozen pnpm install, typecheck, 16 TypeScript tests, the docs link check and the Next.js production build
- 16 pytest tests and 7 eval unittests under **Python 3.14.7**

CI targets Python 3.11, and local 3.11 was not exercised then. The test counts predate the audit fixes.

## Verification after audit fixes

On October 25, 2026 (Node 22.21.1, pnpm 10.19.0): frozen install, `pnpm check` (root, Convex and web typecheck; 62 TypeScript tests; docs link and anchor check; Next.js production build) passed. `pnpm check:convex` pushed the schema and indexes to an anonymous local Convex backend with typechecking enabled. Python: 54 verifier pytest tests and 10 evaluation unittest tests passed under 3.14; the verifier suite also passed under a fresh 3.11 environment. The TypeScript and Python validators share `packages/contracts/schemas/fixtures/verification-cases.json`. None of these run inference, x402 settlement or Base Sepolia transfers. Remote CI result: pending push.

## Task 1 shared deployment

- Client URL: **https://keen-marmot-986.convex.cloud**; project `skarl`, deployment `dev:keen-marmot-986`.
- Seed: one organization, four impersonable demo identities, one unfunded 100-USDC red-cup order and frozen rubric. Running it again returns the same IDs. No transfers, media, inference results or verified-wallet proofs are fabricated.
- Atomic acceptance consumes funded quota, publishes an inline licensed manifest and creates one payable plus balanced fulfillment journal. SHA/perceptual-hash equality with already accepted work blocks a second payable and persists the matching submission as audit evidence. Hash computation and full model-report validation remain upstream work.
- Payment proposals bind requester/recipient/amount/source. Self-approval, agent approval and changed bindings are refused with durable audits. Independent approval queues execution; it does not move money or mark a payable paid.
- Demo identity selectors are public and impersonable. Server role checks are working demo policy, not production authentication.

Task 1 verification (Node 22.21.1, October 25): `pnpm check` passed root/Convex/web typechecks, 62 package tests, 26 Convex regressions, local Markdown links/anchors and the production web build. The cloud equivalent of `check:convex` (`pnpm exec convex dev --once --typecheck enable`) passed against the shared dev deployment. Seed was run repeatedly with identical IDs; a native cloud read-back verified all dashboard queries, one seed audit, three rubric criteria, zero cash/payables/journals and truthful health flags. The Convex tests use synthetic storage, wallet, funding and analysis fixtures; no inference, wallet proof or chain transfer ran. No source under `apps/web` or `packages/payments` changed.

## Payments implementation (October 25)

Payment work reuses the existing schema without additions. `convex/payments.ts` authenticates server imports using the configured service secret; browser demo identity selectors remain impersonable and are not production authentication. Pending funding never becomes funded on signature alone. Payouts require a stored independent approval and one execution claim. Both post only after the exact USDC log has two confirmations.

The public facilitator was queried live and advertises V2 `exact` on Base Sepolia. A live RPC query returned chain ID 84532 and zero USDC/ETH for buyer `0xa54DABc8583B869d488d63d691EC5d6a256c1a9D`. No signed payment or transaction was sent. The private testnet key and service secret are outside source control with mode 600. The service secret is installed in the shared Convex deployment; payment functions must be deployed together with the concurrent backend builder's newer verifier functions.

`pnpm check` includes package, Convex and actual Next/x402 route tests plus typechecks, docs validation and the production build. Payment tests use synthetic chain/facilitator evidence. They do not prove a live settlement. See [payment setup and handoff](payments.md) for the browser hook, MCP arguments and recovery procedure.

## Live funding preflight (October 25, 2026)

A live Base Sepolia RPC read returned chain ID `84532` and `20000000` micro-USDC
(20 USDC) for buyer `0xa54DABc8583B869d488d63d691EC5d6a256c1a9D`.
The shared Convex payment service secret is synchronized with the private local
configuration. No treasury address has been configured: the wallet web session
requires human sign-in. The local funding endpoint returns HTTP 503 with
`treasury_not_configured`, and no funding authorization or transfer was sent.
There is no transaction hash or BaseScan funding link to report.

Wallet MCP is configured as `base-mcp` at `https://wallet-mcp.coinbase.com` in
both Claude Code and Codex. Claude Code reports `Needs authentication`;
configuration alone is not a connected wallet session. A human must sign in to
the existing Coinbase Wallet, authorize the MCP connection, and provide its
Base Sepolia receiving address. No wallet was created, credentials entered,
message signed or transaction approved during this preflight.

`pnpm check` passed: typechecks, 74 package tests, 49 Convex tests, 24 payment
tests, documentation checks and the production build. These tests use synthetic
payment evidence and do not establish live settlement.
