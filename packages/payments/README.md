# @skarl/payments

Solana Devnet-only payment boundary. This package currently exports canonical network configuration from `@skarl/contracts/solana`, a network guard, and a runtime status that explicitly says **unimplemented**. `requirePaymentRuntime()` always throws. It does not connect a wallet, call a facilitator, charge a buyer, send a payout, refund a payment, or fabricate a receipt.

Planned adapter: x402 v2 `exact`, `@x402/svm@2.28.0`, and an authenticated facilitator supporting Solana Devnet. Buyer funding settles an asynchronous collection order. Contributor payouts and buyer refunds are independently approved SPL USDC transfers, not automatic x402 chargebacks. See [payment architecture](../../docs/payments-solana.md).

No SDK runtime dependencies have been installed here because no real adapter exists yet. Verify the selected wallet and facilitator together before adding them. Registry metadata checked October 24, 2026:

- `@x402/svm@2.28.0` peers on `@solana/kit >=5.1.0`.
- `@coinbase/cdp-sdk@1.60.0` internally uses `@solana/kit ^5.5.1`.
- `@solana/react@8.5.0` peers on `@solana/kit ^8.5.0`, `swr ^2.5.1`, and `@tanstack/react-query ^5.103.1`.

Do not force browser and server packages onto one incompatible Kit major. Keep their runtime boundaries separate and exchange serialized addresses/transactions; typecheck the exact selected SDK combination. Coinbase Wallet MCP is currently Base/Base Sepolia-only and is not this Solana adapter. Its sponsor eligibility must not be claimed from CDP facilitator use alone.
