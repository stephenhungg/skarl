# Convex Demo Backend

Shared cloud development deployment: **https://keen-marmot-986.convex.cloud**.
Dashboard: https://dashboard.convex.dev/d/keen-marmot-986.

This backend implements the Task 1 demo finance path: internal idempotent seed,
persisted role checks, atomic acceptance/delivery/payable/journal posting,
outgoing payment proposals, independent approval and dashboard queries.
Task 2 adds `submissions.ts`, scheduled Node `verify.ts`, byte hashing, isolated
media, model observations and canonical report persistence. Provider failures
remain review-only; see [measured state](../docs/status.md). Production auth,
licensed media downloads, wallet verification, funding confirmation, payout
execution and chain reconciliation remain unimplemented.

## Files and API

- `seed.ts`: internal `seed:demo`; `pnpm seed`. One organization, four identities,
  one unfunded 100-USDC order and the frozen red-cup rubric. No fabricated funding.
- `lib/demoAuth.ts`: `requireRole`; **demo-only, impersonable identity selectors**.
- `lib/finance.ts`: deterministic binding hashes, audits and atomic persistence
  of the pure `packages/ledger` journals.
- `finance.ts`: `acceptAndPublish`, `proposePayment`, `approve`.
- `dashboard.ts`: `demoContext`, `orderSummary`, `submissions`, `payables`,
  `journal`, `auditEvents`. Financial JSON fields are decimal integer strings.
- `verify.ts`, `submissions.ts`: scheduled verification, fenced completion and contributor report access.
- `lib/media.ts`, `lib/gemini.ts`, `lib/verificationReport.ts`, `lib/copyDetection.ts`: media separation, provider calls and deterministic evidence/copy checks.
- `finance.test.ts`: isolated `convex-test` regressions; synthetic data only.
- `health.ts`: public capability metadata, `stage: "demo_backend"`.

Use `api` / `internal` from `_generated/api` and generated types from
`_generated/dataModel` / `_generated/server`. `_generated` is **committed** so
teammates can typecheck immediately. Never hand-edit it: regenerate using the
Convex CLI when exported functions or the schema change. No deployment URL,
credential or secret belongs in generated code.

## Important boundaries

Public mutations accept `demoIdentity` as one of `buyer`, `contributor`,
`controller`, `finance-agent`. These are public demo selectors, **not secret
tokens or production authentication**. Roles and organization membership are
checked on the server, but anyone knowing a selector can impersonate that demo
user. Use only disposable synthetic data and test assets. The agent is denied
controller authority even if its membership is accidentally misprovisioned.

Refused duplicate acceptance and approval attempts return `{ ok: false, code }`
after writing an audit record. Callers must inspect `ok`; no thrown error is
required for a refusal. Throwing after writing would roll the audit back.
Queries throw on unauthorized access.

`paymentIntents` has funding and `contributor_payout` variants. Outgoing intents
store `requesterTokenIdentifier` and point to a `paymentCommands` record. Both
are created atomically; `approve` takes the **paymentIntents ID**. Approval only
queues execution: it does not sign a transaction or mark the payable paid.

See [setup](../docs/setup.md), [call examples](../docs/backend.md#task-1-client-contract)
and [current status](../docs/status.md). No Auth0 or production identity provider
is configured.

## Checks

```sh
pnpm test:convex
pnpm check
# Cloud dev deploy/typecheck (requires project access):
pnpm exec convex dev --once --typecheck enable
# Offline CI uses a throwaway anonymous local backend instead:
pnpm check:convex
```

The native backend enforces schemas/indexes; indexes are not unique constraints.
Idempotency reads and writes are in the same mutation. `convex-test` checks the
application logic, not real inference, wallet proofs or chain transfers.
