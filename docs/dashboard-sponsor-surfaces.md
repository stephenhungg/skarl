# Dashboard sponsor surfaces

Implemented in this source pass: clip-review work/money/judgment witness panels, ledger four-way reconciliation, and `/dashboard/scenarios` with confirmed, explicitly simulated runs and persistent audit evidence. Payout document-ID signing/recovery fixes have regression coverage, and proposals open the real agent loop. Local read-only browser checks verified these evidence surfaces; production version verification and operator deployment remain separate. The checklist below still contains remaining presentation work.

What the dashboard must show so each sponsor judge sees their technology doing real work. The thesis on every screen: **every claim has a witness**. Each surface lists its data source (exact Convex function; arguments in [dashboard API](dashboard-api.md)), whether the dashboard renders it today, and the judge moment it creates.

Status: **Shown** = rendered in source, not a production-version claim. **Missing** = source API exists, with presentation work still outstanding in this handoff. **Pending deploy** = source needs an operator deployment.

Labelling rule for every surface: testnet and simulated data carry a visible badge (`Base Sepolia`, `Solana Devnet`, `Mock bank (Nessie)`, `SIMULATED`). Never render an unconfirmed payout as paid.

## Historical baseline audit (Oct 25, 06:10 PDT, main @ `f20665c`)

This teammate audit is retained against its named commit. The integration in this change now supplies G1 in Ledger → Reconciliation and G2’s eight-scenario run/history surface; the per-clip witness panel also exposes EAS links. These source changes were checked in a local browser. The historical grades and missing-surface rows below describe the earlier commit, not this integrated source. Remaining PR #2 capture/order-switching work and the separate proof-page plan are preserved. Deployment and the full live payout still need verification.

Method: grep of `apps/web/app`, `apps/web/features` and `apps/web/components` for each sponsor API and sponsor name. This audits **what a judge can see in the UI**, not whether the backend works (the backend items below are deployed and verified separately in [status](status.md)).

**Verdict:** the backend is A-tier and the dashboard is B- at best. Most sponsor proof lives only in Convex queries, CLI scripts and docs.

### UI grade per sponsor (if judged on the dashboard alone)

| Sponsor | Grade | Why |
| --- | --- | --- |
| Capital One (Nessie) | **D** | Zero UI mentions. Four-way bank reconciliation and bank exceptions exist only as queries. |
| Atlassian (Skarl Guard) | **C+** | The demo lives in Jira; the app never links to it or shows mirrored exceptions. |
| Coinbase (x402 / CDP) | **B-** | x402 copy is present; the agent wallet, CDP policy, payout transactions and funding timeline are not. |
| Convex | **B** | Everything is live-reactive, but nothing calls out Workflow, crons, scheduler, storage, HTTP actions. |
| Hyphenate | **B** | Inbox, payables, ledger, buyer review exist; four-way recon, scenario lab and a highlighted refusal moment are missing. |
| Google Gemini (MLH) | **B-** | Two mentions; no per-criterion jury panel showing both models, agreement and latency. |
| Anthropic (Claude) | **B-** | Coach is wired; no provider badge on agent runs, Claude's role is not visible. |
| Solana (MLH) | **C+** | Explorer link only; no `Solana Devnet` rail badge on funding. |

### Missing surfaces (API live, UI absent)

