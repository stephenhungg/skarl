# Build Status

Truthful state as of October 25, 2026, after the adversarial audit and the move from Solana to Base Sepolia. Task 1 finance and Task 2 verification run on the shared Convex cloud dev deployment below. Both visual and audio inference completed on generated-media and real YouTube-origin negative smoke tests; a human task quality benchmark remains unmeasured. Payment adapters are implemented; the payment owner recorded a first live x402 funding below. Live payout remains unconfirmed. Update this file when another integration becomes demonstrable.

| Area | Implemented now | Remaining for the [demo path](workstreams.md) |
| --- | --- | --- |
| Web | Next.js landing/contributor recorder, Convex upload/status wiring, health and payment API routes; production build passes | Controller dashboard, live browser/wallet integration and HTTPS deployment verification |
| Shared contracts | Base Sepolia chain constants (`chain.ts`), funding/payout status lists, JSON Schema, TS report validation, `parseAtomicUsdc` | Rubric-membership check wired into acceptance |
| Convex | Shared cloud dev deployment; idempotent seed; persisted demo-role checks; `acceptAndPublish` / `proposePayment` / `approve`; uploads/scheduling/fenced report persistence; dashboard queries; committed generated API | Licensed media downloads and verified contributor wallets; production auth is out of demo scope |
| Verifier | Scheduled Node action; SHA-256; server FFmpeg/JPEG/WAV/dHashes; independent Gemini stages; deterministic rubric comparison; validated stored reports; both stages completed on a real YouTube-origin negative (Flash 4,893 ms, audio 1,322 ms) | Human red-cup acceptance, model accuracy and copy calibration remain unmeasured; provider failures route to review |
| Evaluation | Cloud clip runner; pre-labeled/source-hashed manifest; isolated copy scope; advisory quality projection; resumable paired Argon/Flash comparison with per-model accuracy, false accepts and latency | No consented labeled human corpus or measured accuracy run yet; earlier provider quota blockers resolved after billing was enabled |
| Ledger | Atomic journal persistence; journal-derived trial balance, cash, deferred revenue, revenue/expense and payables by contributor; exact replay protection | Live payout settlement and end-to-end reconciliation evidence |
| Payments | Live Base Sepolia x402 funding succeeded: **10 USDC** to treasury `0x8408a922ea400af33d7c2080a9edd5d3495b695f` ([transaction](https://sepolia.basescan.org/tx/0x28b3f88d593c02a669cb95f4bdc6a23ab3d24bb5d1260e6c4ae54554155cd757)); funding journal/reconciliation and payout adapters implemented | Independent controller approval, wallet payout and payout reconciliation remain to demonstrate |
| Finance agent | Gemini function-calling action; six typed tools; persisted transcript/explanation; cumulative exact batch and call caps; existing proposal and refused approval audits | Live model measurement below; durable Workflow approval wait implemented; wallet execution remains separate |
| Sponsors | Requirements checked against Devpost and the briefs | Working integrations; Coinbase eligibility checklist per member |

Local tests prove only the behavior they execute. They do not prove settlement, inference quality, authorization or sponsor eligibility.

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
