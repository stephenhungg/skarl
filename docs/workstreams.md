# Team Ownership and Folder Boundaries

Skarl was built at Cal Hacks 13.0 by four people. This document records who owns which part of the repository and the rules for changing shared code. The [demo runbook](demo.md) describes the end-to-end path; the dated [build status](status.md) records what has been observed live.

## Owners

| Owner | Area | Folders |
| --- | --- | --- |
| MatthewKim323 | Buyer dashboard and review | `apps/web/app/dashboard/**`, `apps/web/features/dashboard/**` |
| silaswu4 | Shared UI and contributor flow | `apps/web/components/**`, `apps/web/features/contributor/**`, `apps/web/app/contribute/**`, root `layout.tsx`, `page.tsx`, `globals.css` |
| Stephen | Backend, verifier, finance logic and shared contracts | `convex/**`, `convex.json`, `services/verifier/**`, `evals/**`, `fixtures/**`, `packages/contracts/**`, `packages/ledger/**` |
| qtzx06 | x402 payments on Base and Coinbase for Agents | `packages/payments/**`, `apps/web/lib/payments/**`, `apps/web/app/api/orders/[id]/fund/**`, `apps/web/app/api/payments/**`, `convex/payments.ts`, `docs/payments.md` |

Integration contracts between these areas: the [dashboard API handoff](dashboard-api.md), the [shared contracts](contracts.md) and the [payment architecture](payments.md).

## The core path

Buyer funds an order with x402 and signs an auto-pay rule → contributor records the task → Gemini returns timestamped evidence against the task's rubric → the deterministic `policy-engine` accepts only when every check passes → a payable and balanced journal are posted, and a devnet Token-2022 license token is minted for the delivery → a re-encoded duplicate clip is blocked from creating a second payable → the finance agent proposes the payout but cannot approve its own proposal → the buyer-signed policy approves within the buyer's cap → an independent CDP wallet cap guards execution → the Base Sepolia USDC transfer is reconciled by network, tx hash and log index.

Named Hyphenate seats: **settlement accountant + AP clerk**, performed by the finance agent (proposer) and the buyer-signed policy (approver). The AI never approves itself. The legacy `controller` role remains a hidden compatibility API; the UI shows Buyer and Contributor only.

## Connect your agent

The landing page, `/llms.txt` and the agent docs share one prompt that works in any MCP-capable agent:

```text
Connect yourself to Skarl, a marketplace for verified robot-training demonstrations.

1. Add this remote MCP server named "skarl" (Streamable HTTP, no API key needed):
   https://keen-marmot-986.convex.site/mcp
   If you can't add MCP servers yourself, give me the exact steps for the app I'm using.
2. Read https://keen-marmot-986.convex.site/llms.txt and call the skarl_about tool.
3. Show me the open tasks and what each one pays.

Rules: ask me before creating an order or paying anything; payments use x402 (test USDC on Base Sepolia). You can propose payments. Only the buyer-signed deterministic policy or the buyer reviewing an exception can approve; agents cannot approve themselves.
```

Per-client setup (Claude Code, Cursor, VS Code, Coinbase Wallet MCP) is in [Remote MCP](mcp.md). Personal-agent wallet onboarding runs over the guest MCP tools `skarl_onboard`, `skarl_wallet_status` and `skarl_request_testnet_usdc` (rate-limited Base Sepolia faucet), and as a portable skill at `https://keen-marmot-986.convex.site/skill.md`.

## Deferred by design

The Railway Python inference worker, HMAC service gateway, job leasing, faster-whisper and SSCD (Gemini plus perceptual hashing replace them), the held-out evaluation split protocol (the mini evaluation replaces it), period close and the Coinbase retail MCP (Base mainnet only). Solana Devnet is a scoped second funding rail and the license-token chain; payouts remain Base Sepolia only.

## Shared rules

- Pull `main` before you push; stay in your folders and coordinate changes to shared schemas first.
- Shared-schema changes need the matching JSON Schema, Python model and tests in both languages.
- Never commit `.env` files, wallet keys or contributor media.
- Anything simulated, replayed or testnet-only is labeled as such in the UI and docs.
