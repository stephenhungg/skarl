# Sponsor track strategy and evidence

Pitch: **Every claim has a witness. Skarl is the autonomous settlement desk for human-data companies.** The agent proposes; the buyer-signed policy (or the buyer in review) approves; an independent CDP cap guards execution. The AI never approves itself. Buyers review exceptions. See the [thesis and witness table](thesis.md) and [per-prize rubric mapping](devpost.md#prize-specific-evidence). The prize list on [Devpost](https://cal-hacks-13-0.devpost.com/) is authoritative. The deadline is October 25, 2026, 12:00 PM EDT (9:00 AM PDT). Official sources were rechecked on October 25 through Devpost and the original sponsor briefs. Start with the [review guide](review-guide.md) for criteria, source files, safe reproduction commands and remaining evidence gaps.

Demonstrated funding uses **Base Sepolia test USDC** and optional **Solana Devnet test USDC** (confirmed at 03:29 PDT). Base remains primary and the only payout target; a live contributor payout is still pending. Repository docs and fixture tests are not evidence of a working sponsor integration.

## Targeted tracks

| Track (Devpost name) | What we demonstrate |
| --- | --- |
| [Hyphenate] The Hyphenated Enterprise: Autonomous Systems for Finance (**primary**) | Implemented duplicate/payable controls, separate agent proposer and buyer-policy approver, balanced journals and recorded funding; complete live policy-approved payout remains pending |
| [Hyphenate] Tax-ready ledger | **Not tax advice — demo data**: journal-derived contributor YTD, form-on-file attestations, missing-form buyer review, advisory threshold flags and read-only finance-agent summaries; deployment and live tax scenario remain unverified. [Scope and checks](tax.md). |
| [Coinbase] Best Use of x402, **Payment Agents** track | Live x402 funding via CDP, a reusable Wallet MCP approval plugin, and live CDP wallet cap/allowlist rejections; contributor payout and MCP purchase still pending |
| [Convex] Best use of Convex | Convex as the system of record: live queries, atomic financial mutations, file storage, and a Workflow for the approval wait |
| [MLH] Best Use of Solana | Live 1-USDC Solana Devnet x402 funding and finalized RPC reconciliation; Base stays primary and the only payout rail |
| [MLH] Best Use of Gemini API | Argon + Flash silent-frame jury and separate Transcribe audio; stored live negative run, timestamped evidence and deterministic comparison; labeled task accuracy unmeasured |
| Capital One (Nessie) | Live Nessie bank as the fourth reconciliation witness: on October 25 at 04:11 PDT, order, ledger, chain and bank all `match` for a 10 USDC order (mock bank, no fiat moved) |
| [Anthropic] Claude for Public Benefit | Stored `claude-sonnet-5-5` finance run: three read-only tools, **4,636 ms backend time**, zero proposed amount; contributor coach implemented and constrained, live coach quality/community benefit unmeasured |
| [Atlassian] Best Agent / Best Security Solution for Agents — **security track** | Forge allowlisted triage/audit/selective rollback plus admin-only, read-only uncertain-write reconciliation; action-bound comments and durable deduplication prevent reposting. Public Convex token buckets return 429/Retry-After, MCP/finance results use `untrusted: true` JSON envelopes, and public orders/funding accept idempotency keys. Local tests cover hostile narration, refusal of approval, rate refill, replay and Jira read-back. Team-recorded 04:53 sync/triage/batch refusal remains separate from new source: deployment and the historical uncertain comment read-back are unverified |

## Hyphenate

Seats filled: **settlement accountant + AP clerk**, performed by the agent and buyer-signed policy. Separation of duties is **agent proposes; buyer-signed policy (or the buyer in review) approves; independent CDP cap**. Buyer and contributor are the only human roles. The receipt aggregates supporting and missing evidence; optional sensors, detector overlays, EAS and Nessie are not universal payment gates. Auto-acceptance requires the policy’s evidence checks; exceptions go to the owning buyer. Source/licensing, duplicate, quota and recipient bindings remain enforced. See the [enforcement boundaries](review-guide.md#what-the-controls-actually-enforce).

The [official brief](https://docs.google.com/document/d/1u4iN8R97ILY3kfHTPKC82zdutHrGx4ze5eCAP-J92w4/edit) judges realism, whether the system could be hired, novelty, and a memorable catch, recovery or defended decision. It requires:

- code
- a video that opens with that moment
- a live demo running for real
- the seats named
- an inventory separating real from simulated work

Judges may inject a scenario.

The advisory finance analyst adds cited exception recommendations, approval/chain-aware payout narration and organization close notes with zero money authority; backend rollout and live analyst evidence remain pending ([API](dashboard-api.md#advisory-finance-analyst)).

The planned moment is the [demo](demo.md) opening; this full live sequence remains unverified:

1. A re-encoded duplicate clip arrives.
2. Its second payable is blocked.
3. The buyer sees the hash evidence in Review.
4. The finance agent proposes the payout but cannot approve its own proposal.
5. The buyer-signed rule approves eligible, within-cap work; over-cap or failed checks go to buyer review. The CDP wallet cap independently guards execution.

## Coinbase: Best Use of x402

$500 USDC plus a recruiter call per eligible team member, per track. There are two tracks with one winning team each. The [brief](https://drive.google.com/file/d/12TnPLguduV3gh1zY_TJ176XmVDz2RGW9/view) defines them:

- **Payment Agents (our primary Coinbase track):** "Use the Coinbase MCP for Agents and x402" to let an agent pay for things, earn money, or both. The brief's examples include "manages the budget for a small business."
- **Trading Agents:** not applicable.

**Judging:** usefulness, technical design (reliability; explain the choice of models, tools, memory and scheduling), ease of reuse (someone else can install it and finish the core task from our instructions), and product feedback. Real-money transactions are not required; label simulated actions clearly, keep credentials private, and don't manage other people's funds.

**What we build:** see [payments](payments.md#where-coinbase-for-agents-fits).

- **x402 funding:** production uses the authenticated CDP facilitator. A 0.01-test-USDC payment settled through CDP and its real signed webhook was processed and reconciled; see [the trace](status.md#confirmed-webhook-delivery-and-cdp-settlement--0254-pdt). The earlier 10-USDC v2 funding used x402.org. These CLI payments are not evidence of Wallet MCP execution. The reusable [plugin](wallet-mcp-plugin/skarl.md) prepares `initiate_x402_request` / `complete_x402_request` with a `maxPayment` cap and human approval.
- **Payouts and policy:** the buyer-signed policy approves only a stored, bound intent within the buyer’s cap. With `PAYOUT_EXECUTOR=cdp_agent`, the existing CDP executor sends that approved intent and has a live 2-USDC cap and recipient allowlist, with real over-cap/non-allowlisted `403 policy_violation` results. A licensed submission and payable are still missing, so **no contributor payout is claimed**. [Policy evidence](status.md#live-retry-after-recovery-deployment--october-25-2026-0305-pdt).
- **Coinbase MCP (retail):** separate from Wallet MCP and outside this demo path. The previously cited 5 USDC limit is unverified in the current documentation; do not present it as a guaranteed product limit.

**Evidence mapped to Payment Agents judging:**

| Criterion | Reproducible evidence |
| --- | --- |
| Usefulness | An agent funds a collection order and can purchase a verified sample’s evidence; explain the buyer/contributor need. |
| Technical design | Durable intents, exact micro-USDC, bounded spending, buyer-signed policy approval separate from the proposer, and receipt reconciliation; explain model/tool choices and known failure paths. |
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

All orders, reports, decisions, payables, approvals and journals live in Convex. Show live propagation between the contributor and buyer Review views, a duplicate event rejected inside a mutation, and an atomic acceptance + payable + journal write.

Convex judges ask for real features ("live queries and components"), so the approval wait uses Convex Workflow. [Mutations](https://docs.convex.dev/functions/mutation-functions), [Workflow](https://www.convex.dev/components/workflow)

## Gemini

The default verifier runs **two separate silent-frame visual requests**, Argon and Flash, plus a separate Transcribe audio request. Narration is withheld from both visual calls. Deterministic code compares each observation with the rubric; visual disagreement or unavailable evidence routes machine recommendations to review. `VERIFIER_JURY=off` and explicitly scoped evaluations use one selected visual model instead. The jury is advisory, not statistically independent proof or payment authority.

The single-video default is `gemini-4-argon`; `gemini-3.5-transcribe` supplies audio. Gemini finance and read-only `askAgent` default to `gemini-3.8-flash`; the finance loop can separately select Claude. Stored model/provider metadata identifies what actually ran. Billing is enabled; earlier free-tier failures are historical. Each logical Gemini request has one shared 30-second deadline, including retries/backoff, within the finance run’s overall budget.

The [04:40 read-back](status.md#submission-evidence-refresh--october-25-2026-0440-pdt) records a negative jury run: Argon **7,758 ms**, Flash **4,916 ms**, Transcribe **718 ms**; both visual reports found task criteria unobservable. This is live integration evidence, not accuracy, calibrated independence or a successful task acceptance. [Configuration](ai-verification.md#models-and-configuration), [evaluation protocol](evaluation.md), [Gemini models](https://ai.google.dev/gemini-api/docs/models).

## Solana

**MLH Best Use of Solana:** the optional CDP-backed Solana Devnet x402 funding path now has live evidence: [1 USDC finalized funding on Solana Explorer](https://explorer.solana.com/tx/31LMrtZYcf4PcBRcyFmFX8tBmt2fNttNSBA4mz7sTrZKSw6E2kH9oghw5FTafzR77JZT9so1zzjkj8ZuVqrGUezi?cluster=devnet) at **03:29 PDT on October 25**. One bounded CDP buyer authorization funded `skarl-red-cup-demo-sol` through the CDP facilitator after fee-payer rotation fix `d91c1e9` reached Vercel production. HTTP 200 reported confirmed funding and provider `cdp`; no x402.org fallback was needed. Convex reports the order funded, one matched 1000000-micro-USDC journal/transfer and zero exceptions; RPC verified finalized slot 514940239, transfer instruction 2, canonical USDC, treasury ATA and order memo.

The earlier 03:13 attempt failed before settlement because fee-payer rotation broke exact quote matching. Its expired, unsettled authorization and spend reservation were retained before the single new attempt. Current-set fee-payer validation resolves that mismatch while retaining all economic and deduplication checks. See [live success and validation](status.md#confirmed-solana-funding-after-fee-payer-fix--october-25-2026-0329-pdt), [Solana rail](payments.md#solana-rail), and [Coinbase builder feedback](coinbase-submission.md#solana-fee-payer-rotation-during-x402-funding). Base/Coinbase remain primary and payouts remain Base-only. This proves testnet funding, not a Solana payout, bridge, Wallet MCP purchase or prize eligibility.

## Atlassian security track

The [official Forge challenge](https://docs.google.com/document/d/12Y2Vamxbm9W_l2Eo4AM530R7HfNAYCXI-UI6F6Xnggw/edit) requires a Forge app and evaluates originality, practical organizational value and execution using Atlassian APIs. Select **Best Security Solution for Agents** in the project description; include the repository and a demo video of at most three minutes. Skarl Guard limits instruction-like issue content to comments/human review, applies project/action/batch caps, records actions and only selectively reverts an unchanged applied result. Detection is heuristic, not comprehensive prompt-injection prevention.

The 04:53 Jira observations in the table are team-recorded; this hardening pass
did not re-run Jira or independently inspect the site. The existing comment
writer already sends Atlassian Document Format. Previously, both a rejected
write and a failed post-write issue read became `uncertain` with the error
status discarded, so the historical cause cannot be established from source.
New audit records preserve the numeric HTTP status and failure stage without
provider bodies. An administrator can reconcile a pending/uncertain write
after five minutes: the app reads every available comment page (bounded to
1,000 comments and 50 comment-property reads), matches its own author plus the stored action property or exact
legacy text/run marker, and records one deterministic reconciliation audit event.
It never posts another comment. Partial/ambiguous/unavailable observations stay
uncertain; a complete read-back resolves confirmed/failed. Existing event dedupe
continues to block replay even after failure. Label/priority writes remain
uncertain until independent changelog review establishes who made the change;
a matching human-edited value cannot authorize rollback.

The Convex public rate schema/cron and changed handlers require an operator
Convex deployment; no new limiter env variable is needed. Existing
`SKARL_PAYMENTS_SERVICE_SECRET`, seeded demo and optional `SKARL_MCP_KEYS` remain
required for their existing functions. Forge requires a separate deploy and
installation upgrade for the added `read:jira-user` permission; no env change is
introduced by reconciliation. Keep the successful historical sync/triage and
refused batch distinct from the unresolved comment and unrecorded
planted-injection sequence. [Code and local checks](../integrations/jira-forge/README.md), [review mapping](review-guide.md).

## Additional opt-ins and eligibility gates

- **Most Technically Complex:** map the general Devpost technical-depth criterion to specific trust-boundary failures and recoveries, rather than counting integrations. [Review mapping](review-guide.md).
- **Microsoft:** the [official Hacker Guide](https://docs.google.com/document/d/1RQrueC9wm5u8uxtWSC2gadIchp05hVayhGUrIjxT9dE/edit) asks for customer understanding, measurable usefulness, a path to production, responsible design and an end-to-end agent. It does not state an Azure requirement. Customer interviews, measured benefit and the complete payout flow are not established.
- **CREAO:** the [official track page](https://community.creao.ai/CalHacks2026) requires a CREAO agent doing core product work, its agent ID and shared run link in the Devpost README, and a running demo. No such integration or run evidence is recorded. **Do not claim eligibility from using another provider’s agent.** The three CREAO tracks remain conditional on meeting that requirement.
- **Commit Fellowship:** a working team prototype addressing a real problem, Devpost opt-in and the [supplemental form](https://mlh.link/commit-fellowship-form) are required. The [event prize listing](https://cal-hacks-13-0.devpost.com/) and [MLH category](https://www.mlh.com/events/prizes) establish the opportunity, not that the team has opted in or submitted the form.

## Other tracks and evidence gates

- **Auth0:** Cal Hacks 13.0 has no Auth0 prize. Optional Convex Auth/Google sign-in and membership checks are implemented; provider configuration and deployed behavior need verification. Impersonable seeded demo selectors remain available when demo mode is enabled and are not production authentication.
- **Cartesia:** no live evidence in the current status snapshot; exclude it as a working witness.
- **Anthropic:** Claude-default exception, payout and close notes persist provider/model metadata and remain advisory; the new analyst path requires backend deployment and live verification ([API](dashboard-api.md#advisory-finance-analyst)).
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

**Policy-bound autonomous agent wallets usable through Wallet MCP without a human click for each already-authorized transaction.** Let the operator define a revocable network/token/recipient/budget policy once, then allow bounded execution under that policy with a stable request ID. Skarl still requires its own stored buyer-policy or buyer-review business approval; this would remove the Wallet MCP manual signing handoff and the separate CDP SDK executor solely for bounded execution. Today's Wallet MCP remains in approval mode. No feature request has been sent externally.
