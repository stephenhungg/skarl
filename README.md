# Skarl

Verified human demonstrations, paid on Solana. Buyers request narrated demonstrations; contributors record them; multimodal AI grounds quality checks in video and audio evidence. A bounded finance agent prepares payouts, handles exceptions and reconciles the resulting books.

Built for Cal Hacks 13.0. **Current state: development scaffold, not a working marketplace.** No live inference, authentication, payments or cloud database connection is implemented. Pure contracts, report validation and local accounting/payment-policy helpers are executable.

## Start here

```sh
# Node 22.18+ within the Node 22 line; pnpm 10.19.0
pnpm install
pnpm dev
# http://localhost:3000
```

No API keys are required to run the shell. See [setup](docs/setup.md) for Python and cloud integration. `pnpm check` runs TypeScript checks, tests, local documentation link checks and the production web build.

## Team handoffs

| Owner | Workstream | Primary folders |
| --- | --- | --- |
| MatthewKim323 | Web dashboard and dashboard data integration | `apps/web/app/dashboard`, `apps/web/features/dashboard` |
| silaswu4 | Shared UI, app shell and contributor recording flow | `apps/web/components`, `apps/web/features/contributor`, root web layout/page/styles |
| Stephen | Backend, auth, AI verification, finance logic and shared contracts | `convex`, `services/verifier`, `evals`, `fixtures`, `packages/contracts`, `packages/ledger` |
| qtzx06 | Solana/x402, wallet integration and onchain settlement | `packages/payments`, `apps/web/lib/solana`, payment API routes |

These assignments reflect Stephen's requested split. Folder paths describe ownership boundaries; some are implementation targets rather than existing routes. [Workstreams](docs/workstreams.md) defines tasks, dependencies and acceptance checks; [the docs index](docs/README.md) covers product, architecture, APIs, sponsors, research and the demo.

## Repository map

```text
apps/web/               Next.js App Router shell and health endpoint
convex/                 Database schema, validators and scaffold health query
packages/contracts/    Shared statuses, Devnet constants and verification schema
packages/ledger/       Exact USDC arithmetic and pure double-entry journal replay
packages/payments/     Devnet policy and explicitly unimplemented payment adapter
services/verifier/     Python report validator and unavailable-inference CLI
fixtures/              Instructions for consented media; no private recordings
evals/                 Evaluation manifest and scoring scaffolding
docs/                  Build specification, research and ownership
scripts/               Repository validation
```

The payment target is **Solana Devnet USDC**, using x402 V2 `exact` for funding and SPL transfers for payouts/refunds. There is no custom token or escrow contract. Sponsor eligibility is not implied by a placeholder integration: [sponsor evidence and limitations](docs/sponsor-tracks.md).
