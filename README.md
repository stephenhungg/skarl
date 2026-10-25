# Skarl

**The AP/settlement seat for a human-data company.**<br>
Agents fund narrated demonstrations through x402; independent visual and audio evidence helps determine what is owed.<br>
A bounded finance agent proposes payouts; a human approves, and chain receipts reconcile the books.

**[Open the live demo](https://skarl.vercel.app)** · [Coinbase submission](docs/coinbase-submission.md) · [Devpost text](docs/devpost.md) · [Two-minute demo and judging runbook](docs/demo-script.md) · [Architecture SVG](docs/architecture.svg)

**Testnet · test USDC · demo identities.** Demonstrated payments use Base Sepolia; operator-owned test assets, no real customer funds. The hosted demo uses impersonable identities, not production authentication.

## Use Skarl from your agent in 3 steps

1. Connect Coinbase Wallet MCP and complete its human wallet onboarding:
   ```sh
   claude mcp add --transport http --scope user base-mcp https://wallet-mcp.coinbase.com
   ```
2. Give your agent [the Skarl plugin instructions](docs/wallet-mcp-plugin/skarl.md). They pin Base Sepolia, the test USDC contract, approved payee and payment cap; no Skarl server credentials are needed.
3. Ask: **“Check whether Skarl order `skarl-red-cup-demo-v2` is funded.”** It already has confirmed 10 USDC funding, so this completes a no-charge status check. For a new payment, supply a fresh unfunded order ID and explicit cap, approve in Coinbase Wallet, then let the agent complete the same request and verify confirmed funding. [Exact requests and recovery](docs/wallet-mcp-plugin/README.md).

The 0.25 USDC evidence-purchase endpoint is implemented, with Bazaar discovery metadata. A licensed, accepted and delivered sample is still needed: **no live evidence sale, Bazaar listing or completed Wallet MCP payment is verified**. A missing sample stops before payment. The agent plugin is a custom instruction file, not a Coinbase-approved integration.

## What actually ran

| Evidence | Observed result |
| --- | --- |
| [10 USDC funding](https://sepolia.basescan.org/tx/0x28b3f88d593c02a669cb95f4bdc6a23ab3d24bb5d1260e6c4ae54554155cd757) | Live Base Sepolia x402 buyer CLI payment through the public facilitator; reconciled funding journal. |
| [0.01 USDC CDP funding](https://sepolia.basescan.org/tx/0x20c9252f7d67a2dac87be839ad82b83465686157478645354838ac0f7239390d) | Live CDP facilitator settlement, signed provider webhook processed, exact balanced journal and no reconciliation exceptions. This is funding, not a payout. |
| Independent Gemini observations | Live inference on generated and real-video negative smoke tests; both correctly remained review-only. No human-task accuracy benchmark. |
| Finance agent | Live Flash tool call to the journal-derived trial balance and persisted explanation; no proposal or transfer in that run. |
| CDP wallet policy | Live contributor signature verification, an applied 2 USDC per-transfer cap, and actual CDP rejections for over-cap and non-allowlisted sends. Three faucet receipts funded 3 test USDC; these are not payouts. |
| Duplicate, approval and payout controls | Implemented with synthetic regression coverage. A licensed accepted contribution, independently approved payout and Wallet MCP execution remain unverified. |

[Build status](docs/status.md) records the dated evidence and limitations. Video defaults to `gemini-4-argon`; finance reasoning uses `gemini-3.8-flash`; independent audio uses `gemini-3.5-transcribe`. Historical Flash measurements keep their actual model attribution. [Model choices](docs/ai-verification.md#models-and-configuration).

## Run locally

```sh
# Node 22.18+ within the Node 22 line; pnpm 10.19.0
pnpm install --frozen-lockfile
cp apps/web/.env.example apps/web/.env.local
pnpm dev
# http://localhost:3000
```

The local UI uses the public demo Convex URL and treasury in the example; no private API keys are required to browse it. Create and fund outsider demo orders through `https://skarl.vercel.app/api/orders`. Running payment mutations on your own server requires operator configuration. The pnpm “ignored build scripts” warning for optional dependencies is harmless for this quickstart; required `esbuild` and `ffmpeg-static` scripts are already allowed. [Setup](docs/setup.md) covers cloud integration; [deployment](docs/deployment.md) covers operator configuration. `pnpm check` runs TypeScript, package/Convex/payment tests, documentation links and the production web build. It does not prove live inference or settlement.

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
