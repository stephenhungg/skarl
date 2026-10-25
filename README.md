# Skarl

Production URL: https://skarl.vercel.app

Verified human demonstrations, paid with x402 on Base. The AP/settlement seat for a human-data company. Buyers request narrated demonstrations; contributors record them; multimodal AI grounds quality checks in video and audio evidence. A bounded finance agent prepares payouts, handles exceptions and reconciles the resulting books.

Built for Cal Hacks 13.0. **Current state: deployed demo backend, contributor recorder and payment adapters, not a complete marketplace.** The shared Convex dev backend has seeded demo identities, acceptance/payable/journal mutations, independent approval and dashboard queries. Task 2 adds scheduled Gemini verification, uploads and server media processing. Both independent model stages ran live on one generated-media smoke test; human demonstration accuracy remains unmeasured. A bounded finance tool loop, durable approval Workflow and journal-derived statements are implemented. The payment owner recorded live x402 funding; outgoing wallet payout remains unconfirmed. Production authentication and contributor-wallet verification remain unimplemented. See [connection/setup](docs/setup.md) and [current status](docs/status.md).

## Start here

```sh
# Node 22.18+ within the Node 22 line; pnpm 10.19.0
pnpm install
pnpm dev
# http://localhost:3000
```

No API keys are required to run the shell. See [setup](docs/setup.md) for Python and cloud integration. `pnpm check` runs TypeScript checks, tests, local documentation link checks and the production web build.

## Use Skarl from your agent in 3 steps

1. Connect Coinbase Wallet MCP in your agent client and complete its wallet onboarding:
   `claude mcp add --transport http --scope user base-mcp https://wallet-mcp.coinbase.com`.
   Use Base Sepolia test USDC; the human approves payment requests in Coinbase Wallet.
2. Load [the Skarl plugin](docs/wallet-mcp-plugin/skarl.md) as agent context. It includes
   exact request arguments, allowed network/token/recipient checks and recovery rules.
3. Ask: “Check Skarl order `skarl-red-cup-demo-v2`; fund it only if unfunded, with a
   maximum of 10 USDC.” The existing demo order is already funded, so this is a safe
   status demonstration without another charge. For a new order, use its actual ID
   and stored budget. The plugin also describes buying a verified sample’s evidence
   for at most 0.25 USDC; that flow requires the deployed endpoint and an eligible
   sample, and must stop if either is unavailable.

See [deployment](docs/deployment.md) for operator setup and [status](docs/status.md)
for live evidence. Installing the plugin is not proof of a completed Wallet MCP
payment or Bazaar listing. Demo identity selectors are not production authentication.

## Team handoffs

| Owner | Workstream | Primary folders |
| --- | --- | --- |
| MatthewKim323 | Web dashboard and dashboard data integration | `apps/web/app/dashboard`, `apps/web/features/dashboard` (to create) |
| silaswu4 | Shared UI, app shell and contributor recording flow | `apps/web/components`, `apps/web/features/contributor` (to create), root web layout/page/styles |
| Stephen | Backend, demo identities, AI verification, finance logic and shared contracts | `convex`, `services/verifier`, `evals`, `fixtures`, `packages/contracts`, `packages/ledger` |
| qtzx06 | x402 on Base Sepolia, Coinbase for Agents (Wallet MCP), onchain settlement | `packages/payments`, `apps/web/lib/payments` (to create), payment API routes (to create) |

These assignments reflect Stephen's requested split. Folder paths describe ownership boundaries; some are implementation targets rather than existing routes. [Workstreams](docs/workstreams.md) is the 8-hour plan to the 9:00 AM PDT deadline; [the docs index](docs/README.md) covers product, architecture, APIs, sponsors, research and the demo.

## Repository map

```text
apps/web/               Next.js contributor recorder and payment API routes
convex/                 Demo finance API, uploads, scheduled Gemini verification and generated types
packages/contracts/    Shared statuses, Base Sepolia chain constants and verification schema
packages/ledger/       Exact USDC arithmetic and pure double-entry journal replay
packages/payments/     x402 funding, receipt checks, reconciliation and wallet adapters
services/verifier/     Python report validator (the Railway inference worker is deferred)
fixtures/              Instructions for consented media; no private recordings
evals/                 Evaluation scoring scaffolding (split protocol deferred)
docs/                  Build specification, research and ownership
scripts/               Repository validation
```

The payment target is **Base Sepolia USDC** (`eip155:84532`), using x402 V2 `exact` via the public x402.org facilitator by default (CDP when configured) for funding and controller-approved USDC transfers (Coinbase Wallet / Wallet MCP) for payouts. There is no custom token or escrow contract. Sponsor eligibility is not implied by a placeholder integration: [sponsor evidence and limitations](docs/sponsor-tracks.md).
