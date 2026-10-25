# Sponsor track strategy and evidence

Pitch: **Skarl is the AP/settlement seat for a human-data company.** It verifies narrated demonstrations with multimodal AI, then pays contributors and keeps the books, with x402 payments on Base Sepolia. The prize list on [Devpost](https://cal-hacks-13-0.devpost.com/) is authoritative. The deadline is October 25, 2026, 12:00 PM EDT (9:00 AM PDT).

Current scope is **Base Sepolia only**. Repository docs and fixture tests are not evidence of a working sponsor integration.

## Targeted tracks

| Track (Devpost name) | What we demonstrate |
| --- | --- |
| [Hyphenate] The Hyphenated Enterprise: Autonomous Systems for Finance (**primary**) | The duplicate-clip catch, the blocked second payable, the agent's refused self-approval, a reconciled payout and balanced books |
| [Coinbase] Best Use of x402, **Payment Agents** track | A buyer agent funds orders via x402 and the finance agent pays contributors, both through Coinbase Wallet MCP within approved caps |
| [Convex] Best use of Convex | Convex as the system of record: live queries, atomic financial mutations, file storage, and a Workflow for the approval wait |
| [MLH] Best Use of Gemini API | Two independent Gemini calls (silent video, audio) producing schema-validated, timestamped evidence |

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

- **x402 funding:** the order-funding endpoint is a real x402 V2 `exact` resource on Base Sepolia, using `https://x402.org/facilitator` by default, or the authenticated CDP facilitator when both CDP API credentials are configured. The public production deployment is now configured for CDP using `createCdpFacilitatorClient` (`@coinbase/cdp-sdk` 1.60.0; `@x402/*` 2.28.0). Its authenticated supported-schemes probe succeeded, but the existing v2 funding transaction predates this switch; no CDP settlement is claimed from that probe. A buyer agent pays it through [Wallet MCP](https://docs.cdp.coinbase.com/ai-agents/coinbase-for-agents/wallet-mcp) `initiate_x402_request`/`complete_x402_request` with a `maxPayment` cap.
- **Payouts:** the finance agent pays contributors via Wallet MCP `send`, only for a stored, approved intent. Every write needs the controller's approval in Coinbase Wallet.
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

## Not targeted

- **MLH Best Use of Solana:** dropped with the move to Base Sepolia.
- **Auth0:** Cal Hacks 13.0 has no Auth0 prize. Demo identities are seeded Convex users whose roles are checked on the server, and they are labeled as demo identities.
- **Cartesia or other extra layers:** out of scope.

## Submission package

1. Product summary, roles, setup and limitations.
2. A video that opens with the duplicate moment.
3. A real-vs-simulated inventory, covering live, replayed or simulated status per segment.
4. A payment trace linking the order → x402 funding tx → payable → approval → payout tx → journal.
5. Coinbase builder feedback based on observed SDK/MCP/facilitator behavior; mark doc-only findings as research.

Do not contact sponsors or send feedback through messaging tools without the user's authorization.
