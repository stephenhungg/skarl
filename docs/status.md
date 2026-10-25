# Build Status

Current source summary, October 25, 2026. The dated entries below preserve observations from their actual runs; historical “pending” notes do not override newer evidence. Source implementation is distinct from deployment and live validation. See the [review guide](review-guide.md) for criterion-to-code navigation.

| Area | Implemented in source | Remaining live proof |
| --- | --- | --- |
| Web | Buyer review dashboard, contributor web/mobile flows, optional Google/Convex Auth, replay and dataset exports; witness receipt, four-way reconciliation and explicitly simulated scenario UI | Verify the version served by the new public domain `skarl.devshardat.work` and separately pinned payment origins; the historical Vercel quota blocker and hosted-source drift are recorded below. Physical-phone validation remains pending. |
| Finance | Funded-quota acceptance, consent/source/wallet gates, exact/perceptual duplicate refusal, buyer-defined policy/exception approval, durable Workflow, payout/refund observation and exact double-entry statements | Licensed original → duplicate caught → real agent proposal/refusal → buyer policy approval or exception review → actual contributor payout/reconciliation. |
| Verifier | Server SHA-256, FFmpeg audio isolation and stored frame/dHash evidence; Argon/Flash visual jury, independent transcription, frozen-rubric comparison, liveness, validated fail-to-review reports | A consented labeled human corpus, legitimate-retake/copy calibration and a positive live contribution. Negative inference is not measured task accuracy. |
| Evaluation | Frozen labels/source hashes and paired-model runner; explicit content-only mode for prerecorded evaluation, retaining separate operational liveness/licensing review | No human-corpus accuracy or false-acceptance benchmark yet. Content metrics never grant acceptance or payout eligibility. |
| Payments | Recorded Base Sepolia x402/CDP funding and signed webhook; finalized Solana Devnet funding; wallet-policy cap/allowlist refusals | No verified contributor payout/refund, Wallet MCP purchase, accepted-sample evidence sale or Bazaar listing. Solana remains funding-only. |
| Agents | Bounded Gemini/Claude tool loops, transcripts, scheduled proposals, refusal audits, contributor coaching | Recorded Claude read-only run: 4,636 ms, three read tools, zero proposed amount. Live coach impact and full approval/dispatch remain unmeasured. |
| Witnesses | Chain and EAS observations, hosted Nessie mock-bank funding comparison, optional sensors and SQL adapter | Nessie is simulated banking, not fiat. SQL was unavailable in the last observation. Advisory witnesses cannot waive financial/source gates. |
| Sponsors | Official requirements rechecked; [criterion/evidence/gap map](review-guide.md) | Complete the central demo, required video/opt-ins and per-member eligibility. CREAO core-agent/run requirements are currently unmet. |

Local checks establish only the paths they execute. They do not establish deployed behavior, inference accuracy, settlement, customer benefit or sponsor eligibility.

## System status

Source implementation: `GET /health` on the Convex **site** origin returns a
redacted integration report, also available as the public `health:integrations`
query. Each row includes `ok`, `degraded` or `missing`, a reason, repair guidance,
query time, last successful evidence time where known and allowlisted evidence.
Credentials are represented by variable names and configuration booleans only;
`SITE_URL` is the public origin. Original media, model text, account identifiers,
provider errors and credential values are excluded.

Run `pnpm demo:preflight` using the existing public Convex URL configuration, or
`pnpm demo:preflight --url https://YOUR-DEPLOYMENT.convex.site`. It prints a table
and exits nonzero for an unavailable/incomplete endpoint or any missing
demo-critical prerequisite: model calls, reconciliation/finance crons, CDP agent
gas/USDC, treasury USDC, required Convex configuration and a licensed accepted
clip on the canonical demo order. It explicitly prints **needs a licensed
accepted clip** when that blocker remains. Optional sponsor integrations stay
visible; degraded rows require review even when the command exits zero.

The internal `health:refresh` action performs bounded read-only Base Sepolia RPC
and known-account Nessie GET probes every two minutes; public GET/query calls
only read cached probes and stored evidence. Balances are decimal integer
strings, bound to their wallet/account; zero funds are missing and probes older
than five minutes are degraded. Cron wrappers record invocation outcomes, not
proof of every downstream settlement. Model rows read stored successful calls,
including negative review reports, and exclude scenario replays. Nessie remains
simulated banking; Solana remains optional funding-only.

Operator deployment is required for the Convex schema/functions/crons and the
Forge publisher. The latter sends numeric successful-sync/uncertain-inventory
telemetry to authenticated `POST /health/jira` using the existing feed secret;
truncated inventory is unknown, never zero. No new credential is needed. Until
deployed and exercised, new cron/probe/Forge telemetry is missing. This source
change does not deploy Convex, change environment variables, exercise Google
sign-in, call a model, attest, or send money. Preflight is not end-to-end proof.
The required Convex variable names are enumerated in
[`REQUIRED_ENV`](../convex/lib/health.ts); existing values must be supplied through
the operator's secret manager. `PAYOUT_EXECUTOR` must select the CDP agent;
Nessie/EAS flags must enable their respective integrations. Google setup is in
[authentication](auth.md). `BASE_SEPOLIA_RPC_URL` is optional (the public Base
Sepolia RPC is the default), and treasury identity comes from the canonical
demo order's stored funding intent. Web-only webhook/origin configuration is
outside this Convex environment inventory and still needs separate verification.

## Task-scoped verifier — October 25, 2026 (source; deployment pending)

- Replaced the red-cup-only pipeline with `task-evidence-2.0`, frozen order/rubric
  task specs, task-generated silent video/general audio prompts and task-scoped
  TypeScript/Python observation validation. Legacy `red-cup-evidence-1.2` reports
  remain readable. Native timestamped transcription uses deterministic task-aware
  claim extraction.
- Read the existing rubrics without changing deployment state. The can order
  `kh7c6cy844fyjxzpsg945v0c618gzsha` asks for movement **closer to the hat next to
  the lamp**. The spec preserves this relationship. Can detector evidence is
  `not_applicable`; cup/bottle detections cannot corroborate a can.
- Mocked can evidence traverses both visual judges, audio, canonical storage and
  scoped validation. Cross-task labels and narration instructions are rejected;
  an unknown spec persists a failed/review report. No fixture result establishes
  live task accuracy, licensing or payment authority.
- Operator needs: deploy Convex and web, then run
  `pnpm exec convex run taskSpecMigration:backfill '{}'` against that deployment.
  The internal migration is idempotent and preserves existing financial/rubric
  hashes and historical reports. No deployment or migration was run here; live
  Gemini on a licensed can clip and physical-phone validation remain outstanding.
