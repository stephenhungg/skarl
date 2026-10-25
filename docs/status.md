# Build Status

Truthful state as of October 25, 2026, after the adversarial audit and the move from Solana to Base Sepolia. Nothing below runs live. Update this file when a real integration becomes demonstrable.

| Area | Implemented now | Remaining for the [demo path](workstreams.md) |
| --- | --- | --- |
| Web | Server-rendered Next.js shell and `/api/health` | Recorder page, controller dashboard, Convex wiring, HTTPS deployment |
| Shared contracts | Base Sepolia chain constants (`chain.ts`), funding/payout status lists, JSON Schema, TS report validation, `parseAtomicUsdc` | Rubric-membership check wired into acceptance |
| Convex | Schema, validators, health query; no deployment | Deploy, seed demo identities, `acceptAndPublish` / `proposePayment` / `approve`, Gemini action, Workflow approval wait |
| Verifier | Python report models and validation CLI (scaffold, no inference) | Gemini runs in a Convex action for the demo; the Python worker is deferred |
| Evaluation | Scoring scaffolding | Deferred: no labeled corpus. Staged demo clips only |
| Ledger | Exact arithmetic, per-kind journal layouts, duplicate-fulfillment and payout-cap checks, pure replay tests | Persist through Convex mutations |
| Payments | Base Sepolia configuration, network/asset guards, adapter that refuses live execution | One x402 funding (CDP facilitator), Wallet MCP integration, one controller-approved payout reconciled by tx hash |
| Finance agent | Tool and policy design in docs | Proposal + explanation over deterministic projections; refused self-approval |
| Sponsors | Requirements checked against Devpost and the briefs | Working integrations; Coinbase eligibility checklist per member |

Local tests prove only the behavior they execute. They do not prove settlement, inference quality, authorization or sponsor eligibility.

## Initial scaffold verification (October 24, 2026)

The following ran under Node 22.21.1 on October 24:

- frozen pnpm install, typecheck, 16 TypeScript tests, the docs link check and the Next.js production build
- 16 pytest tests and 7 eval unittests under **Python 3.14.7**

CI targets Python 3.11, and local 3.11 was not exercised then. The test counts predate the audit fixes.

## Verification after audit fixes

On October 25, 2026 (Node 22.21.1, pnpm 10.19.0): frozen install, `pnpm check` (root, Convex and web typecheck; 62 TypeScript tests; docs link and anchor check; Next.js production build) passed. `pnpm check:convex` pushed the schema and indexes to an anonymous local Convex backend with typechecking enabled. Python: 54 verifier pytest tests and 10 evaluation unittest tests passed under 3.14; the verifier suite also passed under a fresh 3.11 environment. The TypeScript and Python validators share `packages/contracts/schemas/fixtures/verification-cases.json`. None of these run inference, x402 settlement or Base Sepolia transfers. Remote CI result: pending push.
