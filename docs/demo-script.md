# Demo script (about 2:30) and live judging runbook

**Every claim has a witness.** Skarl is the autonomous settlement desk for human-data companies: Agents propose, a rule the buyer signed approves, the AI never approves itself. Buyers review exceptions.

**The moment:** duplicate caught → second payable blocked → agent self-approval refused → buyer-signed policy approves eligible work → independent CDP cap → chain + ledger agree. The 10-USDC funding has a live Nessie comparison, labeled **MOCK BANK**; no payout/bank agreement is claimed. The complete moment remains pending; use the evidence labels and fallbacks below. [Witness table](thesis.md) · [Eight judge scenarios](hyphenate-scenarios.md).

**Disclosure throughout:** “Testnet · test USDC · demo identities.” Use only the operator's own test float. Put a visible **LIVE**, **RECORDED LIVE TESTNET**, or **SIMULATED CONTROL TEST — NO TRANSFER** label on each segment. Replayed evidence retains its actual date, model and transaction.

**Current recording gate:** [status](status.md) records funding and webhook reconciliation, but no complete duplicate-to-payout sequence, completed Wallet MCP purchase or Bazaar listing. The script below opens with the requested moment; use the fallback narration wherever its prerequisites are absent. Do not splice a funding receipt into the payout scene. The demo video itself still needs recording and upload.

## Video script — about 2:30

Each row names its evidence label. Use the fallback narration whenever the live prerequisite has not been recorded; never splice a funding receipt into a payout scene.

| Time | Screen and proof | Narration |
| --- | --- | --- |
| 0:00–0:12 | Landing page and one buyer order (task spec, price per clip, auto-pay rule). | “Every claim has a witness. Skarl is the settlement desk for human-data companies: labs buy short robot-training demonstrations, contributors record them, and every payout has to be earned and provable.” |
| 0:12–0:30 | Contributor records on the phone; the task spec and rubric come from the order (for example cup to coaster, or can next to the hat). Show the upload with consent. | “The contributor sees exactly what the task requires. The rubric is generated from the order's task spec, not hardcoded, and the contributor licenses the clip on upload.” |
| 0:30–0:50 | Jury result: Argon and Flash on silent frames, Transcribe on separate audio, per-criterion timestamps. **LIVE** if a fresh run exists, otherwise the recorded negative jury run. | “Two vision models see silent frames, a third hears the audio. Deterministic code compares their observations to the rubric. Disagreement or missing evidence goes to review; no model decides payment.” |
| 0:50–1:10 | Buyer auto-pay rule approves the accepted clip; `policy-engine` approval audit; CDP agent wallet executes under its own cap. Show the payout transaction **only if recorded**, otherwise the approval boundary labeled “PAYOUT PENDING — NO TRANSFER”, plus the real CDP `policy_violation` rejections. | Live: “The finance agent proposes; the rule the buyer signed approves; CDP independently caps the send; Skarl marks it paid only after the transfer reconciles.” Fallback: “The payout path is buyer-policy approval plus an independent CDP cap. These two real CDP rejections show the cap holding.” |
| 1:10–1:25 | Scenario lab: `duplicate_submission` and `agent_self_approval`, labeled **SIMULATED CONTROL TEST — NO TRANSFER**. | “A re-uploaded copy cannot create a second payable, and the finance agent cannot approve its own proposal. These are control tests through the real code paths.” |
| 1:25–1:40 | Solana: the clip's Token-2022 license row from `proof:summary.solanaLicenses` with Explorer link. **LIVE DEVNET** only when a minted row exists; otherwise show the empty `missing` state and the code path. Also show the live 1-USDC Solana Devnet x402 funding. | “Each accepted clip gets a one-of-one Token-2022 license on Solana devnet: supply one, minting revoked in the same transaction, and on-chain metadata binding the consent receipt and delivered manifest.” |
| 1:40–2:00 | A personal agent onboards over MCP: `skarl_onboard`, `skarl_wallet_status`, `skarl_request_testnet_usdc`, then `/skill.md`. Wallet MCP funds an order with human approval. | “Any personal agent can onboard itself: connect a wallet, get test USDC, find a task, fund an order over x402. The agent pays; it can never approve a payout.” |
| 2:00–2:15 | Finance agent (Claude or Gemini) answers a books question with cited tool results; analyst close note. | “The finance agent reads the real books through typed tools and explains them with citations. It can propose, never approve or sign.” |
| 2:15–2:30 | Proof page: funding receipts on Base Sepolia and Solana Devnet, EAS attestations, **MOCK BANK** Nessie reconciliation, Skarl Guard in Jira. | “Funding, attestations and policy refusals are real testnet operations, and every unfinished piece is labeled. Agents propose, the buyer's rule approves, receipts reconcile.” |

