# Convex Demo Backend

Shared cloud development deployment: **https://keen-marmot-986.convex.cloud**.
Dashboard: https://dashboard.convex.dev/d/keen-marmot-986.

This backend implements the Task 1 demo finance path: internal idempotent seed,
persisted role checks, atomic acceptance/delivery/payable/journal posting,
outgoing payment proposals, independent approval and dashboard queries.
Task 2 adds `submissions.ts`, scheduled Node `verify.ts`, byte hashing, isolated
media, model observations and canonical report persistence. Provider failures
remain review-only; see [measured state](../docs/status.md). Production auth,
licensed media downloads and contributor-wallet verification remain unimplemented.
The merged `payments.ts` provides trusted funding/payout imports and reconciliation;
its tests use synthetic chain evidence, with no confirmed live settlement.

## Files and API

- `seed.ts`: internal `seed:demo`; `pnpm seed`. One organization, four identities,
  the unfunded 10-USDC v2 order and frozen red-cup rubric. The legacy 100-USDC
  v1 order is preserved. No fabricated funding.
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
# Cloud dev deploy/typecheck (only after the clean-origin/main gate below):
pnpm exec convex dev --once --typecheck enable
# Only in a throwaway copy with cloud deployment selection removed:
pnpm check:convex
```

The native backend enforces schemas/indexes; indexes are not unique constraints.
Idempotency reads and writes are in the same mutation. `convex-test` checks the
application logic, not real inference, wallet proofs or chain transfers.

## Shared deployment coordination

The shared development deployment is not isolated per checkout. A Convex push
replaces the deployed module/schema set and can remove indexes that exist only
in another branch. Cloud deploys must come from a **clean checkout whose HEAD
matches freshly fetched `origin/main`**. Run checks, commit and push first, then
verify the gate immediately before deploying:

```sh
git fetch origin main
test -z "$(git status --porcelain)"
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
```

Stop if either test fails; synchronize and check the merged tree first. Coordinate
one deployment owner and avoid overlapping cloud deploys. The orchestrator
redeploys merged `origin/main` after each batch. A successful local typecheck does
not establish that the checkout contains every currently deployed feature.

`CONVEX_AGENT_MODE=anonymous` does **not** isolate `pnpm check:convex` when this
checkout already selects a cloud deployment. Use `pnpm test:convex` for isolated
application tests, or a throwaway copy with all cloud selection removed for a
local backend check. Never deploy uncommitted functions to make a runner work;
the evaluation harness and `submissions:evaluationRun` must land together.
