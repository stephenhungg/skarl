# Payment architecture

Research date: October 25, 2026. Network decision: **Base Sepolia only** (testnet; mainnet is not enabled).

## Current implementation boundary

`packages/payments` is a fail-closed scaffold: it exports canonical configuration and reports every payment capability unavailable. There is no x402 handler, facilitator connection, wallet integration, settlement importer or payout executor yet. A UI showing fixture balances must label them as fixtures. A passing unit test is not an onchain payment.

The design: a short x402 V2 `exact` funding payment for a collection order. Recording and verification happen asynchronously afterward. A paid HTTP request never waits for someone to record a demonstration.

## Network and SDK decisions

The source of truth is `packages/contracts/src/chain.ts`:

| Constant | Value |
| --- | --- |
| `PAYMENT_NETWORK` (CAIP-2) | `eip155:84532` (Base Sepolia) |
| `PAYMENT_CHAIN_ID` | `84532` |
| `USDC_ADDRESS` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (Circle test USDC) |
| `USDC_DECIMALS` | `6` |
| Scheme | `exact` |
| Application amount type | Integer micro-USDC: `bigint` / Convex Int64 / decimal string in JSON |

Check the chain ID and token address together; a token symbol does not establish asset identity. [Circle USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)

Use the canonical [x402 Foundation implementation](https://github.com/x402-foundation/x402) with every `@x402/*` package pinned to `2.28.0` (released the day before the event; install and typecheck in hour 0–1):

| Package | Requirement (npm metadata) |
| --- | --- |
| `@x402/evm@2.28.0` | Depends on `viem ^2.48.11`, `@x402/core ~2.28.0` |
| `@x402/next@2.28.0` | Peers: `next >=16.2.6`, **`@x402/paywall ^2.28.0`** (install it too) |
| `@x402/paywall@2.28.0` | Peers: `react ^19`, `react-dom ^19` |
| `@x402/core`, `@x402/fetch` | `2.28.0` |

Register the exact network `eip155:84532`, not a wildcard. The CDP facilitator settles x402 on Base and Base Sepolia; query its supported-networks response before advertising a payment requirement. [CDP facilitator](https://docs.cdp.coinbase.com/x402/seller/facilitator)

## Where Coinbase for Agents fits

| Tool | Documented behavior | Use in Skarl |
| --- | --- | --- |
| [Wallet MCP](https://docs.cdp.coinbase.com/ai-agents/coinbase-for-agents/wallet-mcp) (`https://wallet-mcp.coinbase.com`) | Base and Base Sepolia. `initiate_x402_request` / `complete_x402_request` with a `maxPayment` cap; `send` for transfers. **Every write action requires the user's approval in Coinbase Wallet.** | (1) The buyer agent funds an order through our x402 endpoint. (2) The finance agent executes an approved payout with `send`; the controller approves it in Coinbase Wallet. |
| [Coinbase MCP](https://docs.cdp.coinbase.com/ai-agents/coinbase-for-agents/coinbase-mcp) | x402 in USDC on **Base mainnet**, `coinbase_x402_fetch` / `coinbase_x402_pay`, **capped at 5 USDC per payment** | Optional only. It does not reach Base Sepolia, so it is not on the demo path. |

**Agent execution rule:** the agent proposes; Convex records the proposal and the controller's approval. The agent may call Wallet MCP `send` only for a stored, approved intent, and only with the exact recipient, amount and token from that intent, with the cap equal to the approved amount. The controller's Coinbase Wallet approval is the signature. An unapproved, changed or already-attempted intent is refused before any MCP call.

## Funding a collection order

1. An authenticated buyer creates a draft order: task/rubric version, quantity, sample price, license terms and total.
2. The funding route validates ownership, state and the stored quote **before** returning a payment requirement. An invalid order fails before charging.
3. The route returns the x402 V2 `PAYMENT-REQUIRED` challenge for the stored amount, `USDC_ADDRESS` and the merchant address. The client sends a stable funding idempotency key.
4. The buyer (or buyer agent via Wallet MCP) signs an EIP-3009 `transferWithAuthorization` and retries with `PAYMENT-SIGNATURE`. Persist the attempt and the authorization nonce **before** settlement.
5. Only an observed settled transfer activates the order. One Convex mutation records the settlement evidence, posts cash against customer prepayments and marks the order funded.
6. A status endpoint returns the same order after a lost response; it never charges again.

The EIP-3009 authorization nonce identifies a signed authorization. Claim it before settlement so one authorization cannot fund two orders. [Exact EVM scheme](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_evm.md)

### Handler ordering

**By default**, the Next.js `withX402` adapter verifies the authorization, runs the handler, then settles. A handler may therefore run before funds settle. The adapter also has a `beforeHandlerSettlement` option that settles first ([source](https://github.com/x402-foundation/x402/blob/main/typescript/packages/http/next/src/index.ts)).

Either way, the handler may stage a pending order but must not create a funded order on verification alone. Activation happens through settlement observation plus an idempotent Convex mutation. Test the exact deployed route path; a route-pattern mismatch can leave a handler unprotected.

## Funding states

These match `fundingStatuses` in `packages/contracts/src/index.ts`:

`awaiting_payment` → `verification_pending` → `settlement_pending` → `confirmed`, or `failed`, or `reconciliation_required`.

A timeout is not proof of failure. On `settlement_pending`, keep the authorization nonce and reconcile; never ask the buyer to pay again because a response was lost.

## Idempotency and reconciliation

There is no atomic transaction spanning Base, the facilitator, HTTP and Convex. Application identities make failures recoverable:

| Identity | Purpose |
| --- | --- |
| Buyer + order + funding key | One purchase intent across retries |
| Quote/request digest | Reject a reused key with changed price, recipient or terms |
| EIP-3009 authorization nonce | One signed authorization funds at most one order |
| `(network, txHash, logIndex)` | One imported USDC `Transfer` event, independent of HTTP results |
| Business event ID | Each financial transition posts once |

Reconcile from the USDC `Transfer` log, not from a client-supplied hash. Check `from`, `to`, `value`, the token contract address and the receipt status.

## Contributor payouts

Payouts are independently approved **USDC ERC-20 transfers**, not reversals of an x402 payment. The controller sees the recipient, amount, network, underlying payable and evidence. The requesting agent cannot approve its own proposal.

- **Custody:** buyer prepayments land in a human-controlled Coinbase Wallet / Smart Wallet. There is no treasury key in the web runtime or the agent, and no custom Solidity or escrow contract. Do not call this noncustodial escrow.
- **Execution:** the controller signs in the browser wallet, or approves a Wallet MCP `send` of the stored intent.
- **Recording:** record the intent before submission and keep the original transaction hash through retries. A submitted transaction is not a paid payable; reduce the payable only once the identified `Transfer` log is confirmed.
- **Gas:** payouts need Base Sepolia ETH for gas, unless a smart-wallet paymaster sponsors it.

**Refunds are deferred** unless funding and payout both work by hour 6. If built, they refund only the original verified payer.

## Checks before claiming a working integration

- One genuine Base Sepolia x402 purchase through the deployed URL and the CDP facilitator, with its tx hash saved.
- Unpaid access is rejected, as are a wrong chain, token, recipient or amount, stale quotes and access to another user's order.
- A retried or interrupted request creates no second funded order.
- One approved payout is confirmed and reconciled by `(txHash, logIndex)`.
- A self-approval attempt by the agent is blocked.
