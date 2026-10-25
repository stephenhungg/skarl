# Build Status

Truthful state as of October 25, 2026, after the adversarial audit and the move from Solana to Base Sepolia. Task 1 finance and Task 2 verification run on the shared Convex cloud dev deployment below. Both visual and audio inference completed on one generated-media smoke test; a human demonstration quality benchmark remains unmeasured. Payment adapters are implemented; the payment owner recorded a first live x402 funding below. Live payout remains unconfirmed. Update this file when another integration becomes demonstrable.

| Area | Implemented now | Remaining for the [demo path](workstreams.md) |
| --- | --- | --- |
| Web | Next.js landing/contributor recorder, Convex upload/status wiring, health and payment API routes; production build passes | Controller dashboard, live browser/wallet integration and HTTPS deployment verification |
| Shared contracts | Base Sepolia chain constants (`chain.ts`), funding/payout status lists, JSON Schema, TS report validation, `parseAtomicUsdc` | Rubric-membership check wired into acceptance |
| Convex | Shared cloud dev deployment; idempotent seed; persisted demo-role checks; `acceptAndPublish` / `proposePayment` / `approve`; uploads/scheduling/fenced report persistence; dashboard queries; committed generated API | Licensed media downloads and verified contributor wallets; production auth is out of demo scope |
| Verifier | Scheduled Node action; SHA-256; server FFmpeg/JPEG/WAV/dHashes; independent Gemini stages; deterministic rubric comparison; validated stored reports; live audio measured | Both model stages completed on one generated input; human task acceptance, model accuracy and copy calibration remain unmeasured; intermittent provider failures persist |
| Evaluation | Cloud clip runner; pre-labeled/source-hashed manifest; isolated copy scope; advisory quality projection; dated JSON/Markdown metrics and resume checkpoints | No consented labeled human corpus or measured accuracy run yet; provider availability remains a blocker |
| Ledger | Atomic journal persistence; journal-derived trial balance, cash, deferred revenue, revenue/expense and payables by contributor; exact replay protection | Live payout settlement and end-to-end reconciliation evidence |
| Payments | Base Sepolia x402 exact route; nonce dedup; receipt/authorization-log validation; atomic funding and payout journals; three-way reconciliation; testnet buyer CLI; browser payout hook; prepared Wallet MCP calls; mock-backed tests | First x402 funding recorded below; v2 read-back is funded with 10000000 micro-USDC cash and deferred revenue. Complete the independent approval, wallet payout and reconciliation demo |
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
model defaults. A working visual-provider response/quota is still required to
claim a complete live multimodal verification demo.

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
