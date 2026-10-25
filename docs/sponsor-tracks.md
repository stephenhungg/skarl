# Sponsor track strategy and evidence

Pitch: **Every claim has a witness. Skarl is the autonomous settlement desk for human-data companies.** Agents argue the case, deterministic code decides, and humans approve exceptions and every payout. See the [thesis and witness table](thesis.md) and [per-prize rubric mapping](devpost.md#prize-specific-evidence). The prize list on [Devpost](https://cal-hacks-13-0.devpost.com/) is authoritative. The deadline is October 25, 2026, 12:00 PM EDT (9:00 AM PDT).

Demonstrated funding uses **Base Sepolia test USDC** and optional **Solana Devnet test USDC** (confirmed at 03:29 PDT). Base remains primary and the only payout target; a live contributor payout is still pending. Repository docs and fixture tests are not evidence of a working sponsor integration.

## Targeted tracks

| Track (Devpost name) | What we demonstrate |
| --- | --- |
| [Hyphenate] The Hyphenated Enterprise: Autonomous Systems for Finance (**primary**) | The duplicate-clip catch, the blocked second payable, the agent's refused self-approval, a reconciled payout and balanced books |
| [Coinbase] Best Use of x402, **Payment Agents** track | Live x402 funding via CDP, a reusable Wallet MCP approval plugin, and live CDP wallet cap/allowlist rejections; contributor payout and MCP purchase still pending |
| [Convex] Best use of Convex | Convex as the system of record: live queries, atomic financial mutations, file storage, and a Workflow for the approval wait |
| [MLH] Best Use of Solana | Live 1-USDC Solana Devnet x402 funding and finalized RPC reconciliation; Base stays primary and the only payout rail |
| [MLH] Best Use of Gemini API | Two independent Gemini calls (silent video, audio) producing schema-validated, timestamped evidence |
| Capital One (Nessie) | Live Nessie bank as the fourth reconciliation witness: on October 25 at 04:11 PDT, order, ledger, chain and bank all `match` for a 10 USDC order (mock bank, no fiat moved) |
| Anthropic (Claude) | Live Claude finance agent (`claude-sonnet-5-5`, 3 read-only tool calls, about 7 s, cannot approve) and a Claude contributor coach whose output is validated server-side and cannot change verdicts |
| [Atlassian] Best Security Solution for Agents | [Skarl Guard for Jira](../integrations/jira-forge/README.md), Agentic Workforce Challenge Track 2: deterministic injection guard, constrained Claude triage, audited refusals and selective rollback; **live on a Jira Cloud demo site (Oct 25, 04:53 PDT):** authenticated feed sync created SKARL-1..5 (0 errors); Claude triaged SKARL-5 within policy (labels, priority) with per-action audit and revert; the bulk-change test refused a six-issue batch with no Jira change. One agent comment write returned `uncertain` and was not replayed, by design. Injection-in-issue demo still to record |

## Hyphenate

Seats filled: **settlement accountant + AP clerk**. A human controller approves money movement.

The [official brief](https://docs.google.com/document/d/1u4iN8R97ILY3kfHTPKC82zdutHrGx4ze5eCAP-J92w4/edit) judges realism, whether the system could be hired, novelty, and a memorable catch, recovery or defended decision. It requires:

- code
- a video that opens with that moment
- a live demo running for real
- the seats named
- an inventory separating real from simulated work

Judges may inject a scenario.

Our moment is the [demo](demo.md) opening:

1. A re-encoded duplicate clip arrives.
2. Its second payable is blocked.
3. The controller sees the hash evidence.
4. The finance agent proposes the payout but cannot approve its own proposal.

## Coinbase: Best Use of x402

$500 USDC plus a recruiter call per eligible team member, per track. There are two tracks with one winning team each. The [brief](https://drive.google.com/file/d/12TnPLguduV3gh1zY_TJ176XmVDz2RGW9/view) defines them:

- **Payment Agents (our primary Coinbase track):** "Use the Coinbase MCP for Agents and x402" to let an agent pay for things, earn money, or both. The brief's examples include "manages the budget for a small business."
- **Trading Agents:** not applicable.

**Judging:** usefulness, technical design (reliability; explain the choice of models, tools, memory and scheduling), ease of reuse (someone else can install it and finish the core task from our instructions), and product feedback. Real-money transactions are not required; label simulated actions clearly, keep credentials private, and don't manage other people's funds.

**What we build:** see [payments](payments.md#where-coinbase-for-agents-fits).

- **x402 funding:** production uses the authenticated CDP facilitator. A 0.01-test-USDC payment settled through CDP and its real signed webhook was processed and reconciled; see [the trace](status.md#confirmed-webhook-delivery-and-cdp-settlement--0254-pdt). The earlier 10-USDC v2 funding used x402.org. These CLI payments are not evidence of Wallet MCP execution. The reusable [plugin](wallet-mcp-plugin/skarl.md) prepares `initiate_x402_request` / `complete_x402_request` with a `maxPayment` cap and human approval.
- **Payouts and policy:** the default controller-wallet / Wallet MCP `send` adapter executes only a stored independently approved intent. The optional CDP executor has a live 2-USDC cap and recipient allowlist, with real over-cap/non-allowlisted `403 policy_violation` results. A licensed submission and payable are still missing, so **no contributor payout is claimed**. [Policy evidence](status.md#live-retry-after-recovery-deployment--october-25-2026-0305-pdt).
- **Coinbase MCP (retail):** separate from Wallet MCP and outside this demo path. The previously cited 5 USDC limit is unverified in the current documentation; do not present it as a guaranteed product limit.

**Evidence mapped to Payment Agents judging:**

| Criterion | Reproducible evidence |
| --- | --- |
| Usefulness | An agent funds a collection order and can purchase a verified sample’s evidence; explain the buyer/contributor need. |
| Technical design | Durable intents, exact micro-USDC, bounded spending, independent approval and receipt reconciliation; explain model/tool choices and known failure paths. |
| Ease of reuse | Public HTTPS app, [Wallet MCP plugin](wallet-mcp-plugin/skarl.md), three-step README setup and exact capped request examples. |
| Product feedback | Observed blocker, workaround and desired capability; distinguish doc research from a live Wallet MCP session. |

The evidence endpoint is implemented. A real evidence purchase and CDP Bazaar
discovery still require a licensed, accepted and delivered sample plus successful
live verification. A plugin file or
public URL alone is not evidence that an agent bought data or was indexed.

**Submission requirements (choose Payment Agents as the primary track):**

1. Project summary: who it's for, what it does, which agent platform and Coinbase tools.
2. Working example: a short demo plus the repo, with setup instructions.
3. Architecture: components, controls and known limitations.
4. Builder feedback: the biggest blocker, the workaround, and the one missing Coinbase capability we most want.

### Team eligibility checklist

The prize is paid only to eligible members. Each member confirms:

- [ ] at least 18 years old
- [ ] a legal resident of the US or Canada (not Quebec)
- [ ] a **verified Coinbase account** they personally hold, created before participating
- [ ] they understand the limit of one prize per person; winners may need an affidavit, and Canadian winners a skill-testing question

Record each member's answer before submitting. An ineligible member does not change the build; they simply cannot claim the prize.

## Convex

All orders, reports, decisions, payables, approvals and journals live in Convex. Show live propagation between the contributor and controller views, a duplicate event rejected inside a mutation, and an atomic acceptance + payable + journal write.

Convex judges ask for real features ("live queries and components"), so the approval wait uses Convex Workflow. [Mutations](https://docs.convex.dev/functions/mutation-functions), [Workflow](https://www.convex.dev/components/workflow)

## Gemini

The pipeline makes two independent calls so the visual evidence is not contaminated by narration: one on timestamped JPEG frames extracted from the original clip, one on its separately extracted audio. Each returns structured output validated against the shared schema, with timestamps.

Current configurable defaults are `gemini-4-argon` for visual evidence, `gemini-3.8-flash` for finance reasoning and read-only `askAgent`, and `gemini-3.5-transcribe` for audio. Billing is enabled; the team's latest probes returned correct HTTP 200 responses for 3.8 Flash, 4 Argon and 3.6 Flash. Earlier free-tier quota failures are historical and no longer current blockers. No automatic model fallback is configured. The shared transport gives each logical request one 30-second deadline across at most three transient attempts; finance rounds fit inside a two-minute overall budget. Preserve the actual model ID for every historical measurement and record prompt version and measured latency. [Configuration and probe results](ai-verification.md#models-and-configuration), [Gemini models](https://ai.google.dev/gemini-api/docs/models).

## Solana

**MLH Best Use of Solana:** the optional CDP-backed Solana Devnet x402 funding path now has live evidence: [1 USDC finalized funding on Solana Explorer](https://explorer.solana.com/tx/31LMrtZYcf4PcBRcyFmFX8tBmt2fNttNSBA4mz7sTrZKSw6E2kH9oghw5FTafzR77JZT9so1zzjkj8ZuVqrGUezi?cluster=devnet) at **03:29 PDT on October 25**. One bounded CDP buyer authorization funded `skarl-red-cup-demo-sol` through the CDP facilitator after fee-payer rotation fix `d91c1e9` reached Vercel production. HTTP 200 reported confirmed funding and provider `cdp`; no x402.org fallback was needed. Convex reports the order funded, one matched 1000000-micro-USDC journal/transfer and zero exceptions; RPC verified finalized slot 514940239, transfer instruction 2, canonical USDC, treasury ATA and order memo.

The earlier 03:13 attempt failed before settlement because fee-payer rotation broke exact quote matching. Its expired, unsettled authorization and spend reservation were retained before the single new attempt. Current-set fee-payer validation resolves that mismatch while retaining all economic and deduplication checks. See [live success and validation](status.md#confirmed-solana-funding-after-fee-payer-fix--october-25-2026-0329-pdt), [Solana rail](payments.md#solana-rail), and [Coinbase builder feedback](coinbase-submission.md#solana-fee-payer-rotation-during-x402-funding). Base/Coinbase remain primary and payouts remain Base-only. This proves testnet funding, not a Solana payout, bridge, Wallet MCP purchase or prize eligibility.

## Other tracks and evidence gates

- **Auth0:** Cal Hacks 13.0 has no Auth0 prize. Demo identities are seeded Convex users whose roles are checked on the server, and they are labeled as demo identities.
- **Cartesia:** no live evidence in the current status snapshot; exclude it as a working witness.
- **Anthropic / Capital One:** stored live Claude finance and hosted Nessie mock-bank funding evidence now support the [Devpost mapping](devpost.md#prize-specific-evidence). See the [04:40 refresh](status.md#submission-evidence-refresh--october-25-2026-0440-pdt); no measured community impact or real bank settlement is claimed.

## Submission package

1. Product summary, roles, setup and limitations.
2. A video that opens with the duplicate moment.
3. A real-vs-simulated inventory, covering live, replayed or simulated status per segment.
4. A payment trace linking the order → x402 funding tx → payable → approval → payout tx → journal.
5. Coinbase builder feedback based on observed SDK/MCP/facilitator behavior; mark doc-only findings as research.

Do not contact sponsors or send feedback through messaging tools without the user's authorization.

## Coinbase builder feedback — October 25

Mirrored from the [Coinbase submission](coinbase-submission.md#4-builder-feedback). Observed incidents, dependency inspection and documentation research are labeled separately.

### Biggest observed blocker: SQL unavailable even for SELECT 1

At approximately 02:54 PDT, every recorded query to `/platform/v2/data/query/run` returned HTTP 500, including client-key and API-secret-JWT `SELECT 1`. CDP returned `internal_server_error`. Correlation IDs: client-key **`a50055b9eb2f354e-IAD`**, JWT **`a50055baacf2354e-SJC`**, scoped Base Sepolia Transfer query **`a50055bbcc0b7851-IAD`**. These are actual provider errors in [status](status.md#live-cdp-verification), not fixtures.

**Workaround:** keep RPC-verified reconciliation and signed webhooks as the operational path; show `witness_unavailable` for SQL. The CDP funding/webhook transaction above still reconciled and posted one balanced journal. SQL failure never became a payout approval or a false match.

### Other friction, with provenance

| Friction | Evidence and workaround |
| --- | --- |
| Wallet MCP approval mode | Live preflight recorded authentication/OAuth waits, not a completed MCP payment. Official [approval-mode documentation](https://docs.cdp.coinbase.com/coinbase-for-agents/wallet-mcp/references/approval-mode) requires human approval for every write. Preserve returned request IDs and make the approval handoff explicit. This is a Wallet MCP limitation, not a claim that Coinbase has no autonomous wallet products. |
| Wallet MCP x402 Base coverage | The [Wallet MCP reference](https://docs.cdp.coinbase.com/coinbase-for-agents/wallet-mcp/skill) documents USDC x402 on Base, not Solana. Skarl targets Base Sepolia and stops if the connected tools cannot support it. No failed Solana MCP transaction was recorded. |
| Solana devnet data coverage | [Onchain activity webhooks](https://docs.cdp.coinbase.com/webhooks/onchain-activity/overview) list Base mainnet/Sepolia; [SQL quickstart](https://docs.cdp.coinbase.com/data/sql-api/quickstart) describes Solana token coverage on Mainnet. Solana devnet webhook/SQL parity was not documented in these references; this is platform research, not a live outage. Base plus RPC keeps the demo on a supported path. |
| Faucet-sized budgets | [Circle](https://faucet.circle.com/) advertises 20 test USDC per two hours per address/blockchain; [CDP](https://docs.cdp.coinbase.com/faucets/introduction/welcome) lists 1 USDC per claim. The demo uses a 10-USDC order and a 0.01-USDC webhook probe. Status records a 20-USDC buyer balance and three actual 1-USDC CDP claims funding the policy wallet; no faucet rate-limit error is invented. |
| Solana dependency version split | The [lockfile](../pnpm-lock.yaml) resolves `@solana/kit` 5.5.1 under `@coinbase/cdp-sdk` 1.60.0 and 6.10.0 for `@x402/svm` 2.28.0. This is a dependency observation, not a proven Solana payment failure. Keep the pinned graph, externalize CDP for Convex and keep Solana funding evidence separate from the demonstrated Base path. |
| Bazaar indexing latency and visibility | [CDP documents](https://docs.cdp.coinbase.com/x402/seller/get-discovered) asynchronous indexing after settlement, up to 15 minutes, and `success`/`processing`/`rejected` extension responses. We forward `EXTENSION-RESPONSES` explicitly and support direct resource inspection. Our live validator stopped at an ineligible sample's 404; **no actual indexing delay or successful listing was measured**. |

### One capability we most want

**Policy-bound autonomous agent wallets usable through Wallet MCP without a human click for each already-authorized transaction.** Let the operator define a revocable network/token/recipient/budget policy once, then allow bounded execution under that policy with a stable request ID. Skarl would still require its own independent business approval; this would remove the second manual signing handoff and the separate CDP SDK executor solely for bounded execution. Today's Wallet MCP remains in approval mode. No feature request has been sent externally.
