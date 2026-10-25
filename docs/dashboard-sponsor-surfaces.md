# Dashboard sponsor surfaces

Implemented in this source pass: clip-review work/money/judgment witness panels, ledger four-way reconciliation, and `/dashboard/scenarios` with confirmed, explicitly simulated runs and persistent audit evidence. Payout document-ID signing/recovery fixes have regression coverage, and proposals open the real agent loop. Local read-only browser checks verified these evidence surfaces; production version verification and operator deployment remain separate.

What the dashboard must show so each sponsor judge sees their technology doing real work. The thesis on every screen: **every claim has a witness**. Each surface lists its data source (exact Convex function; arguments in [dashboard API](dashboard-api.md)), whether the dashboard renders it today, and the judge moment it creates.

Status: **Shown** = rendered in source, not a production-version claim. **Missing** = source API exists, with presentation work still outstanding in this handoff. **Pending deploy** = source needs an operator deployment.

Labelling rule for every surface: testnet and simulated data carry a visible badge (`Base Sepolia`, `Solana Devnet`, `Mock bank (Nessie)`, `SIMULATED`). Never render an unconfirmed payout as paid.

## Demo path through the proof page (60 seconds)

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
- Payout executor badge: display **Buyer wallet** for legacy `controller_wallet`, or **CDP agent** for `cdp_agent`, with the payout tx link. `payments.payoutAttempt`, `activity.payoutHistory`.
- **Earn**: evidence-sale (x402 Bazaar) count and receipts once live (`/api/samples/[id]/evidence`).
- **Agent-native**: "Connect your agent" panel with the MCP URL, A2A card, Wallet MCP flow and personal-agent onboarding (`skarl_onboard`, `skarl_wallet_status`, `skarl_request_testnet_usdc`, `/skill.md`). See `docs/agents.md` and `docs/mcp.md`.
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
- **Token-2022 license per delivery**: each published delivery schedules a devnet mint (MetadataPointer + TokenMetadata, supply 1, mint authority revoked in the same transaction; metadata binds a `licenseDigest` over the manifest, terms, consent receipt and license hashes). `proof:solanaLicenses` and `proof:summary.solanaLicenses` return per-delivery `status` (`pending` / `minted` / `unconfirmed` / `failed` / `skipped`), `mintAddress`, `tokenUrl`, `transactionUrl`, `licenseDigest` and `testnetOnly: true`; the public `/proof.json` lists minted licenses only, without holder or contributor linkage. Badge: `Token-2022 · Solana Devnet`.

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
