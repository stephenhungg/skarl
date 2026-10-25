# Payment architecture

Updated October 25, 2026. **Base Sepolia primary; optional Solana Devnet funding; test funds.** Implementation and tests do not establish a live transfer.

## Buyer-signed auto-pay

The happy path uses the order’s buyer-signed rule for deterministic approval, then the existing CDP executor (`PAYOUT_EXECUTOR=cdp_agent`). The internal policy service is distinct from the proposing finance agent; its per-clip cap and the independent CDP wallet cap both apply. Exceptions go to the order’s buyer in Review. Browser-wallet and Wallet MCP payout signing below remain compatibility paths, not required human controller steps. Deployment and a live eligible payout remain unverified; the operator configures Convex separately.

## Current implementation boundary

Implemented: dynamic x402 funding, durable nonce claims, receipt verification, atomic funding/payout journals, three-way reconciliation, a testnet buyer CLI, and a legacy browser-wallet payout library. The HTTP payment service authenticates to Convex with a shared secret. Existing intents, attempts, approvals, observations and journals are reused. Funding-related network/token validators accept both rails; payout validators stay Base-only. Solana message hashes have a dedicated deduplication index.

Prior live funding evidence is recorded in [build status](status.md), including the v2 order's reconciled 10 USDC funding. A later live Solana funding retry is recorded below; no live payout is claimed. A fresh public facilitator `/supported` read on October 25 returned V2 `exact`, `upto`, and `batch-settlement` on `eip155:84532`, plus `builder-code`, `eip2612GasSponsoring`, and `erc20ApprovalGasSponsoring` extensions. Skarl still enables **exact only**. Buyer ETH is unnecessary for EIP-3009 funding: the buyer signs an authorization and the facilitator pays transaction gas. Wallet MCP execution requires a connected human wallet and approval.

## Network and SDK decisions

Canonical values come from `packages/contracts/src/chain.ts`: `PAYMENT_NETWORK`, `PAYMENT_CHAIN_ID`, `USDC_ADDRESS`, `USDC_DECIMALS`. Money stays bigint micro-USDC in code/Convex and decimal integer strings in HTTP JSON. Never infer an asset from its symbol.

`@x402/core`, `@x402/evm`, `@x402/fetch`, `@x402/next`, `@x402/extensions`, `@x402/svm` and `@x402/paywall` are pinned to 2.28.0; `@coinbase/cdp-sdk` is pinned to 1.60.0. The funding route registers Base Sepolia first and optionally Solana Devnet when `SKARL_SOLANA_TREASURY_ADDRESS` is configured. Both quote explicit assets and atomic amounts; paid evidence and payouts remain Base-only. `@solana/kit` is pinned directly to 6.10.0 for SVM transaction decoding.

