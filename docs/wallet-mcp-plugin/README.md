# Use Skarl from your agent

This directory contains a reusable [Skarl Wallet MCP plugin](skarl.md) for funding orders and purchasing verification evidence. It is a custom instruction file, not an installed or Coinbase-approved marketplace integration.

## Three steps

1. Connect [Coinbase Wallet MCP](https://docs.cdp.coinbase.com/coinbase-for-agents/wallet-mcp/references/install) to your agent. For Claude Code, run `claude mcp add --transport http base-mcp https://wallet-mcp.coinbase.com`. For Codex, run `codex mcp add base-mcp --url https://wallet-mcp.coinbase.com/`. Authorize the connection and have Base Sepolia test USDC in the connected wallet.
2. Give the agent [skarl.md](skarl.md), or copy it to `skills/base-mcp/plugins/skarl.md` in an existing Wallet MCP skill installation. Ask it to run Wallet MCP onboarding and read the plugin. No Skarl server credentials are needed. An HTTP-capable agent is the most direct route; chat-only clients also depend on Coinbase's host allowlist.
3. Ask “Check whether Skarl order skarl-red-cup-demo-v2 is funded.” For a new payment, supply a fresh unfunded order ID and a cap, for example “Fund Skarl order ORDER_ID with at most 10 USDC on Base Sepolia.” Review the request in Coinbase Wallet, then let the agent complete the request and read back confirmed funding.

For evidence: “Buy Skarl sample SAMPLE_ID's evidence for at most 0.25 USDC.” This requires the separately shipped evidence endpoint and a published sample; the plugin stops if either is unavailable. The seeded v2 order is already funded, so checking it does not demonstrate a new payment. No live Wallet MCP payment is claimed by these instructions alone.

## Review and integration status

The plugin follows the [Coinbase plugin specification](https://docs.cdp.coinbase.com/coinbase-for-agents/wallet-mcp/references/plugin-spec) for frontmatter and section ordering. Its submission tools are the actual x402 approval tools, consistent with Coinbase's [Brickken x402 example](https://docs.cdp.coinbase.com/coinbase-for-agents/wallet-mcp/plugins/brickken), rather than a raw calldata conversion.

The repository does not include Coinbase's `plugin-review` skill; review here is a local structure/link check, not upstream certification. Shipping this file does not register a Bazaar listing or update Coinbase's `web_request` allowlist. See [deployment](../deployment.md) and [status](../status.md) for live evidence and remaining limitations.