- Local verification: `pnpm check` and 59 Python verifier tests passed. Mobile
  dependencies are absent in this worktree, so standalone Expo typecheck/runtime
  capture remain unverified. See [task-spec handoff](ai-verification.md#task-scoped-evidence-source-implementation-october-25).

## Sponsor review integration — October 25, 2026

- Browser payout signing/recovery now use the Convex intent document ID, not the business event key. Proposal actions open the real finance-agent loop rather than impersonating an agent with a demo selector; existing buyer rejection and policy execution controls are preserved.
- Clip review exposes stored work, money and judgment witnesses. The ledger has a four-way reconciliation tab. The scenario lab requires explicit confirmation, labels synthetic inputs, retains audit evidence and distinguishes missing prerequisites from passed controls.
- The wallet Workflow tests now wait for actual dispatch/paid boundaries with a bounded fake clock, avoiding Workpool maintenance timers advancing approvals into expiry. Production expiry and signing policy are unchanged.
- Prerecorded evaluation can opt into content-quality metrics without claiming liveness was tested or making media publishable/payable. The operational report retains the missing-liveness/licensing restrictions.
- This pass does not deploy, run paid inference, create scenario artifacts or send a payment. Integrated `pnpm check` passed: 185 package/script, 877 Convex, 185 payment and 33 web tests (1,280 total), typechecks, 57-file documentation checks and the production build. A local browser connected read-only to the shared cloud rendered the scenario history, confirmation/cancel flow, clip witnesses and the stored 10-USDC four-way funding match. No scenario was executed by this pass; the historical run rows belong to their original executions. Production hosting and the new content-only cloud protocol still require operator deployment.

## Coinbase Wallet MCP upgrade — October 25, 2026

### Live provisioning and web deployment fence

The operator deployed the backend, and `payments:createWalletMcpDemo({})` returned one order, `kh7f2fkah4hh0sx9s0wsdcweb98gzrdd`, with frozen `fundingPayTo:0x0a9efdf66c58543538824906ae267b969ed651c5`, a 1-USDC budget and disabled auto-pay. No signing or settlement occurs during provisioning. Repeated calls recover this same order through its stable creation key.

Fresh unsigned GETs to both `skarl.vercel.app` and `skarl.devshardat.work` still returned the old human treasury recipient and omitted `autoPay`/`fundingTermsHash`. The coordinator rejected this stale web deployment before any Wallet MCP initiation. Deploy the payment web routes from `2841ee9` or a compatible later main commit, then verify that GET returns the frozen agent recipient, disabled rule and terms hash before preparing a wallet request. Do not bypass the preflight or fund the old quoted recipient.

The final integration after the shared-config merge passed **1,701 tests** (267 package/script, 1,194 Convex, 195 payment, 34 web, 11 finance eval), typechecks, the no-hardcode check, documentation checks and production build. This proves local integration behavior, not a completed Wallet MCP payment. A human approval request and actual transfer remain pending the web deployment.


- Added a non-signing funding coordinator (`pnpm wallet:fund`) with exact quote/recipient/cap checks, private state, write-ahead request boundaries, same-request recovery, first-completion deadlines and independent seller + canonical chain verification. Operator-entered MCP metadata is not cryptographic tool provenance or a journal check.
- Added a versioned funding-terms commitment over the order, budget, canonical Base USDC, recipient and buyer auto-pay rule. The HTTP route and atomic claim both reject stale reviewed terms before settlement/new financial writes. Legacy callers remain compatible.
- Added an operator-only idempotent one-order agent-treasury path with auto-pay disabled. It freezes that order's Base recipient to the configured CDP agent wallet; the global treasury and other orders stay unchanged. Public order creation cannot select an arbitrary payee.
- **Live read-only MCP evidence:** `get_wallets` returned the existing human treasury as the connected Base Account; `search_x402_services` for Skarl on Base Sepolia returned zero matches. Both real calls completed once. No initiation, completion or transfer ran in this probe.
- Both web and Convex code must be deployed before provisioning/funding the agent-treasury order. A completed Wallet MCP funding payment, Bazaar listing, licensed sample sale and contributor payout are not inferred from code or read-only discovery. Final integrated `pnpm check` passed 261 package/script, 1,187 Convex, 192 payment, 34 web and 11 finance-eval tests (1,685 total), typechecks, documentation checks and the production build. A cloud invocation found `payments:createWalletMcpDemo` unavailable on the current shared deployment; that failed invocation created no order or payment. The operator owns deployment before provisioning and human wallet approval.

## Verifier jury and evaluation honesty — October 25, 2026

Implemented and pushed for operator deployment:

- Default-on `VERIFIER_JURY` runs Argon and Flash on the same silent frames in
  parallel with separate audio. Argon stays primary; per-criterion disagreement
  or a failed visual request produces review. Both model attempts and advisory
  per-model reports are retained; agreement is `null` on failed analysis.
  Explicit evaluation model overrides remain single-model; `VERIFIER_JURY=off`
  restores the configured single-model deployment path.
- Python/JS scorers agree on Wilson 95% intervals, criterion Cohen's kappa with
  confusion matrices, and risk/coverage. The requested 0/15, 0/20 and 1/15
  interval regressions pass. Failures and review abstentions do not masquerade
  as successful automatic decisions; undefined denominators remain `null`.
- Approximate duplicate candidates use one-to-one monotonic informative-frame
  alignment, at least three matches, mean Hamming distance <=6 and maximum <=10.
  The evidence query returns the actual aligned indices/assets. Local FFmpeg
  re-encode, synthetic one-second shift, unrelated/static/blank fingerprints,
  non-reuse and a second-payable refusal regression pass. dHash does not cover
  crop, flip, overlay or screen recapture; real trim recall and retake false
  positives remain uncalibrated.

Validation after the code changes: `pnpm check` passed typechecks, 126 package/
script tests, 302 Convex tests, 168 payment tests, docs checks and the web build.
The eval suite passed 14 Python unit tests; the installed verifier environment
passed 54 pytest tests. Provider behavior in the jury tests is mocked. No live
inference, new labeled-corpus measurement or chain transaction ran for these
upgrades. No Convex deploy was performed; the operator must deploy `origin/main`
to activate the backend changes. The jury adds a second visual request by
default, so its live cost/latency and review rate still need measurement.

See [verification rationale](ai-verification.md#why-these-choices) and
[metric definitions](evaluation.md#uncertainty-agreement-and-selective-prediction).

## Initial scaffold verification (October 24, 2026)

The following ran under Node 22.21.1 on October 24:

- frozen pnpm install, typecheck, 16 TypeScript tests, the docs link check and the Next.js production build
- 16 pytest tests and 7 eval unittests under **Python 3.14.7**

CI targets Python 3.11, and local 3.11 was not exercised then. The test counts predate the audit fixes.

## Verification after audit fixes

On October 25, 2026 (Node 22.21.1, pnpm 10.19.0): frozen install, `pnpm check` (root, Convex and web typecheck; 62 TypeScript tests; docs link and anchor check; Next.js production build) passed. `pnpm check:convex` pushed the schema and indexes to an anonymous local Convex backend with typechecking enabled. Python: 54 verifier pytest tests and 10 evaluation unittest tests passed under 3.14; the verifier suite also passed under a fresh 3.11 environment. The TypeScript and Python validators share `packages/contracts/schemas/fixtures/verification-cases.json`. None of these run inference, x402 settlement or Base Sepolia transfers. Remote CI result: pending push.

## Task 1 shared deployment

- Client URL: **https://keen-marmot-986.convex.cloud**; project `skarl`, deployment `dev:keen-marmot-986`.
- Seed: one organization, four impersonable demo identities, one unfunded 100-USDC red-cup order and frozen rubric. Running it again returns the same IDs. No transfers, media, inference results or verified-wallet proofs are fabricated.
- Atomic acceptance consumes funded quota, publishes an inline licensed manifest and creates one payable plus balanced fulfillment journal. SHA/perceptual-hash equality with already accepted work blocks a second payable and persists the matching submission as audit evidence. Hash computation and full model-report validation remain upstream work.
- Payment proposals bind requester/recipient/amount/source. Self-approval, agent approval and changed bindings are refused with durable audits. Independent approval queues execution; it does not move money or mark a payable paid.
- Demo identity selectors are public and impersonable. Server role checks are working demo policy, not production authentication.

Task 1 verification (Node 22.21.1, October 25): `pnpm check` passed root/Convex/web typechecks, 62 package tests, 26 Convex regressions, local Markdown links/anchors and the production web build. The cloud equivalent of `check:convex` (`pnpm exec convex dev --once --typecheck enable`) passed against the shared dev deployment. Seed was run repeatedly with identical IDs; a native cloud read-back verified all dashboard queries, one seed audit, three rubric criteria, zero cash/payables/journals and truthful health flags. The Convex tests use synthetic storage, wallet, funding and analysis fixtures; no inference, wallet proof or chain transfer ran. No source under `apps/web` or `packages/payments` changed.

## Payments implementation (October 25)

Payment work reuses the existing schema without additions. `convex/payments.ts` authenticates server imports using the configured service secret; browser demo identity selectors remain impersonable and are not production authentication. Pending funding never becomes funded on signature alone. Payouts require a stored independent approval and one execution claim. Both post only after the exact USDC log has two confirmations.

The public facilitator was queried live and advertises V2 `exact` on Base Sepolia. A live RPC query returned chain ID 84532 and zero USDC/ETH for buyer `0xa54DABc8583B869d488d63d691EC5d6a256c1a9D`. No signed payment or transaction was sent. The private testnet key and service secret are outside source control with mode 600. The service secret is installed in the shared Convex deployment; payment functions must be deployed together with the concurrent backend builder's newer verifier functions.

`pnpm check` includes package, Convex and actual Next/x402 route tests plus typechecks, docs validation and the production build. Payment tests use synthetic chain/facilitator evidence. They do not prove a live settlement. See [payment setup and handoff](payments.md) for the browser hook, MCP arguments and recovery procedure.

## Live funding preflight (October 25, 2026)

A live Base Sepolia RPC read returned chain ID `84532` and `20000000` micro-USDC
(20 USDC) for buyer `0xa54DABc8583B869d488d63d691EC5d6a256c1a9D`.
The shared Convex payment service secret is synchronized with the private local
configuration. No treasury address has been configured: the wallet web session
requires human sign-in. The local funding endpoint returns HTTP 503 with
`treasury_not_configured`, and no funding authorization or transfer was sent.
There is no transaction hash or BaseScan funding link to report.

Deployment polling observed the payment functions at 01:33 PDT. `pnpm seed`
returned v2 order `kh7531zdrt7bn8vrs5qsw3c8bs8gy0cg`. A trusted live
`payments.fundingStatus` read verified public ID `skarl-red-cup-demo-v2`,
`budgetAtomic: 10000000`, four samples at `2500000` micro-USDC,
`status: awaiting_funding`, and null intent/attempt. Running
`pnpm agent:fund skarl-red-cup-demo-v2` stopped with the actionable missing
`SKARL_TREASURY_ADDRESS` error before signing. The payment owner did not deploy
Convex; the main-checkout owner supplied the deployment.

Wallet MCP is configured as `base-mcp` at `https://wallet-mcp.coinbase.com` in
both Claude Code and Codex. Claude Code reports `Needs authentication`;
configuration alone is not a connected wallet session. A human must sign in to
the existing Coinbase Wallet, authorize the MCP connection, and provide its
Base Sepolia receiving address. No wallet was created, credentials entered,
message signed or transaction approved during this preflight. Both OAuth waits
timed out without authentication. Restart with `claude mcp login base-mcp`
(or `codex mcp login base-mcp`), then complete the human Coinbase sign-in and
connection approval. No existing wallet address could be read; this does not
establish that the operator has no wallet.

`pnpm check` passed: typechecks, 74 package tests, 49 Convex tests, 24 payment
tests, documentation checks and the production build. These tests use synthetic
payment evidence and do not establish live settlement.

## Task 2 verification and actual provider state

Code is deployed to **https://keen-marmot-986.convex.cloud**. Upload creation
schedules `verify.run`; it hashes original bytes, separates modalities, computes
server frame hashes, makes independent provider requests and stores a canonical
rubric-validated report. A five-minute watchdog stores a failed/review report
for interrupted attempts; stale results cannot upgrade it. The sample CLI is
`pnpm verify:sample <path-to-mp4>` and always marks the clip verification-only,
which the finance acceptance mutation refuses.

**What ran live:** a ten-second synthetic color-pattern video with machine
speech (“This is a synthetic verification test. No human performs the red cup
task.”) was uploaded and processed on the cloud deployment. Original bytes were
SHA-256 hashed server-side; FFmpeg decoded and isolated media, produced twelve
JPEGs/six dHashes, and the real Transcribe response was validated and persisted.
The latest scheduled run's audio round trip was **1,262 ms**; total action time
was **8,942 ms**, including failed visual requests. Its report is correctly
`failed` / `needs_review`, not a successful multimodal acceptance. No human data,
Gemini key, raw media or provider response is committed.

**What did not succeed live:** Flash (`gemini-3.8-flash`) visual requests returned
503/high demand or timed out for native video, twelve sampled JPEGs, and a
minimal 32×32 PNG probe. Even a legacy video transport probe timed out. Structured
text succeeded after reducing provider schema array limits. Argon
(`gemini-4-argon`) returned HTTP 429 with **0 requests/day on Free Tier**. No
billing/account upgrade was performed. Model listing is not inference quota.
The cloud configuration was restored to the requested Flash + Transcribe
model defaults. Those quota failures describe the earlier free-tier state;
billing is now enabled and subsequent Interactions probes succeeded.

**Chosen duplicate approach:** server-computed original SHA-256 and six sampled
64-bit dHashes, with bounded Hamming candidate checks repeated at acceptance.
One benign synthetic re-encode is covered by real local FFmpeg tests; crop/speed
robustness and legitimate-retake false positives are unmeasured. Client frame
hashes have an explicit `clientReported` fallback label when server preparation
fails, cause review and cannot qualify quarantined media for automatic payment.
Failed provider attempts alone do not make a later retry a copy candidate.

**Test scope:** Gemini responses are mocked in deterministic comparison,
malicious-narration, malformed-output and timeout tests. Local media tests use
actual FFmpeg. The separate cloud observations above are live integration
measurements, not an accuracy benchmark. No onchain money moved.

Latest measured submission: `mn76ffw1ds98w5s2n1rqgtjrp18gz13h`, pipeline
`red-cup-evidence-1.1`, original SHA-256
`8047a87afedc01a0a54ebcffd301d39970dfc965f657c407c6c08572f9a5a57d`.
The report and observations can be read through `submissions.getReport` with the
controller demo selector. Final Task 2 checks passed under Node 22.21.1: `pnpm check` (62 package + 88 Convex tests, typechecks, docs links/anchors and production build), cloud deploy/typecheck, and secret preflight. The 88 Convex tests include 62 added Task 2 cases on top of the 26 Task 1 cases. No source under `apps/web` or `packages/payments` changed; raw media stays ignored.

## Combined-main verification (October 25, 2026)

Task 2 was rebased onto the payment and contributor work, preserving both sets
of package scripts, generated APIs and documentation. The combined backend was
deployed to the shared Convex development URL. A Node/DOM `Blob` type conflict
was fixed by using the Node 22 global constructor.

`pnpm check` passed: 74 package tests, 111 Convex tests, 24 payment-route tests,
root/Convex/web typechecks, documentation links and the production web build.
The installed Python verifier suite passed all 54 tests. Cloud deploy/typecheck
and the outgoing-secret/media preflight passed. These checks do not establish
successful visual inference or live chain settlement.

Known integration gaps remain: contributor wallets need verified provisioning
before acceptance can create a payable; duplicate refusals persist evidence in
the controller audit but currently show generic review in the contributor UI.

## First live x402 funding (October 25, 2026, ~01:30 PDT)

The buyer agent (`pnpm agent:fund skarl-red-cup-demo-v2`) paid the x402-protected funding route on Base Sepolia through the public testnet facilitator. Transaction [0x28b3…d757](https://sepolia.basescan.org/tx/0x28b3f88d593c02a669cb95f4bdc6a23ab3d24bb5d1260e6c4ae54554155cd757) (block 49978209, status success) transferred exactly 10.000000 USDC (`0x036C…CF7e`) from the buyer `0xa54D…1a9D` to the controller's Coinbase Wallet `0x8408…695f`; the buyer paid no gas. Convex reported the funding as `confirmed` only after the server observed the Transfer log. Receipt and balances were rechecked independently over Base Sepolia RPC.

## Task 3 — finance agent

A real Gemini function-calling loop is implemented in `financeAgent.run`, with
six allowlisted tools over deterministic Convex projections and proposals.
Model-selected approval calls can only reach the existing server refusal as the
finance-agent identity. Batch amounts/destinations come from stored payables in
one transaction; the model cannot set them. Runs and tool results are persisted
for the dashboard. See [agent API/configuration](finance-agent.md#running-the-implemented-agent).

Approval Workflow, statement queries and the clip evaluation runner are the next
ordered quality items. The transcript tests use mocked provider responses and
synthetic obligations; they do not prove a live transfer or inference accuracy.

Agent validation: `pnpm check` passed 74 package, 126 Convex and 24 payment-route
tests plus typechecks/docs/build. The 14 new action tests mock the provider; an
additional transport regression covers Gemini's `requires_action` status. The
cloud action deployed successfully. A live read-only Flash request timed out
after **60,423 ms**, stored run `mx765vzkc04sqfqe66jjxx1ssd8gyhff` as failed with
`gemini_timeout`, and executed no tools. No complete live agent loop or payment
is claimed from this attempt.

## Task 3 — durable approval Workflow

Payout proposals start the real `@convex-dev/workflow` component and persist its
ID. Controller approval sends a durable event; the resumed mutation revalidates
current independent-controller membership, the binding/source snapshot, exact
amount/recipient/asset and expiry before queuing dispatch once. The payment claim
now requires this pending outbox entry. Dashboard payables expose `dispatchReady`;
clients must wait for it after approval. No Workflow step signs or sends funds.

Tests use the component's actual `convex-test` registration, not a fake Workflow
stub. They exercise waiting, early events, refused approval, replay, stale or
revoked authority and the pre-dispatch execution fence. Live payout remains
unperformed by this work; this component is a durable authorization coordinator,
not a wallet executor.

Workflow validation: `pnpm check` passed 74 package, 147 Convex and 24 payment-route
tests, typechecks, docs and production build. The 21 added Workflow tests include
actual event wait/resume through the component test adapter. The shared cloud
deployment installed `workflow`, its Workpool and batch worker successfully.
A separate live query read v2 as funded with exactly `10000000` micro-USDC cash
and customer prepayments; that read does not demonstrate a live approval/payout.

## Task 3 — financial statements

`statements.forOrder` derives the trial balance, cash, deferred revenue, sales,
contributor expense, net income and contributor liabilities directly from posted
journal lines. It asserts per-entry balance and tenant bindings, and returns
exact integer micro-USDC strings. The finance agent's balance tool uses this
same query. Nine new synthetic regressions cover the full funding/fulfillment/
payout lifecycle, contributor and order scoping, values above JavaScript's safe
integer range and corrupt journals that cancel only at aggregate level.

Statements validation: `pnpm check` passed 74 package, 156 Convex and 24
payment-route tests plus typechecks/docs/build; cloud deploy/typecheck passed.
One live query took **145 ms** and returned cash `10000000`, deferred revenue
`10000000`, revenue `0`, and equal debit/credit totals of `10000000` micro-USDC.
This is a current journal projection of the funded v2 order, not new inference
or a new transfer.

## Task 3 — clip evaluation harness

`pnpm eval:clips <manifest.json>` validates and freezes labels/source hashes
before network requests, uploads actual recordings to the existing scheduled
Convex verifier and scores stored advisory quality projections with the Python
scorer when report coverage is complete. It writes local dated JSON and a
Markdown metrics table under ignored `evals/results/`, preserving partial state
for resumption without rerunning completed submissions.

Evaluation submissions remain verification-only and cannot create a payable.
Their quality report omits only the subsequently added licensing warning;
inference, media and safety warnings remain intact. Copy checks are isolated by
evaluation run, while financial duplicate blocking remains global over accepted
work. Provider failures are excluded from correctness credit, and incomplete
cases remain in the reported coverage and failure-adjusted accuracy denominator.
Only harness code, tests and the placeholder manifest are committed; no media
or generated benchmark result is included. No 15–20 clip accuracy result exists
yet.

Task 3 implementation validation (before subsequent team feature merges):
`pnpm check` passed **273 tests** (74 package, 164
Convex, 24 payment-route and 11 runner tests), root/Convex/web typechecks,
documentation checks and the production build. The separate Python checks
passed 54 verifier pytest cases and 10 scorer unittests. Cloud deploy/typecheck
passed after keeping Ajv schema compilation in the Node runtime; the completion
mutation performs binding/criterion/licensing checks without dynamic compilation.

**Live generated-media transport smoke:** one pre-labeled ten-second generated
color-pattern clip with machine speech (not a human demonstration) ran through
`pnpm eval:clips`. Both independent models responded: Flash visual observation
**3,629 ms**, Transcribe **1,038 ms**, backend processing **9,766 ms**, and client
create-to-stored-report latency **12,443 ms**. The advisory report had all three
criteria unobservable and recommended review; the operational report remained
review-only. Submission: `mn7fw2rqwx4dbd2gcnfd8ekw3h8gzs3j`. The runner wrote
ignored JSON/Markdown artifacts and invoked the offline scorer. A single
obvious generated negative is transport evidence, not a human accuracy benchmark;
no 15–20 clip quality evaluation has run.

**Later live finance-agent check:** provider capacity recovered. Run
`mx73x9mwd5qg366srgvygh5t098gy0hq` completed in **6,805 ms client time**
(**6,351 ms backend run time**). Gemini selected `getTrialBalance`, received exact
`10000000` debit/credit totals from the real statement query, and produced a
persisted advisory explanation. This supersedes the earlier availability blocker
for that read-only run. It proposed, approved and transferred nothing.

Final rebase verification also exposed a pre-existing cleanup-test race between
concurrent local checkouts. The FFmpeg regression now asserts deletion of the
temporary directories created by its own invocation, retaining real cleanup
coverage without comparing unrelated processes' folders.

A final shared-deployment collision briefly removed indexes from concurrently
deployed reconciliation/chat work. After those commits landed, main was
synchronized through `2677e1b`, both index families were restored, and live
`exceptions.list` / `agentChatData.history` reads succeeded. No payment command
or journal was created by that verification. The combined `pnpm check` passed
320 tests (95 Node, 197 Convex and 28 payment-route) plus typechecks/docs/build.
See [deployment coordination](../convex/README.md#shared-deployment-coordination)
to avoid repeating the checkout-versus-shared-deployment mismatch.

## Public HTTPS deployment — October 25, 2026, 02:24 PDT

Production URL: https://skarl.vercel.app

Vercel project `skarl` is linked to `stephenhungg/skarl`, production branch `main`,
root `apps/web`, Node 22, with installation from the repository root. Production
is publicly accessible; preview deployments retain Vercel authentication.
Initial deployment: `dpl_Gm1jt9BE3ikFpYhqcnrK9HKzgefB`.

Observed over public HTTPS without authentication or bypass headers:

- `GET /api/health`: **200**, `service: "skarl-web"`, `status: "scaffold"`,
  `network: "eip155:84532"`. Its capabilities are static scaffold flags, not live
  integration readiness checks.
- `GET /contribute`: **200**, HTTPS HTML. Camera permission/recording on the actual
  demo device remains a separate manual check.
- `GET /api/orders/skarl-red-cup-demo-v2/fund`: **200**, `status: "funded"`,
  `fundingStatus: "confirmed"`, `amountAtomic: "10000000"`, treasury
  `0x8408a922ea400af33d7c2080a9edd5d3495b695f`, and stored transaction
  [`0x28b3f88d593c02a669cb95f4bdc6a23ab3d24bb5d1260e6c4ae54554155cd757`](https://sepolia.basescan.org/tx/0x28b3f88d593c02a669cb95f4bdc6a23ab3d24bb5d1260e6c4ae54554155cd757).
  This reads existing reconciled funding; this deployment did not send a new payment.

GET funding is a status endpoint. A fresh eligible order's POST generates the
402 challenge; the funded demo must not be charged again to force a 402. Missing
payment configuration produces 503. The production service secret is configured
privately, matching Convex. CDP credentials were still pending at this initial
check; polling continues. No CDP settlement or Bazaar listing is claimed here.

Operational correction: invoking the repository's `pnpm check:convex` selected
and synced the existing cloud deployment despite `CONVEX_AGENT_MODE=anonymous`.
The flag is not isolation when the checkout already selects `CONVEX_DEPLOYMENT`.
The orchestrator must redeploy merged `origin/main`; this worktree will not run
that command again. Use `pnpm test:convex` for isolated tests. See
[deployment](deployment.md) for reproducible hosting and environment setup.

## CDP webhooks + SQL witness — October 25, 2026

Implemented signed POST/HEAD `/api/webhooks/cdp`, durable event/transfer
idempotency, reuse of trusted RPC payment confirmation, treasury-scoped
`unknown_transfer` exceptions, and cached `chainWitness.reconciliationWithWitness`
with `match`, `missing`, `mismatch` and `witness_unavailable` states. SQL is
advisory; an outage never changes the original reconciliation or authorizes money.
See the [dashboard contract](dashboard-api.md#cdp-webhooks--sql-witness).

Local verification: `pnpm check` passed (100 Node tests, 229 Convex tests, 28
payment-route tests, TypeScript, documentation and production build). New tests
use **simulated** signatures, receipts and provider responses. `pnpm check:convex`
also passed against an isolated temporary copy with deployment environment
variables removed and a newly selected anonymous backend at `127.0.0.1:3240`.
No cloud Convex deploy/dev command was run from the cloud-linked worktree.

Live witness command: `node scripts/cdp-sql-witness.mjs`. At the verification
attempt, `~/.config/skarl/cdp.env` was absent. The command exited 2 and returned
`evidence:"not_verified"`, `sql.status:"witness_unavailable"`,
`sql.reason:"client_key_not_configured"` for treasury
`0x8408a922ea400af33d7c2080a9edd5d3495b695f` and existing funding transaction
[`0x28b3f88d593c02a669cb95f4bdc6a23ab3d24bb5d1260e6c4ae54554155cd757`](https://sepolia.basescan.org/tx/0x28b3f88d593c02a669cb95f4bdc6a23ab3d24bb5d1260e6c4ae54554155cd757).
This is a local missing-configuration result, **not a CDP API response or SQL
match**. No new chain transaction was submitted by this work.

Remaining: deploy merged backend/web source, set the Convex client API key, run
the live witness command, create both subscriptions with
`node scripts/cdp-webhooks-create.mjs https://skarl.vercel.app` (set the treasury
environment variable), then install the returned signing secrets in Vercel and
redeploy. This worktree has no `apps/web/.vercel/project.json`; the subscription
script supplies environment instructions instead of changing an unlinked project.
Root `package.json` alias ownership approval is pending; the node command is ready.

## Gemini request deadline and billing correction

At this earlier correction, video and finance defaults remained `gemini-3.8-flash`, with explicit
`GEMINI_VIDEO_MODEL` / `GEMINI_FINANCE_MODEL` overrides preserved. Audio remains
`gemini-3.5-transcribe`. Billing is now enabled on the key. The team's latest
Interactions probes returned correct HTTP 200 responses for 3.8 Flash (~2.1 s),
Argon (~3.0 s) and 3.6 Flash (~1.4 s). Earlier Flash 503/stall and Argon zero-quota
observations are historical, not current free-tier blockers.

The shared transport now caps the entire logical provider request at 30 seconds,
including response reading and all transient retries/backoff. Finance action and
read-only chat rounds use the same cap; smaller caller budgets remain allowed.
A hung attempt is aborted once, without restarting another 30-second window,
and verification persists a failed `needs_review` report. No unavailable model
can qualify a sample for acceptance. Regression tests exercise the 30-second cap,
shared retry deadline, unchanged defaults and environment overrides.

## Production Git integration verified

After push `37ce828`, Vercel created production deployment
`dpl_EE91QJj61JgLXkqJdSq9oPdC2byw` from that GitHub `main` commit and reached READY.
Subsequent `main` updates also deployed automatically. `pnpm check` passed before
the push, including TypeScript, tests, docs links and the production build.

A public POST to the already-funded v2 order returned HTTP 200 with its existing
confirmed intent and the same stored transaction hash; no new payment was sent.
After the webhook change landed, public `HEAD /api/webhooks/cdp` returned 200;
unsigned POST returned `503 {"error":"webhook_not_configured"}` while subscription
secrets were absent. This establishes reachability and missing-configuration
behavior, not successful signed webhook delivery.

## Real YouTube-origin clip verification — October 25, 2026

The deployed scheduled verifier processed [Me at the zoo](https://www.youtube.com/watch?v=jNQXAC9IVRw), by Jawed Karim and Yakov Lapitsky, using its unmodified [Wikimedia Commons copy](https://commons.wikimedia.org/wiki/File:Me_at_the_zoo.webm), licensed [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Ordinary YouTube CDN downloads returned HTTP 403; the public licensed mirror supplied the same source clip. The 19-second, 913,078-byte recording contains real human video and speech. It is an intentionally unrelated negative, not a red-cup demonstration or an accuracy corpus.

The upload, submission scheduler, server SHA-256, FFmpeg modality isolation, twelve sampled visual frames, server dHashes, independent live Gemini calls, canonical report validation and stored report read-back all ran against **https://keen-marmot-986.convex.cloud**:

| Measurement | Observed |
| --- | --- |
| Visual model | `gemini-3.8-flash`, **4,893 ms** |
| Audio model | `gemini-3.5-transcribe`, **1,322 ms**, 39 timestamped transcript segments |
| Backend processing | **11,622 ms** |
| Client queued-to-report polling | **14,709 ms** |
| Complete CLI invocation, including startup/upload | **16,578 ms** |
| Stored outcome | `needs_review`; all three rubric criteria `unobservable`, no visible cup events |

Submission: `mn7100dqspzfrdt5f3h8bwbzqx8gyb1w`. Original SHA-256: `f080a995943f2b4641d74a94dfc2d336d494fa6e25026e55b5def94f07ea522b`. This was a successful inference/report integration run, not a provider failure. It stayed verification-only: no training license was granted and no acceptance, payable or payment was requested. Media, transcript and raw provider/report artifacts remain private and ignored.

Immediately before the run, the cloud video override was observed as `gemini-4-argon`; it was restored to the requested `gemini-3.8-flash`. The stored model-run metadata above confirms Flash actually served this measurement. At the time of this measurement, code defaults for video and finance remained 3.8 Flash; the shared 30-second provider deadline was deployed. The later model decision below supersedes the video default.

Final validation for this run: `pnpm check` passed **385 tests** (100 Node, 257 Convex, 28 payment-route), root/Convex/web typechecks, all 32 Markdown files’ local links/anchors and the production build. Cloud deploy/typecheck passed before the live run. Committed generated API types now include the already-deployed chain-witness modules.

## Handoff cleanup and deployment provenance follow-up

The cleanup regression now supplies its own real per-test `mkdtemp` directory to the failing preprocessing invocation and checks only that directory was removed. Two separate Vitest processes ran the media suite concurrently: **11 tests passed in each process**. The complete `pnpm check` then passed **385 tests** (100 Node, 257 Convex, 28 payment-route), typechecks, docs and the production build.

The reported evaluation deployment drift was already resolved in `3c7ca29`: `submissions:evaluationRun` and the resumable evaluation harness are both committed on `origin/main`. No missing query or harness changes remained in the checkout. The [deployment rule](../convex/README.md#shared-deployment-coordination) now requires checking, committing and pushing first, followed by a clean working tree and HEAD equal to freshly fetched `origin/main`. No cloud deployment was performed for this test/documentation follow-up; the orchestrator redeploys merged batches.

## Video model decision and paired evaluation

The current code default for video verification is **`gemini-4-argon`**;
`GEMINI_VIDEO_MODEL` remains configurable, and the orchestrator reports that the
shared deployment environment is already Argon. Finance-agent and read-only
`askAgent` defaults remain **`gemini-3.8-flash`** for interactive latency. Audio
stays `gemini-3.5-transcribe`; the shared 30-second provider deadline remains.
Earlier Flash smoke-test measurements above retain their original model IDs.

The team's real-frame directional A/B probe reported zero hallucinated events
for either video model, with Argon returning visibility `clear` and Flash
`uncertain`. Reported latencies were Argon **4.4–5.0 s** and Flash **3.1–4.1 s**.
This motivates the choice but does not measure valid-clip acceptance accuracy
or establish a calibrated false-acceptance rate.

`pnpm eval:clips <manifest.json> --compare-video-models` now runs both models
against identical frozen clip bytes/labels and the same rubric/pipeline. Each
arm uses a separate duplicate corpus and a persisted, allowlisted evaluation-only
model override; it never switches global deployment configuration. Parent and
child checkpoints support resumption. The Markdown/JSON comparison reports
accuracy, false accepts, coverage, review rate and visual/backend/client p50/p95
latency separately per model. Actual provider model metadata is validated before
scoring. Evaluation uploads remain ineligible for acceptance or payment.

No new labeled human-corpus A/B benchmark or cloud deployment is claimed by this
source change. The orchestrator must deploy merged `origin/main` from a clean,
matching checkout before the new `evalVideoModel` argument is available live.

Validation: `pnpm check` passed **396 tests** (107 Node, 261 Convex, 28 payment-route), all typechecks, documentation checks and the production build. This includes 18 runner tests plus model-default/override/scope/replay regressions; transport and provider responses are mocked in these tests. A separate read-only review found no actionable paired-evaluation correctness issue. No new live inference measurement is claimed.

## Production CDP facilitator verification — October 25, 2026, 02:49 PDT

Production URL: https://skarl.vercel.app

The CDP API key ID/secret pair arrived and was installed as encrypted production
variables via stdin. Deployment `dpl_5wKnDRjDaRT8HeB29HoYVRMT5EH2` reached READY
with the merged CDP facilitator and evidence routes. `CDP_WALLET_SECRET` and
`CDP_CLIENT_API_KEY` were still absent at this check; polling continues for them.

Live, authenticated `createCdpFacilitatorClient().getSupported()` returned these
Base Sepolia kinds: x402 V2 `exact`, `upto`, and `batch-settlement`. This is a real
CDP API response, not a fixture, simulation or payment. The app selects `exact`.

The public, unpaid POST probe to
`/api/orders/skarl-red-cup-demo-v1/fund` returned **402**, with
`X-Skarl-Facilitator: cdp` and decoded `PAYMENT-REQUIRED` fields:

```json
{
  "x402Version": 2,
  "scheme": "exact",
  "network": "eip155:84532",
  "amount": "100000000",
  "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "payTo": "0x8408a922ea400af33d7c2080a9edd5d3495b695f",
  "maxTimeoutSeconds": 300
}
```

This is the legacy **100 USDC v1** order, used only for an unsigned challenge
probe. No wallet approval, signature or settlement was submitted. The existing
10 USDC v2 order remains a confirmed status read, not a new CDP payment.

The deployed evidence endpoint returned **404 `sample_unavailable`** for the
known verification-only submission `mn7fw2rqwx4dbd2gcnfd8ekw3h8gzs3j`, correctly
refusing to offer unlicensed/unaccepted work for sale. The plugin now documents
the implemented 0.25 USDC contract and actual response fields. A licensed,
accepted and delivered sample, live paid delivery, and Bazaar indexing evidence
remain outstanding. No new transaction hash was produced by this deployment.

## Production environment complete — October 25, 2026, 02:53 PDT

All four CDP variables are now installed as encrypted Vercel production variables:
`CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET`, and
`CDP_CLIENT_API_KEY`. They join the public Convex URL, treasury, private payment
service secret and Base Sepolia RPC URL. The credential watcher completed before
the 40-minute limit. Values were passed through stdin and were not printed or
committed. Deployment `dpl_9adbqe3hcJ5xYx2PxYSHnrvwUEz3` reached READY with the
complete environment and remains aliased to **https://skarl.vercel.app**.

Final public checks on that deployment:

- Health: **200** with the documented static scaffold payload.
- Contributor page: **200**, HTTPS HTML and Next.js assets present.
- Funded v2 GET: **200**, confirmed `10000000` micro-USDC and the same existing
  `0x28b3f88d593c02a669cb95f4bdc6a23ab3d24bb5d1260e6c4ae54554155cd757` hash.
- Unfunded v1 GET: **200**, awaiting payment, null attempt and transaction hash.
  Its unsigned POST: **402**, `X-Skarl-Facilitator: cdp`; no funds moved.
- Verification-only sample evidence GET: **404**, `sample_unavailable`.

The live CDP supported-schemes response and real production 402 challenge are
recorded above. Installing the wallet/client secrets does not prove a CDP wallet
transaction, SQL witness, signed webhook delivery, evidence sale or Bazaar
listing. Those remain their integration owners' live verification steps. A
licensed accepted/delivered sample and human Wallet MCP approval are still needed
for the evidence-purchase demonstration. The actual camera permission/recording
check remains a manual demo-device step.

## Live CDP verification

October 25, 2026, starting 02:51 PDT. Base Sepolia test assets only; no treasury funds moved. Live API results below are distinct from local tests and CDP policy simulations.

1. **Contributor identity:** created testnet-only wallet `0x975e1455d277d3030ac53E6b00F0251C7B3AE9FD`; key is private in `~/.config/skarl/contributor.env`, mode 600. No existing signature-verification mutation existed. Added controller-gated `contributorWallet:challenge` / `contributorWallet:verify`: five-minute, one-use, membership/domain/chain-bound SIWE message verified with EIP-191. The optional `memberships.walletChallenge` field preserves the existing verification record. Registration is pending orchestrator deployment of checked main; no verification claimed yet. Demo role selectors remain impersonable, not production authentication.
2. **Agent policy:** `CONVEX_DEPLOYMENT=dev:keen-marmot-986 CDP_PAYOUT_CAP_ATOMIC=2000000 pnpm cdp:policy:apply` exited 1 with `verified_contributor_allowlist_required`. This is the local prerequisite guard, **not a CDP rejection**. CDP API key pair, wallet secret and client key were installed privately in Convex. Agent address/policy and faucet funding await verified registration.
3. **Approved payout:** blocked before approval or send. All three live v2 submissions (`mn7fw2rqwx4dbd2gcnfd8ekw3h8gzs3j`, `mn75sdfqg8zr7k08dtrrpcm9218gzt4w`, `mn7100dqspzfrdt5f3h8bwbzqx8gyb1w`) are `verificationOnly:true`, `needs_review`, with no delivery; review cannot override the licensing gate. A fresh licensed contribution is required. No payout or live policy-negative result is claimed.
4. **Webhooks:** live CDP API created treasury Transfer subscriptions: TO `d92abd8b-ec2e-4d57-a07f-3caa1330f6bc`; FROM `bdee78ad-31b8-4735-83cc-a5e54824ded7`. Secrets saved privately in `~/.config/skarl/cdp-webhook.env` and installed as sensitive Vercel production `CDP_WEBHOOK_SECRET_TO` / `CDP_WEBHOOK_SECRET_FROM`. Project verified as `stephen-hungs-projects-d01c13ef/skarl` (`prj_Lz8hAQeXTvpaWSozr9E4Pd7j67mV`). Production already contained CDP facilitator key ID/secret. Live deployment and delivery are confirmed below.
5. **SQL witness:** the live witness command exited 2, returning `evidence:not_verified`, `sql.status:witness_unavailable`, `reason:http_500`, `fetchedAt:1792922008469` for funding transaction `0x28b3f88d593c02a669cb95f4bdc6a23ab3d24bb5d1260e6c4ae54554155cd757`. Follow-up read-only API probes all returned HTTP 500 and `{errorType:"internal_server_error",errorMessage:"An internal server error occurred. Please try again later.",errorLink:"https://docs.cdp.coinbase.com/api-reference/v2/errors#internal-server-error"}`. Correlation IDs: client-key `SELECT 1`: `a50055b9eb2f354e-IAD`; secret-key JWT `SELECT 1`: `a50055baacf2354e-SJC`; scoped transfer query: `a50055bbcc0b7851-IAD`. No SQL match is claimed.
6. **Bazaar:** pending a licensed, accepted, delivered sample with completed inference. Existing verification-only uploads cannot be sold. No purchase or catalog indexing is claimed.

### Confirmed webhook delivery and CDP settlement — 02:54 PDT

Production deployment `dpl_8DgwjMoGacAknUKAZfiF9XRCTaEk` was READY with webhook secrets; an unsigned configuration probe returned HTTP 401 `invalid_signature` (not delivery evidence). The authorized webhook probe used a real durable order `kh7dfb77wfpnqpdgh44w2qrc4n8gyjxt`, public ID `order-07384d232d47dfa0faadae0b14ab854729c1951bda5f11b0981b808c77b8c579`, with exact budget **10000 micro-USDC (0.01 USDC)**. Creation returned `status:awaiting_funding`, `replayed:false`, task version `md7e229199tr6m5v6aq8bnf6n98gywvv`; private retry terms are retained in `~/.config/skarl/webhook-test-order.json`.

`SKARL_APP_URL=https://skarl.vercel.app pnpm agent:fund kh7dfb77wfpnqpdgh44w2qrc4n8gyjxt` exited 0 with `Funding status: confirmed`. Buyer `0xa54DABc8583B869d488d63d691EC5d6a256c1a9D` paid the treasury; no treasury signing key or outgoing treasury transfer was used. Transaction: [0x20c9252f7d67a2dac87be839ad82b83465686157478645354838ac0f7239390d](https://sepolia.basescan.org/tx/0x20c9252f7d67a2dac87be839ad82b83465686157478645354838ac0f7239390d), Transfer log **1**.

Vercel's actual settlement log reported `{facilitator:'cdp',network:'eip155:84532',txHash:'0x20c9252f7d67a2dac87be839ad82b83465686157478645354838ac0f7239390d',orderId:'kh7dfb77wfpnqpdgh44w2qrc4n8gyjxt'}`. Its extension response was `{}`: this funding route is not a Bazaar evidence listing. At 02:54:37.92, CDP's POST `/api/webhooks/cdp` returned **200**. Convex receipt `nd7ba39fpmftqsfyc3w361y6158gy3dr` has `status:processed`, `amountAtomic:'10000'`, matching sender/treasury/hash/log, `receivedAt:1792922078597`, `updatedAt:1792922078975`, and authenticated body-digest event identity `df995bf386b91090cb219ab689715ce4711c50897fdd99904f0389e6169ec531`. This was a real provider delivery, not a locally signed replay.

`payments:reconciliation` returned one matching chain identity and `exceptions:[]`. Posted journal `k173e6xy542d92rwss9t368hyh8gyqjv` balances a 10000 debit to `asset:usdc` against a 10000 credit to `liability:customer_prepayments`. This proves live CDP x402 funding and webhook receipt processing; it does not prove a contributor payout.

### Remaining gates and negative probes — 02:55 PDT

- Wallet verification source was pushed as `f1966e0` after `git pull --rebase origin main && pnpm check && git push origin HEAD:main`. The full check passed TypeScript, **465 tests** (107 Node, 272 Convex, 86 payments), documentation links and the production build. Signature tests use real disposable local signatures against an isolated test database, not a live registration. The orchestrator was asked to deploy the new Convex mutations/schema; this worktree never ran `convex dev` or `convex deploy`.
- `pnpm demo:policy` exited 1 with `verified_contributor_allowlist_required`, before any live CDP send. It is not evidence of over-cap or non-allowlisted CDP enforcement. Faucet claims and account policy setup remain dependent on live contributor registration.
- Live POST `/platform/v2/x402/validate` for `https://skarl.vercel.app/api/samples/sample-mn7fw2rqwx4dbd2gcnfd8ekw3h8gzs3j/evidence` returned HTTP 200 with `valid:false`, `statusCode:404`, `paymentRequirements:{error:'sample_unavailable'}`, `bazaarExtension:null`, `index:null`, `x402Version:null`, and `simulation:{outcome:'rejected',rejectionReason:'endpoint failed preflight checks'}`. URL/HTTPS/reachability checks passed; `returns_402` failed, and remaining payload/schema checks were skipped. The validator's simulation is not a transaction.
- `pnpm agent:buy-evidence mn7fw2rqwx4dbd2gcnfd8ekw3h8gzs3j` exited 1: `Evidence discovery expected HTTP 402 with PAYMENT-REQUIRED, got 404.` It stopped before payment. No paid-evidence `EXTENSION-RESPONSES` or Bazaar status is available. A fresh, consented recording was requested; existing verification-only recordings were not relabeled or licensed.

### Contributor signature runtime discrepancy

The initial mutation became available live. Its challenge returned the correct Base Sepolia address/chain and nonce, but verification returned `invalid_wallet_signature` (Convex request `e56c2d5568caa49f`). The exact saved message/signature verified locally and recovered `0x975e1455d277d3030ac53E6b00F0251C7B3AE9FD`; registration did not complete. Proof material remains private.

Inspection found viem's `recoverPublicKey` dynamically imports `@noble/curves/secp256k1`; [Convex documents dynamic dependency imports as unsupported in its default runtime](https://docs.convex.dev/functions/bundling). The focused correction statically imports the same pinned curve implementation and retains EIP-191 hashing, strict recovery-bit validation, recovered-address matching and the transactional challenge gate. This is the leading cause inferred from code/runtime behavior, not a captured inner exception. Deployment and a successful live retry are required before claiming wallet verification.

The static-recovery correction was pushed as `67194ed`; `pnpm check` passed **466 tests** (107 Node, 273 Convex, 86 payment tests), all typechecks, documentation links and the production build. A subsequent retry of the same private proof still reached the old handler and returned `invalid_wallet_signature` at its original line 67, request `a706ae388c910736`; the corrected handler's rejection is at a different line. The orchestrator was asked to deploy `67194ed` or later. Registration, account policy/faucets, real CDP negative sends and approved payout remain incomplete until that deployment and, for payout, a licensed submission. No backend deploy or verification bypass was performed here.

### Live retry after recovery deployment — October 25, 2026, 03:05 PDT

The orchestrator reported the recovery fix deployed at 03:04 PDT. This run used the checked-out `origin/main` implementation, invoked existing Convex functions and changed environment configuration only; it did not deploy backend or web code. The results below supersede the registration and policy blockers above. All assets are Base Sepolia test USDC.

| Check | Live evidence | Result |
| --- | --- | --- |
| Contributor verification | Fresh SIWE challenge and EIP-191 signature returned `verified:true`, `replayed:false`, `chainId:84532`, `verifiedAt:1792922707057`, wallet `0x975e1455d277d3030ac53e6b00f0251c7b3ae9fd`. `lib/cdpWallet:allowlist` returned exactly this address. | Passed against the deployed mutation; proof/key remain private. An initial challenge used an incorrect demo token separator and returned `contributor_not_found`; using the canonical `demo:skarl:contributor` resolved that invocation error. |
| CDP account policy | `CONVEX_DEPLOYMENT=dev:keen-marmot-986 CDP_PAYOUT_CAP_ATOMIC=2000000 pnpm cdp:policy:apply` exited 0. Account `skarl-finance-agent`: `0x0A9EfDF66c58543538824906aE267B969Ed651c5`; active account policy `fa62ac94-e420-4013-bb4f-2dcab18deb7b`; recipient operator `in`; one verified recipient; cap `2000000` micro-USDC. | Applied. Candidate/probe and finance-account simulations accepted the allowlisted transfer at cap and rejected over-cap, non-allowlisted, wrong token, native value, wrong network and wrong function. Those preflight results are simulations. |
| Convex environment | Set and read back `CDP_AGENT_ADDRESS=0x0A9EfDF66c58543538824906aE267B969Ed651c5` and `CDP_AGENT_POLICY_ID=fa62ac94-e420-4013-bb4f-2dcab18deb7b` on `dev:keen-marmot-986`. | Both match the live CDP account. No credential values were printed. |
| Agent funding | Three `requestFaucet` calls for `usdc`, `base-sepolia`, each with a persisted distinct idempotency key. Successful receipts with two confirmations contained exactly `1000000` micro-USDC each to the agent. Transaction/log identities are below. | 3 USDC funded; balance read after the negative tests remained `3000000` at 03:05:58 PDT. |
| Direct over-cap send | Real `cdp.evm.sendTransaction` from `skarl-finance-agent`, canonical USDC `transfer`, amount `2000001` (2.000001 USDC), verified contributor recipient. HTTP **403**, `APIError`, `errorType:policy_violation`; correlation `a5006791aba9be62-IAD`. | Rejected by CDP; no transaction hash returned. This was not the unfunded probe account or a simulation. |
| Direct non-allowlisted send | Real `cdp.evm.sendTransaction` from the same finance account, canonical USDC `transfer`, amount `100000` (0.10 USDC), recipient `0x000000000000000000000000000000000000dEaD`. HTTP **403**, `APIError`, `errorType:policy_violation`; correlation `a500679519ddbe62-IAD`. | Rejected by CDP; no transaction hash returned. This was not a simulation. |
| Within-policy 0.10 USDC payout | Live `dashboard:submissions` for v2 order `kh7531zdrt7bn8vrs5qsw3c8bs8gy0cg` still returned the same three `verificationOnly:true`, `needs_review` submissions with null deliveries; `dashboard:payables` returned `[]`. | **Skipped:** no accept-eligible submission, payable or stored approved intent. No allowed-recipient send, fabricated obligation, approval bypass or executor enablement was performed. The requested 0.10 USDC cannot replace an obligation's bound amount. |
| SQL witness, one retry | `pnpm cdp:sql:witness` exited **2** for funding transaction `0x28b3f88d593c02a669cb95f4bdc6a23ab3d24bb5d1260e6c4ae54554155cd757`: `evidence:not_verified`, `sql.status:witness_unavailable`, `reason:http_500`, `fetchedAt:1792922706483`. | Still unavailable; no SQL match claimed and no further SQL retries in this run. |

Both direct negative calls returned the exact same CDP rejection message:

```text
The request is forbidden due to violating at least one configured policy.
```

Both responses included `errorLink:https://docs.cdp.coinbase.com/api-reference/v2/errors#policy-violation`. Before each real negative call, policy simulation returned `reject`; the live account/policy binding and absence of overriding project accepts were checked. Exact attempt terms and idempotency keys were persisted privately before dispatch. The real HTTP 403 responses, rather than the preflight simulations or a balance failure, establish the two policy rejections.

| Faucet claim | Confirmed Base Sepolia transaction | USDC Transfer log index | Amount (micro-USDC) |
| --- | --- | --- | --- |
| 1 | [0x0044a094cafb5eb0cf09577177fa71477259eb199e8cbebc80bcd051be8b933e](https://sepolia.basescan.org/tx/0x0044a094cafb5eb0cf09577177fa71477259eb199e8cbebc80bcd051be8b933e) | 12 | 1000000 |
| 2 | [0x4fa28ece62b78fbda786f5d57587bb81b4675f1e115ee091834f40afd2a4859a](https://sepolia.basescan.org/tx/0x4fa28ece62b78fbda786f5d57587bb81b4675f1e115ee091834f40afd2a4859a) | 6 | 1000000 |
| 3 | [0x55c0da36c680f9f96d462d1901721af42f4e8fc6d162fb114ab4f48c32316c1d](https://sepolia.basescan.org/tx/0x55c0da36c680f9f96d462d1901721af42f4e8fc6d162fb114ab4f48c32316c1d) | 21 | 1000000 |

No outgoing agent or treasury transfer is claimed. No deployment is needed for this documentation-only follow-up or the already-applied environment values. A live payout still requires licensed acceptance, the corresponding bound payable, independent stored approval and an explicitly enabled executor.

Validation for this follow-up: `pnpm check` passed all typechecks, **466 tests** (107 Node, 273 Convex, 86 payments), local links/anchors in 33 Markdown files and the production web build. `git diff --check` passed. These local checks are separate from the live API and chain evidence above.

## Solana funding rail (October 25)

Implemented optional Solana Devnet x402 funding with Base first, durable message-hash claims, strict RPC reconciliation, a bounded CDP buyer, and an idempotent 1 USDC demo seed. Base payouts and human approval remain unchanged. Receive-only treasury `5vrHh4EG9dChLEEAkgedPUEq2gjYj95822kSjsCXPshh` and its canonical USDC ATA are live; the treasury address is configured in Vercel production and Convex. This is setup evidence, not a funding claim. The backend deployment is complete, but the first live request was rejected before settlement because the CDP fee payer changed between challenges; funding is not demonstrated. See [Solana rail](payments.md#solana-rail).

## Wallet MCP buyer-to-agent revenue path — October 25, 03:12 PDT

Code commit `ab2a5fe` was pushed to `main` after the required rebase and `pnpm check`: TypeScript, **518 tests** (122 Node, 280 Convex, 116 payments), documentation links and production build passed. Concurrent payment changes on main were preserved. Vercel Git deployment `dpl_BGDpDrnHWQ79dyvDT5gLQf3ELZGA` reached READY and the production alias `https://skarl.vercel.app` was confirmed against that commit before validation.

- Evidence `payTo`: **`0x0A9EfDF66c58543538824906aE267B969Ed651c5`**, the existing `skarl-finance-agent` address read from live Convex `CDP_AGENT_ADDRESS`. Set as `SKARL_EVIDENCE_PAYTO` in the linked Vercel **skarl** production project and Convex `dev:keen-marmot-986`. No second CDP account was created.
- Funding remains directed to **`0x8408a922ea400af33d7c2080a9edd5d3495b695f`**. The deployed v2 funding GET returned HTTP 200, `fundingStatus:"confirmed"`, `amountAtomic:"10000000"`, and that treasury recipient. No new payment was made.
- Dedicated `evidence_sale` / `evidence_sale_deferred` journals retain the revenue wallet, keep its cash separate from treasury cash, and do not change order prepayments or accrue another contributor payable. Reconciliation checks the standalone claim, receipt and journal. These changes require the backend owner to deploy the new Convex schema/handlers from `ab2a5fe` or later. **This worktree did not deploy Convex.** Web refuses payment against older accounting capability or a mismatched backend recipient.
- Actual middleware tests verify an anonymous, header-free GET produces a v2 JSON body and `PAYMENT-REQUIRED` header with exact Base Sepolia canonical USDC, `250000` atomic amount, and the separate revenue recipient. The pinned adapter normally sends `{}` as the body; the evidence route now mirrors its public challenge into JSON. Tests are synthetic service/receipt evidence, not a live sale.
- Live inventory: all three organization orders have `acceptedCount:"0"`; the three v2 submissions remain verification-only, `needs_review`, with no delivery. No useful verified-sample catalog exists to sell, so no empty paid catalog was added. A fresh consented contribution, completed inference and authorized acceptance/delivery remain necessary.
- [Exact Claude Code prompts and approval/journal checks](wallet-mcp-demo.md) and the [Wallet MCP plugin](wallet-mcp-plugin/skarl.md) are updated. Search explicitly uses `network:"base-sepolia"` because Wallet MCP defaults to Base mainnet. Evidence GET requires no custom headers. No Wallet MCP purchase, human approval, new transfer or Bazaar indexing is claimed.

### Deployed Bazaar validation output

At `2026-10-25T10:12:45.672101+00:00`, POST `https://api.cdp.coinbase.com/platform/v2/x402/validate` with:

```json
{
  "resource": "https://skarl.vercel.app/api/samples/sample-mn7fw2rqwx4dbd2gcnfd8ekw3h8gzs3j/evidence",
  "method": "GET"
}
```

returned **HTTP 200** with **`valid:false`**, endpoint **404 `sample_unavailable`**, `bazaarExtension:null`, `index:null`, `x402Version:null`, and `simulation.outcome:"rejected"`. URL validity, HTTPS and reachability passed; `returns_402` failed because this existing verification-only sample is not saleable. Payload/schema checks were skipped. The validator's simulation is not a blockchain transaction. Successful live 402 validation remains pending an eligible sample and the backend deployment.

<details>
<summary>Exact validator response</summary>

```json
{
  "bazaarExtension": null,
  "index": null,
  "paymentRequirements": {
    "error": "sample_unavailable"
  },
  "preflight": [
    {
      "check": "url_valid",
      "detail": "URL is well-formed",
      "passed": true,
      "severity": "required"
    },
    {
      "actual": "https",
      "check": "url_https",
      "detail": "Resource URL uses HTTPS",
      "expected": "https",
      "passed": true,
      "severity": "required"
    },
    {
      "check": "endpoint_reachable",
      "detail": "Endpoint responded with status 404",
      "passed": true,
      "severity": "required"
    },
    {
      "actual": "404",
      "check": "returns_402",
      "detail": "Endpoint returned HTTP 404 instead of 402",
      "expected": "402",
      "passed": false,
      "severity": "required"
    },
    {
      "check": "valid_json",
      "detail": "Skipped: endpoint did not return 402",
      "passed": false,
      "severity": "required"
    },
    {
      "check": "x402_version",
      "detail": "Skipped: endpoint did not return 402",
      "passed": false,
      "severity": "required"
    },
    {
      "check": "payment_required_header",
      "detail": "Skipped: endpoint did not return 402",
      "passed": false,
      "severity": "required"
    },
    {
      "check": "has_accepts",
      "detail": "Skipped: endpoint did not return 402",
      "passed": false,
      "severity": "required"
    },
    {
      "check": "accepts[0].shape",
      "detail": "Skipped: endpoint did not return 402",
      "passed": false,
      "severity": "required"
    },
    {
      "check": "accepts[0].scheme",
      "detail": "Skipped: endpoint did not return 402",
      "passed": false,
      "severity": "required"
    },
    {
      "check": "accepts[0].network",
      "detail": "Skipped: endpoint did not return 402",
      "passed": false,
      "severity": "required"
    },
    {
      "check": "accepts[0].asset",
      "detail": "Skipped: endpoint did not return 402",
      "passed": false,
      "severity": "required"
    },
    {
      "check": "accepts[0].amount",
      "detail": "Skipped: endpoint did not return 402",
      "passed": false,
      "severity": "required"
    },
    {
      "check": "accepts[0].payTo",
      "detail": "Skipped: endpoint did not return 402",
      "passed": false,
      "severity": "required"
    },
    {
      "check": "accepts[0].maxTimeoutSeconds",
      "detail": "Skipped: endpoint did not return 402",
      "passed": false,
      "severity": "required"
    },
    {
      "check": "has_resource",
      "detail": "Skipped: endpoint did not return 402",
      "passed": false,
      "severity": "required"
    },
    {
      "check": "has_bazaar_extension",
      "detail": "Skipped: endpoint did not return 402",
      "passed": false,
      "severity": "required"
    },
    {
      "check": "bazaar.info",
      "detail": "Skipped: endpoint did not return 402",
      "passed": false,
      "severity": "required"
    },
    {
      "check": "bazaar.info.input",
      "detail": "Skipped: endpoint did not return 402",
      "passed": false,
      "severity": "required"
    },
    {
      "check": "bazaar.info.input.type",
      "detail": "Skipped: endpoint did not return 402",
      "passed": false,
      "severity": "required"
    },
    {
      "check": "bazaar.info.input.method",
      "detail": "Skipped: endpoint did not return 402",
      "passed": false,
      "severity": "required"
    },
    {
      "check": "bazaar.info.output",
      "detail": "Skipped: endpoint did not return 402",
      "passed": false,
      "severity": "advisory"
    },
    {
      "check": "bazaar.info.output.example",
      "detail": "Skipped: endpoint did not return 402",
      "passed": false,
      "severity": "advisory"
    },
    {
      "check": "bazaar.schema",
      "detail": "Skipped: endpoint did not return 402",
      "passed": false,
      "severity": "required"
    },
    {
      "check": "parse",
      "detail": "Skipped: preflight checks failed",
      "passed": false,
      "severity": "required"
    }
  ],
  "simulation": {
    "outcome": "rejected",
    "rejectionReason": "endpoint failed preflight checks"
  },
  "statusCode": 404,
  "valid": false,
  "x402Version": null
}
```

</details>


### Solana live attempt — October 25, 2026, 03:13–03:15 PDT

**Outcome: no funding transaction and no Solana Explorer funding link.** The single bounded CDP buyer authorization received HTTP 402 before any Convex funding intent was created. The order correctly remained `awaiting_funding`; this run does not demonstrate a successful transition to `funded` or live RPC-confirmed funding.

| Check | Observed result |
| --- | --- |
| Deployment | The deployment owner reported `ff79f59` deployed to `keen-marmot-986`. Vercel's production alias was independently observed READY on `ff79f59`, deployment `dpl_51qWCiyDm2Kx68SiGvBCZVuwWfgA`, before the buyer ran. No manual deployment was performed. |
| Seed | `seed:solanaDemo` returned order `kh70wdg1psv4np16bfkq4hkc6d8gz715`, public ID `skarl-red-cup-demo-sol`, one sample costing `1000000` micro-USDC. |
| Production configuration | Vercel production lists `SKARL_SOLANA_TREASURY_ADDRESS`; the live quote and Convex environment both match `5vrHh4EG9dChLEEAkgedPUEq2gjYj95822kSjsCXPshh`. |
| Live challenge | At 03:13:22 PDT, HTTP 402 advertised Base Sepolia `exact` first and Solana Devnet `exact` second, each for `1000000` micro-USDC. `X-Skarl-Facilitator: cdp`; Solana memo `skarl:kh70wdg1psv4np16bfkq4hkc6d8gz715`. |
| Buyer attempt | Managed buyer `35pgsKg8sUYQRbLuWSmgYnham9rWhqNuG1JJhGKN6TWy`; approved treasury, canonical mint and Devnet allowlisted; per-payment and 24-hour cumulative cap both `1000000`. One authorization was saved before dispatch. Its signed request returned HTTP 402. One recovery replay of that identical authorization also returned 402; no second authorization was created. |
| Diagnosis | CDP read-only verification returned `isValid:true` for the saved payload. Its accepted fee payer was `BENrLoUbndxoNMUS5JXApGMtNykLjFXXixMtpDwDR9SP`; later live challenges advertised different fee payers. The installed x402 requirement matcher returned false against a fresh live challenge and true when only that challenge's fee payer was restored to the original. This reproduces a quote-matching failure before settlement. |
| Convex reconciliation | `payments:reconciliation` returned `{"exceptions":[],"matches":[]}`; `dashboard:journal` returned `[]`. The funding endpoint had no attempt or transaction hash. Empty matches are absence of funding, not successful reconciliation. |
| Independent RPC | At 03:15:14 PDT, finalized reads showed buyer USDC `2000000`, buyer SOL `0`, treasury USDC `1000000` from its earlier setup faucet, and no later treasury ATA transaction. The signed message's recent blockhash was no longer valid. No setup faucet is counted as order funding. |

Private authorization, spend reservation, response and RPC records are retained. The original replay did not settle and no replacement authorization was signed. The next implementation must preserve a facilitator-authorized fee payer across the challenge/payment round trip without weakening mint, amount, payee, memo or signature validation. A successful live funding attempt remains required before claiming MLH Best Use of Solana with live funding evidence.
## Outsider reuse check (October 25, 2026, 03:15 PDT)

Implementation `68148a6` adds public `GET /api/orders` documentation and
`POST /api/orders` creation: fixed red-cup task, one sample, exactly `1000000`
micro-USDC (1 USDC) on Base Sepolia, labeled demo/testnet. No identity header or
server credentials are needed by the caller. Convex stores atomic hourly caps of
3 creations per IP and 30 globally; caller-supplied terms are rejected. Wallet
MCP instructions cap this flow at `1.000000` USDC. The CLI also funds without an
identity header. The dashboard navigation link remains in place.

Local verification passed: `pnpm check` (122 package tests, 285 Convex tests,
141 payment-route tests, TypeScript, documentation links and production build).
Rate-limit, fixed-term, configuration and funding tests use synthetic services;
they are not evidence of live settlement.

A fresh temporary clone of `68148a6` passed `pnpm install --frozen-lockfile`,
`cp apps/web/.env.example apps/web/.env.local` and web typecheck under the pinned
Node 22.21.1 / pnpm 10.19.0. The system Node 26 was correctly rejected before
switching with `nvm use`. The local homepage and API documentation returned
HTTP 200 without private keys. Local funding returned HTTP 503 with explicit
hosted-demo/operator configuration guidance. Next regenerated its ignored
declaration file; the optional-build-script warning did not block startup.

Live requests from that clone to `https://skarl.vercel.app`, after Vercel served
the new route, observed:

- `GET /api/orders`: **200**, exact 1 USDC demo terms and creation instructions.
- `GET /api/health`: **503 degraded**, Convex reachable, treasury configured,
  facilitator `cdp`; the old backend did not expose the new service/inference
  readiness fields yet. This is configuration evidence, not an inference probe.
- `POST /api/orders` with `{}` and **no identity header**: **503
  `demo_orders_unavailable`**. The public creation mutation and `demoOrderLimits`
  table still need the designated deployment owner's Convex deployment from
  `origin/main` at `68148a6` or newer. This task did not deploy Convex.

The live outsider create → 402 → funding check is therefore **blocked on the
Convex deployment**, not complete. No order or payment was claimed from this
failed request, and no new payment was attempted. After deployment, repeat
creation once, retain its returned order ID, verify the 1 USDC x402 challenge,
and only then perform the authorized single testnet funding and read back its
reconciled transaction. Record that result here; do not substitute the already
funded seeded order as proof of outsider creation.
## Backend batch — persisted verifier frames

New verification actions store the twelve sampled visual JPEGs and six additional
JPEGs of the exact decoded 6-fps frames underlying the existing dHashes. Sample
timestamps and decoded fingerprint indices are persisted as private storage
assets linked to the job and analysis in the report-completion transaction.
Storage hash/size/type, sample indices, source times and current job generation
are checked before linking. The existing fingerprint algorithm is unchanged.

`media.submissionEvidence` now exposes role-checked `frames` (12), `dHashFrames`
(6), `dHashFrameIndices` and `framesAvailable`; `media.duplicatePair` returns both
sides' matching fingerprint frame URLs and per-frame Hamming distances. These
are bearer URLs issued only after both submissions' tenant/ownership checks.
Older analyses are not backfilled and retain honest unavailable states. Failed
storage/analysis work cannot become acceptance evidence. An ambiguous completion
failure retains private blobs for recovery instead of deleting possibly linked
assets. No real media or storage URLs are committed.

The source change requires the orchestrator's deployment of clean `origin/main`;
no cloud sync was run from this checkout.

Frame commit validation ran against an isolated snapshot of the staged tree, excluding other in-progress batch changes: `pnpm check` passed **550 tests** (122 Node, 287 Convex, 141 payment-route), typechecks, docs and production build. Actual local FFmpeg extraction ran; provider observations and chain evidence in tests are synthetic. The persistence regression verifies all 18 assets, both duplicate sides, exact indices/distances, role refusal, replay and invalid frame-binding refusals.


## Confirmed Solana funding after fee-payer fix — October 25, 2026, 03:29 PDT

**Live, finalized testnet transfer: [1 USDC on Solana Explorer](https://explorer.solana.com/tx/31LMrtZYcf4PcBRcyFmFX8tBmt2fNttNSBA4mz7sTrZKSw6E2kH9oghw5FTafzR77JZT9so1zzjkj8ZuVqrGUezi?cluster=devnet).** The bounded CDP-managed buyer funded `skarl-red-cup-demo-sol` (`kh70wdg1psv4np16bfkq4hkc6d8gz715`) through the **CDP facilitator**, after Vercel's production alias served fix commit `d91c1e9`. The response was HTTP 200 with `fundingStatus: confirmed` and `settledBy: cdp`; the route reports `X-Skarl-Facilitator: cdp`. No x402.org fallback was needed. No manual deployment or Convex change was performed for this fix.

- Network: `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`; canonical USDC mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`; amount **1000000 micro-USDC**.
- Buyer: `35pgsKg8sUYQRbLuWSmgYnham9rWhqNuG1JJhGKN6TWy`; treasury owner: `5vrHh4EG9dChLEEAkgedPUEq2gjYj95822kSjsCXPshh`; recipient ATA: `CtgPLBxHZU1UZcyovafXuQR2cVAFvpHksPh5HCBDJWHY`.
- Finalized RPC observation: slot **514940239**, outer transfer instruction index **2**, exact payer/mint/recipient/amount and order memo matched the stored signed message hash. Fee payer: `GVJJ7rdGiXr5xaYbRwRbjfaJL7fmwRygFi1H6aGqDveb`.
- Convex read-back: order `funded`, funding intent `confirmed`, attempt `kx72x5z60d65xxj20t3kmad00s8gywx5`; reconciliation returned **one 1000000-micro-USDC match and zero exceptions**, including the balanced funding journal and `(network, signature, 2)` identity.
- Finalized balances: buyer **2000000 → 1000000**, treasury **1000000 → 2000000** micro-USDC. The treasury's pre-existing faucet deposit is not counted as order funding.

Exactly one new authorization was created. Before it, finalized RPC confirmed the earlier rejected authorization's blockhash was invalid, treasury history contained only its original faucet deposit, and the order had no intent/attempt. The earlier private attempt was archived and its 1-USDC reservation retained; this retry kept a 1-USDC per-payment cap and a 2-USDC cumulative cap covering both reservations. No automatic second payment was sent.

Validation: `pnpm check` passed **578 tests** (123 Node, 287 Convex, 168 payment tests), typechecks, documentation links and the production build. Subsequent incoming homepage-only edits passed fresh typechecks/build before the push. Rotation tests cover currently supported versus unsupported fee payers, every other quote field, signed-message fee-payer binding, cache expiry and single-authorization refusal. Those tests are simulated; the Explorer/RPC/Convex observations above are live. Base remains primary and the only payout rail; no Solana payout or bridge is claimed.
## Backend batch — hosted cron jobs

Added real Convex intervals: every two minutes, observe existing Base/Solana
funding and Base payout attempts without signing/resending; every ten minutes,
run the bounded finance-agent loop over changed accrued payables and exceptions.
The loop persists tool calls/results/explanations, can propose stored payouts,
and has no approval/signing authority. Unchanged state and completed failed model
runs do not repeatedly spend inference; interrupted pre-action reservations reuse
their durable request ID.

Atomic leases/generations, least-recently-checked observation reservations and
pagination cap each tick at three orders/four pending attempts per order.
Confirmed/finalized/definitively failed attempts are skipped. Ten stale pending
CDP webhook receipts per tick are classified from existing observations. Current
unknown/late discrepancies persist as advisory snapshots/audits and remain in
`exceptions.list`. Hashless attempts stay pending; none are re-sent.

Controller/finance-agent query `scheduledData.snapshots` exposes scoped operating
state. Global and finance-only kill switches are documented in the dashboard
contract. Existing Gemini time/tool/amount caps apply. These jobs require the
orchestrator's clean-main deployment; no hosted execution or live settlement is
claimed from the new mocked tests.

Cron commit validation: isolated staged-source `pnpm check` passed **567 tests** (122 Node, 304 Convex, 141 payment-route), typechecks, docs and production build. The 17 new cron cases cover Base/Solana receipt reconciliation, existing payout observation, ambiguity without resend, status/call caps, fair pagination, unchanged/failed finance runs, approval refusal and tenant/role fences. CLI API generation completed without activating a deployment; all provider/chain observations in these tests are mocked.

## Backend batch — guarded Convex check command

`pnpm check:convex` now uses a Node wrapper that checks process environment, `.env.local` and `.env` independently using the pinned CLI dotenv parser. Cloud/unknown deployment selections and remote deployment credentials/URLs are refused before starting the CLI unless `--allow-cloud` is explicit. Exact local/anonymous selectors are allowed; surrounding whitespace cannot disguise a cloud selection. Arbitrary forwarded CLI overrides are refused. The designated owner and clean-`origin/main` deploy rule still apply. No actual backend check/sync was run from the cloud-linked checkout.

The prior cron change also passed a later rebased full check of **613 tests** (126 Node, 319 Convex, 168 payment-route), including the concurrently merged visual jury and monotonic duplicate alignment.

Guard commit validation: isolated staged-source `pnpm check` passed **649 tests** (162 Node, 319 Convex, 168 payment-route), typechecks, documentation and production build. All 36 wrapper tests inject command execution and configuration reads; none start a real Convex backend. Tests include process/file precedence, quoted/export/colon dotenv grammar, whitespace bypass refusal, local/anonymous allowance and explicit remote opt-in.

## Mobile contribution slice (October 25, 2026)

Standalone Expo SDK 58 (`expo 58.0.19`) iPhone app implemented in
`apps/mobile`, with Bun and explicit pnpm workspace exclusion. Captures 10–30s
back-camera narrated video, ~50 Hz available IMU channels, device metadata and
consent; uploads private video/JSON with stable request IDs and resumable stages.
Live reports show persisted status and timestamped criteria. Additive sensor
attachment validates stored bytes and computes RMS/activity chart bins. Sensors
never authorize acceptance or payment. The fixed-camera task makes a still-IMU
recapture warning unsound, so that stretch is intentionally omitted.

Strict mobile TypeScript, iOS Metro/Hermes and web exports, 8 mobile tests and
`pnpm check` passed. Synthetic sensor backend regressions passed. The native UI
uses the web tokens, converted Montreal/Fono fonts and a reduced-motion-aware
settle transition. [390px comparison screenshots](mobile.md#visual-alignment)
were rendered from the Expo web export and deployed contributor page. These checks do not establish physical iPhone camera,
mic, sensors or live upload behavior. **Convex deployment is needed and was not
performed by this work.** The operator deploys main, then follows the
[phone run and smoke-test instructions](../apps/mobile/README.md).
## Backend batch — buyer refund execution

The existing buyer cancellation reservation now has a complete Base-only
execution adapter: `refunds.approve` requires an independent controller;
`refunds.forOrder` exposes approval/claim/transaction state; browser
`executeApprovedRefund` reuses the treasury-wallet USDC transfer client and the
allowlisted `/api/payments/refund` route. Current controller authority, expiry,
source terms, remaining quota, original buyer recipient and exact amount are
revalidated. Proposal `executionAvailable` stays false until approval is valid.

One attempt is stored before signing. Ambiguous dispatch/receipt results retain
the claim/hash; recovery observes the same hash and never signs/sends again.
Exact canonical USDC receipt evidence with two confirmations posts one
`refund_paid` journal, clears customer-refund liability/cash, and sets the order
to `refunded`. The funding intent remains confirmed. Reconciliation includes
refund obligations and exact chain identities. The scheduled sweeper now also
observes standalone command-bound refund attempts using its existing caps and
leases, without creating attempts or resending.

Refunds for Solana-funded orders remain unsupported. No live wallet/refund was
performed; tests use synthetic receipts and injected browser wallets. The source
requires the orchestrator's next clean-main backend deployment plus the normal
web deployment. The dashboard API includes the precise signing/recovery flow.

Refund commit validation: isolated staged-source `pnpm check` passed **662 tests** (163 Node, 325 Convex, 174 payment-route/client), typechecks, docs and production build, including `/api/payments/refund`. Tests exercise exact reservation/payment accounts, approval refusal/revocation/expiry/tenant checks, same-hash replay, changed bindings, browser recovery, and one-time sweep posting. An independent read-only review found no blocking issue. API types were regenerated without activating a deployment. All wallet/chain evidence in these tests is simulated.

After merging the concurrent receipt/mobile backend slice, the complete main checkout passed `pnpm check`: **670 tests** (163 Node, 333 Convex, 174 payment-route/client), all typechecks, 39 Markdown documents’ links/anchors and the production web build. Both `/api/payments/refund` and the incoming receipt route built successfully. This confirms merged source compatibility; no live wallet transfer or cloud deployment was performed.

## Verify on-chain — EAS setup, October 25, 2026

The revocable Skarl report schema is registered on the existing Base Sepolia EAS
predeploy. No custom contract, resolver or escrow was deployed. The eight fields
are `reportHash`, `sourceSha256`, `rubricHash`, `pipelineVersion`, `videoModel`,
`recommendation`, `verifiedAt`, and `licensed`. No original media, report text,
contributor name, URL or contributor wallet is published.

- Schema UID: `0x1ea6e2d3fd6c61ffc02b18bea15c4037f90f832e2ed82e2d50bb98bcfe6e804f`.
- [EAS schema](https://base-sepolia.easscan.org/schema/view/0x1ea6e2d3fd6c61ffc02b18bea15c4037f90f832e2ed82e2d50bb98bcfe6e804f).
- [Successful schema-registration transaction](https://sepolia.basescan.org/tx/0x6467a504407e9d03e7bfb4c41bf7b9e29cd629c86bdb0995a7f1664081ca36a1).
- Attestor CDP Server Wallet account: `skarl-attestor`, `0xbc1e957F2AE49e39014ea2a9D23e59C62832F26B`.
- Account policy: `a3f55c34-6ba6-4c7f-b81d-c0203ce30ba0`. Live CDP policy simulations accepted `attest` and `revoke`; rejected wrong destination, network, function, native value, and alternate transaction/hash/message signing. Simulations are policy evidence, not attestation transactions.
- The separate registrar account is `0x952395cc709E5064137ECfCA46FD8B1BD1a82f8A`; the attestor cannot call SchemaRegistry. Rerunning `scripts/eas-register-schema.mjs` observed the schema and skipped sending.

`convex/attestations.ts` and `convex/attestationsNode.ts` implement an independent
two-minute sweep, a durable per-analysis intent, fenced retries, and receipt plus
EAS payload verification. CDP retries reuse one stable request key within 23
hours; unknown older sends require reconciliation. Proven reverted receipts may
start up to three fresh attempts while preserving their transaction history.
The public `attestations.forSubmission` query exposes only the current analysis's
confirmed public fields and explorer links. Nothing here grants acceptance,
licensing, delivery or payment authority. Failed finalized reports retain their
stored recommendation; verification-only reports always attest `licensed=false`.

### Live backfill and automatic sweep — October 25, 2026, 03:53 PDT

The deployment owner deployed `1789763` (including EAS commit `5cff95a`) to
`keen-marmot-986` at 03:50 PDT. All **11 finalized reports have confirmed
attestations**: six completed jobs with review-only reports and five failed jobs
with finalized failure reports. Every stored recommendation is `needs_review`;
none of these commitments establishes acceptance, model accuracy or payment.
Ten attestations have `licensed=false`; the one `licensed=true` records validated
consent metadata, not acceptance or delivery.

Live Convex execution history shows `attestations:sweep` invoked by **Cron** at
03:50:13 PDT (execution `2c2fb5d7-cf4f-4b7d-a820-ad2798040b0f`), followed by 11
scheduler-invoked `attestationsNode:run` actions. All 11 intents reached
`confirmed` on their first generation by 03:50:25 PDT. The operator's explicit
backfill sweep at 03:50:46 returned `{ "more": false, "scheduled": 0 }`: the cron
had already completed the backfill. Another successful **Cron** invocation at
03:52:12 PDT (`640c5a15-f948-4a6f-8da5-1f6e0f26aaed`) confirms the two-minute
schedule remains active. A fresh complete inventory found 11 reports, 11
attestations and zero missing confirmations.

This is live evidence of automatic discovery and attestation of previously
unattested stored reports. No new report arrived during this observation window
and no media was uploaded for this check; a post-deployment new-upload example
has therefore not been observed separately. The sweep scans all report pages,
so newly stored reports use the same demonstrated discovery path.

**Explorer and chain verification:** each EASScan page returned its indexed
on-chain attestation, matching the UID, transaction, attestor and all eight
public fields exactly. Independently, Base Sepolia RPC confirmed all 11
successful receipts, matching `Attested` events and stored EAS payloads, schema,
recipient, revocability and unrevoked/non-expiring state. Block numbers and log
indices below come from those receipts. All BaseScan links were requested but
returned HTTP 403; Chrome also stopped at a Cloudflare CAPTCHA. BaseScan page
contents remain **unverified**, rather than being inferred from RPC success.

| Analysis ID | Licensed | Verify on-chain | Transaction | Block / log index |
| --- | --- | --- | --- | --- |
| `j571t3ahsx4y2hs1j6dh0ggc858gzsqx` | `false` | [EASScan](https://base-sepolia.easscan.org/attestation/view/0x83f97276ee0e7424837e9086c4224ac08bfe0f0e4ca753963f60622c9fdb386d) | [BaseScan](https://sepolia.basescan.org/tx/0xd4aa2b01d0daf64ba9f5b1634bed9bb1dda11f3a1a9577a18fb0ae2e0dd6e5cb) | `50017777 / 10` |
| `j5773p3t4ah0vaentc3hsed0k18gye63` | `false` | [EASScan](https://base-sepolia.easscan.org/attestation/view/0x30f5c683a4ebf25c6c3ad96c1fd68e41bd2d7b3f3d17572b9b2f7b3f0aa59b2b) | [BaseScan](https://sepolia.basescan.org/tx/0x0098374f2ecf076375ebf60f090c37e16bc2b28f8465eb6ee3d3d4f033c0022a) | `50017775 / 10` |
| `j57btg8018nzpzbqhv416gd0g18gyaxf` | `true` | [EASScan](https://base-sepolia.easscan.org/attestation/view/0xa04e3457c8d303421a39be2445da72a0e5c5c76214558e73681363916ad93de1) | [BaseScan](https://sepolia.basescan.org/tx/0x7c308886b6eb1d5b6a31d442aea6b1ee4a1097cdfad38bc3a8051043e012092c) | `50017759 / 13` |
| `j5736zsn81zfksy5bg73f1cs0d8gyjzr` | `false` | [EASScan](https://base-sepolia.easscan.org/attestation/view/0x313d20ea10d97ca561a215e0a52d81a0bdf7bc968af578aeda45f5a50c92a6f4) | [BaseScan](https://sepolia.basescan.org/tx/0x5a7377f564e2c6e5485fa0a41a3c5b3bef9d0cc14c1f60f06e0cdcbbb03bbcc9) | `50017761 / 20` |
| `j571a5jzm5wvp0yn1ykngkcj518gz2xm` | `false` | [EASScan](https://base-sepolia.easscan.org/attestation/view/0x2229476b782a01ec2904df1c8c172f5f9d06721f9a6b43a16af50f50e2602a74) | [BaseScan](https://sepolia.basescan.org/tx/0x514529b21456f6404031117bd32d9adbb85767994f3ce61de7e1141d9005e1bf) | `50017776 / 10` |
| `j571jkt4m2qnvw7j0nzz10rca98gzkh5` | `false` | [EASScan](https://base-sepolia.easscan.org/attestation/view/0x211516c9da4ed275090a82ab606998b40fd2223a1d04a087237171eedf2aee20) | [BaseScan](https://sepolia.basescan.org/tx/0x7c6fdcff4b55bd48e00716456fe0cd9d1abbeb1eb5e10af6eacd7865d70b9711) | `50017764 / 0` |
| `j576ngxsaakcgvcd84dcvayp798gzgq6` | `false` | [EASScan](https://base-sepolia.easscan.org/attestation/view/0x2292b7489d6fc2b055d0c57b46fd287b54904abc5f834b8dea3f1d1358caafa0) | [BaseScan](https://sepolia.basescan.org/tx/0x6b606c178b8c14bd93d31e4195baaf48d7adb024e14b1eba3c75c2afaeb98cd7) | `50017776 / 17` |
| `j578spxhtctqc0masn3k2f82kx8gz10w` | `false` | [EASScan](https://base-sepolia.easscan.org/attestation/view/0x134f7c55964a06146a5b3e7b0ebd92e99316e70c13aa933fcb2e084932ae5c28) | [BaseScan](https://sepolia.basescan.org/tx/0x21c154448e620acbbdfc930afecd1f5a8bdb85cade19cc7ceadd4f3802d716b0) | `50017727 / 0` |
| `j57dbaxpz3rs6fbgew0q6vger98gzhzp` | `false` | [EASScan](https://base-sepolia.easscan.org/attestation/view/0x19210398d31e0a1dcaeb7dada8de74a33892a2a861a1bb7cccc4acb366463771) | [BaseScan](https://sepolia.basescan.org/tx/0x3a09ba3650a6bd043c3cbb3840c61389c73866cf275f63a0cd54c601d9747266) | `50017735 / 4` |
| `j57f76tvbef3t2g0tyx667r1g98gzzmz` | `false` | [EASScan](https://base-sepolia.easscan.org/attestation/view/0x3d8288b740c353196046618d3481ed9e9120e53ea906ad624df21a26a9c9c8e0) | [BaseScan](https://sepolia.basescan.org/tx/0x5ce628d64f69c42347dde3f1dd6ea8dc0da42ed6317dda16668d70862a269c33) | `50017744 / 0` |
| `j5793b275cgcb55fwnxsrh1wgh8gy5h9` | `false` | [EASScan](https://base-sepolia.easscan.org/attestation/view/0x935c09143c1ddb059ca62429a6623b42b3110dc589cdc45031eaa8c6c5e863e4) | [BaseScan](https://sepolia.basescan.org/tx/0x04319bde242f2660f14a29c0fdbb4cf853f8e9aa797d0ca3ae0f3afa67fb212b) | `50017754 / 1` |

Validation: `pnpm check` passed (TypeScript, Node/Convex/payment tests,
documentation links and production build). Live evidence above comes from
Convex, EASScan and Base Sepolia RPC, not fixtures. This follow-up made no
Convex deployment or environment change and uploaded no media.

## Capital One Nessie bank witness — October 25, 2026

The bank-witness slice adds a fourth reconciliation source beside the order,
ledger and chain: **simulated bank (Capital One Nessie mock)**. It models a
Treasury deposit after confirmed x402 funding and a contributor off-ramp
transfer after an observed payout, using the original intent ID as the bank
description. Exact amounts and account direction bind the match. The live
Nessie API truncates `amount` to an integer (1.5 becomes 1, 0.01 becomes 0)
and requires `status`, so the bank carries exact integer US cents: 1 cent is
10,000 micro-USDC. Sub-cent amounts (for example a 1.875 USDC payout) are
refused with `nessie_subcent_amount`, never rounded, and stay visible as
missing bank evidence. Live empty transfer lists return HTTP 404 and are read
as no transfers only after the key is bound to the known account;
missing evidence stays visible and disagreements enter the exception queue. No bank record
posts a journal or grants payment authority.

The implementation provides an idempotent Treasury/contributor account seed,
durable intents before external requests, a two-minute activity sweep, and a
controller/finance-agent four-way query. Contributors must be active and have a
verified wallet before account seeding. Ambiguous writes are observed rather
than resent. Refund and standalone evidence-sale bank simulation is outside
this slice's scope. The one-dollar-per-USDC mapping is a demo assumption.

**Live Nessie run (October 25, 2026, 04:04–04:12 PDT):** a real Nessie key
(GitHub OAuth, private in `~/.config/skarl/nessie.env`, set in Convex) passed the
POST credential probe. `bankWitness:seed` created the Treasury and contributor
accounts; `bankWitness:sweep` posted four simulated funding deposits that were
read back as `observed`. `bankWitness:reconciliation4Way` for order
`kh7531zdrt7bn8vrs5qsw3c8bs8gy0cg` returned order, ledger, chain and bank all
`match`. Three live-contract fixes were needed (integer cents, required `status`,
deposit rows without `payee_id`, empty transfer list as 404); four deposits first
refused with HTTP 400 were released by `bankWitness:releaseRejectedOperations`.
This is still a mock bank: no real fiat moved.

**Rollout:** the deployment owner must deploy the merged `origin/main` backend
and configure `NESSIE_API_KEY` and `NESSIE_ENABLED=true`. This task performs no
Convex deployment. The exact signup steps and operator entry points are in the
[bank-witness dashboard handoff](dashboard-api.md#bank-witness--capital-one-nessie).
Keep the simulation label after activation: Nessie's hosted mock bank is still
not a real bank transfer or custody integration.

## Submission evidence refresh — October 25, 2026, 04:40 PDT

Read-only queries against `dev:keen-marmot-986` reconcile the submission text
with stored live history. These observations supersede earlier pending labels;
this refresh invoked no inference, bank write, wallet send or deployment.

- **Vision jury:** `dashboard:submissions` for v2 returns analysis
  `j5793b275cgcb55fwnxsrh1wgh8gy5h9`, completed at **03:35:33 PDT**, for
  verification-only submission `mn79eef6kdybg8c8g86b3whatd8gzbz2`. Its stored
  report records Argon **7,758 ms**, Flash **4,916 ms**, Transcribe **718 ms**,
  `agreementFraction:1`, no disagreed criteria, and 19 evidence assets. Both
  judges found the task criteria unobservable; the report remains
  `needs_review` with suspected duplicate evidence. This proves a completed
  live negative jury run and persisted assets, not valid work, trim robustness
  or measured human-task accuracy.
- **Claude finance:** `financeAgentData:runs` returns completed run
  `mx72prddnhjp87a8qdy9p0svs98gyggq`, provider `claude`, model
  `claude-sonnet-5-5`, **03:59:29–03:59:33 PDT** (4,636 ms). Its stored tools
  are `listOutstandingPayables`, `getTrialBalance` and
  `listReconciliationExceptions`; an explanation is persisted and
  `proposedAtomic` is `"0"`. The earlier `claude_http_400` run remains recorded.
  This is live read-only finance evidence, not a proposal, approval, payment,
  coach-quality measurement or new model call by this refresh.
- **Nessie funding witness:** the 04:40 read of
  `bankWitness:reconciliation4Way` returns `bankAvailable:true`,
  `simulated:true`, label `simulated bank (Capital One Nessie mock)`, and a
  04:39:26 PDT snapshot. For the v2 funding intent, order/ledger/chain/bank all
  `match` at `10000000` micro-USDC; activity
  `d556d8f9-4f88-41be-9034-f24da9b40583`; `exceptions:[]`. This corroborates
  the hosted mock-bank run above. It does not establish fiat movement or a
  payout/off-ramp match.
- **Remaining payout gate:** `dashboard:payables` for v2 still returns `[]` at
  04:40. Its six observed submissions remain verification-only, review-only
  and undelivered. The full duplicate-to-controller-wallet-payout sequence,
  Wallet MCP purchase and paid evidence delivery remain unverified. No new
  physical iPhone IMU or Cartesia evidence is recorded here.

The finance/bank/payable queries were repeated at 04:40; submission/report
history was read earlier in this refresh. All reads use the v2 order ID
`kh7531zdrt7bn8vrs5qsw3c8bs8gy0cg` and the controller demo identity. No original
media, transcript text, private URL or credential is reproduced here.
