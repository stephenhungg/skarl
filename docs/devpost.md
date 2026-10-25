# Skarl — Every claim has a witness

**Skarl is the autonomous settlement desk for human-data companies. Independent witnesses must agree before anything moves: agents argue the case, deterministic code decides, and humans approve exceptions.** Every payout currently requires independent human approval, not just exceptions.

[Live testnet demo](https://skarl.vercel.app) · [Repository](https://github.com/stephenhungg/skarl) · [One-page thesis and witness table](thesis.md) · [Coinbase submission](coinbase-submission.md) · [Demo script](demo-script.md) · [Setup](setup.md)

**Testnet · test USDC · demo identities · operator-owned funds.** Demo video: **pending recording and upload**. Evidence cutoff: **October 25, 2026, 03:53 PDT**; [status](status.md) is the dated source of truth. Implemented, simulated and live are different claims.

## Inspiration

Human-data companies buy demonstrations that must become licensed training samples and defensible contributor payments. But a new filename may conceal work already paid for; fluent narration may describe something the camera never saw; a timeout may hide a completed transfer. The settlement desk needs witnesses for the work, the obligation and the movement of money.

Our first task is deliberately narrow: pick up a red cup, put it on a marked coaster and narrate the action. Our first customer hypothesis is the operator buying those demonstrations for an AI team. No customer interviews, paid adoption or downstream model improvement are claimed.

## What it does

Skarl fills the **settlement accountant + AP clerk** seats. The work witnesses are silent visual observations, separately transcribed audio and server-derived copy evidence. The money witnesses are frozen Convex order terms, exact double-entry journals and independently observed chain transfers. A deterministic judge checks the evidence and stored authority. Finance agents explain discrepancies and propose bounded payments; they cannot approve them. The human controller signs approved Base Sepolia payouts in Coinbase Wallet.

Acceptance atomically creates a licensed delivery, one payable and balanced journals. An incomplete, unavailable or scaffold report cannot recommend acceptance. Unknown transfers become exceptions; an uncertain attempt remains pending while the original transaction is reconciled. Neither a persuasive agent nor an HTTP success is proof of settlement.

**The moment:** duplicate caught → second payable blocked → agent self-approval refused → controller approves in Coinbase Wallet → chain + ledger agree. The complete sequence is **pending live proof**. The demo labels isolated control tests as **SIMULATED — NO TRANSFER** and recorded provider operations as **RECORDED LIVE TESTNET**. Add a bank comparison only after a dated live Nessie API observation, still labeled a **mock bank**.

## How we built it

Convex holds the order, private media, version-bound evidence, approvals, attempts, journals and agent transcripts. Next.js serves the product and x402 endpoints. Gemini Argon and Flash form a silent-frame jury; separate Gemini Transcribe audio provides another input. Disagreement and failed analysis route to review. The jury is locally tested; historical live single-model smoke tests do not establish that the current jury ran live. Same-family agreement is not independent proof of truth.

Amounts stay `bigint` micro-USDC, Convex Int64 and decimal integer strings at JSON boundaries. Durable intent and a single execution claim precede payment. Canonical token, recipient, amount, confirmations and transfer identity must match before posting. Base Sepolia is advertised first and is the only payout target; Solana Devnet is an optional funding rail. There is no custom smart contract or escrow contract.

## What's real, what's simulated, how we know

| Claim | Evidence and limit |
| --- | --- |
| **Live: Base x402 funding** | [10 test USDC](https://sepolia.basescan.org/tx/0x28b3f88d593c02a669cb95f4bdc6a23ab3d24bb5d1260e6c4ae54554155cd757) via the public facilitator; [0.01 test USDC](https://sepolia.basescan.org/tx/0x20c9252f7d67a2dac87be839ad82b83465686157478645354838ac0f7239390d) via CDP with a real signed webhook, processed Convex receipt and balanced funding journal. These are funding receipts, not payouts. |
| **Live: Solana funding** | [1 test USDC through CDP](https://explorer.solana.com/tx/31LMrtZYcf4PcBRcyFmFX8tBmt2fNttNSBA4mz7sTrZKSw6E2kH9oghw5FTafzR77JZT9so1zzjkj8ZuVqrGUezi?cluster=devnet), finalized slot 514940239, transfer instruction 2; exact RPC/Convex match and zero reconciliation exceptions at 03:29 PDT. |
| **Live: inference and finance read** | Historical Flash vision (4,893 ms) + Transcribe (1,322 ms) on an unrelated human-video negative; correctly review-only. Flash finance read the trial balance and persisted an explanation (6,805 ms client time), with no proposal or transfer. These are integration measurements, not accuracy or productivity benchmarks. |
| **Live: CDP enforcement** | Actual over-cap 2.000001-USDC and non-allowlisted 0.10-USDC requests returned `403 policy_violation`; no outgoing transaction returned. Preflight policy simulations are separate evidence. |
| **Live: EAS public receipts** | All 11 finalized reports have confirmed attestations from the two-minute cron, verified through EASScan and RPC; every recommendation remains `needs_review`. [Inventory and provenance](status.md#live-backfill-and-automatic-sweep--october-25-2026-0353-pdt). |
| **Simulated / local controls** | Duplicate obligations, trim-candidate alignment, approval refusal, replay, refund reservation and timeout recovery have regression coverage. Workflow wait/resume uses the real component's test adapter. Tests prove those cases, not live settlement. |
| **Pending** | Licensed accepted contribution; contributor payout; completed Wallet MCP purchase; paid evidence delivery/Bazaar listing; live Argon+Flash jury and settlement/finance cron observations. Claude finance runtime, Cartesia, physical iPhone IMU and Nessie are not evidenced live. EAS report attestations are now live; they do not establish acceptance. |

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
| **Would you hire it?** | Seats: **settlement accountant + AP clerk**. Limited access: scoped typed tools, capped proposals, no agent approval/signing authority. Clean record: persisted calls, refusal audits, version-bound intents and journals. Knows when to ask: missing witnesses, exceptions and all payouts require human intervention/approval. Demo identity impersonation blocks production hiring today. |
| **Did we see something new?** | Work-quality evidence and financial settlement share one obligation lifecycle: a copied clip is stopped before it becomes a second debt. Multiple model opinions remain evidence under deterministic authority. |
| **The moment** | Duplicate caught → second payable blocked → agent self-approval refused → controller approves in Coinbase Wallet → chain + ledger agree. Full live sequence pending; control tests and funding evidence are labeled separately. |

The real/simulated inventory above accompanies the video. For judge-selected variations, use the [eight-scenario playbook](hyphenate-scenarios.md); duplicate re-upload and trimmed-copy variants share one scenario.

### Convex — Best use of Convex

Convex is the system of record and agent memory. Its transactions keep acceptance, payable and journal creation together; its persisted attempts preserve uncertainty across retries. The official brief calls out **live queries and components**.

#### Convex features used

| Feature | File paths and concrete role | Evidence |
| --- | --- | --- |
| Live queries | [dashboard.ts](../convex/dashboard.ts), [contribute-flow.tsx](../apps/web/features/contributor/contribute-flow.tsx): `useQuery` subscriptions to orders, submissions and payables. | Query data observed live; no measured cross-browser propagation latency claimed. |
| Workflow component | [convex.config.ts](../convex/convex.config.ts), [approvalWorkflow.ts](../convex/approvalWorkflow.ts): durable approval event, revalidation, one dispatch. | Component installed; wait/resume/refusal proven with component tests; live payout pending. |
| Scheduler | [submissions.ts](../convex/submissions.ts): transactionally queue verification and interrupted-job checks. | Scheduled negative-smoke inference ran live. |
| Crons | [crons.ts](../convex/crons.ts), [scheduledJobs.ts](../convex/scheduledJobs.ts): bounded settlement observation and finance review; report-attestation sweep. | Attestation cron observed live at 03:50/03:52; settlement/finance cron runs remain unverified in status. No blind resend. |
| File storage | [submissions.ts](../convex/submissions.ts), [verify.ts](../convex/verify.ts), [media.ts](../convex/media.ts): private source media and access-checked evidence. | Original uploads read live; frame code deployed at 03:50, post-deployment frame execution unverified. |
| Node actions | [verify.ts](../convex/verify.ts), [financeAgent.ts](../convex/financeAgent.ts): FFmpeg/provider calls outside transactions. | Live isolated inference and read-only Gemini finance run. |
| Typed validators | [schema.ts](../convex/schema.ts), [validators.ts](../convex/validators.ts), [verification.ts](../packages/contracts/src/verification.ts): typed records, exact money and report validation. | Deployed core validation plus local trust-boundary regressions. |

### Coinbase — Best Use of x402 by Coinbase / Payment Agents

| Rubric, verbatim | Skarl's evidence |
| --- | --- |
| **Usefulness** | **PAY:** agent-funded human-data orders, live through CLI/CDP. **EARN:** a 0.25-USDC eligible-sample evidence endpoint paying a separate revenue wallet; live sale pending. |
| **Technical design** | Exact money, durable intents, CDP facilitator + signed webhooks + RPC, bounded Gemini tools, Convex memory/Workflow, independent human approval. Actual CDP policy `403`s constrain the optional executor; successful payout pending. |
| **Ease of reuse** | Public app, [README setup](../README.md), [Wallet MCP plugin](wallet-mcp-plugin/skarl.md), explicit caps and same-request recovery. Completed Wallet MCP payment remains pending; CLI settlement is not MCP evidence. |
| **Product feedback** | Observed SQL 500 blocker; RPC/webhook workaround. Requested capability: policy-bound Wallet MCP execution of already authorized transactions with stable request IDs. Full incident provenance in [builder feedback](coinbase-submission.md#4-builder-feedback). |

Wallet MCP uses `initiate_x402_request`, human approval and `complete_x402_request`; the finance agent cannot approve itself. Account-level CDP policy and Wallet MCP human approval are different controls. Eligibility and the four required submission artifacts remain in the [sponsor checklist](sponsor-tracks.md#team-eligibility-checklist).

### Anthropic — Claude for Public Benefit

**A named community.** Student and gig contributors recording robot-training demonstrations for labs, and the small AI teams responsible for paying them. The intended benefit is evidence-backed compensation and fewer duplicate obligations; no community deployment or measured social impact is claimed. **A real problem.** Disputed work and uncertain settlement leave contributors and operators without a defensible payment decision. **It works.** The prototype has live funding, Gemini evidence and bounded finance tools; the complete payout loop is pending.

**Thoughtful use of Claude.** Integration gate: the thesis calls for Claude + Gemini agents to argue and explain, with neither able to approve. Live runtime evidence currently proves only the Gemini finance loop. Claude Code used for development or a Wallet MCP setup example does not establish thoughtful in-product Claude use. Keep this entry **pending** until a dated Claude run and its contribution to the named community are evidenced.

Our community is student and gig contributors recording robot-training demonstrations for labs, who can be paid late or rejected without a useful explanation. **Every claim has a witness:** Skarl's Contributor Coach uses Claude to turn stored criterion results into kind, specific guidance linked to exact evidence timestamps, while retaining the recorded outcome and uncertainty. Claude also serves as a configurable finance provider over the same bounded tools as Gemini; agents explain and propose, deterministic code enforces the rules, and humans approve exceptions and payments. Neither role can grant payment authority. The coach omits raw narration, has no tools, validates its output and derives citations from the stored report. The implementation has synthetic provider tests; live Claude inference, deployment and contributor-facing UI integration remain pending because the Anthropic key was unavailable at this checkpoint. Our Monday scope is one useful support task: explain what to correct in a recorded demonstration without promising acceptance or payment. [Implementation, limits and setup](anthropic.md).

### Capital One — Best Use of Nessie

Rubric: **Completeness, Creativity, Complexity**. The proposed Nessie witness compares mock bank records with the contract, ledger and chain; it never establishes a real bank settlement. Completeness requires a reproducible API observation and mismatch/recovery trace; creativity is using disagreement to surface an exception; complexity is binding the observation to an exact obligation without treating it as payment authority. **Pending:** status contains no live Nessie integration. Do not present a bank witness or bank agreement as working yet.

### MLH — Best Use of Gemini API

Gemini produces timestamped observations instead of final payment authority. Argon + Flash inspect silent frames, Transcribe receives isolated audio, and Flash explains exact finance tool results. The current jury is deployed and tested with simulated provider responses; live jury execution remains unverified; historical Flash/Transcribe negative inference and the read-only Flash tool loop are live. No human-task accuracy or model-superiority claim is made. Missing evidence and disagreement route to review.

### MLH — Best Use of Solana

**Live funding evidence:** 1 test USDC on Solana Devnet through CDP at 03:29 PDT, with finalized RPC identity and a matching Convex journal, linked above. The earlier fee-payer mismatch is preserved as a failed attempt rather than hidden. Solana provides optional buyer funding; Base remains first in x402 accepts and the only payout rail. No Solana payout, bridge, mainnet load test or Wallet MCP Solana payment is claimed.

### Microsoft — Built for the Real World (1st), Customer Impact Award (2nd)

| Rubric, verbatim | Skarl's evidence and next proof |
| --- | --- |
| **Customer understanding** | One defined operator job: acquire licensed demonstrations and pay each valid obligation once. Customer discovery remains a hypothesis to validate, not completed research. |
| **Measurable usefulness** | Observable checks: one payable per accepted original, unchanged books after refused approval, exact reconciliation and no resend under uncertainty. Live funding has matching journals/zero exceptions. No hours saved, ROI or production fraud reduction measured. |
| **Path from prototype to production** | Replace demo identities; validate consent/access handling and controller roles; complete live payout/recovery; measure a consented corpus; run a narrow operator pilot before real funds. |
| **responsible design** | Private originals, independent approval, scoped tools, exact money, retained uncertainty, review on missing evidence and visible simulated/live labels. No model can change a destination or confer authority. |
| **end to end functionality** | Fund → upload → independent evidence → acceptance/payable → approval → wallet → reconciliation is implemented in parts. Funding and negative verification ran live; accepted-work-to-payout and the complete integrated demo remain pending. |

### Cal Hacks Most Technically Complex Hack

**Technical Complexity:** the depth is in connecting independent media evidence to transactional obligations and asynchronous settlement without double payment. Modality isolation, copy alignment, canonical report validation, exact journal replay, durable Workflow approval, signed webhooks and Base/Solana receipt adapters each enforce a distinct boundary. Complexity is demonstrated through failures and recoveries, not an integration count; mocked tests do not establish live execution.

### MLH — Commit Fellowship Prize Category

The team has a prototype and a specific problem to validate: can small human-data operators reduce settlement review effort while protecting contributors and preventing duplicate obligations? Next is customer discovery, a consented pilot and measured review/false-acceptance outcomes. **Submission reminder:** opt into the Commit Fellowship Prize Category on Devpost **and complete the [supplemental form](https://mlh.link/commit-fellowship-form)** ([official MLH prize instructions](https://www.mlh.com/events/prizes)). Neither selection nor form submission has been performed by this documentation task.

## What's next

Complete a consented, accept-eligible contribution and independently approved Coinbase Wallet payout; record the entire moment. Verify paid evidence delivery and Wallet MCP/Bazaar discovery. Measure the deployed jury and recovery crons; test public receipts on a newly submitted report as well as the demonstrated backfill. Add Claude and mock-bank evidence only after real provider traces. Evaluate false acceptance and copy detection on labeled human clips before claiming quality or expanding the task.

## Built with

TypeScript, React, Next.js, Vercel, Convex, Convex Workflow, Gemini API (Argon, Flash, Transcribe), FFmpeg, x402, Coinbase CDP SDK/facilitator/webhooks/Policy Engine, Coinbase Wallet MCP adapter, Base Sepolia, Solana Devnet, test USDC, viem, Python, Vitest and pnpm. This list describes implementation, not proof that every integration ran end to end.

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
polling and exception projection are implemented against a mocked client.
Live Nessie integration remains blocked on an API key and backend rollout;
no hosted Nessie transaction or real fiat movement is claimed.

**Creativity:** “Every claim has a witness” connects agent commerce with the
settlement desk's ordinary question: do the independent records agree? The
bank view gives a human-data company a modeled fiat-side witness beside its
USDC books. Agents can explain the disagreement, deterministic code identifies
the mismatch, and humans retain exception review and payment authority. The
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
