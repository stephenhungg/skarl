# Use Skarl from your agent

This directory contains a reusable [Skarl Wallet MCP plugin](skarl.md) for funding orders and purchasing verification evidence. It is a custom instruction file, not an installed or Coinbase-approved marketplace integration.

The evidence revenue address is `0x0A9EfDF66c58543538824906aE267B969Ed651c5`, read from live Convex `CDP_AGENT_ADDRESS`. For the live buyer-to-agent demonstration, use the [Wallet MCP demo runbook](../wallet-mcp-demo.md). Evidence purchases pay the separate `skarl-finance-agent` revenue account through `SKARL_EVIDENCE_PAYTO`; order funding continues to pay the human treasury. Search must explicitly select `network: "base-sepolia"`, because Wallet MCP discovery defaults to Base mainnet.

## Three steps

1. Connect [Coinbase Wallet MCP](https://docs.cdp.coinbase.com/coinbase-for-agents/wallet-mcp/references/install) to your agent. For Claude Code, run `claude mcp add --transport http --scope user base-mcp https://wallet-mcp.coinbase.com`. For Codex, run `codex mcp add base-mcp --url https://wallet-mcp.coinbase.com/`. Authorize the connection and have Base Sepolia test USDC in the connected wallet.
2. Give the agent [skarl.md](skarl.md), or copy it to `skills/base-mcp/plugins/skarl.md` in an existing Wallet MCP skill installation. Ask it to run Wallet MCP onboarding and read the plugin. No Skarl server credentials are needed. An HTTP-capable agent is the most direct route; chat-only clients also depend on Coinbase's host allowlist.
3. Ask “Check whether Skarl order skarl-red-cup-demo-v2 is funded.” For a new payment, ask “Create a fresh Skarl demo order with POST https://skarl.vercel.app/api/orders and fund its returned fundUrl with at most 1 USDC on Base Sepolia.” The order has a fixed red-cup task and requires no identity header; creation accepts an empty body or `{}` and limits requests to 3 per IP and 30 globally per hour. Review the request in Coinbase Wallet, then let the agent complete the request and read back confirmed funding.

For evidence: “Buy Skarl sample sample-SUBMISSION_ID's evidence for at most 0.25 USDC.” The implemented endpoint charges `0.250000` USDC for an eligible accepted, delivered sample and returns the stored report plus five-minute media access after confirmed settlement. No eligible sample or live paid evidence sale has been demonstrated as of the October 25 deployment handoff; the plugin stops if the sample or backend is unavailable. The seeded v2 order is already funded, so checking it does not demonstrate a new payment. No live Wallet MCP payment is claimed by these instructions alone. See the [evidence contract](../x402-bazaar.md) for eligibility, receipt handling, and accounting limitations.

## Review and integration status

The plugin follows the [Coinbase plugin specification](https://docs.cdp.coinbase.com/coinbase-for-agents/wallet-mcp/references/plugin-spec) for frontmatter and section ordering. Its submission tools are the actual x402 approval tools, consistent with Coinbase's [Brickken x402 example](https://docs.cdp.coinbase.com/coinbase-for-agents/wallet-mcp/plugins/brickken), rather than a raw calldata conversion.

The repository does not include Coinbase's `plugin-review` skill; review here is a local structure/link check, not upstream certification. Shipping this file does not register a Bazaar listing or update Coinbase's `web_request` allowlist. See [deployment](../deployment.md) and [status](../status.md) for live evidence and remaining limitations.
