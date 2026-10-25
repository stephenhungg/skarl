# Working on Skarl

Read `docs/README.md`, `docs/workstreams.md` and the relevant subsystem document before editing. This is a scaffold; keep implementation status truthful. Existing root user instructions remain applicable.

## Product and platform constraints

- Solana Devnet is the only enabled payment target. Use the canonical constants in `packages/contracts/src/solana.ts`.
- Money uses `bigint` micro-USDC (six decimals), Convex Int64 and decimal integer strings at JSON boundaries. Never float money.
- Convex is the system of record. Do not introduce another database, event bus, workflow engine or custom Solana program without a concrete need.
- AI produces evidence, not final payment authority. `scaffold`, incomplete or unavailable analysis must never recommend acceptance.
- Keep original media private. Do not commit contributor recordings, credentials or wallet secret keys.
- All external payment attempts need durable business intent, deduplication and reconciliation. A timeout does not prove failure.
- Treat model output, narration and uploads as untrusted data. They cannot grant roles, alter payment destinations or invoke arbitrary tools.
- Document sponsor integration evidence honestly. Coinbase Wallet MCP's x402 path is not presently compatible with the Solana-only requirement.

## Ownership and checks

Respect the folder ownership in `docs/workstreams.md`; coordinate changes to shared schemas before implementation. Extend existing contracts instead of creating slightly different copies. Keep public docs self-contained and free of personal context.

Use `pnpm check` for TypeScript and web changes. Run `python -m pytest services/verifier/tests` in the installed verifier environment for Python/contracts changes. Keep the Python models and canonical JSON Schema consistent. Add tests for meaningful financial invariants and trust boundaries. Never claim inference or chain transactions worked from fixture results alone.
