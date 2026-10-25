# Devpost submission

## Project name

Skarl

## Tagline

The AP/settlement seat for a human-data company: verify the work, prevent duplicate payables, and reconcile agent payments.

## Links

- [Live testnet demo](https://skarl.vercel.app)
- [Repository](https://github.com/stephenhungg/skarl)
- [Setup](setup.md) · [Coinbase submission and architecture](coinbase-submission.md) · [Two-minute demo script](demo-script.md)
- Demo video: **pending recording and upload**. The script is not a recorded demonstration.

## Inspiration

Buying human demonstrations for AI creates a surprisingly ordinary finance problem: what did we receive, what do we owe, and did we already pay for it? A re-encoded clip can look like a new submission. Fluent narration can describe an action the camera never captured. A payment request can time out after money has moved. We built Skarl around those disagreements, with evidence for the work and a traceable decision for every financial event.

## What it does

Skarl fills the **settlement accountant + AP clerk** seats for a company acquiring narrated demonstrations. Buyers fund collection orders through x402. Contributors record a short task. Independent visual and audio analysis produces timestamped evidence, while deterministic checks compare that evidence with the frozen rubric and detect likely copies. Acceptance creates a delivery, one payable and balanced journal entries atomically. The finance agent explains the books and proposes payouts; it cannot approve its own proposal. A human controller retains payment authority.

There are two agent-commerce paths: **PAY**, funding an order; and **EARN**, an implemented 0.25 USDC endpoint selling an eligible sample's verification evidence to a buyer, with receipts paid to the separate `skarl-finance-agent` revenue account and Bazaar discovery metadata. The earning path has not yet produced a live sale or a confirmed Bazaar listing. Coinbase Wallet MCP instructions cover `initiate_x402_request` and `complete_x402_request`; a completed Wallet MCP purchase remains unverified.

**Testnet only: test USDC, demo identities, and the operator's own test float. We do not manage anyone else's real funds.**

## How we built it

Next.js serves the contributor experience and x402 routes on Vercel. Convex is the system of record for orders, private uploads, reports, payables, approvals, attempts, journals and agent transcripts. Transactional scheduling starts verification; Convex Workflow preserves the independent approval wait and revalidates the proposal before releasing dispatch.

The current configurable models are **Gemini 4 Argon** (`gemini-4-argon`) for timestamped visual frames, **Gemini 3.5 Transcribe** for independently extracted audio, and **Gemini 3.8 Flash** for a bounded finance tool loop. Visual input never receives narration. A deterministic judge compares observations; AI evidence cannot grant payment authority. Argon was chosen after a small directional frame probe, not a completed accuracy benchmark. Flash keeps finance interactions responsive.

Coinbase's CDP facilitator settles x402 V2 `exact` payments on Base Sepolia. Amounts stay integer micro-USDC throughout. Durable claims precede external settlement; receipt verification checks the actual token, sender, recipient, amount, confirmations and transfer log. Signed CDP webhooks push observations into the same reconciliation path, with RPC reads as the fallback. The optional CDP Server Wallet executor has independent Convex approval checks. A live account policy caps each transfer at 2 USDC and allows one verified recipient; real over-cap and non-allowlisted send attempts were rejected by CDP. The approved payout path remains unverified.

## Challenges we ran into

CDP SQL API requests returned HTTP 500 even for `SELECT 1`, so the optional witness reports `witness_unavailable` while RPC-confirmed reconciliation continues. An x402 hook exception was not enough to stop settlement: we return an explicit abort after durable-claim failure. A paid response can disappear after settlement, so an unresolved claim stays locked instead of being retried as a new charge.

Gemini quota and capacity failures initially blocked visual analysis. After billing-enabled probes succeeded, we retained a shared 30-second deadline across retries and explicit review-only failures. Convex's default runtime also exposed a dynamic cryptographic import issue in contributor signature verification; a static-import fix restored the deployed SIWE verification path. A fresh live signature verified successfully; the private proof and key remain outside the repository.

## Accomplishments we're proud of

- **Real x402 funding:** 10 test USDC through the public facilitator, with a [Base Sepolia receipt](https://sepolia.basescan.org/tx/0x28b3f88d593c02a669cb95f4bdc6a23ab3d24bb5d1260e6c4ae54554155cd757).
- **Real CDP settlement and provider webhook delivery:** a separate 0.01 test USDC payment, [Transfer log 1](https://sepolia.basescan.org/tx/0x20c9252f7d67a2dac87be839ad82b83465686157478645354838ac0f7239390d), reconciled with no exceptions and a balanced 10000-micro-USDC journal.
- **Real multimodal inference:** the verifier processed an unrelated 19-second human video and correctly retained review rather than treating it as red-cup evidence. That historical run used Flash visual inference (4,893 ms) and Transcribe (1,322 ms); it is an integration check, not a benchmark.
- **Real read-only finance agent:** Flash called the trial-balance tool and persisted its explanation against funded live state. It proposed and transferred nothing in that run.
- **Real policy enforcement:** CDP rejected an over-cap 2.000001 USDC attempt and a non-allowlisted 0.10 USDC attempt from the funded finance account with HTTP 403 `policy_violation`. These were real API calls, not policy simulations; no outgoing transaction was returned.
- **Tested financial boundaries:** isolated synthetic regressions cover duplicate obligations, self-approval refusal, changed approval bindings, replay, and uncertain settlement. These tests are not live payouts.

The dated evidence and limits are in [build status](status.md). A contributor payout, accepted licensed sample sale, Wallet MCP payment, and Bazaar catalog listing remain unverified; the submission does not claim a complete live marketplace.

## What we learned

Evidence, approval and settlement are different facts. A model's answer does not create a payable; an approval does not prove a transfer; and a transfer does not establish that the work met its rubric. Keeping those boundaries explicit made the system easier to debug and its failures easier to explain. The most useful agent memory was a durable record of business intent and prior attempts, not an ever-growing chat history.

## What's next

Complete the consented red-cup contribution, then capture an independently approved payout and a Wallet MCP evidence purchase. Verify Bazaar discovery with an actual catalog result. Deploy and verify the new sale-specific accounting and reconciliation: evidence receipts use a separate cash account, recognizing revenue only when the bound licensed content remains available and retaining a liability otherwise. The implementation has synthetic receipt coverage, not a live sale. Finish paid-content redelivery and refund execution, replace impersonable demo identities with production authentication, and measure false acceptance and copy detection on a consented, labeled corpus before expanding beyond the narrow task.

## Built with

TypeScript, React, Next.js, Vercel, Convex, Convex Workflow, Gemini API, Gemini 4 Argon, Gemini 3.8 Flash, Gemini 3.5 Transcribe, FFmpeg, Coinbase Wallet MCP adapter, Coinbase CDP SDK, CDP x402 facilitator, CDP webhooks, CDP Policy Engine integration code, x402, Base Sepolia, test USDC, viem, Python, Vitest, pnpm.

## Prize-specific text

### Coinbase — Payment Agents

Skarl gives agents a useful payment job: fund human-data orders, purchase verified evidence, and prepare a small company's contributor payouts. We use x402, the CDP facilitator, a reusable Coinbase Wallet MCP plugin, and bounded CDP buyer tooling. Live evidence proves CDP x402 settlement, signed provider webhook delivery and two real Policy Engine send rejections; Wallet MCP approval/completion, an evidence sale and Bazaar indexing remain pending. Independent approval, exact amounts, durable attempts and chain reconciliation constrain the finance agent. Our biggest observed Coinbase blocker was SQL API HTTP 500s even on `SELECT 1`; RPC is the fallback. Our single most-wanted capability is a policy-bound autonomous wallet usable through Wallet MCP without a separate click for every transaction, while preserving an application's independent approval requirement. [Four-part submission](coinbase-submission.md).

### Hyphenate — The Hyphenated Enterprise: Autonomous Systems for Finance

The seats are **settlement accountant + AP clerk**. Skarl turns accepted work into an obligation and compares three sources that can disagree: the frozen order contract, the ledger, and observed chain transfers. The memorable catch is a duplicate clip blocked from creating a second payable, followed by refusal when the finance agent tries to approve its own proposal. Those controls are implemented and regression-tested with synthetic state; the full live catch-to-payout sequence remains pending. Real demonstrations include funding, journal reconciliation, independent multimodal inference and a read-only finance-agent loop. A human controller retains approval and signing authority. The [demo runbook](demo-script.md) labels live, replayed and simulated segments explicitly.

### Convex — Best Use of Convex

Convex owns both business state and agent memory: frozen orders, reports, payables, attempts, journals and transcripts. Atomic mutations create the delivery, payable and balanced journal together, and reject duplicate financial events. File storage and scheduled Node actions support verification; reactive queries expose persisted state. The deployed Workflow component waits for independent controller approval, then rechecks bindings before dispatch. Its wait/resume and refusal behavior is exercised with the actual component test adapter; that is distinct from a completed live payout.

### MLH — Best Use of Gemini API

Skarl separates visual evidence from narration before inference, preventing the spoken claim from serving as visual proof. Argon inspects timestamped frames, Transcribe handles isolated audio, and deterministic code compares both with the rubric. Flash uses typed finance tools over exact ledger projections. Live historical Flash/Transcribe negative smoke tests and a read-only Flash finance loop are recorded; no human-task accuracy score or model-superiority claim is made. Failures and incomplete evidence remain review-only.

### MLH — Best Use of Solana

**Pending — do not submit this prize claim.** No live Solana devnet transaction is recorded in [status](status.md). Base Sepolia is the demonstrated payment target. Optional Solana contract support and an installed SVM dependency do not establish a working devnet payment. Replace this placeholder only after a dated live devnet transaction and reproducible flow are documented.


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
marked `licensed: false`. Schema registration and wallet-policy setup have live
evidence; backend rollout and per-report backfill are tracked separately in
[build status](status.md). See [Coinbase controls and provenance](coinbase-submission.md#verify-on-chain)
and the [official EAS deployments](https://docs.attest.org/docs/quick--start/contracts).