## Prepare the live table

1. Open [the app](https://skarl.devshardat.work), the [architecture and controls](coinbase-submission.md), [status](status.md), and the two real receipts: [10 USDC public-facilitator funding](https://sepolia.basescan.org/tx/0x28b3f88d593c02a669cb95f4bdc6a23ab3d24bb5d1260e6c4ae54554155cd757) and [0.01 USDC CDP funding](https://sepolia.basescan.org/tx/0x20c9252f7d67a2dac87be839ad82b83465686157478645354838ac0f7239390d). Both are testnet, historical funding transactions.
2. Record the commit, deployment URL, task/rubric/pipeline version and each segment's evidence label. Use a genuine prior recording only if one exists; otherwise show a labeled synthetic test or diagram. Keep browser wallet credentials and private media URLs off the projector.
3. Confirm the actual demo device's camera/microphone permissions and Wallet MCP login. Load [the plugin](wallet-mcp-plugin/skarl.md); its live tool schemas remain authoritative. No Skarl server key belongs in the agent session.
4. Check for an actually licensed contribution, completed source-bound inference, verified contributor wallet, remaining funded quota and a fresh independently approvable intent. Existing verification-only clips cannot be relabeled to satisfy this gate. Live SIWE verification and the CDP account policy now have successful recorded evidence; an accept-eligible licensed submission remains missing. If any prerequisite is absent, select the fallback opening before recording.
5. Preload the private original and duplicate only with contributor consent. A simple re-encode is the tested local media case; crop/speed resistance is unmeasured. Do not claim robust copy detection or show invented matched-frame assets.

Read-only public funding check, no secrets required:

```sh
curl --fail-with-body \
  -H 'x-skarl-demo-identity: buyer' \
  https://skarl.vercel.app/api/orders/skarl-red-cup-demo-v2/fund
```

Expected recorded state: `fundingStatus: "confirmed"`, `amountAtomic: "10000000"` and the 10 USDC transaction above. Read the actual result if state changes. Do not repay this funded order to manufacture a 402 challenge.

## Run the opening when its prerequisites exist

Use buyer Review if integrated; otherwise show the exact query/mutation results from the [dashboard API](dashboard-api.md). A successful backend read is not proof that a dashboard control is wired.

1. Display the accepted original and existing payable, then submit the licensed re-encoded copy. Inspect its evidence. The acceptance attempt must return `duplicate_submission` and `matchingSubmissionId`; compare payable count before/after and show the `acceptance_refused` audit. No second obligation may appear.
2. Run the finance agent through `financeAgent:run` for an actual model proposal, or use the deterministic demo runner below and label it accordingly. A forbidden model call is not guaranteed by a prompt. Show an actual persisted refusal, not a scripted chat line.
3. With the stored payable, `finance:proposePayment` as `finance-agent` returns an intent ID. Calling `finance:approve` with that same identity must return `self_approval_refused` and a durable `payment_approval_refused` audit. The buyer-signed rule approves that exact intent only when all checks pass; otherwise the buyer reviews its exception. Wait for `dispatchReady === true`.
4. With `PAYOUT_EXECUTOR=cdp_agent`, the existing executor consumes the approved intent under the independent CDP cap. Browser Wallet / [Wallet MCP payout signing](payments.md#where-coinbase-for-agents-fits) remains a compatibility path. Do not execute both paths.
5. Show the observed payout's own transaction hash/log index and `paid` state, then compare order terms, journal and chain evidence. Approval or `submitted` alone is not settlement. If the result is uncertain, retain the claim/hash and reconcile; never resend to save the demo.

## Wallet MCP evidence purchase

Use an actual accepted and delivered `sample-<submissionId>`. First inspect its unsigned GET challenge and require x402 V2 `exact`, `eip155:84532`, canonical USDC, the configured evidence payee `SKARL_EVIDENCE_PAYTO` (`0x0A9EfDF66c58543538824906aE267B969Ed651c5`, the `skarl-finance-agent` account) and `250000` atomic units. The evidence recipient must differ from the buyer and funding treasury. Backend and web deployment must agree on this payee and support accounting version 2 before a challenge is offered. If Bazaar search finds it, preserve the actual result; using a direct URL is direct discovery, not proof of catalog indexing.

Call `initiate_x402_request` with:

```json
{
  "url": "https://skarl.vercel.app/api/samples/sample-SUBMISSION_ID/evidence",
  "method": "GET",
  "scheme": "exact",
  "maxPayment": "0.250000"
}
```

Present the returned approval link to the human, inspect that request's status, then call `complete_x402_request` with the **same returned** `requestId`. Follow [the full plugin checks](wallet-mcp-plugin/skarl.md) and [exact buyer-to-agent prompts and receipt checks](wallet-mcp-demo.md). A delivered purchase requires HTTP 200, `settlement.status: "confirmed"`, a real hash, the matching report and a five-minute media grant. Keep report/media content private. `202` is pending; `409 paid_content_unavailable` means payment without delivery; neither permits another payment. The new evidence-sale journal debits `asset:evidence_usdc` and credits `revenue:evidence_sales` when the bound licensed evidence remains available, or `liability:evidence_receipts` if it became unavailable. It never increases collection-order prepayments or creates another contributor payable. This accounting path requires the matching backend deployment; synthetic tests are not a live sale. Automatic redelivery, deferred-sale release and sale refunds remain unimplemented.

## Strong live-evidence fallback: policy rejection

If the duplicate-to-payout opening is still blocked, keep its simulated/refusal label and follow it with the recorded real CDP rejection. At 03:05 PDT the funded `skarl-finance-agent` account held 3 test USDC under policy `fa62ac94-e420-4013-bb4f-2dcab18deb7b`: 2 USDC per-transfer cap, one verified recipient. A 2.000001 USDC transfer to that recipient returned HTTP 403 `policy_violation` (correlation `a5006791aba9be62-IAD`); a 0.10 USDC transfer to an unapproved recipient returned the same rejection (`a500679519ddbe62-IAD`). These were actual send API calls, not simulations or insufficient-balance errors. No transaction hash was returned, and the balance remained 3 USDC. Show the [dated evidence](status.md), not a manufactured wallet failure.

Suggested narration: “Even outside our application's proposal screen, CDP refuses this wallet's over-cap and wrong-recipient sends. These are real provider rejections. An allowed payout still needs an independently approved obligation, and that part is pending.” Do not rerun outgoing negative requests just for stage effect; the recorded evidence is sufficient. The CDP executor and legacy browser-wallet payout are distinct paths; use one.

## If a judge injects a scenario

Use the buyer’s order-scoped scenario lab after the deployment owner deploys this
backend. Every run is **SIMULATED CONTROL TEST — NO TRANSFER**: synthetic input
travels through the existing acceptance, approval, verification, or reconciliation
control. The terminal's pass/fail comes from persisted evidence read back from
Convex. A missing prerequisite or missing refusal is a failure, not a staged
success. No chain send, Coinbase call, or wallet signing occurs.

```sh
pnpm scenario all
# Scope the demonstration to a particular source order:
pnpm scenario wrong_amount_transfer kh7531zdrt7bn8vrs5qsw3c8bs8gy0cg
```

The optional argument is a Convex order document ID. Without it, the server
selects the seeded demo order. Runs use a separately labeled lab order linked
to that source order so the original order's balances and licensed deliveries
remain real evidence. Follow the returned `labOrderId` to inspect control
artifacts; keep its simulation label visible. The dashboard can subscribe to
[`scenarios:listRuns`](dashboard-api.md#scenario-lab--judge-injections) for the
selected source order, display the result and link its evidence IDs. If that
panel has not been wired, show the terminal and actual query results; do not
claim a backend run proves the dashboard integration.

| Judge asks | Command | Recorded control evidence to show |
| --- | --- | --- |
| “What if the transfer amount is wrong?” | `pnpm scenario wrong_amount_transfer` | Reconciliation exception for the simulated amount; no journal for that transfer. |
| “What if money arrives with no order?” | `pnpm scenario unknown_transfer` | `unknown_transfer` exception with simulated receipt/transfer identity; no posted cash. |
| “What if a contributor submits the same clip twice?” | `pnpm scenario duplicate_submission` | Existing duplicate refusal, matching original submission ID, and no second payable. Requires an already accepted source clip; an absent original produces a failed/prerequisite result. |
| “Can the finance agent approve itself?” | `pnpm scenario agent_self_approval` | `payment_approval_refused` audit from the real `finance:approve` path; no approval or dispatch. Requires an existing finance-agent-authored payout proposal; the lab never invents a payable or creates a real proposal. |
| “What if the clip tells the agent to ignore its instructions?” | `pnpm scenario prompt_injection_narration` | Stored instruction-like narration and the real verification control's `needs_review` outcome. Synthetic transcript evidence is not a live model response. |
| “Can policy approve above the buyer cap?” | `pnpm scenario over_cap_payout` | Above-cap proposal routes to buyer review with no approval or dispatch. |
| “Can a valid clip pay automatically?” | `pnpm scenario policy_auto_pay` | Simulated all-checks-pass clip is accepted and approved by `policy-engine`, with policy/acceptance/approval audit evidence. No chain send is claimed. |
| “What if the bank disagrees with the chain?” | `pnpm scenario bank_mismatch` | Four-way reconciliation's `bank_mismatch` exception and incorrect bank amount, labeled **simulated bank (Capital One Nessie mock)**. |

The self-approval refusal remains attached to the existing source-order payout
intent; open its returned audit/intent evidence link. Narration injection may
also run the read-only agent when the server's Gemini key is configured. Show
that answer's actual status separately from the deterministic control result.
An unavailable model is shown as unavailable; it is never a simulated success.

Each command prints a pass/fail table, expected control, observed outcome and
evidence IDs. Exit 0 means every requested control was observed; exit 1 means
at least one failed or could not run; exit 2 is invalid command usage. Inspect
the failed result openly and explain the missing prerequisite or recovery step.
`pnpm scenario all` runs all eight even if one fails. These commands invoke
`convex run` only; they do not run Convex dev/deploy or push backend code.

## Fallbacks and judge injections

| Situation | Honest demonstration |
| --- | --- |
| No licensed accepted sample / verified wallet | Show the actual refusal and a **simulated control test** for duplicate/self-approval behavior. Do not bypass consent or signature checks. |
| No live duplicate/refusal record | Run `pnpm exec vitest run --config test/convex.config.mts convex/finance.test.ts`. Explain that isolated state, funding and analysis are synthetic; no wallet or model is exercised. |
| Gemini slow or unavailable | Show the stored review failure or a labeled earlier inference run with its actual model and timestamps. No acceptance claim from unavailable analysis. |
| Wallet MCP login, tool, or approval unavailable | Show the plugin and unpaid endpoint result; replay the historical CDP funding receipt separately. A CLI payment is not an MCP payment. |
| Evidence endpoint returns 404 | Say “sample unavailable; no charge.” Current recorded validator output is `valid:false`; do not describe it as approved for Bazaar. |
| Bazaar search is empty or processing | Use the direct sample URL only if eligible and label catalog discovery unverified. Preserve `EXTENSION-RESPONSES` if a real paid response exists. |
| Wallet/HTTP response lost | Show stored attempt and hash, reconcile that original transaction, and keep pending state visible. Never initiate a replacement transfer. |
| SQL witness fails | Show `witness_unavailable`; retain RPC-confirmed reconciliation. The recorded HTTP 500s are real, not an injected outage. |
| Judge asks for replay / wrong amount / unauthorized approval | Use the scenario-lab commands above after deployment; otherwise show the relevant isolated regression with its simulation label. Show that the ledger stays unchanged. Do not send a deliberately invalid transfer. |
| Network unavailable | Play an existing recording labeled **RECORDED LIVE TESTNET**. If none exists, use local synthetic tests and the documented receipts; do not pretend a recording exists. |

## Close the evidence inventory

As recorded in [status](status.md): live x402 funding (public facilitator and CDP), signed CDP webhook delivery, funding reconciliation, independent Gemini negative-smoke inference, a read-only finance-agent loop, successful SIWE registration, and two real CDP Policy Engine send rejections. Duplicate/payable and approval boundaries have synthetic test coverage. Contributor payout, Wallet MCP payment, paid evidence delivery and Bazaar listing remain unverified. Optional Solana Devnet funding is live: the 03:29 PDT CDP payment finalized and matched the Convex journal. Base remains the only payout target. The [04:40 evidence refresh](status.md#submission-evidence-refresh--october-25-2026-0440-pdt) confirms stored live Argon+Flash jury and Claude read-only finance results, plus order/ledger/chain/Nessie funding agreement labeled **MOCK BANK**. Token-2022 license minting is implemented and verified by one devnet smoke mint (supply 1, mint authority revoked, metadata present); no production license exists until a clip is accepted. Personal-agent onboarding over MCP (`skarl_onboard`, `skarl_wallet_status`, `skarl_request_testnet_usdc`) and `/skill.md` are deployed. Cartesia and physical iPhone capture remain unverified; all 11 finalized reports now have live EAS attestations, with review-only recommendations. Update this inventory only when new dated evidence is recorded; capture a real demo-video link before submission.
