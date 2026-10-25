# Solana payment architecture

Research date: October 24, 2026. Network decision: **Solana Devnet only**.

## Current implementation boundary

`packages/payments` is a fail-closed scaffold. It exports canonical configuration and reports all payment capabilities unavailable. There is no implemented x402 handler, facilitator connection, wallet signer, settlement importer, payout executor, or refund executor. A UI using fixture balances must label them as fixtures. A successful local unit test is not an onchain payment.

The recommended first integration is a small x402 v2 `exact` funding payment for a collection order. Human demonstrations and model verification happen asynchronously afterward. The buyer receives an order receipt immediately and uses authenticated, uncharged status/download endpoints for fulfillment. A paid HTTP connection must not wait for someone to record a demonstration.

## Network and SDK decisions

The source of truth is `packages/contracts/src/solana.ts`:

| Setting | Value |
| --- | --- |
| x402 network | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` |
| Asset | Circle test USDC |
| Mint | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| Decimals | `6` |
| Scheme | `exact` |
| Application amount type | Integer micro-USDC, `bigint` / Convex Int64 |

Circle identifies the Devnet mint as test currency without financial value. Check the mint and cluster together; a token symbol does not establish asset identity. [Circle contract and mint addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)

Use the canonical [x402 Foundation implementation](https://github.com/x402-foundation/x402), with the `@x402/*` packages pinned together at `2.28.0` for the initial spike. The planned server/client packages are `@x402/core`, `@x402/svm`, `@x402/next`, `@x402/fetch`, and the needed extensions. Use the SDK's SVM signer and server adapters instead of rebuilding transaction parsing or fee sponsorship. Register the exact Devnet network, not the permissive `solana:*` wildcard. [SVM package and export reference](https://github.com/x402-foundation/x402/tree/main/typescript/packages/mechanisms/svm)

The CDP facilitator documents support for Solana mainnet and Devnet. A provider's live supported-networks response must still be checked before advertising a challenge. CDP integration does not require enabling an EVM payment option. [Facilitator support](https://docs.cdp.coinbase.com/x402/seller/facilitator)

### Version compatibility checked against npm metadata

| Package | Verified dependency requirement |
| --- | --- |
| `@x402/svm@2.28.0` | Peer: `@solana/kit >=5.1.0` |
| `@coinbase/cdp-sdk@1.60.0` | Internal dependency: `@solana/kit ^5.5.1`; x402 peer ranges accept `2.28.0` |
| `@solana/react@8.5.0` | Peers: `@solana/kit ^8.5.0`, `swr ^2.5.1`, `@tanstack/react-query ^5.103.1`, React >=18 |
| `@x402/next@2.28.0` | Peer: Next.js >=16.2.6 |

Do not override every dependency to the newest Kit major. Keep the browser Wallet Standard integration separate from the server payment implementation and exchange serialized addresses/transactions across the boundary. Run a typecheck and one real Devnet round trip with the exact dependency graph. These registry checks do not prove runtime interoperability. [SVM metadata](https://registry.npmjs.org/@x402%2fsvm/2.28.0), [CDP metadata](https://registry.npmjs.org/@coinbase%2fcdp-sdk/1.60.0), [React metadata](https://registry.npmjs.org/@solana%2freact/8.5.0)

## Funding a collection order

1. An authenticated buyer creates a draft with task/rubric version, quantity, sample price, license terms, expected payer, and total.
2. The funding endpoint validates ownership, state, and the immutable quote before requiring payment. An invalid order must fail before charging.
3. The server returns the x402 v2 `PAYMENT-REQUIRED` challenge for that stored amount, Devnet mint, merchant address, and supported sponsor. The client supplies a stable funding idempotency key.
4. The client signs the SVM transaction and retries using `PAYMENT-SIGNATURE`. The backend persists a payment attempt, canonical request digest, and transaction-message identity before asking the facilitator to settle.
5. Only a verified settled payment can activate the order. One Convex mutation records settlement evidence, posts cash against customer prepayments, marks the order funded, and schedules publication of the task.
6. A status endpoint returns the same order after a lost HTTP response. It never charges again just to retrieve an already purchased receipt or dataset.

`exact` transfers a specific asset to the merchant. The SVM client constructs a partially signed transaction; the sponsoring facilitator completes its fee-payer signature and broadcasts it. The sponsor's fee-payer account is not the contributor or necessarily the buyer. Reconciliation must identify the actual token source/owner, recipient ATA, mint, amount, and successful transaction outcome. Do not trust an unverified client-supplied signature or a `payer` display field as sufficient attribution. [Canonical SVM specification](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_svm.md)

The paid resource here is a funded order and its future fulfillment obligation. This is a deliberate application design, not a promise that the x402 protocol itself supplies a labor marketplace, licensing contract, escrow, or delivery guarantee.

### Handler ordering matters

The published Next.js `withX402` adapter verifies the authorization, runs the handler, settles, then returns the response. A handler may therefore execute before funds settle. It may stage a pending order; it must not release data or create a funded task on verification alone. Activate through a successful settlement lifecycle step and an idempotent Convex mutation, with a reconciliation loop for the crash window between chain settlement and the database commit.

The generic Next payment proxy has different semantics and can settle before the downstream handler. Prefer an explicit route-specific lifecycle that validates the order before funds move. Test the exact deployed path: a route-pattern mismatch can leave a handler unprotected. [Next.js adapter implementation](https://github.com/x402-foundation/x402/blob/main/typescript/packages/http/next/src/index.ts)

Solana's recent blockhash expires. Settle the short funding request without waiting for media processing. Persist the last-valid block height when available, retain unresolved attempts, and check history before constructing a replacement transaction. [Solana transactions](https://solana.com/docs/core/transactions)

## Idempotency and reconciliation

There is no atomic transaction spanning Solana, a facilitator, HTTP, and Convex. Use application state to make failures recoverable:

| Identity | Purpose |
| --- | --- |
| Buyer + order + stable funding key | One purchase intent across retries and fresh transaction attempts |
| Immutable quote/request digest | Reject the same key reused with changed price, recipient, or terms |
| Signed transaction-message digest | Claim a submitted authorization before settlement; prevent one authorization funding multiple orders |
| Network + confirmed signature + identified transfer | Deduplicate imported chain money movement independently of HTTP results |
| Business event ID | Post each financial transition once |

Advertise and use x402's payment-identifier extension where supported. It carries a key; the application must still implement durable, concurrency-safe deduplication. A process-local map or `get` followed by `set` is insufficient across replicas. [Payment identifier implementation](https://github.com/x402-foundation/x402/tree/main/typescript/packages/extensions/src/payment-identifier)

Model funding states explicitly: `awaiting_payment`, `verification_pending`, `settlement_pending`, `confirmed`, `failed`, and `reconciliation_required`. A timeout is not proof of failure. On `settlement_pending`, keep the existing transaction identity and reconcile it. Never ask the buyer to pay again merely because the response was lost. The canonical facilitator has pending-settlement recovery, but application persistence remains necessary. [Facilitator recovery behavior](https://github.com/x402-foundation/x402/blob/main/docs/core-concepts/facilitator.md)

For a transaction whose outcome is unknown, retry observation or resubmit the same signed bytes where supported. Rebuild with a fresh blockhash only after the original can no longer land and reliable history establishes that it did not settle. Preserve the original intent key and every attempt. Do not turn an RPC outage into a second charge.

Use `confirmed` as the declared minimum Devnet operational threshold, retain slot/transaction evidence, and track `finalized` separately. Confirmed and finalized are distinct states. The initial application should reject overpayments and leave unexpected transfers for reconciliation rather than silently allocating them to an order. A production implementation must define handling for orphan deposits, rollbacks, failed transfers, and payer mismatches.

## Contributor payouts and buyer refunds

Payouts and refunds are independently approved SPL USDC transfers. They are not automatic reversals of an x402 `exact` payment. The controller must see the recipient, mint, amount, cluster, underlying obligation, and evidence. The requesting agent cannot approve or sign its own payment.

The least-complex initial custody model is a human-controlled treasury wallet receiving buyer prepayments. The agent prepares a typed proposal; the controller signs the actual transfer through a supported Solana wallet. A treasury-controlled server signer is a later option requiring enforceable policy and separate approval. Recipient changes invalidate pending approval. Refund only to the original verified payer in the MVP.

Payout execution must record its proposed transaction before broadcast and retain the original signature through retries. A submitted transaction is not a paid payable. Reduce the payable or refund liability only when the identified transfer is confirmed. Check source/destination ATAs and arrange any required account-creation funding explicitly; facilitator-sponsored checkout does not imply that outgoing payouts have sponsored fees.

This model places refundable prepayments in a platform treasury wallet. The ledger tracks liabilities and reserves; it does not lock them cryptographically. Do not call it noncustodial escrow. A future Solana program could enforce per-order reserves and approved disbursement references, but that is outside this scaffold and must not be represented as implemented.

## Essential payment checks before claiming a working integration

- Complete one genuine Devnet x402 purchase through the deployed URL and selected facilitator.
- Reject unpaid access, wrong cluster/mint/recipient/amount, stale quotes, malformed payloads, and unauthorized order access.
- Retry simultaneous and interrupted requests without creating another funded order or credit.
- Recover when settlement succeeds but the database write or HTTP response fails.
- Preserve pending outcomes instead of manufacturing a new payment authorization.
- Confirm one approved contributor payout and one approved refund, with independently verifiable transaction evidence.
- Reconcile only the intended transfer and post each business event once.

Coinbase Wallet MCP currently supports Base/Base Sepolia for its x402 calls. It is not a Solana buyer adapter. See [sponsor track constraints](sponsor-tracks.md) before describing prize eligibility.
