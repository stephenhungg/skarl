# Skarl — Every claim has a witness

**Skarl is the autonomous settlement desk for human-data companies. Independent witnesses must agree before anything moves.** The agent proposes; the buyer-signed policy (or the buyer in review) approves; an independent CDP cap guards execution. The AI never approves itself. The buyer reviews exceptions.

[Live testnet demo](https://skarl.devshardat.work) · [Repository](https://github.com/stephenhungg/skarl) · [One-page thesis and witness table](thesis.md) · [Coinbase submission](coinbase-submission.md) · [Demo script](demo-script.md) · [Setup](setup.md)

**Testnet · test USDC · demo identities · operator-owned funds.** Evidence cutoff: **October 25, 2026, 04:40 PDT**; [status](status.md) is the dated source of truth. Implemented, simulated and live are different claims.

## Inspiration

Human-data companies buy demonstrations that must become licensed training samples and defensible contributor payments. But a new filename may conceal work already paid for; fluent narration may describe something the camera never saw; a timeout may hide a completed transfer. The settlement desk needs witnesses for the work, the obligation and the movement of money.

The market is spending heavily on human demonstrations: Forbes reports Figure's plan to invest **$1 billion in data and compute over 12 months**. Contributors still need visibility into the bargain: MIT Technology Review reports workers' uncertainty about how their footage is used, stored and shared. [Forbes](https://www.forbes.com/sites/johnkoetsier/2026/08/26/figure-launches-gig-platform-to-get-humans-to-do-work-to-train-robots-will-spend-1-billion/), [MIT Technology Review](https://www.technologyreview.com/2026/04/01/1134863/humanoid-data-training-gig-economy-2026-breakthrough-technology/).

Our tasks are deliberately narrow tabletop demonstrations, each defined by a versioned task spec: for example, put a red cup on a marked coaster while a blue cup acts as a distractor, or move a can next to a hat. The verifier's prompts and object/target checks are generated from the task spec's rubric rather than hardcoded per task. Our first customer hypothesis is the operator buying those demonstrations for an AI team. No customer interviews, paid adoption or downstream model improvement are claimed.

## What it does

Skarl fills the **settlement accountant + AP clerk** seats through the finance agent and buyer-signed policy. The work witnesses are silent visual observations, separately transcribed audio and server-derived copy evidence. The money witnesses are frozen Convex order terms, exact double-entry journals and independently observed chain transfers. A deterministic judge checks the evidence and stored authority. Finance agents explain discrepancies and propose bounded payments; they cannot approve them. The buyer sets an auto-pay rule when funding. A separate internal `policy-engine` applies it deterministically; the CDP executor enforces an independent wallet cap.

The rule is on by default with a cap equal to the order’s per-clip price; buyers can change or disable it. Completed accept evidence, a clear copy check, liveness when required, no injection flag, and consent/license are required. Failed checks go to the buyer’s Review queue with their reasons. Acceptance atomically creates a licensed delivery, one payable and balanced journals. An incomplete, unavailable or scaffold report cannot recommend acceptance. Unknown transfers become exceptions; an uncertain attempt remains pending while the original transaction is reconciled. Neither a persuasive agent nor an HTTP success is proof of settlement.

**The moment:** duplicate caught → second payable blocked → agent self-approval refused → buyer-signed policy approves eligible work → independent CDP cap → chain + ledger agree. The complete sequence is **pending live proof**. The demo labels isolated control tests as **SIMULATED — NO TRANSFER** and recorded provider operations as **RECORDED LIVE TESTNET**. The bank comparison is a dated live Nessie API observation (October 25, 2026, 04:11 PDT: four funding deposits observed; order, ledger, chain and bank all `match` for the 10 USDC order), still labeled a **mock bank**.

The advisory finance analyst adds cited review recommendations, payout narration that distinguishes approval from observed settlement, and organization close notes on Convex crons. Live close and exception notes have been generated on the development deployment; the analyst has zero payment authority.

The [tax-ready ledger](tax.md) adds journal-derived YTD payouts, contributor form-on-file attestations, deterministic missing-form buyer review and read-only finance-agent summaries: **Not tax advice — demo data**. It collects no tax IDs and never computes, withholds or files real tax.

Each accepted clip also gets a **Token-2022 license token on Solana devnet**: a one-of-one mint (supply 1, decimals 0) whose mint authority is revoked in the same transaction, with on-chain metadata whose `license` field is a digest binding the delivery, manifest, order terms, consent receipt and license version. Minting is idempotent per delivery and refused once a consent revocation is recorded.

Personal AI agents can **onboard themselves over MCP**: `skarl_onboard` walks through wallet setup, `skarl_wallet_status` checks Base Sepolia USDC readiness and `skarl_request_testnet_usdc` requests rate-limited test USDC from the CDP faucet. The same flow ships as a `skarl-buyer` skill at `/skill.md`. Agents fund orders; they never approve payouts.

## How we're different

Existing human-data marketplaces such as [Kled AI](https://www.kled.ai/) proved people will sell real-world data at scale (500k+ contributors by Kled's own count) and already record consent and provenance receipts on-chain. What they publish about quality is a closed fraud score and a self-reported accuracy figure, and public App Store reviews complain about opaque, tiny per-item payouts. Skarl competes on proof, not scale:

- **Auditable verdicts:** two vision models must agree or a human reviews; every rubric criterion cites timestamped evidence; evals publish Wilson intervals, kappa and risk-coverage.
- **The verdict is attested, not just the consent:** each verification result and its evidence hash go to EAS on Base Sepolia.
- **Built for robot learning:** task rubrics and narration, with implemented phone motion capture whose physical-device behavior remains unverified.
- **Agents can buy:** an AI buyer funds an order over x402 without a sales form.
- **Payments a buyer can defend:** agents propose but never approve, the signed rule approves only eligible payments within the buyer’s cap, the independent CDP cap guards execution, and order, ledger, chain and bank reconcile.
- **Contributors get reasons:** the implemented Claude coach cites stored evidence and cannot change the verdict; contributor-facing quality remains unmeasured.

The opportunity is useful episodes with a defensible receipt. Flikforge reports that buyers discard approximately **90% of bulk pretraining footage for a specific robot-training task**. This is a **vendor claim**, not Skarl's measured result or an independent industry statistic; Forbes links Flikforge for price estimates, not independent validation of that discard rate. Our response is explained criteria, consent provenance and visible payment state. It is not a claim that short task clips replace sensor-rich robot demonstrations. [Flikforge, vendor](https://flikforge.com/robot-data-glut-egocentric-video-physical-ai/), [Forbes](https://www.forbes.com/sites/johnkoetsier/2026/08/26/figure-launches-gig-platform-to-get-humans-to-do-work-to-train-robots-will-spend-1-billion/). The [market summary](market.md) records prices, source limits and the hand-pose, depth, ARKit camera-pose, head-mount and fiat-payout roadmap.

Kled leads on what matters for a business today: real contributors, mainnet payouts, buyers and fraud models trained on real attacks. Skarl is a testnet prototype.

## How we built it

Convex holds the order, private media, version-bound evidence, approvals, attempts, journals and agent transcripts. Next.js serves the product and x402 endpoints. Gemini Argon and Flash form a silent-frame jury; separate Gemini Transcribe audio provides another input. Disagreement and failed analysis route to review. A stored live Argon+Flash negative jury report has both judges agreeing that the task criteria were unobservable; it remains review-only. Same-family agreement is not independent proof of truth.

Amounts stay `bigint` micro-USDC, Convex Int64 and decimal integer strings at JSON boundaries. Durable intent and a single execution claim precede payment. Canonical token, recipient, amount, confirmations and transfer identity must match before posting. Base Sepolia is advertised first and is the only payout target; Solana Devnet is an optional funding rail. There is no custom smart contract or escrow contract.

## What's real, what's simulated, how we know

| Claim | Evidence and limit |
| --- | --- |
| **Live: Base x402 funding** | [10 test USDC](https://sepolia.basescan.org/tx/0x28b3f88d593c02a669cb95f4bdc6a23ab3d24bb5d1260e6c4ae54554155cd757) via the public facilitator; [0.01 test USDC](https://sepolia.basescan.org/tx/0x20c9252f7d67a2dac87be839ad82b83465686157478645354838ac0f7239390d) via CDP with a real signed webhook, processed Convex receipt and balanced funding journal. These are funding receipts, not payouts. |
| **Live: Solana funding** | [1 test USDC through CDP](https://explorer.solana.com/tx/31LMrtZYcf4PcBRcyFmFX8tBmt2fNttNSBA4mz7sTrZKSw6E2kH9oghw5FTafzR77JZT9so1zzjkj8ZuVqrGUezi?cluster=devnet), finalized slot 514940239, transfer instruction 2; exact RPC/Convex match and zero reconciliation exceptions at 03:29 PDT. |
| **Live: inference and finance read** | Historical Flash vision (4,893 ms) + Transcribe (1,322 ms) on an unrelated human-video negative; correctly review-only. Flash finance read the trial balance and persisted an explanation (6,805 ms client time), with no proposal or transfer. These are integration measurements, not accuracy or productivity benchmarks. |
| **Live: jury + Claude finance + mock bank** | The [04:40 evidence refresh](status.md#submission-evidence-refresh--october-25-2026-0440-pdt) records the Argon/Flash/Transcribe negative jury (7,758/4,916/718 ms), a completed Claude finance loop with three read tools and zero proposed amount, and a fresh 10-USDC order/ledger/chain/Nessie match. Nessie is a simulated bank; no fiat or payout match is claimed. |
| **Live: CDP enforcement** | Actual over-cap 2.000001-USDC and non-allowlisted 0.10-USDC requests returned `403 policy_violation`; no outgoing transaction returned. Preflight policy simulations are separate evidence. |
| **Live: EAS public receipts** | All 11 finalized reports have confirmed attestations from the two-minute cron, verified through EASScan and RPC; every recommendation remains `needs_review`. [Inventory and provenance](status.md#live-backfill-and-automatic-sweep--october-25-2026-0353-pdt). |
| **Implemented + devnet smoke: Token-2022 licenses** | [`solana-license.ts`](../packages/payments/src/solana-license.ts), [`solanaLicense.ts`](../convex/solanaLicense.ts), [`solanaLicenseData.ts`](../convex/solanaLicenseData.ts). A devnet smoke mint confirmed supply 1, mint authority `None` and on-chain metadata. Licenses appear in `proof:summary.solanaLicenses` and the public `/proof.json`. No production license exists until a clip is accepted. |
| **Deployed: agent onboarding** | MCP guest tools `skarl_onboard`, `skarl_wallet_status`, `skarl_request_testnet_usdc` ([`mcp.ts`](../convex/mcp.ts), [`onboarding.ts`](../convex/onboarding.ts)) and `/skill.md`. A live faucet request delivered test USDC to the CDP agent wallet. Faucet use is rate limited per address, caller and globally. |
| **Simulated / local controls** | Duplicate obligations, trim-candidate alignment, approval refusal, replay, refund reservation and timeout recovery have regression coverage. Workflow wait/resume uses the real component's test adapter. Tests prove those cases, not live settlement. |
| **Pending** | Licensed accepted contribution; contributor payout; production Token-2022 license; completed Wallet MCP purchase; paid evidence delivery/Bazaar listing; settlement/finance cron observations. Cartesia and physical iPhone IMU remain unverified. Claude finance and the negative vision jury now have stored live-run evidence; Nessie has live mock-API evidence. EAS report attestations are now live; they do not establish acceptance. |

The [witness table](thesis.md#the-witness-table) distinguishes each layer. Original media, private URLs and credentials stay out of source control and public receipts. Demo identities are impersonable and are not production authentication.

## Challenges and lessons

CDP SQL returned HTTP 500 even for `SELECT 1`; we kept it explicitly unavailable and reconciled with RPC plus signed webhooks. Solana facilitator fee-payer rotation initially broke quote matching; the bounded retry succeeded only after checking the earlier authorization was expired and unsettled. A timeout alone never permits a replacement payment.

Evidence, approval and settlement are separate facts. A model answer does not establish an obligation, an approval does not establish a transfer, and a transfer does not establish valid work. This distinction is the product's central design decision.

## Prize-specific evidence

Criterion labels below follow the [official prize list](https://cal-hacks-13-0.devpost.com/), [Hyphenate brief](https://docs.google.com/document/d/1u4iN8R97ILY3kfHTPKC82zdutHrGx4ze5eCAP-J92w4/edit), [Coinbase brief](https://drive.google.com/file/d/12TnPLguduV3gh1zY_TJ176XmVDz2RGW9/view), and [Cal Hacks 13.0 Hacker Guide](https://docs.google.com/document/d/1RQrueC9wm5u8uxtWSC2gadIchp05hVayhGUrIjxT9dE/edit). Missing integration evidence is a submission gate, not a prize claim.

### Hyphenate — The Hyphenated Enterprise: Autonomous Systems for Finance

| Rubric, verbatim | Skarl's evidence |
| --- | --- |
| **Is it real enough?** | Frozen contracts, a double-entry ledger, real testnet funding, real provider failures and a reconciliation queue. Payout and complete live operation remain pending. |
| **Would you hire it?** | Seats: **settlement accountant + AP clerk**. Limited access: scoped typed tools, capped proposals, no agent approval/signing authority. Clean record: persisted calls, refusal audits, version-bound intents and journals. Knows when to ask: missing witnesses, over-cap amounts and other exceptions go to buyer review. Separation of duties is agent proposer vs. buyer-signed policy approver vs. independent CDP cap. Demo identity impersonation blocks production hiring today. |
| **Did we see something new?** | Work-quality evidence and financial settlement share one obligation lifecycle: a copied clip is stopped before it becomes a second debt. Multiple model opinions remain evidence under deterministic authority. |
| **The moment** | Duplicate caught → second payable blocked → agent self-approval refused → buyer-signed policy approves eligible work → independent CDP cap → chain + ledger agree. Full live sequence pending; control tests and funding evidence are labeled separately. |

The real/simulated inventory above accompanies the video. For judge-selected variations, use the [eight-scenario playbook](hyphenate-scenarios.md); duplicate re-upload and trimmed-copy variants share one scenario.

### Convex — Best use of Convex

Convex is the system of record and agent memory. Its transactions keep acceptance, payable and journal creation together; its persisted attempts preserve uncertainty across retries. The official brief calls out **live queries and components**.

#### Convex features used

| Feature | File paths and concrete role | Evidence |
| --- | --- | --- |
| Live queries | [dashboard.ts](../convex/dashboard.ts), [contributor data.ts](../apps/web/features/contributor/data.ts): `useQuery` subscriptions to orders, submissions and payables. | Query data observed live; no measured cross-browser propagation latency claimed. |
| Workflow component | [convex.config.ts](../convex/convex.config.ts), [approvalWorkflow.ts](../convex/approvalWorkflow.ts): durable approval event, revalidation, one dispatch. | Component installed; wait/resume/refusal proven with component tests; live payout pending. |
| Scheduler | [submissions.ts](../convex/submissions.ts): transactionally queue verification and interrupted-job checks. | Scheduled negative-smoke inference ran live. |
| Crons | [crons.ts](../convex/crons.ts), [scheduledJobs.ts](../convex/scheduledJobs.ts): bounded settlement observation and finance review; report-attestation sweep. | Attestation cron observed live at 03:50/03:52; settlement/finance cron runs remain unverified in status. No blind resend. |
| File storage | [submissions.ts](../convex/submissions.ts), [verify.ts](../convex/verify.ts), [media.ts](../convex/media.ts): private source media and access-checked evidence. | Original uploads read live; the observed jury report has 19 stored evidence assets. |
| Node actions | [verify.ts](../convex/verify.ts), [financeAgent.ts](../convex/financeAgent.ts): FFmpeg/provider calls outside transactions. | Live isolated inference, negative jury, and read-only Gemini/Claude finance runs. |
| Typed validators | [schema.ts](../convex/schema.ts), [validators.ts](../convex/validators.ts), [verification.ts](../packages/contracts/src/verification.ts): typed records, exact money and report validation. | Deployed core validation plus local trust-boundary regressions. |

### Coinbase — Best Use of x402 by Coinbase / Payment Agents

| Rubric, verbatim | Skarl's evidence |
| --- | --- |
| **Usefulness** | **PAY:** agent-funded human-data orders, live through CLI/CDP. **EARN:** a 0.25-USDC eligible-sample evidence endpoint paying a separate revenue wallet; live sale pending. |
| **Technical design** | Exact money, durable intents, CDP facilitator + signed webhooks + RPC, bounded Gemini/Claude tools, Convex memory/Workflow, buyer-signed deterministic approval. Actual CDP policy `403`s constrain the optional executor; successful payout pending. |
| **Ease of reuse** | Public app, [README setup](../README.md), [Wallet MCP plugin](wallet-mcp-plugin/skarl.md), MCP onboarding tools plus a `skarl-buyer` skill at `/skill.md` (wallet check, rate-limited CDP faucet, task discovery, x402 funding), explicit caps and same-request recovery. Completed Wallet MCP payment remains pending; CLI settlement is not MCP evidence. |
| **Product feedback** | Observed SQL 500 blocker; RPC/webhook workaround. Solana x402 fee-payer rotation, Wallet MCP self-send, CDP faucet sizing for Token-2022 rent and the `@solana/kit` version split are documented with workarounds. Requested capability: policy-bound Wallet MCP execution of already authorized transactions with stable request IDs. Full incident provenance in [builder feedback](coinbase-submission.md#4-builder-feedback). |

Wallet MCP uses `initiate_x402_request`, human approval and `complete_x402_request`; the finance agent cannot approve itself. The application’s buyer-signed policy and the CDP wallet cap are separate controls. Wallet MCP approval-mode signing remains a compatibility path. Eligibility and the four required submission artifacts remain in the [sponsor checklist](sponsor-tracks.md#team-eligibility-checklist).

### Anthropic — Claude for Public Benefit

**A named community.** Student and gig contributors recording robot-training demonstrations for labs, and the small AI teams responsible for paying them. The intended benefit is evidence-backed compensation and fewer duplicate obligations; no community deployment or measured social impact is claimed. **A real problem.** Disputed work and uncertain settlement leave contributors and operators without a defensible payment decision. **It works.** The prototype has live funding, Gemini evidence and bounded finance tools; the complete payout loop is pending.

**Thoughtful use of Claude.** Claude and Gemini are configurable finance providers over the same bounded tools; neither can approve. A stored live `claude-sonnet-5-5` run completed at 03:59 PDT, reading payables, trial balance and exceptions, then persisting an explanation with zero proposed amount. The [04:40 evidence refresh](status.md#submission-evidence-refresh--october-25-2026-0440-pdt) gives its run ID and retains the earlier HTTP 400 failure. This is in-product finance evidence, separate from Claude Code used for development.

The implemented Contributor Coach translates stored criteria into specific correction guidance with evidence timestamps. It omits raw narration, has no tools, validates output and cannot change the outcome or promise payment. Its contributor-facing quality and community benefit remain unmeasured, and no completed live coach result is recorded yet. The useful next step is a consented contributor pilot. [Implementation and limits](anthropic.md).

### Capital One — Best Use of Nessie

Rubric: **Completeness, Creativity, Complexity**. **Completeness:** live Nessie mock-API setup and four observed funding deposits; the 04:40 query confirms order, ledger, chain and bank agreement for the 10-USDC order. Payout/off-ramp agreement remains pending. **Creativity:** use disagreement between witnesses to expose an exception. **Complexity:** durable bank intents, exact integer-cent mapping, direction/intent binding, and observation of ambiguous writes instead of blind resend. Sub-cent amounts are refused rather than rounded. No bank record grants payment authority or posts a journal. This is always a **simulated bank**, never evidence that real fiat moved. [Live provider trace](status.md#capital-one-nessie-bank-witness--october-25-2026).

### MLH — Best Use of Gemini API

Gemini produces timestamped observations instead of final payment authority. Argon + Flash inspect silent frames, Transcribe receives isolated audio, and Flash explains exact finance tool results. The stored live jury run has Argon and Flash agreeing on unobservable criteria, with separate Transcribe audio and a review-only result. Historical Flash/Transcribe negative inference and the read-only Flash finance loop are also live. Local simulated regressions cover failure and disagreement paths. No human-task accuracy or model-superiority claim is made. Missing evidence and disagreement route to review.

### MLH — Best Use of Solana

**Live funding evidence:** 1 test USDC on Solana Devnet through CDP at 03:29 PDT, with finalized RPC identity and a matching Convex journal, linked above. The earlier fee-payer mismatch is preserved as a failed attempt rather than hidden. Solana provides optional buyer funding; Base remains first in x402 accepts and the only payout rail.

**Token-2022 data licenses:** each published delivery mints one Token-2022 license on Solana devnet using the MetadataPointer and TokenMetadata extensions. One transaction creates the mint, writes metadata, mints exactly one token and sets the mint authority to `None`, so supply is provably fixed. The on-chain `license` field is a digest over the delivery, manifest hash, order terms hash, consent receipt hash, license hash and license version, so anyone holding Skarl's off-chain records can verify which consent the token licenses. A CDP Solana account pays and signs remotely; a fresh mint keypair signs locally. Mints are idempotent per delivery, retried a bounded number of times, and refused after a consent revocation is recorded. A devnet smoke mint verified the transaction shape; no production license exists until a clip is accepted. No Solana payout, bridge, mainnet deployment or Wallet MCP Solana payment is claimed.

### Microsoft — Built for the Real World (1st), Customer Impact Award (2nd)

| Rubric, verbatim | Skarl's evidence and next proof |
| --- | --- |
| **Customer understanding** | One defined operator job: acquire licensed demonstrations and pay each valid obligation once. Customer discovery remains a hypothesis to validate, not completed research. |
| **Measurable usefulness** | Observable checks: one payable per accepted original, unchanged books after refused approval, exact reconciliation and no resend under uncertainty. Live funding has matching journals/zero exceptions. No hours saved, ROI or production fraud reduction measured. |
| **Path from prototype to production** | Replace demo identities; validate consent/access handling and buyer ownership checks; complete live payout/recovery; measure a consented corpus; run a narrow operator pilot before real funds. |
| **responsible design** | Private originals, buyer-signed policy approval, independent CDP cap, scoped tools, exact money, retained uncertainty, review on missing evidence and visible simulated/live labels. No model can change a destination or confer authority. |
| **end to end functionality** | Fund → upload → independent evidence → acceptance/payable → approval → wallet → reconciliation is implemented in parts. Funding and negative verification ran live; accepted-work-to-payout and the complete integrated demo remain pending. |

### Cal Hacks Most Technically Complex Hack

**Technical Complexity:** the depth is in connecting independent media evidence to transactional obligations and asynchronous settlement without double payment. Modality isolation, copy alignment, canonical report validation, exact journal replay, durable Workflow approval, signed webhooks and Base/Solana receipt adapters each enforce a distinct boundary. Complexity is demonstrated through failures and recoveries, not an integration count; mocked tests do not establish live execution.

### MLH — Commit Fellowship Prize Category

The team has a prototype and a specific problem to validate: can small human-data operators reduce settlement review effort while protecting contributors and preventing duplicate obligations? Next is customer discovery, a consented pilot and measured review/false-acceptance outcomes.

## What's next

Complete a consented, accept-eligible contribution and independently approved Coinbase Wallet payout; record the entire moment. Verify paid evidence delivery and Wallet MCP/Bazaar discovery. Measure the deployed jury and recovery crons; test public receipts on a newly submitted report as well as the demonstrated backfill. Extend the demonstrated Claude read-only finance and mock-bank funding paths to a consented pilot without granting models payment authority. Evaluate false acceptance and copy detection on labeled human clips before claiming quality or expanding the task.

## Built with

TypeScript, React, Next.js, Vercel, Convex, Convex Workflow, Gemini API (Argon, Flash, Transcribe), Claude API, Capital One Nessie mock API, EAS, FFmpeg, x402, Coinbase CDP SDK/facilitator/webhooks/Policy Engine/faucet, Coinbase Wallet MCP adapter, MCP, Base Sepolia, Solana Devnet, Solana Token-2022 (`@solana/kit`, `@solana-program/token-2022`), test USDC, viem, Python, Vitest and pnpm. This list describes implementation, not proof that every integration ran end to end.

## Verify on-chain

Skarl's report provenance integration uses the existing EAS predeploy on Base
Sepolia, with no custom contract. A policy-constrained CDP attestor commits the
canonical report hash, original-source hash, frozen-rubric hash, pipeline/model
versions, stored recommendation, completion time and license flag. The public
record contains no media URL, contributor name or contributor wallet. A dashboard
**Verify on-chain** badge links the current report to EAS when confirmation is
available.

The commitment also covers finalized failed reports: it proves what Skarl
recorded, not model accuracy, acceptance or payment. Verification-only clips are
marked `licensed: false`. All 11 finalized reports now have confirmed
attestations, automatically backfilled by the deployed two-minute Convex cron.
Every recommendation remains `needs_review`.

**Verify on-chain:** [Latest report on EASScan](https://base-sepolia.easscan.org/attestation/view/0x935c09143c1ddb059ca62429a6623b42b3110dc589cdc45031eaa8c6c5e863e4)
and [its Base Sepolia transaction](https://sepolia.basescan.org/tx/0x04319bde242f2660f14a29c0fdbb4cf853f8e9aa797d0ca3ae0f3afa67fb212b).
The [complete attestation inventory](status.md#live-backfill-and-automatic-sweep--october-25-2026-0353-pdt)
includes all 11 EASScan and BaseScan links, receipt block/log identities and the
observed cron executions. EASScan fields and direct RPC receipts/payloads were
verified; BaseScan page inspection was blocked by its CAPTCHA. No new upload was
created to test the cron.

See [Coinbase controls and provenance](coinbase-submission.md#verify-on-chain)
and the [official EAS deployments](https://docs.attest.org/docs/quick--start/contracts).

## Capital One — Nessie bank witness

**Completeness:** Skarl adds a fourth settlement witness, labeled **simulated
bank (Capital One Nessie mock)**, to compare each funding or contributor-payout
obligation across the order, ledger, chain and modeled bank activity. Confirmed
x402 funding is modeled as a Treasury deposit; observed contributor payouts
are modeled as Treasury-to-contributor transfers. Account seeding, activity
polling and exception projection run against the live Nessie mock API: four
funding deposits were observed and the 10-USDC order matched across order,
ledger, chain and bank at 04:11 PDT. No real fiat movement is claimed.

**Creativity:** “Every claim has a witness” connects agent commerce with the
settlement desk's ordinary question: do the independent records agree? The
bank view gives a human-data company a modeled fiat-side witness beside its
USDC books. Agents can explain the disagreement, deterministic code identifies
the mismatch, and the buyer retains exception review; no agent gains payment
authority. The
mock bank demonstrates that workflow; it is not independent proof of actual
fiat settlement.

**Complexity:** Durable business intent precedes external writes, and repeated
requests reuse the original records. An uncertain response does not authorize
a second transfer. Matching uses the intent ID, exact micro-USDC amount and
account direction, with explicit missing and mismatch states. Startup also
handles Nessie's silent invalid-key behavior: a GET returning HTTP 200 and an
empty array cannot validate credentials. A successful POST probe or a known
account ID is required. The bank witness never changes the ledger or signs a
payment. See the dated [integration status](status.md#capital-one-nessie-bank-witness--october-25-2026)
and [dashboard contract](dashboard-api.md#bank-witness--capital-one-nessie).
