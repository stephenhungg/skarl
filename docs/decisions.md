# Engineering Decisions

Status as of October 24, 2026. These are design decisions, not claims of completed integrations.

| Decision | Status | Reason / revisit trigger |
| --- | --- | --- |
| Solana Devnet USDC only | Required by user | x402 can settle on Solana; do not add Base to chase a logo. Mainnet requires a separate launch decision. |
| No custom on-chain program | Chosen for MVP | Checked SPL transfers and durable application accounting satisfy the demo. Revisit only for a real enforceable escrow requirement. |
| Platform-held refundable prepayment | Demo assumption | Do not call it noncustodial escrow. Real custody, customer terms and operating obligations need review before launch. |
| Skarl acts as principal for dataset sales | Explicit accounting assumption | Recognize gross revenue on actual licensed delivery, contributor acquisition cost separately. A pure brokerage business needs a different net model. |
| Convex is authoritative | Chosen | Transactions, jobs, storage and reactive views; avoid dual writes into a second database. |
| Python pull worker on Railway | Chosen target | Media/ML dependencies and long tasks outside web requests. Modal/GPU only if measurements require it. |
| Auth0 | Preferred | Necessary identity and possible sponsor fit. Keep an existing working integration over a last-minute replacement. |
| Gemini silent-video + independent ASR | Chosen starting pipeline | Reduces narrative contamination and permits alignment tests. Current model identifier remains configurable. |
| SSCD temporal copy checks | Chosen starting method | Detect transformed copies. Semantic embeddings alone would conflate valid retakes. |
| No model fine-tuning in first loop | Deferred | Build labels and evaluate before choosing a learned head. Training without evidence is not engineering value. |
| Finance agent has typed bounded tools | Required | Model can propose/explain; deterministic authorization, policy, approvals and signer execution remain outside it. |
| x402 funding is short and asynchronous | Required | Do not wait for video analysis inside a paid route; grant work only after settlement observation. |
| Coinbase Payment Agents prize | Conditional | Brief asks for Coinbase MCP + x402. Wallet MCP's documented x402 path is Base-only; CDP SDK/facilitator is not the same requirement. |
| Cartesia / extra voice layer | Deferred | Only if responsive voice is truly useful and the core loop is already complete. |
| Public repository license | Unselected | Public visibility does not itself grant an open-source license; maintainers should select terms deliberately. |

## Open questions that affect live implementation

- What exact license/consent text is acceptable to both buyer and contributor? Define withdrawal/deletion and already delivered data behavior before actual collection.
- Will a Solana-compatible Coinbase MCP path or sponsor-approved alternative satisfy the challenge? Obtain a clear answer; do not infer acceptance from facilitator support.
- What are the exact maximum payout, batch threshold, approver identities and posting/finality policy? Document a demo policy before enabling a signer.
- Who owns each hosted account and secret? The scaffold creates no deployments or credentials.
- What measured quality, false-positive tolerance and latency does the buyer require? Freeze thresholds on training/validation sessions and reserve held-out sessions for reporting.

Routine folder and implementation choices can proceed without waiting on these. Real contributor collection, live signing and claims of sponsor eligibility depend on resolving their respective questions.
