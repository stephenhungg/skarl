# Dashboard sponsor surfaces

What the dashboard must show so each sponsor judge sees their technology doing real work. The thesis on every screen: **every claim has a witness**. Each surface lists its data source (exact Convex function; arguments in [dashboard API](dashboard-api.md)), whether the dashboard renders it today, and the judge moment it creates.

Status: **Shown** = rendered in `apps/web/app/dashboard/**` today. **Missing** = API is live, UI is not. **Pending deploy** = code merged, needs a Convex deploy.

Labelling rule for every surface: testnet and simulated data carry a visible badge (`Base Sepolia`, `Solana Devnet`, `Mock bank (Nessie)`, `SIMULATED`). Never render an unconfirmed payout as paid.

## P0: build these first (they carry the most tracks)

| # | Surface | Source | Status | Tracks |
| --- | --- | --- | --- | --- |
| 1 | **Witness receipt** per submission: checklist of every witness (agree / disagree / missing / pending) with evidence links | `witnessReceipt.forSubmission` | Missing (receipt page reads only `submissions.getReport` + `media.submissionEvidence`) | All, the thesis made visible |
| 2 | **Four-way reconciliation table**: order · ledger · chain · bank per intent, mismatches in red | `bankWitness.reconciliation4Way`, `bankWitness.bankExceptions` | Missing (dashboard uses 3-way `payments.reconciliation`) | Hyphenate, Capital One |
| 3 | **Scenario lab**: buttons to inject the 6 attacks, live pass/fail table read back from the DB | `scenarios.run`, `scenarios.listRuns` | Missing | Hyphenate, Convex, MTC |
| 4 | **Agent refused** moment: finance agent proposal → self-approval refused, with audit reason | `financeAgentData.runs`, `dashboard.auditEvents` | Partially shown (agent page, audit page); make the refusal a highlighted card | Hyphenate, Anthropic, Coinbase |
| 5 | **Funding with rail badge and explorer links** (BaseScan / Solana Explorer), x402 status | `payments.fundingStatus` (`network`, `explorerUrl`) | Check: order summary shown; rail badge + explorer link likely missing | Coinbase, Solana |

## Per sponsor

### Hyphenate: autonomous finance (primary)
- Named seats on screen: **settlement accountant + AP clerk**.
- Duplicate catch: side-by-side frames with score, second payable blocked. `media.duplicatePair` (shown), `media.submissionEvidence`.
- Payables → proposal → independent approval → payout, each step with actor and time. `dashboard.payables`, `finance.proposePayment`, `finance.approve`, `dashboard.journal` (shown).
- Balanced journal and trial balance from journals. `dashboard.journal`, `statements.forOrder` (shown).
- Exceptions queue with acknowledge/resolve. `exceptions.list/acknowledge/resolve` (list shown; ensure actions are wired).
- 4-way reconciliation (P0 #2) and scenario lab (P0 #3).
- Real-vs-simulated inventory panel (static, from `docs/thesis.md` witness table).

### Coinbase: x402 Payment Agents
- **Pay**: x402 funding timeline (402 challenge → signed payment → CDP facilitator settlement → CDP webhook received → chain observation). `payments.fundingStatus`, `chainWitness.reconciliationWithWitness`, `chainWitness.webhookExceptions`.
- **Policy engine**: agent wallet card with address, policy ID, per-payout cap, and the two live `policy_violation` rejections (static evidence from `docs/agent-wallet.md` + status).
- Payout executor badge: `controller_wallet` vs `cdp_agent`, with the payout tx link. `payments.payoutAttempt`, `activity.payoutHistory`.
- **Earn**: evidence-sale (x402 Bazaar) count and receipts once live (`/api/samples/[id]/evidence`).
- **Agent-native**: "Connect your agent" panel with the MCP URL, A2A card and Wallet MCP flow (pending deploy, see [agents](agents.md) / [MCP](mcp.md)).
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
3. Agent run → self-approval refused → controller approves → payout tx link (Hyphenate, Coinbase, Anthropic).
4. 4-way reconciliation all green; then run the bank-mismatch scenario and watch it turn red live (Nessie, Convex).
5. "Connect your agent" panel (agent-native, Coinbase MCP).
