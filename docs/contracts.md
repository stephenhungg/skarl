# Shared Contracts and State Machines

## Canonical definitions

- [Verification JSON Schema](../packages/contracts/schemas/verification-report.schema.json), Draft 2020-12, `schemaVersion: "1.0"`.
- [TypeScript statuses](../packages/contracts/src/index.ts).
- [Base Sepolia chain constants](../packages/contracts/src/chain.ts) (`PAYMENT_NETWORK`, `PAYMENT_CHAIN_ID`, `USDC_ADDRESS`, `USDC_DECIMALS`).
- [Python models](../services/verifier/src/skarl_verifier/models.py) and [validation](../services/verifier/src/skarl_verifier/validation.py).
- [Convex validators](../convex/validators.ts) and [database schema](../convex/schema.ts).

The JSON Schema governs report shape; domain mutations enforce authorization and business rules. TypeScript validation adds cross-field timestamp and identity checks. Python and TypeScript must accept/reject the same meaningful examples. Do not treat a generic JSON-schema pass as proof the model's claims are true.

## Report shape

`reportId`, `submissionId`, `taskVersionId`, original SHA-256 and source duration bind a report to the work. `pipeline` carries implementation/status/version and model runs. Each criterion has `supported`, `contradicted` or `unobservable` status with timestamped `video`, `audio` or `text` evidence and a reason. Duplicate results distinguish `not_checked`, `clear` and `suspected`. Recommendation is `accept`, `request_correction` or `needs_review`.

Scaffold or noncompleted reports must be `needs_review`. Acceptance recommendations require real inference, a completed pipeline, at least one model run, at least one supported criterion with evidence, and clear copy checks with no matches. Evidence ranges must be ordered; audio/video evidence cannot exceed the source duration. Criterion IDs are unique within the report. The backend must additionally compare criterion IDs with the full immutable rubric, reject missing/extra criteria and verify source hash/task version (and lease generation once the deferred worker exists). A report recommending acceptance does not accept a submission or authorize a payout.

Persist the report and index metadata separately if needed, but never silently coerce invalid output into a successful result. Use a new pipeline version when prompts, models, frame sampling or thresholds materially change.

## State transitions

Allowed status **values** exist in code; the full transition enforcement below is planned backend work.

| Domain | Main path | Exception behavior |
| --- | --- | --- |
| Order | `draft → awaiting_funding → funded → collecting → fulfilled → closed` | Funding failure goes to `funding_failed`; cancelling reserves the unused balance and reaches `refunded` only after an observed refund (refunds deferred). |
| Submission | `uploading → queued → analysing → accepted` | Analysis may lead to `needs_review`, `needs_correction` or `rejected`; corrected uploads create a new source/version rather than overwrite accepted evidence. |
| Funding (`fundingStatuses`) | `awaiting_payment → verification_pending → settlement_pending → confirmed` | `failed` needs concrete evidence; an unknown outcome stays `settlement_pending` or moves to `reconciliation_required`. A timeout is never `failed`. |
| Payout (`payoutStatuses`) | `proposed → approved → submitted → pending → confirmed → finalized` | Uncertain transport enters `reconciling`; `failed` needs evidence that the transaction cannot land; `cancelled` only before submission. There is no `expired` state. The legacy combined `paymentStatuses` is deprecated. |

Status strings are not a queue or a security policy. Every transition needs an actor, expected prior version, immutable event ID and audit reason. Store meaningful timestamps and chain facts separately. Confirmation and finalization are different observations; configure the posting/finality policy deliberately and handle later inconsistencies explicitly.

## Planned endpoints

Only web `GET /api/health` and the Convex scaffold health query exist today. Names here are integration targets and may be refined jointly before implementation.

| Target | Actor | Request / invariant |
| --- | --- | --- |
| `orders.create` | Buyer member | Task version, quota, exact price; create an unfunded order. |
| `POST /api/orders/{id}/fund` | Buyer / paying agent | Validate order and bounded x402 quote; stage funding intent; grant no work before observed settlement. |
| `submissions.beginUpload` | Contributor | Check consent, task and media limits; scoped upload workflow. |
| `submissions.finalizeUpload` | Contributor | Expected storage asset, source hash and task; atomically enqueue analysis once. |
| Analysis action (Convex) | System | Two Gemini calls; validate the canonical report; reject a mismatched source hash; duplicate hash routes to review. (Worker claim/heartbeat/completion routes are deferred.) |
| `reviews.decide` | Authorized reviewer | Evidence and immutable rubric; atomic remaining-budget check. |
| Delivery publication | Buyer-authorized backend | Publish actual licensed manifest; attach recognition event. |
| `payments.propose/approve` | Agent / independent controller | Known payables, recipient, amount, policy version, approval expiry. The proposer can never approve. |
| Payment execute/reconcile | Controller wallet or Wallet MCP `send`; payment route | Approved intent only; immutable attempts; unique `(network, txHash, logIndex)` observations. |

Demo auth uses seeded identities whose memberships are checked by the backend. The deferred worker/payment HMAC gateway specification is in [security](security.md); it is not implemented.

## JSON money boundary

All monetary API fields use integer micro-USDC strings, for example `"7500000"` for 7.5 USDC. Convert to `bigint` with `parseAtomicUsdc` (canonical unsigned integer string, Int64 bound). `parseUsdc` reads decimal dollars and must not be used on atomic strings. Convex stores signed Int64; every individual amount must fit. The ledger rejects decimals exceeding six places and does not round. Do not serialize `bigint` with default `JSON.stringify`, cast it to `number`, or accept caller-calculated prices without a server-owned quote.

## Delivery manifest target

A buyer-visible manifest should include order ID, task version, submission ID, source hash, permitted license version, consent reference, verification report ID, decision ID, delivery timestamp and controlled asset reference. Keep secrets and private contributor identity out. The license and disclosure text still need product approval before real contributor collection.