| # | Surface | Source (deployed) | Tracks | Owner |
| --- | --- | --- | --- | --- |
| G1 | Four-way reconciliation table, label **Mock bank (Capital One Nessie)**, mismatches red, bank exceptions list | `bankWitness.reconciliation4Way`, `bankWitness.bankExceptions` | Capital One, Hyphenate | Proof-page worker |
| G2 | Scenario lab: run buttons + live pass/fail read back from the DB | `scenarios.run`, `scenarios.listRuns` | Hyphenate, Convex, MTC | **Matthew (PR #2)** |
| G3 | Agent wallet card: address (BaseScan link), CDP policy id, per-payout cap, the two `policy_violation` rejections, executor badge `cdp_agent` | `agentWallet`, [agent-wallet](agent-wallet.md), `payments.payoutAttempt` | Coinbase | Proof-page worker |
| G4 | Payout history with transaction links | `activity.payoutHistory` | Coinbase, Hyphenate | Proof-page worker |
| G5 | x402 funding timeline: 402 challenge → signed payment → facilitator settlement → CDP webhook → chain observation | `payments.fundingStatus`, `chainWitness.reconciliationWithWitness`, `chainWitness.webhookExceptions` | Coinbase | Proof-page worker |
| G6 | EAS attestation badge + EASScan link per verified submission | `attestations.forSubmission` | Coinbase, MTC | Proof-page worker |
| G7 | Skarl Guard card: Jira project link (`one-atlas-hmeq.atlassian.net`, project SKARL), count of mirrored exceptions, "agents can't approve" note | `/jira/feed` contents, `exceptions.list` | Atlassian | Proof-page worker |
| G8 | "Convex features in use" panel + analytics: Workflow (approval wait), crons (reconcile 2m, attest 2m, bank sweep 2m, finance 10m), scheduler, file storage, Node actions, HTTP actions (`/mcp`, `/jira/feed`, discovery) | `analytics.overview`, `analytics.timeSeries`, `scheduledData.snapshots` | Convex | Proof-page worker |
| G9 | Jury panel per submission: both models, per-criterion verdict, agreement, latency | `submissions.getReport` (`pipeline.modelRuns`), `witnessReceipt.forSubmission` | Gemini | Proof-page worker |
| G10 | Provider badge (`claude-sonnet-5-5` / gemini) on every finance-agent run; coach card labelled "Claude, advisory" | `financeAgentData.runs` (`provider`, `model`), `coachData.forSubmission` | Anthropic | Proof-page worker |
| G11 | Rail badge `Base Sepolia` / `Solana Devnet` + explorer link on funding | `payments.fundingStatus` (`network`, `explorerUrl`) | Coinbase, Solana | Proof-page worker |
| G12 | Tax panel: YTD per contributor, form status, flags, CSV, "Not tax advice" | tax worker (in flight) | Hyphenate | Tax worker |
| G13 | Highlighted refusal card: agent proposal → `self_approval_refused` with audit reason, then policy-engine approval | `financeAgentData.runs`, `dashboard.auditEvents` | Hyphenate, Anthropic, Coinbase | Proof-page worker |

### Build plan

1. **Matthew — merge PR #2** (`matthew/dashboard`: scenario lab, contributor capture view, order switcher, phone evidence). It is open and `CONFLICTING` with main: rebase on main, keep main's buyer/controller auth and auto-pay changes, re-run `pnpm check`, merge.
2. **Proof-page worker** — new route `apps/web/app/dashboard/proof/page.tsx` plus cards in `apps/web/features/dashboard/proof/*` (new files only, to avoid colliding with in-flight auth and PR #2 changes). One section per sponsor with a sponsor heading, G1 and G3–G11 and G13, a link to it in the dashboard nav.
3. **Tax worker** — G12, already queued.

### Acceptance (per surface)

- Reads live data from the deployed Convex functions above; no hardcoded numbers except documented static evidence (CDP policy id, the two recorded rejections).
- Carries the labelling badges above; unconfirmed payouts never render as paid.
- Empty state says exactly which prerequisite is missing (for example "No accepted clip yet").
- Every external proof is a clickable link (BaseScan, Solana Explorer, EASScan, Jira, Nessie account id).

### Demo path through the proof page (60 seconds)

Scenario lab: run `bank_mismatch` → four-way table turns red live (Capital One, Convex) → agent run card shows Claude badge and the refused self-approval, then policy-engine approval (Anthropic, Hyphenate) → payout row with BaseScan transaction link and `cdp_agent` executor (Coinbase) → Skarl Guard card opens the Jira ticket (Atlassian).

## P0: core evidence surfaces

| # | Surface | Source | Status | Tracks |
| --- | --- | --- | --- | --- |
| 1 | **Witness receipt** per submission: checklist of every witness (agree / disagree / missing / pending) with evidence links | `witnessReceipt.forSubmission` | Shown below the clip and rubric; optional witnesses remain advisory | All, the thesis made visible |
| 2 | **Four-way reconciliation table**: order · ledger · chain · bank per intent, mismatches in red | `bankWitness.reconciliation4Way`, `bankWitness.bankExceptions` | Shown in Ledger → Reconciliation; mock bank explicitly labeled | Hyphenate, Capital One |
| 3 | **Scenario lab**: confirmed actions for 8 labeled simulations, expected/observed outcomes read from the DB | `scenarios.run`, `scenarios.listRuns` | Shown at `/dashboard/scenarios`; missing prerequisites remain blocked | Hyphenate, Convex, MTC |

| 4 | **Agent refused** moment: finance agent proposal → self-approval refused, with audit reason | `financeAgentData.runs`, `dashboard.auditEvents` | Partially shown (agent page, audit page); make the refusal a highlighted card | Hyphenate, Anthropic, Coinbase |
| 5 | **Funding with rail badge and explorer links** (BaseScan / Solana Explorer), x402 status | `payments.fundingStatus` (`network`, `explorerUrl`) | Check: order summary shown; rail badge + explorer link likely missing | Coinbase, Solana |

## Per sponsor

### Hyphenate: autonomous finance (primary)
- Named seats on screen: **settlement accountant + AP clerk**.
- Duplicate catch: side-by-side frames with score, second payable blocked. `media.duplicatePair` (shown), `media.submissionEvidence`.
- Payables → agent proposal → buyer-policy approval or buyer exception review → payout, each step with actor and time. `dashboard.payables`, `finance.proposePayment`, `finance.approve`, `dashboard.journal` (shown).
- Balanced journal and trial balance from journals. `dashboard.journal`, `statements.forOrder` (shown).
- Exceptions queue with acknowledge/resolve. `exceptions.list/acknowledge/resolve` (list shown; ensure actions are wired).
- 4-way reconciliation (P0 #2) and scenario lab (P0 #3).
- Real-vs-simulated inventory panel (static, from `docs/thesis.md` witness table).

### Coinbase: x402 Payment Agents
- **Pay**: x402 funding timeline (402 challenge → signed payment → CDP facilitator settlement → CDP webhook received → chain observation). `payments.fundingStatus`, `chainWitness.reconciliationWithWitness`, `chainWitness.webhookExceptions`.
- **Policy engine**: agent wallet card with address, policy ID, per-payout cap, and the two live `policy_violation` rejections (static evidence from `docs/agent-wallet.md` + status).
- Payout executor badge: `controller_wallet` vs `cdp_agent`, with the payout tx link. `payments.payoutAttempt`, `activity.payoutHistory`.
- **Earn**: evidence-sale (x402 Bazaar) count and receipts once live (`/api/samples/[id]/evidence`).
- **Agent-native**: "Connect your agent" panel with the MCP URL, A2A card and Wallet MCP flow (pending deploy, see `docs/agents.md` and `docs/mcp.md` once merged).
- Builder feedback link (`docs/coinbase-submission.md`).

### Convex
- Everything above updates live without refresh; make one moment obvious: scenario run or webhook arrival flipping a row in real time.
- Activity feed and analytics. `activity.feed`, `analytics.overview`, `analytics.timeSeries` (missing).
- "System" panel listing the real features in use: Workflow (approval wait), crons (reconcile 2m, attest 2m, bank sweep 2m, finance 10m), scheduler, file storage, Node actions, HTTP actions (`/mcp`, `/jira/feed`, discovery). `scheduledData.snapshots` (shown).

### Capital One: Nessie
- Bank column in the 4-way table (P0 #2), labelled **Mock bank (Capital One Nessie)**.
- Bank account cards (Treasury, contributor) with Nessie account ids and last snapshot time; bank exceptions. `bankWitness.bankExceptions`.
- Cent-exact note: sub-cent amounts are refused, not rounded (show `nessie_subcent_amount` honestly).

### Atlassian: Security for Agents (Skarl Guard)
- Link card to the Jira project (`one-atlas-hmeq.atlassian.net`, project SKARL) and the Skarl Guard admin page.
- Count of exceptions mirrored to Jira (from the `/jira/feed` contents). Optional; the main demo lives in Jira itself.

### Anthropic: Claude
- Contributor coach card on every submission: plain-language explanation with cited timestamps, "advisory" badge, cannot change verdict. `coachData.forSubmission`, `coach.explainOutcome` (missing on web).
- Finance agent provider badge (`claude` / `gemini`) on each agent run. `financeAgentData.runs` (`provider`, `model`).
- Contributor earnings view (fair-pay framing for Public Benefit). `datasets.contributorEarnings` (missing).

### Gemini (MLH)
- Jury panel per submission: both models, each one's per-criterion verdict, agreement/disagreement, latency. `submissions.getReport` (`pipeline.modelRuns`), `witnessReceipt.forSubmission` (jury witnesses).
- Evidence player: click a criterion to seek the video to its timestamp, with the transcript aligned. `media.submissionEvidence`.
- Eval card: Wilson CIs, kappa, risk-coverage (static from `evals/` report).

### Solana (MLH)
- Rail badge `Solana Devnet` + Explorer link on Solana-funded orders. `payments.fundingStatus`.

### EAS (supports Coinbase / Most Technically Complex)
- Attestation badge with EASScan link on each verified submission. `attestations.forSubmission`.

### iPhone sensors and liveness (supports MTC, Gemini, Hyphenate)
- Motion summary: steadiness ratio, mean tilt, active-motion intervals on the timeline. `submissions.getReport` / sensor trace summary (see "Mobile sensor evidence" in the API doc).
- Liveness result: issued words and the matched transcript timestamp, or why it routed to review. `witnessReceipt.forSubmission` (liveness witness).

### Buyers (product completeness)
- Dataset export button (JSON / JSONL). `datasets.forOrder`, `GET /api/orders/[id]/dataset`.

## Demo order of screens (3-minute pitch)
1. Submissions → duplicate caught (Hyphenate moment).
2. Witness receipt of the good clip (thesis).
3. Agent run → self-approval refused → buyer-signed policy approves → independent CDP cap → payout tx link (Hyphenate, Coinbase, Anthropic).
4. 4-way confirmed funding comparison; then run the explicitly simulated bank-mismatch probe and inspect its recorded discrepancy (Nessie, Convex).
5. "Connect your agent" panel (agent-native, Coinbase MCP).
