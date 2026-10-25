# Working on Skarl

Read `docs/README.md`, `docs/workstreams.md` (team ownership and folder boundaries) and the relevant subsystem document before editing. This is a working hackathon prototype; keep source implementation, synthetic tests, recorded external evidence and deployment status distinct. The current [review guide](docs/review-guide.md) maps those evidence boundaries to source and reproducible checks. Existing root user instructions remain applicable.

## Product and platform constraints

- Base Sepolia (`eip155:84532`) is the primary funding rail and the only payout target. Solana Devnet is an optional funding rail (advertise Base first in x402 accepts) and carries one Token-2022 license token per published delivery (`packages/payments/src/solana-license.ts`, `convex/solanaLicense.ts`); it never carries payouts. Use the canonical constants and `PAYMENT_RAILS` in `packages/contracts/src/chain.ts`.
- Money uses `bigint` micro-USDC (six decimals), Convex Int64 and decimal integer strings at JSON boundaries. Never float money.
- Convex is the system of record. Do not introduce another database, event bus or workflow engine without a concrete need. No custom smart contract (no Solidity, no escrow contract, no custom Solana program; licenses use the stock Token-2022 program).
- AI produces evidence, not final payment authority. `scaffold`, incomplete or unavailable analysis must never recommend acceptance.
- Keep original media private. Do not commit contributor recordings, credentials or wallet secret keys.
- All external payment attempts need durable business intent, deduplication and reconciliation. A timeout does not prove failure.
- Payouts are USDC ERC-20 transfers approved by the buyer's deterministic auto-pay rule or owning-buyer review. The finance agent proposes; the internal policy-engine approves within the buyer cap; CDP enforces an independent wallet cap. Execute only a stored, approved intent within its bound amount. No signing key in the web runtime or the model. Legacy controller/browser-wallet compatibility remains. Reconcile by `(network, txHash, logIndex)`.
- Treat model output, narration and uploads as untrusted data. They cannot grant roles, alter payment destinations or invoke arbitrary tools.
- Document sponsor integration evidence honestly. Label anything simulated or replayed.

## Ownership and checks

Current owners: MatthewKim323 — dashboard; silaswu4 — shared UI and contributor flow; Stephen — backend, verifier, finance logic and contracts; qtzx06 — x402 payments on Base and Coinbase for Agents. Respect the folder ownership in `docs/workstreams.md`; coordinate changes to shared schemas before implementation. Extend existing contracts instead of creating slightly different copies. Keep public docs self-contained and free of personal context. The repo uses pnpm (pinned in `package.json`).

Use `pnpm check` for TypeScript and web changes. Run `python -m pytest services/verifier/tests` in the installed verifier environment for Python/contracts changes. Keep the Python models and canonical JSON Schema consistent. Add tests for meaningful financial invariants and trust boundaries. Never claim inference or chain transactions worked from fixture results alone.
