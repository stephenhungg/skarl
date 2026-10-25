# @skarl/payments

Base Sepolia-only payment boundary. This package exports the canonical network and asset configuration from `@skarl/contracts/chain` (`PAYMENT_NETWORK` = `eip155:84532`, `USDC_ADDRESS` = Circle's Base Sepolia USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, `USDC_DECIMALS` = 6), network and asset guards, and a runtime status that explicitly says **unimplemented**. `requirePaymentRuntime()` always throws. It does not connect a wallet, call a facilitator, charge a buyer, send a payout, refund a payment, or fabricate a receipt.

`assertPaymentAsset(network, asset, decimals)` checks all three together and compares EVM addresses case-insensitively (EIP-55 casing is a checksum, not identity).

Installed for the planned adapter (imports typecheck; nothing is wired): `@x402/core`, `@x402/evm`, `@x402/fetch` at 2.28.0 and `viem` 2.57.11 (`@x402/evm` depends on `viem ^2.48.11`). Buyer funding uses x402 v2 `exact` on Base Sepolia. Contributor payouts and buyer refunds are independently approved USDC transfers, not automatic x402 chargebacks. Coinbase MCP for Agents is not installed or wired here.
