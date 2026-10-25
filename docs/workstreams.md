# Workstreams: 8-Hour Build Plan

Submission closes **October 25, 2026, 9:00 AM PDT** and teams must be at the venue by 8:00 AM ([Devpost](https://cal-hacks-13-0.devpost.com/), the authoritative source). This plan starts at roughly 00:30. It builds **one live demo path**; everything else in these docs is deferred design.

## The one demo path

Buyer agent funds an order with x402 on Base Sepolia (Coinbase Wallet MCP) → contributor records the red-cup task → Gemini returns a timestamped report → controller accepts → payable and balanced journal are created → **a duplicate (re-encoded) clip arrives, its second payable is blocked and the controller sees the evidence** → the finance agent proposes the payout but **cannot approve its own proposal** → the controller approves the payout in Coinbase Wallet → the USDC transfer is reconciled by tx hash and log index. See [demo](demo.md).

Named Hyphenate seats: **settlement accountant + AP clerk**.

## Schedule

| Time (PDT) | Everyone |
| --- | --- |
| 00:30–01:30 | Hour 0–1: deploy Convex, seed demo identities (buyer, contributor, controller, finance agent) with roles, one order and the rubric. qtzx06 installs `@x402/evm`, `@x402/next` and `@x402/paywall`, then typechecks. **Every member confirms Coinbase eligibility and a verified Coinbase account** ([checklist](sponsor-tracks.md#team-eligibility-checklist)). Get a CDP API key and Base Sepolia ETH/USDC from the faucet. |
| 01:30–05:00 | Parallel build against the seeded deployment (sections below). Merge to `main` small and often. |
| 05:00–06:30 | Integrate the full path end to end; stage the three clips (valid, duplicate re-encode, narration mismatch). |
| 06:30–07:00 | **Record the fallback demo video** (opens with the duplicate moment). Write the real-vs-simulated inventory. |
| 07:00–08:00 | Submit on Devpost, travel, rehearse. Venue by 08:00. |

Cut rule: if a step is not working by its slot, replace it with a clearly labeled simulation and move on. Never display a fake signature or a fake analysis as live.

## Stephen — backend, AI and finance logic

**Own:** `convex/**`, `convex.json`, `services/verifier/**`, `evals/**`, `fixtures/**`, `packages/contracts/**`, `packages/ledger/**`.

1. Seed script and demo identities with roles checked on the server in every mutation. These are labeled demo identities, not production auth.
2. Gemini Convex action with **two separate calls**: silent video only, then audio only. It validates the report against the shared schema before storing it; anything that fails validation, or any unavailable analysis, routes to review.
3. Mutations `acceptAndPublish` (payable + journal via `packages/ledger`, idempotent event keys, duplicate SHA-256/perceptual hash blocks a second payable), `proposePayment` and `approve` (the requester cannot approve; the agent identity can never approve).
4. Approval wait via Convex Workflow; finance-agent explanation call over the deterministic projections.

## qtzx06 — x402 on Base and Coinbase for Agents

**Own:** `packages/payments/**`, `apps/web/lib/payments/**` (to create), payment routes such as `apps/web/app/api/orders/[id]/fund/**` (to create), `docs/payments.md`.

1. One real Base Sepolia x402 `exact` funding through the CDP facilitator; observe the USDC `Transfer` and call Stephen's funding-confirmation mutation.
2. Coinbase for Agents: the buyer agent pays the funding endpoint via Wallet MCP (`initiate_x402_request`/`complete_x402_request`, tight `maxPayment`). The finance agent pays an **approved** intent via Wallet MCP `send` (the controller approves in Coinbase Wallet). No treasury key in the web runtime or the agent.
3. Reconcile by `(txHash, logIndex)`: check the token, recipient, amount and receipt status, then report the facts to Convex. Save BaseScan links.
4. Write the Coinbase builder feedback (biggest blocker, workaround, most-wanted capability) from what you actually hit.

## silaswu4 — UI and contributor flow

**Own:** `apps/web/components/**` (to create), `apps/web/features/contributor/**` (to create), `apps/web/app/contribute/**` (to create), root `layout.tsx`, `page.tsx`, `globals.css`.

1. Recorder page served over HTTPS (camera access fails on plain-HTTP LAN), with camera/mic preview and a 10–30 second capture.
2. Upload straight to Convex storage, then create the submission; show queued/review/accepted states.

## MatthewKim323 — controller dashboard

**Own:** `apps/web/app/dashboard/**` (to create), `apps/web/features/dashboard/**` (to create).

1. Live controller dashboard: order and funding, report evidence with timestamps, payables, journal, and the approve/sign button.
2. Show the duplicate block and the agent's refused self-approval with their audit reasons. Format amounts from exact micro-units; never show an unconfirmed payout as paid.

## Deferred (design only; not built tonight)

The Railway Python worker, HMAC service gateway, job leasing, faster-whisper, SSCD, the eval split protocol, period close, refunds (unless funding and payout both work by hour 6), Auth0, the Coinbase retail MCP (Base mainnet only) and Solana. Their designs remain in the subsystem docs, marked deferred.

## Shared rules

Pull `main` before you push; stay in your folders. Shared-schema changes need the matching JSON Schema, Python model and both-language tests. Never commit `.env` files, wallet keys or contributor media.
