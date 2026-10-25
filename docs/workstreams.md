# Workstreams: 8-Hour Build Plan

Submission closes **October 25, 2026, 9:00 AM PDT** and teams must be at the venue by 8:00 AM ([Devpost](https://cal-hacks-13-0.devpost.com/), the authoritative source). This plan starts at roughly 00:30. It builds **one live demo path**; everything else in these docs is deferred design.

## The one demo path

Buyer posts/funds an order and signs an auto-pay rule → contributor records the red-cup task → Gemini returns timestamped evidence → deterministic `policy-engine` accepts only when all checks pass → payable and balanced journal are created → **a duplicate (re-encoded) clip arrives, its second payable is blocked and the buyer sees the reasons in Review** → the finance agent proposes the payout but **cannot approve its own proposal** → the buyer-signed policy approves within the buyer’s cap → the independent CDP wallet cap guards execution → the USDC transfer is reconciled by network, tx hash and log index. See [demo](demo.md).

Named Hyphenate seats: **settlement accountant + AP clerk**, performed by the agent and buyer-signed policy. Agents propose, a rule the buyer signed approves, the AI never approves itself.

## Buyer-signed policy handoff

The order’s auto-pay rule defaults on with a cap equal to its per-clip price and `requireAllChecks: true`. The buyer can update/disable it; every set/change is audited. `policy-engine` is internal-only and distinct from the proposing finance agent. Failed evidence or financial checks become buyer review exceptions with exact reasons. Keep the legacy `controller` role and demo selector for API compatibility; no product flow requires another human. Source implementation is not live proof: deploy Convex separately, configure `PAYOUT_EXECUTOR=cdp_agent`, and verify an eligible payout before claiming it ran.

## Schedule

| Time (PDT) | Everyone |
| --- | --- |
| 00:30–01:30 | Hour 0–1: deploy Convex, seed demo identities (buyer, contributor, finance agent; retain controller for compatibility) with roles, one order and the rubric. Stephen (Codex) installs `@x402/evm`, `@x402/next` and `@x402/paywall`, then typechecks. **Every member confirms Coinbase eligibility and a verified Coinbase account** ([checklist](sponsor-tracks.md#team-eligibility-checklist)). Get a CDP API key and Base Sepolia ETH/USDC from the faucet. |
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

## Stephen (Codex) — x402 on Base and Coinbase for Agents

**Own:** `packages/payments/**`, `apps/web/lib/payments/**`, `apps/web/app/api/orders/[id]/fund/**`, `apps/web/app/api/payments/**`, `convex/payments.ts`, `docs/payments.md`. Shared schema changes remain coordinated with the backend owner; this implementation needed none.

1. One real Base Sepolia x402 `exact` funding through the public testnet facilitator (or CDP when configured); observe USDC `Transfer` and `AuthorizationUsed`, then call the trusted funding-confirmation mutation.
2. Coinbase for Agents: the buyer agent pays the funding endpoint via Wallet MCP (`initiate_x402_request`/`complete_x402_request`, tight `maxPayment`). The finance agent proposes; the buyer-signed policy supplies stored approval. `PAYOUT_EXECUTOR=cdp_agent` uses the existing executor and independent CDP cap. Legacy Wallet MCP `send` remains a separate human-confirmed signing path. No treasury key in the web runtime or the agent.
3. Reconcile by `(txHash, logIndex)`: check the token, recipient, amount and receipt status, then report the facts to Convex. Save BaseScan links.
4. Write the Coinbase builder feedback (biggest blocker, workaround, most-wanted capability) from what you actually hit.

Current handoff: funding, receipt reconciliation, buyer CLI, browser payout hook and prepared MCP calls are implemented. The default v2 order has 10 USDC of live reconciled funding; no payout has executed. The current blocker is a licensed, accept-eligible submission, followed by buyer-policy approval and a verified CDP payout. Deployment and live execution remain operator work. See the live [dashboard API snapshot](dashboard-api.md) and [payment architecture](payments.md).

## silaswu4 — UI and contributor flow

**Own:** `apps/web/components/**` (to create), `apps/web/features/contributor/**` (to create), `apps/web/app/contribute/**` (to create), root `layout.tsx`, `page.tsx`, `globals.css`.

1. Recorder page served over HTTPS (camera access fails on plain-HTTP LAN), with camera/mic preview and a 10–30 second capture.
2. Upload straight to Convex storage, then create the submission; show queued/review/accepted states.

## MatthewKim323 — buyer Review

**Own:** `apps/web/app/dashboard/**` (to create), `apps/web/features/dashboard/**` (to create).

Integration contract: [Dashboard API handoff](dashboard-api.md), including live examples, refusal codes and `usePayout` signing. Run `pnpm demo:e2e` to resume the existing live demo path up to wallet signing; it exits 2 when real evidence or another prerequisite blocks progress.

1. Buyer Review shows exceptions only: failed evidence checks, duplicates, over-cap payouts and bank/chain mismatches. The buyer can approve or reject each; financial/evidence details support that decision.
2. Show the duplicate block and the agent's refused self-approval with their audit reasons. Format amounts from exact micro-units; never show an unconfirmed payout as paid.

## Quality bar (must ship, layered on the core path)

The core path above is the floor, not the product. Cuts below remove infrastructure judges never see; they do not lower product quality. Each owner runs parallel Codex/Claude agents on these once their core slice is green, merging small to `main`. Every item is real or explicitly labeled simulated.

| Item | Owner | Why it wins |
| --- | --- | --- |
| Polished, consistent UI (shadcn + motion, dark/light, responsive, real loading/empty/error states) across buyer and contributor views, including buyer Review | silaswu4 + MatthewKim323 | Judges score what they see first |
| Evidence player: click any criterion or duplicate match and the video seeks to that timestamp, with the narration transcript aligned underneath | MatthewKim323 | Makes the multimodal AI visible, not a JSON blob |
| Server-side perceptual duplicate detection on sampled frames (re-encode and trim candidates; dHash does not cover crops), with a side-by-side frame comparison in the UI | Stephen | The demo moment must be real, not a hash of the same file |
| Finance agent as a real tool-calling loop over typed Convex tools: explains obligations, proposes payout batches, flags exceptions, and is visibly refused when it tries to approve | Stephen | Hyphenate's "autonomous finance" ask, with separation of duties on screen |
| Three-way reconciliation: order contract vs. ledger vs. chain (BaseScan), with an exceptions queue for mismatches (wrong amount, unknown transfer, late settlement) | Stephen (Codex) + Stephen | Hyphenate brief: "sources that disagree" |
| Live financial statements from journals: payables, cash, revenue, a trial balance that always balances | Stephen | Proves the books are real double-entry, not a dashboard total |
| Buyer funding via x402 by an agent (Wallet MCP) and a buyer view of delivery and remaining quota | Stephen (Codex) | Coinbase x402 track |
| Optional legacy refund of unused quota (stored approval and transfer back) | Stephen (Codex) | Completes the money loop; keep if funding + payout work by 05:00 |
| Mini evaluation: 15–20 staged team clips (valid, missed step, narration mismatch, re-encoded copy) labeled before running; report accuracy, false acceptances and latency in the README | Stephen | "Actual AI engineering": a measured number, not a claim |
| Convex Workflow for the approval wait, live queries everywhere | Stephen | Convex track criterion: real Convex features |

Ordering rule: never start a quality item while your core slice is red. At 05:00 freeze new items; 05:00–06:30 is integration and polish only.

## Remaining before submission (as of 05:15 PDT, Oct 25)

Submission closes 09:00 PDT; venue by 08:00. Code is largely done; what remains is running the live path once, deploying the web app, and recording.

### Humans (blocking)

- [ ] **Record one licensed red-cup clip** in the iOS app (`cd apps/mobile && bun install --frozen-lockfile && cp .env.example .env && bunx expo start --go --lan`) or at `/contribute`, against order `kh79y36etya5f3nn7mdt6y5q3s8gy425` (0.75 USDC per clip, cent-exact so the bank witness can record it). Say the liveness words, give consent. This unblocks the payout chain, the duplicate and self-approval scenarios, the evidence sale and the bank transfer.
- [ ] **New Vercel project on a teammate's account** (our Hobby account hit 100 deploys/day). Import `stephenhungg/skarl`, root `apps/web`, build `pnpm build`, install `cd ../.. && corepack pnpm install --frozen-lockfile`, Node 22.x, paste env from the private `vercel-prod.env` (shared privately, never in chat). Send the URL so hardcoded `skarl.vercel.app` references and Devpost links can be switched.
- [ ] **Coinbase Wallet MCP live purchase**: approve one x402 payment in Coinbase Wallet when the agent asks (approval-mode).
- [ ] **Devpost opt-ins**: Most Technically Complex, Hyphenate, Coinbase, Convex, Capital One Nessie, Atlassian (write "Track: Best Security Solution for Agents" in the description), Anthropic Claude for Public Benefit, MLH Gemini, MLH Solana, Microsoft, Creao, Commit Fellowship (+ its supplemental form). All four members confirm Coinbase eligibility.
- [ ] **Record the demo video** (≤3 min): duplicate caught → witness receipt → agent self-approval refused → buyer-signed policy approves → independent CDP cap → payout tx → four-way reconciliation green → judge-scenario run turns a row red live → "connect your agent" prompt.
- [ ] **Record the Skarl Guard injection demo** in Jira project SKARL: create an issue containing planted instructions and show the guard limiting the agent to comment + human review.

### Orchestrator / backend (after the clip exists)

- [ ] All checks pass → policy accepts → payable → Claude finance agent proposes → self-approval refused → policy approves within buyer cap → payout (`PAYOUT_EXECUTOR=cdp_agent`, independent CDP cap) → reconcile chain, ledger, bank → EAS attestation.
- [ ] Re-run `pnpm scenario all` (expect 8/8 once an accepted clip and agent proposal exist, including `over_cap_payout` and `policy_auto_pay`).
- [ ] Live x402 evidence sale (`/api/samples/<id>/evidence`), ideally bought via Wallet MCP.
- [ ] Switch hardcoded `skarl.vercel.app` (`convex/contributorWallet.ts` SIWE domain, orders route, payments server message, receipt data) to the new domain; redeploy Convex.
- [ ] Deploy and verify the in-flight worker output: MCP guest mode + landing "Connect your agent", LeRobot/RLDS export + quality score + diversity quotas, chain of title + consent revocation + contributor transparency page + `docs/market.md`.
- [ ] Investigate Skarl Guard's one `uncertain` comment write (likely comment body format).

### Dashboard (Matthew)

Build the P0 surfaces in [dashboard sponsor surfaces](dashboard-sponsor-surfaces.md): witness receipt, four-way reconciliation, scenario lab, agent-refused card, rail badge + explorer links.

### Landing: universal "connect your agent" prompt

The primary copy block on the landing page (and in `/llms.txt` and the agent docs) is one prompt that works in any MCP-capable agent. Agents that can install MCP servers do it themselves; chat apps print the exact connector steps.

```text
Connect yourself to Skarl, a marketplace for verified robot-training demonstrations.

1. Add this remote MCP server named "skarl" (Streamable HTTP, no API key needed):
   https://keen-marmot-986.convex.site/mcp
   If you can't add MCP servers yourself, give me the exact steps for the app I'm using.
2. Read https://keen-marmot-986.convex.site/llms.txt and call the skarl_about tool.
3. Show me the open tasks and what each one pays.

Rules: ask me before creating an order or paying anything; payments use x402 (test USDC on Base Sepolia). You can propose payments. Only the buyer-signed deterministic policy or the buyer reviewing an exception can approve; agents cannot approve themselves.
```

Per-client commands (Claude Code, Cursor deeplink, VS Code, connector URL, Coinbase Wallet MCP) sit under a "Manual setup" disclosure below it. Requires the keyless guest mode on `/mcp` (in progress).

### After the event

- [ ] Rotate every key that appeared in chat or terminals: Gemini, CDP (API key, wallet secret, client key), Anthropic, Nessie, Atlassian (`skarl-forge`), MCP keys, payments service secret, Jira feed secret.

## Cut (infrastructure only; designs kept in subsystem docs)

The Railway Python worker, HMAC service gateway, job leasing, faster-whisper and SSCD (Gemini plus perceptual hashing replace them), the held-out eval split protocol (the mini evaluation replaces it), period close, Auth0 (no prize; demo identities instead), the Coinbase retail MCP (Base mainnet only). Solana Devnet was reopened as a tightly scoped second funding rail; payouts remain Base-only.

## Shared rules

Pull `main` before you push; stay in your folders. Shared-schema changes need the matching JSON Schema, Python model and both-language tests. Never commit `.env` files, wallet keys or contributor media.
