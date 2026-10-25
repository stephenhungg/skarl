# Build Status

Current as of **October 25, 2026, ~07:30 PDT**. This page separates three kinds of claim:

- **Live:** observed against a deployed service or a public chain, with a link or stored record.
- **Implemented and tested:** in source, covered by tests that `pnpm check` runs. Tests use synthetic inputs and are not live proof.
- **Known gaps:** not yet demonstrated, stated plainly.

Everything on-chain is **testnet only** (Base Sepolia, Solana Devnet). Capital One Nessie is a **hosted mock bank**; no fiat moves. AI verdicts are **advisory evidence**, never payment authority. The [review guide](review-guide.md) maps each sponsor criterion to source and checks.

## Deployments

| Surface | Location |
| --- | --- |
| Web app | [skarl.devshardat.work](https://skarl.devshardat.work) (also `skarl.vercel.app`) |
| Backend | Convex deployment `dev:keen-marmot-986`; site origin `https://keen-marmot-986.convex.site` |
| Health | `GET /health` on the Convex site origin; `pnpm demo:preflight` prints the same rows |
| Public proof | `GET /proof.json?orderId=…` on the Convex site origin (explicitly public demo orders only, redacted) |
| Agent discovery | `/llms.txt`, `/skill.md`, remote MCP at `/mcp` on the Convex site origin |
| Jira | Forge app "Skarl Guard" ([integration](../integrations/jira-forge/README.md)) |

`pnpm check` (typechecks, Node/Convex/payments/web tests, finance-agent evals, documentation link checks, the no-hardcode scan and the production web build) passes at commit `7259529`. The repository has 127 test files.

## Live evidence

### Funding over x402 (Coinbase / Base Sepolia)

- **10 test USDC** funded the v2 demo order through the x402-protected funding route via the public x402.org facilitator: [0x28b3…d757](https://sepolia.basescan.org/tx/0x28b3f88d593c02a669cb95f4bdc6a23ab3d24bb5d1260e6c4ae54554155cd757). Convex marked funding `confirmed` only after observing the exact Transfer log.
- **0.01 test USDC through the CDP facilitator**, with a real signed CDP webhook delivery (HTTP 200, receipt `processed`): [0x20c9…390d](https://sepolia.basescan.org/tx/0x20c9252f7d67a2dac87be839ad82b83465686157478645354838ac0f7239390d). `payments:reconciliation` returned one match and no exceptions; the funding journal balances.
- **CDP wallet policy refusals:** two real HTTP 403 `policy-violation` responses from the agent wallet's cap/allowlist policy (details in [Coinbase submission](coinbase-submission.md)).
- **Agent onboarding faucet:** the `requestTestnetUsdc` path behind the MCP tool `skarl_request_testnet_usdc` sent Base Sepolia test USDC from the CDP faucet: [0x7e97…89b7](https://sepolia.basescan.org/tx/0x7e97cbbc4789de2ebb34b2a96222e7702d748d07a7a05c4904e5209917bf89b7).

### Solana Devnet

- **1 USDC finalized x402 funding** through the CDP facilitator after fixing a fee-payer rotation mismatch: [Solana Explorer](https://explorer.solana.com/tx/31LMrtZYcf4PcBRcyFmFX8tBmt2fNttNSBA4mz7sTrZKSw6E2kH9oghw5FTafzR77JZT9so1zzjkj8ZuVqrGUezi?cluster=devnet). RPC confirmed finalization. Convex reconciliation returned one match and zero exceptions.
- **Token-2022 license minting** was exercised live on devnet with a smoke-test mint: supply 1, decimals 0, mint authority revoked, MetadataPointer + TokenMetadata present. That smoke token was then burned to reclaim rent, so it is **not** a license. Real license tokens mint automatically on the first accepted delivery (see gaps).

### Attestations (EAS on Base Sepolia)

- Revocable report schema [registered](https://base-sepolia.easscan.org/schema/view/0x1ea6e2d3fd6c61ffc02b18bea15c4037f90f832e2ed82e2d50bb98bcfe6e804f) by a separate registrar account. The attestor is a policy-bound CDP server wallet (`0xbc1e…F26B`) that can only call `attest` and `revoke`.
- A two-minute cron discovered and attested **every finalized verification report** (11 at the 03:53 PDT inventory, all confirmed and matched against EASScan and RPC). The attestor has continued attesting new reports; for example, [0x21c1…16b0](https://sepolia.basescan.org/tx/0x21c154448e620acbbdfc930afecd1f5a8bdb85cade19cc7ceadd4f3802d716b0) succeeded on BaseScan.
- Attestations commit to report contents. Every stored recommendation so far is `needs_review`. An attestation is not acceptance, model accuracy or payment.

### Gemini verification jury

- A completed live jury run on a verification-only upload stored Argon (**7,758 ms**), Flash (**4,916 ms**) and Transcribe (**718 ms**) results with 19 evidence assets. Both judges found the task criteria unobservable and the report stayed `needs_review`. This proves the pipeline ran and correctly refused; it is not a measured task-accuracy result.

### Claude finance agent

- Live Claude (`claude-sonnet-5-5`) finance runs call the shared tool registry and persist cited explanations. The first recorded run used three read tools in **4,636 ms** with zero proposed amount. After the strict-tool-schema fix, a later run produced a cited answer that found a missing auto-pay rule on the demo order, which was then configured.
- Scheduled analyst notes (exception, payout and close) complete with Claude and are stored.

### Capital One Nessie (mock bank)

- A real Nessie API key seeded treasury and contributor accounts. Four simulated funding deposits were posted and read back. `bankWitness:reconciliation4Way` returned order, ledger, chain and bank all `match` at `10000000` micro-USDC with no exceptions. This is the hosted mock bank: **no fiat moved**.

### Auth and Jira

- Google OAuth via Convex Auth: the sign-in redirect reaches Google with the configured client. Signed-in users cannot escalate through the legacy demo-identity selector.
- Skarl Guard (Forge) syncs Skarl reconciliation exceptions to Jira every five minutes under constrained triage and batch policy. Team-recorded observations are in [sponsor tracks](sponsor-tracks.md#atlassian-security-track).

## Implemented and tested

| Area | Source | Tests |
| --- | --- | --- |
| Acceptance, licensed delivery, payable accrual, duplicate/diversity refusals | [finance.ts](../convex/finance.ts) | [finance.test.ts](../convex/finance.test.ts) |
| Buyer-signed auto-pay policy: the policy engine approves within the buyer's cap; failures go to the owning buyer; agents never approve | [policy.ts](../convex/policy.ts) | [policy.test.ts](../convex/policy.test.ts) |
| Durable approval workflow and CDP agent execution of approved intents only | [approvalWorkflow.ts](../convex/approvalWorkflow.ts), [agentWallet.ts](../convex/agentWallet.ts) | `approvalWorkflow.test.ts`, `agentWallet.test.ts` |
| Exact double-entry journals and statements (bigint micro-USDC) | [ledger](../packages/ledger/src/index.ts), [statements.ts](../convex/statements.ts) | `statements.test.ts`, ledger package tests |
| x402 funding, reconciliation by `(network, txHash, logIndex)`, Solana quote/fee-payer binding | [payments.ts](../convex/payments.ts), [reconciliation.ts](../packages/payments/src/reconciliation.ts) | `payments.test.ts`, [cdp-solana-buyer.test.ts](../packages/payments/tests/cdp-solana-buyer.test.ts) |
| Token-2022 license per published delivery: one-of-one mint, metadata digest binding license, consent receipt and manifest hashes, minting revoked in the same transaction; idempotent per delivery and refused after a consent-revocation request | [solanaLicense.ts](../convex/solanaLicense.ts), [solanaLicenseData.ts](../convex/solanaLicenseData.ts), [solana-license.ts](../packages/payments/src/solana-license.ts) | [solana-license.test.ts](../packages/payments/src/solana-license.test.ts), license cases in [finance.test.ts](../convex/finance.test.ts) |
| Finance agent: Claude or Gemini over one shared, validated tool registry; mutating tools strict; never advertises approve/sign/send | [financeAgent.ts](../convex/financeAgent.ts), [financeToolRegistry.ts](../convex/lib/financeToolRegistry.ts), [financeAgentProvider.ts](../convex/lib/financeAgentProvider.ts) | [financeAgentClaude.test.ts](../convex/financeAgentClaude.test.ts), `pnpm eval:finance` |
| Scheduled analyst notes | [financeAnalyst.ts](../convex/financeAnalyst.ts) | [financeAnalyst.test.ts](../convex/financeAnalyst.test.ts) |
| Task-spec verifier: prompts, objects and targets generated from each task's rubric criteria, no task-specific hardcoding (`scripts/no-hardcode.mjs` enforces this in `pnpm check`) | [taskSpec.ts](../convex/lib/taskSpec.ts), [visualJury.ts](../convex/lib/visualJury.ts), [verificationReport.ts](../convex/lib/verificationReport.ts) | [taskSpec.test.ts](../convex/taskSpec.test.ts), `verificationReport.test.ts`, `gemini.test.ts` |
| Personal-agent onboarding over MCP: `skarl_onboard`, `skarl_wallet_status`, `skarl_request_testnet_usdc` (rate limited per address, caller and globally), plus a reusable `/skill.md` | [onboarding.ts](../convex/onboarding.ts), [onboardingData.ts](../convex/onboardingData.ts), [onboardingSteps.ts](../convex/lib/onboardingSteps.ts), [mcp.ts](../convex/mcp.ts) | [onboarding.test.ts](../convex/onboarding.test.ts), [mcp.test.ts](../convex/mcp.test.ts) |
| Advisory tax-ready ledger: contributor tax profiles, $600 reporting threshold (configurable), `tax_form_missing` payout hold | [tax.ts](../convex/tax.ts) | [tax.test.ts](../convex/tax.test.ts) |
| Bank witness and four-way reconciliation | [bankWitness.ts](../convex/bankWitness.ts), [nessie.ts](../convex/lib/nessie.ts) | `bankWitness.test.ts` |
| Proof read models (dashboard and redacted public JSON), including Solana licenses | [proof.ts](../convex/proof.ts), [proofPublic.ts](../convex/proofPublic.ts) | [proof.test.ts](../convex/proof.test.ts) |
| Health report and preflight | [health.ts](../convex/health.ts) | `health.test.ts` |
| Injected scenarios (duplicate, self-approval, over-cap, policy auto-pay and others), always labeled simulated | [scenarios.ts](../convex/scenarios.ts) | [scenarios.test.ts](../convex/scenarios.test.ts) |
| Configuration from environment with validated defaults | [config.ts](../convex/lib/config.ts) | `config` tests, no-hardcode scan |

## Known gaps

- **No accepted clip yet, and therefore no live contributor payout.** Every stored submission so far is verification-only or `needs_review`. The CDP agent executor (`PAYOUT_EXECUTOR=cdp_agent`) is configured and funded, and the demo order has a buyer auto-pay rule. A payout has not been observed on-chain.
- **No Token-2022 license minted for a real delivery yet.** Minting runs automatically on the first accepted delivery. The devnet license signer is funded; the smoke mint above was burned.
- **Scenarios:** 4 of 8 pass live. Duplicate, self-approval, over-cap and policy auto-pay need an accepted clip to run against.
- **Wallet MCP:** a live `initiate_x402_request` was correctly refused as a self-send (the approving wallet was the treasury). No completed Wallet MCP purchase or paid evidence sale is recorded. See [Coinbase submission](coinbase-submission.md).
- **Verifier accuracy is unmeasured:** there is no labeled human-task corpus. Agreement between related models is not calibrated correctness.
- **Nessie is a mock bank.** Contributor off-ramp matching needs a payout first, and sub-cent amounts are refused rather than rounded.
- **Solana is funding plus licensing.** Base Sepolia is the only payout rail. There is no Solana payout, bridge or mainnet use.
- **Physical-phone validation** of the mobile sensor capture is not recorded here. Sensors are advisory signals, not proof of who recorded a clip.
- **Testnet only throughout.** No production banking, custody or tax filing is claimed. The tax ledger is advisory record-keeping, not tax advice.

## Dated evidence log

Compact records of the live runs referenced from other documents. Each entry keeps its original heading so existing links resolve. Private keys, media and raw provider responses are never committed.

### Task 2 verification and actual provider state

An early synthetic ten-second color-pattern video with machine speech ran end to end on the deployed verifier: server SHA-256, FFmpeg modality isolation, twelve sampled frames and six dHashes, and a validated, persisted Transcribe response (audio round trip **1,262 ms**). Visual requests then failed on free-tier quota (Flash 503s, Argon HTTP 429). The report was correctly `failed` / `needs_review`. Billing was enabled afterwards and later runs succeeded (below). Gemini responses in tests are mocked; these cloud observations are integration measurements, not an accuracy benchmark.

### Task 3 — clip evaluation harness

`pnpm eval:clips <manifest.json>` freezes labels and source hashes before any network request, runs recordings through the deployed verifier as verification-only submissions (which can never create a payable) and scores stored reports, keeping provider failures in the denominator. Only harness code, tests and a placeholder manifest are committed. **No labeled accuracy result exists yet.**

### Real YouTube-origin clip verification — October 25, 2026

The deployed verifier processed [Me at the zoo](https://www.youtube.com/watch?v=jNQXAC9IVRw) from its CC BY 3.0 [Wikimedia Commons copy](https://commons.wikimedia.org/wiki/File:Me_at_the_zoo.webm): real human video and speech, 19 seconds. Visual (`gemini-3.8-flash`) took **4,893 ms**, Transcribe **1,322 ms** with 39 timestamped segments, and backend processing **11,622 ms**. The stored outcome was `needs_review`, with every rubric criterion `unobservable` for that unrelated clip: a correct negative, verification-only, with no license, acceptance or payment.

### Live CDP verification

Starting 02:51 PDT, CDP webhook subscriptions were created for treasury Transfers (TO and FROM) with secrets stored only in the hosting secret manager, and SIWE contributor-wallet verification was added. The CDP SQL witness returned HTTP 500 on every attempt (`witness_unavailable`); no SQL match is claimed. The first policy-apply attempt correctly stopped on a local `verified_contributor_allowlist_required` guard. That guard is not a CDP rejection; the live rejections are recorded below.

### Confirmed webhook delivery and CDP settlement — 02:54 PDT

A 0.01-USDC order was funded through the CDP facilitator: [0x20c9…390d](https://sepolia.basescan.org/tx/0x20c9252f7d67a2dac87be839ad82b83465686157478645354838ac0f7239390d), Transfer log 1. CDP's real webhook POST returned **200**, and the stored receipt is `processed` with matching sender, treasury, hash, log and amount. `payments:reconciliation` returned one match and `exceptions:[]`, and the funding journal balances (10000 debit `asset:usdc`, 10000 credit `liability:customer_prepayments`). This proves live CDP x402 funding and webhook processing, not a payout.

### Live retry after recovery deployment — October 25, 2026, 03:05 PDT

- A fresh SIWE challenge verified the testnet contributor wallet on chain 84532. The CDP allowlist contains exactly that address.
- `pnpm cdp:policy:apply` bound the `skarl-finance-agent` account (`0x0A9EfDF66c58543538824906aE267B969Ed651c5`) to a policy with a `2000000` micro-USDC cap and one verified recipient.
- The agent was funded with 3 test USDC from three CDP faucet claims: [0x0044…933e](https://sepolia.basescan.org/tx/0x0044a094cafb5eb0cf09577177fa71477259eb199e8cbebc80bcd051be8b933e), [0x4fa2…859a](https://sepolia.basescan.org/tx/0x4fa28ece62b78fbda786f5d57587bb81b4675f1e115ee091834f40afd2a4859a) and [0x55c0…6c1d](https://sepolia.basescan.org/tx/0x55c0da36c680f9f96d462d1901721af42f4e8fc6d162fb114ab4f48c32316c1d).
- **Two real CDP rejections:** an over-cap 2.000001-USDC transfer and a 0.10-USDC transfer to a non-allowlisted address each returned HTTP **403** `policy_violation`, with no transaction hash. These were real sends from the funded account, not simulations.
- The within-policy payout was **skipped**: there was no accepted submission, payable or approved intent, and none was fabricated.

### Solana live attempt — October 25, 2026, 03:13–03:15 PDT

The first Solana Devnet funding attempt did **not** settle. The facilitator rotated its fee payer between quote and payment, so exact requirement matching failed with HTTP 402. The order correctly stayed `awaiting_funding`, reconciliation returned no matches, and no replacement authorization was signed. The fix validates the signed fee payer against the facilitator's current signer set without loosening any economic field.

### Confirmed Solana funding after fee-payer fix — October 25, 2026, 03:29 PDT

After that fix, one new 1-USDC authorization [settled through CDP on Solana Devnet](https://explorer.solana.com/tx/31LMrtZYcf4PcBRcyFmFX8tBmt2fNttNSBA4mz7sTrZKSw6E2kH9oghw5FTafzR77JZT9so1zzjkj8ZuVqrGUezi?cluster=devnet).

- Finalized RPC matched payer, canonical mint, recipient ATA, amount and order memo.
- Convex shows the order `funded`, funding `confirmed`, and one reconciliation match with zero exceptions.
- Base stays first in x402 quotes and is the only payout rail.

### Live backfill and automatic sweep — October 25, 2026, 03:53 PDT

The `attestations:sweep` cron discovered every finalized verification report and attested each one through the policy-bound attestor: **11 of 11 confirmed**, zero missing. Each EASScan record and Base Sepolia receipt matched the stored payload, schema, recipient and unrevoked state. Ten attestations record `licensed=false`; one records validated consent metadata (`licensed=true`), not acceptance. All stored recommendations are `needs_review`. Attestations are public commitments to reports, not proof of accuracy or payment.

### Capital One Nessie bank witness — October 25, 2026

The bank witness adds a fourth reconciliation source (order, ledger, chain, **simulated bank**).

- Amounts are carried as exact integer cents, and sub-cent amounts are refused with `nessie_subcent_amount` rather than rounded.
- Against the hosted Nessie mock API, the treasury and contributor accounts were seeded and four simulated funding deposits were posted and read back.
- `bankWitness:reconciliation4Way` returned all four sources `match`.
- Bank records never post journals or grant payment authority. **No fiat moved.**

### Submission evidence refresh — October 25, 2026, 04:40 PDT

Read-only queries against `dev:keen-marmot-986`:

- **Gemini jury:** a completed run stored Argon **7,758 ms**, Flash **4,916 ms** and Transcribe **718 ms**, with full agreement and 19 evidence assets. The correct outcome was `needs_review`.
- **Claude finance:** a completed `claude-sonnet-5-5` run used three read tools in **4,636 ms** with a persisted explanation and `proposedAtomic:"0"`.
- **Nessie:** the four-way funding match held at `10000000` micro-USDC with `exceptions:[]` (simulated bank).
- **Payables:** none. Payout remains gated on an accepted, licensed clip.
