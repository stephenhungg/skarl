# @skarl/payments

Base Sepolia-only x402 funding configuration, EIP-3009 authorization parsing, transfer validation and three-way reconciliation. Constants come from `@skarl/contracts/chain`; amounts are bigint micro-USDC and decimal integer strings in JSON.

The Next route adapters live under `apps/web/lib/payments` and `apps/web/app/api`. Convex owns durable attempts, nonce claims, approvals and financial transitions in `convex/payments.ts`. `getPaymentRuntimeStatus()` describes implemented code but does not infer configured credentials or live evidence. The old generic `requirePaymentRuntime()` remains closed; call the explicit adapters.

See [payment setup and integration](../../docs/payments.md). No fixture or passing test proves onchain execution. Refunds are deferred.