Default facilitator: `https://x402.org/facilitator`, which needs no CDP key for testnet. When both `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` are configured, both paid routes use `createCdpFacilitatorClient({apiKeyId, apiKeySecret})` from `@coinbase/cdp-sdk/x402`. Setting only one refuses service. `X402_FACILITATOR_URL` optionally overrides the public default. CDP failures never trigger a public fallback. SDK initialization checks supported networks before advertising requirements. `X-Skarl-Facilitator` names the configured provider (`cdp`, `x402.org`, or `custom`); `settledBy` is set only after a successful facilitator response. Structured settlement logs include the actual provider and transaction hash. Existing funding status does not guess a historical provider from current environment settings. [CDP facilitator documentation](https://docs.cdp.coinbase.com/x402/seller/facilitator)

## Setup

1. Run `pnpm install`. Use the shared Convex deployment specified in [setup](setup.md). The deployment owner deploys the merged backend from `origin/main`; individual payment worktrees must not deploy to the cloud. Run `pnpm check:convex` only in an isolated checkout without cloud deployment configuration.
2. Configure `apps/web/.env.local`: `NEXT_PUBLIC_CONVEX_URL`, `SKARL_PAYMENTS_SERVICE_SECRET`, and `SKARL_TREASURY_ADDRESS` (the treasury receiving address; legacy browser-wallet signing uses its wallet). Optional: `BASE_SEPOLIA_RPC_URL`, facilitator override or CDP keys. Never put a treasury private key in any app or agent configuration.
3. The generated payment service secret is stored only in `~/.config/skarl/payments.env` and the gitignored `apps/web/.env.local`, both mode 600. The same value has been set in the shared Convex dev deployment with `convex env set`. For another deployment, install that value privately via your environment manager; never paste it into source or logs.
4. Start the app with `pnpm dev`. The default seeded order, `skarl-red-cup-demo-v2`, costs **10 USDC**: four samples at 2.50 USDC (`4n * 2_500_000n = 10_000_000n` micro-USDC). Its contributor rate is 1.875 USDC per sample, preserving the 75% ratio. The unchanged 100 USDC v1 order remains available explicitly for compatibility. Faucet allowances and wallet balances must be checked at runtime; a single CDP USDC faucet claim may not cover the 10 USDC order. Buyer ETH is not required.
5. Run `SKARL_APP_URL=http://localhost:3000 pnpm agent:fund skarl-red-cup-demo-v2`. For remote use, `SKARL_APP_URL` must be HTTPS. Omitting the order argument also selects v2. The script checks chain ID and USDC balance before signing, pins the returned quote, and prints a BaseScan link when a hash is available. It never queries or requires buyer ETH. If `SKARL_TREASURY_ADDRESS` is unset or invalid on the web server, GET/POST return HTTP 503 with configuration guidance; the buyer reports the missing receiving address before signing. The original local-key buyer reads the treasury from the quote. The CDP buyer requires the approved treasury locally as an independent payee allowlist.

Buyer address: `0xa54DABc8583B869d488d63d691EC5d6a256c1a9D`. The CLI generates and retains its testnet-only key in `~/.config/skarl/buyer.env` (600). `pnpm agent:fund --address` shows the address without the key. Do not copy this key into the web environment. [Circle USDC faucet](https://faucet.circle.com). Payout gas is separate from gasless buyer funding.

## CDP buyer and paid sample evidence

`pnpm agent:fund --cdp [orderId]` uses a CDP-managed `skarl-buyer-sepolia` account via `cdp.evm.getOrCreateAccount`. Configure `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET`, `SKARL_TREASURY_ADDRESS`, and `SKARL_APP_URL` privately. The web server needs only the API key pair, not the wallet secret. `CdpX402Client` registers Base Sepolia exact only. Its `SpendControls` allow only the independently approved payee (treasury for funding; `SKARL_EVIDENCE_PAYTO` for evidence), canonical USDC address and CAIP network `eip155:84532`, cap each payment at the inspected amount, and cap cumulative spending at 20 USDC per 24 hours by default (`SKARL_CDP_MAX_CUMULATIVE_ATOMIC` overrides the bigint limit).

An empty account requests one idempotent Base Sepolia USDC faucet claim. Insufficient balance stops before signing; it does not loop faucet requests. The buyer persists its attempt before signing and signed authorization before dispatch. Private append-only spend reservations survive restarts and conservatively count uncertain/failed attempts. An exclusive local process lock prevents concurrent CLI overspending. After a crash, reconcile the private attempt before removing a stale `~/.config/skarl/cdp-buyer.lock`. These are local buyer controls, not a claim of a CDP account-wide policy enforced against other clients. [CDP SpendControls](https://docs.cdp.coinbase.com/sdks/cdp-sdks-v2/typescript/x402/type-aliases/SpendControls)

`pnpm agent:buy-evidence <sampleId>` probes the public 402 declaration, validates its price/network/payee and Bazaar metadata, then buys with the same CDP controls. It validates the canonical report, sample identity, completed inference, confirmed settlement and five-minute media gateway URL; the result is saved privately. Direct resource discovery does not establish catalog indexing. See [Bazaar integration and verification](x402-bazaar.md).

The evidence sale claims its nonce before settlement and uses the existing payment-attempt and chain-observation tables. Its separate operator revenue recipient comes from `SKARL_EVIDENCE_PAYTO` in both web and Convex; it must differ from the funding treasury. The receipt posts `asset:evidence_usdc` against `revenue:evidence_sales` while the bound licensed content is available, or `liability:evidence_receipts` if unavailable. This never changes collection-order prepayments or creates a second contributor obligation. Reconciliation includes each sale's stored payee, transfer and journal. The new schema/handlers require the backend owner's deployment; web refuses old accounting capability before payment. See the [live Wallet MCP demo runbook](wallet-mcp-demo.md).

## Funding a collection order

`GET /api/orders/[id]/fund` returns the stored amount, treasury address, funding status and any transaction hash. IDs may be Convex IDs or the seeded public ID. `POST` protects that specific route with `@x402/next` and the `exact` scheme (Base EIP-3009 first, Solana second when configured).

Before a challenge, the server checks persisted buyer membership, ownership, order state and deadline. The current demo uses public, impersonable identity selectors (`x-skarl-demo-identity: buyer`), **not production authentication**. Receipt import still requires the private server service secret.

Both routes catch persistence/validation errors and explicitly return an abort from their pre-settlement hook: x402 2.28.0 ignores thrown hook errors, so throwing alone is not safe. The funding route's settlement hook atomically creates a funding intent and claims `(network, payer, authorizationNonce)` before calling the facilitator. A concurrent request or new authorization for the same order cannot initiate another settlement. The verified authorization does not activate the order. Existing attempts return status without another charge.

After settlement, the server durably records the hash and reads Base Sepolia with viem. It checks successful receipt, canonical block hash, two confirmations, USDC contract, sender, recipient, exact amount, and the matching `AuthorizationUsed` nonce in that transaction. Only then does `confirmFunding` atomically persist the transfer, post cash/customer prepayments, and mark the order funded. The payer address replaces the seed's explicitly non-signing placeholder only after confirmation; this is funding evidence, not a SIWE membership proof.

The contract's order state is `awaiting_funding`, with pending settlement represented by the funding intent's `settlement_pending` state. We did not add a second `funding_pending` order enum. Confirmed funding changes the order to `funded`.

## Idempotency and recovery

| Identity | Protection |
| --- | --- |
| Order funding intent | One pending purchase per order |
| Payer + EIP-3009 nonce + network | An authorization cannot fund multiple orders |
| Network + tx hash + log index | A transfer cannot post twice or settle multiple intents |
| Funding/payout business event key | A journal posts once |
| Payout execution claim | An approved intent is dispatched once |

`POST /api/payments/reconcile` accepts `{ "orderId": "...", "demoIdentity": "buyer", "txHash": "0x..." }`. `txHash` is optional: it scans the latest 10,000 blocks in bounded chunks for the saved authorization nonce. For older attempts supply the explorer hash. A supplied hash is verified against the claimed nonce and exact transfer before binding it. A missing receipt, RPC error, timeout or failed facilitator response remains pending; none authorizes repayment.

The buyer saves its signed authorization privately before submitting it. Rerunning the command reconciles rather than signs again. If the process stopped after saving the authorization but before the server claimed it, the CLI intentionally stops for operator reconciliation; it does not delete authorization evidence or create a replacement automatically.

`payments.reconciliation({demoIdentity, orderId})` compares order/intent obligations, exact ledger account/amount pairs and imported chain observations. It reports matches and `wrong_amount`, `unknown_transfer`, `missing_transfer`, `late_settlement`, `ledger_mismatch`, invalid evidence and duplicate allocation. The query covers imported observations for that order, **not a complete scan of arbitrary treasury transfers**. Wrong receipts are rejected before posting; the pure reconciliation helper also diagnoses mismatched external observations. Two confirmations are the demo policy, not irreversible chain finality; deep-reorg monitoring is deferred.

## Contributor payouts

The backend owner creates and independently approves an intent through `finance.proposePayment` and `finance.approve`. The requester/finance agent cannot approve its own proposal. Approval does not move funds.

Dashboard integration:

```tsx
const payout = usePayout({ demoIdentity: "controller", provider });
await payout.execute(intentId); // after successful finance.approve
// Read confirmed/paid state from Convex; hook "submitted" alone means only submitted.
```

Import the hook from `apps/web/lib/payments/use-payout.ts`. `provider` is Coinbase Wallet, Smart Wallet, or another connected EIP-1193 provider. The library switches to Base Sepolia, calls `/api/payments/payout` with `action: "claim"`, validates returned stored terms, then requests the exact ERC-20 transfer. The claim checks independent approval, expiry, bindings, payable and configured treasury sender. It increments the attempt count before the wallet can submit; no treasury key exists in the server or agent.

The hash is saved in browser storage and reported to the server before receipt polling. If reporting fails, call `payout.recover({...getPayoutRecovery(intentId), txHash})` with the original hash. The recovery path never sends. A claimed intent without a hash must be checked against wallet history; automatic claim release/retry is deliberately unavailable. Even wallet rejection stays claimed until an operator resolves it.

The server verifies the exact transfer from the claimed treasury, rejects transfers predating the claim, imports `(network, txHash, logIndex)`, and atomically posts the payout journal and marks the payable paid. Refund execution remains deferred.

## Where Coinbase for Agents fits

[Wallet MCP documentation](https://docs.cdp.coinbase.com/ai-agents/coinbase-for-agents/wallet-mcp) supports Base Sepolia and interactive wallet approval. Install in Claude Code:

```sh
claude mcp add --transport http --scope user base-mcp https://wallet-mcp.coinbase.com
```

A human must authenticate Coinbase Wallet, authorize the connection, select the testnet wallet, and approve writes. Retail Coinbase MCP's mainnet payment path is not used.

**Buyer:** `walletMcpFundingRequest(httpsFundingUrl, storedBudgetAtomic)` in `packages/payments/src/wallet-mcp.ts` builds `initiate_x402_request` arguments: POST URL, buyer headers/body and exact decimal-USDC `maxPayment`. Present the returned approval URL, wait for human approval, then call `complete_x402_request` with its `requestId`. Read our funding status/reconcile endpoint; do not equate signature approval with funding.

**Finance agent:** after independent stored approval, POST `/api/payments/payout` with `{action:"claim_mcp", intentId, demoIdentity:"finance-agent", senderAddress:treasury}`. Persist the returned `claimId`; call the returned `mcp.tool` (`send`) with its exact arguments. These contain the literal USDC contract, six decimals, recipient, decimal amount and `base-sepolia`. Human approval signs it. Poll `get_request_status`; report the resulting hash using `{action:"submitted", intentId, demoIdentity:"finance-agent", claimId, txHash}`. Never call `send` twice for the same claim or let model text rewrite its terms. `send` has no invented `maxPayment` parameter; its exact amount is the approved limit.

This is a prepared adapter and runbook, **not a claim of a connected MCP session or autonomous execution**. The operator must complete login, treasury configuration and approval. The original CLI mode uses its explicitly testnet-only generated key; `--cdp` uses the managed CDP account; Wallet MCP uses the connected human wallet instead.

## Verification and builder feedback

`pnpm check` runs typechecks, package tests, Convex tests, docs checks and the production build. The payment test suite additionally exercises the actual dynamic Next route with real x402 middleware and mocked facilitator/RPC/Convex responses. It proves challenge contents, pre-settlement nonce persistence, actionable missing-treasury errors and no activation from a signed payload. The buyer regression test uses the real x402 client and a disposable signer against mocked HTTP/RPC to authorize 10 USDC with a 20 USDC balance and zero buyer ETH, without reading ETH. Seed tests verify exact v2 amounts, idempotency and unchanged v1 state. These tests do not prove facilitator signature verification or chain settlement.

Observed integration friction: the Next adapter requires a large paywall peer dependency tree, including unused chains; its extra peers report version warnings while our typechecks/build pass. The public facilitator removes the CDP-key requirement for testnet. Desired capability: a documented lightweight server-only Next adapter plus durable settlement lookup keyed by EIP-3009 nonce, to simplify recovery after a lost response. MCP-specific UX feedback is pending an actual human login and payment.

Before claiming the sponsor demo works, capture one live funding transaction, one independently approved payout, both transfer log indexes, balanced journals, and the MCP approval/response trace. Keep simulated tests clearly labeled.


SDK integration traps verified locally: `@coinbase/cdp-sdk/x402` imports its optional `@x402/svm` peer even for an EVM-only facilitator; pinning it fixes runtime import failures. Bazaar's 2.28.0 declaration omits the output schema unless an output example is also supplied. The Next middleware does not forward `result.extensionResponses`; the evidence route explicitly forwards that base64 JSON as `EXTENSION-RESPONSES`. Tests use simulated facilitator, RPC and Convex fixtures and do not prove catalog acceptance or payment settlement. No current Coinbase retail-MCP transaction cap is asserted here; that separate mainnet product is not this integration.


## Solana rail

Solana Devnet is a second funding rail and the license-token chain, targeting MLH Best Use of Solana. Coinbase/CDP and Base remain primary. Canonical network is `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`; USDC mint is `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, six decimals. There is no bridge or Solana payout flow: all payouts still require Base USDC liquidity.

### Token-2022 license per delivery

When `acceptAndPublish` publishes a delivery, it schedules `solanaLicense:mintForDelivery` (`convex/solanaLicense.ts`, with claims in `convex/solanaLicenseData.ts`). The builder in `packages/payments/src/solana-license.ts` creates one Token-2022 mint with the MetadataPointer and TokenMetadata extensions, decimals 0, mints exactly one token to the custodial license account, and revokes the mint authority in the same transaction, so supply is provably fixed at one. The single additional metadata field `license` is a digest over the delivery ID, manifest hash, terms hash, consent receipt hash, license hash and license version.

The fee payer, metadata update authority and holder is the CDP Solana account named by `SKARL_CDP_SOLANA_LICENSE_ACCOUNT` (default `skarl-license-devnet`). The fresh mint key signs locally; CDP signs the payer slot remotely (`signTransaction`), and the transaction is sent and confirmed over Solana RPC. The claim is idempotent per delivery: minted or in-flight rows are never re-minted, failures retry up to `SKARL_SOLANA_LICENSE_MAX_ATTEMPTS` (default 3), a recorded consent revocation refuses minting, and an underfunded signer fails before signing. `SKARL_SOLANA_LICENSES=off` disables scheduling. Results surface in `proof:solanaLicenses`, `proof:summary.solanaLicenses` and, for minted licenses only and without holder or contributor linkage, the public `/proof.json`. Devnet and testnet only; the license token is a provenance record, not a transfer of payment.

The CDP receive-only account `skarl-treasury-devnet` is `5vrHh4EG9dChLEEAkgedPUEq2gjYj95822kSjsCXPshh`. Its canonical USDC associated token account (ATA), `CtgPLBxHZU1UZcyovafXuQR2cVAFvpHksPh5HCBDJWHY`, was initialized through the USDC faucet and independently observed on Devnet before enabling payment. Its public address is configured as `SKARL_SOLANA_TREASURY_ADDRESS` in Vercel production and Convex. No treasury signing operation is used by this integration.

The deployment owner deployed the Solana backend on October 25. To seed it, run `CONVEX_DEPLOYMENT=dev:keen-marmot-986 pnpm exec convex run seed:solanaDemo`. This idempotently creates `skarl-red-cup-demo-sol`: one sample, exactly 1 USDC; existing orders remain unchanged. Funding terms and outgoing payable denomination stay Base; the selected incoming rail is stored on the funding intent, attempt, observation and journal.

With CDP credentials loaded privately, set `SKARL_APP_URL=https://skarl.vercel.app` and the approved Solana treasury address, then run `pnpm agent:fund --rail solana skarl-red-cup-demo-sol`. The buyer uses the managed `skarl-buyer-devnet` account, Solana Devnet `exact`, and `SpendControls` allowlisting only this network, USDC mint and treasury. It persists spend reservations and signed payloads privately and reconciles an existing attempt on rerun. A timeout never authorizes another payment. The facilitator injects `extra.feePayer`, pays fees and signs its own transaction slot; the buyer requires **0 SOL**.

Before settlement, the server validates the payer signature, canonical mint, exact amount, treasury ATA and memo `skarl:<canonical Convex order ID>`. It claims `0x` + SHA-256 of the serialized message bytes durably; the final transaction signature is unavailable until the facilitator signs. A Solana message hash cannot claim another order or a case-mutated payer. Base58 addresses and signatures are case-sensitive throughout storage and reconciliation.

After settlement, Solana RPC must show `meta.err === null`, confirmed status with at least two confirmations (or finalized), an outer `transferChecked` to the treasury ATA with the canonical mint, payer authority, amount and required memo. Parsed and raw transaction reads must agree on signature/slot, and the raw message must hash to the stored authorization. Only then may `confirmFunding` post the balanced journal and activate the order. Chain identity reuses `(network, txHash, logIndex)`, with `txHash` holding the Solana signature and `logIndex` the outer instruction index. `SOLANA_DEVNET_RPC_URL` optionally overrides the public Devnet RPC; its genesis hash is checked.

`POST /api/payments/reconcile` accepts a case-preserved Solana signature as `txHash`. A lost facilitator response without a signature requires operator lookup of that transaction before recovery; the route does not scan or create a new payment. Solana Devnet does not use CDP webhooks or SQL API. Funding status and activity observations expose `network` and a rail-specific `explorerUrl` for dashboard badges.

Implementation tests use simulated RPC/facilitator data and real local transaction signatures. Treasury/faucet setup is live. The first post-deployment funding attempt returned HTTP 402 before settlement; the later fee-payer fix and successful retry are recorded below. See the [live attempt evidence](status.md#solana-live-attempt--october-25-2026-03130315-pdt).

Live setup check: CDP buyer `35pgsKg8sUYQRbLuWSmgYnham9rWhqNuG1JJhGKN6TWy` has 2 USDC and 0 SOL before the funding demonstration. Two immediate faucet requests initially returned the same signature despite distinct idempotency keys; RPC showed only one deposit. The buyer now waits for each faucet signature to finalize before issuing the next claim. Private setup records retain the duplicate response and the separately confirmed replacement claim; no duplicate deposit is counted.


### Live fee-payer mismatch — October 25, 03:13–03:15 PDT

The production `ff79f59` build advertised Base first, Solana second and `X-Skarl-Facilitator: cdp`. The seeded 1 USDC order is `kh70wdg1psv4np16bfkq4hkc6d8gz715` (`skarl-red-cup-demo-sol`). The bounded CDP buyer created one authorization with a `1000000` micro-USDC per-payment and cumulative cap; its paid request and one identical recovery replay both returned HTTP 402. CDP's read-only verification accepted the saved payload, but x402's requirement matcher rejected a fresh challenge whose `extra.feePayer` differed from the signed quote. Restoring only the original fee payer made that local matching check succeed.

`ExactSvmScheme` 2.28.0 copies the supported response's fee payer into each challenge, while its dynamic-extra list only excludes `recentBlockhash` and `lastValidBlockHeight` from matching. Skarl creates a resource server per request, and the live CDP-supported fee payer varies. This combination prevents the observed signed quote from matching a later challenge. A fix must preserve a facilitator-authorized fee payer across requests; do not simply trust an arbitrary client-supplied fee payer or bypass settlement validation.

Reconciliation returned zero matches and zero exceptions, with no journal, intent or transaction hash. The order remained `awaiting_funding`. Finalized RPC reads still showed 2 USDC and 0 SOL for the buyer, and the treasury's original 1 USDC faucet deposit only; the authorization blockhash had expired. The private attempt and reservation remain intact. No replacement authorization, manual deployment, successful settlement or Explorer funding link is claimed. Full [live evidence](status.md#solana-live-attempt--october-25-2026-03130315-pdt).


### Fee-payer rotation fix

The funding resource server now matches Solana quotes with one narrowly scoped exception: `extra.feePayer` may differ from the newly generated quote only when the accepted payer appears in the selected facilitator's current supported set. The set requires v2 `exact` support for the canonical Devnet network and uses that kind's fee payer plus the concrete-network/`solana:*` signers. Support is cached for at most 30 seconds within one request, refreshed before verification/settlement when expired, and never accumulated across old quotes. Lookup failure fails closed.

Network, mint, treasury, amount, max timeout and every other extra field remain exact, including the order memo. The signed transaction must use the accepted fee payer and still passes the canonical treasury ATA, mint, exact amount, payer signature and memo checks. Existing durable message-hash and order claims remain unchanged. Historical receipt reconciliation does not depend on today's signer set. Regression tests use simulated facilitator responses; live retry evidence is recorded separately below. This is a web-only change and requires no Convex deployment.


### Confirmed live Solana retry — October 25, 03:29 PDT

[Solana Explorer: 1 USDC funding](https://explorer.solana.com/tx/31LMrtZYcf4PcBRcyFmFX8tBmt2fNttNSBA4mz7sTrZKSw6E2kH9oghw5FTafzR77JZT9so1zzjkj8ZuVqrGUezi?cluster=devnet). After the automatic Vercel production build of `d91c1e9` was live, one new bounded CDP buyer authorization returned HTTP 200, `fundingStatus: confirmed`, and `settledBy: cdp`. `X-Skarl-Facilitator` remains `cdp`; no public fallback was necessary. This fix changed no Convex functions and used no manual deployment.

The canonical order `kh70wdg1psv4np16bfkq4hkc6d8gz715` is funded for **1000000 micro-USDC**. RPC independently verified a finalized transaction at slot **514940239**, transfer instruction **2**, canonical mint, treasury ATA, exact amount, payer signature and order memo/message hash. Convex reconciliation returned one matched funding journal/transfer and zero exceptions. Finalized buyer/treasury balances changed from 2/1 to 1/2 USDC. See [the complete live trace](status.md#confirmed-solana-funding-after-fee-payer-fix--october-25-2026-0329-pdt).

The old rejected authorization was proven expired and unsettled before being archived privately; its spend reservation remains counted. The retry used a 1-USDC per-payment cap and a 2-USDC cumulative cap including that reservation. This is CDP SDK buyer evidence, not a Wallet MCP purchase. Base remains first in accepts and the only payout target.
