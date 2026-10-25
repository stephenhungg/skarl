# Build Status

Truthful state as of October 25, 2026, after the adversarial audit and the move from Solana to Base Sepolia. Task 1 now runs on the shared Convex cloud dev deployment below; inference and payments remain unimplemented. Update this file when another integration becomes demonstrable.

| Area | Implemented now | Remaining for the [demo path](workstreams.md) |
| --- | --- | --- |
| Web | Server-rendered Next.js shell and `/api/health` | Recorder page, controller dashboard, Convex wiring, HTTPS deployment |
| Shared contracts | Base Sepolia chain constants (`chain.ts`), funding/payout status lists, JSON Schema, TS report validation, `parseAtomicUsdc` | Rubric-membership check wired into acceptance |
| Convex | Shared cloud dev deployment; idempotent seed; persisted demo-role checks; `acceptAndPublish` / `proposePayment` / `approve`; dashboard queries; committed generated API | Upload/media APIs, Gemini action, verified wallets, trusted funding/settlement import, Workflow approval wait; production auth is out of demo scope |
| Verifier | Python report models and validation CLI (scaffold, no inference) | Gemini runs in a Convex action for the demo; the Python worker is deferred |
| Evaluation | Scoring scaffolding | Deferred: no labeled corpus. Staged demo clips only |
| Ledger | Audited pure helpers plus atomic Convex journal/line persistence, fulfillment accrual, event fingerprints and replay protection | Real funding/payout import and chain reconciliation |
| Payments | Base Sepolia configuration, network/asset guards, adapter that refuses live execution | One x402 funding (CDP facilitator), Wallet MCP integration, one controller-approved payout reconciled by tx hash |
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
