# Build Status

Truthful state as of October 25, 2026, after the adversarial audit and the move from Solana to Base Sepolia. Task 1 finance and Task 2 verification run on the shared Convex cloud dev deployment below. Audio inference succeeded; successful visual inference remains externally blocked as detailed below. Payment adapters are implemented but no live transfer is confirmed. Update this file when another integration becomes demonstrable.

| Area | Implemented now | Remaining for the [demo path](workstreams.md) |
| --- | --- | --- |
| Web | Next.js landing/contributor recorder, Convex upload/status wiring, health and payment API routes; production build passes | Controller dashboard, live browser/wallet integration and HTTPS deployment verification |
| Shared contracts | Base Sepolia chain constants (`chain.ts`), funding/payout status lists, JSON Schema, TS report validation, `parseAtomicUsdc` | Rubric-membership check wired into acceptance |
| Convex | Shared cloud dev deployment; idempotent seed; persisted demo-role checks; `acceptAndPublish` / `proposePayment` / `approve`; uploads/scheduling/fenced report persistence; dashboard queries; committed generated API | Licensed media downloads, verified contributor wallets, Workflow approval wait; production auth is out of demo scope |
| Verifier | Scheduled Node action; SHA-256; server FFmpeg/JPEG/WAV/dHashes; independent Gemini stages; deterministic rubric comparison; validated stored reports; live audio measured | Successful live visual response blocked by Flash 503/timeouts and Argon zero quota; real demonstration quality/copy calibration unmeasured; Python worker deferred |
| Evaluation | Scoring scaffolding | Deferred: no labeled corpus. Staged demo clips only |
| Ledger | Audited pure helpers plus atomic Convex journal/line persistence, fulfillment accrual, event fingerprints and replay protection | Live funding/payout settlement and reconciliation evidence |
| Payments | Base Sepolia x402 exact route; nonce dedup; receipt/authorization-log validation; atomic funding and payout journals; three-way reconciliation; testnet buyer CLI; browser payout hook; prepared Wallet MCP calls; mock-backed tests | Supply controller treasury address; complete Wallet MCP authentication; run real funding/payout. Live buyer balance verified at 20 USDC; no live transfer yet |
| Finance agent | Server payment proposal, independent approval, durable refused self/agent approval audit and exact dashboard projections | Model explanation/tool loop, Workflow wait, approved-command execution |
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

Wallet MCP is configured as `base-mcp` at `https://wallet-mcp.coinbase.com` in
both Claude Code and Codex. Claude Code reports `Needs authentication`;
configuration alone is not a connected wallet session. A human must sign in to
the existing Coinbase Wallet, authorize the MCP connection, and provide its
Base Sepolia receiving address. No wallet was created, credentials entered,
message signed or transaction approved during this preflight.

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
