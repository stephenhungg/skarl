# Consent and Sample Provenance

Implementation handoff, October 25, 2026. These are stored records and derived
signals, not a legal opinion or proof that a contributor owns every depicted
right. Demo identities remain public, impersonable selectors.

## Query and Export Contract

`provenance.forSubmission({ demoIdentity, submissionId })` authorizes the order's
buyer, a controller in the same organization, or the owning contributor. The
finance agent is excluded. Cross-linked consent references fail closed; missing
evidence remains explicitly missing.

Dataset integration uses the same helper after its existing access checks:

```ts
import { buildProvenance } from "./lib/provenance";

// Inside the authorized per-sample export projection:
const provenance = await buildProvenance(ctx, submission);
// Include { ...sample, provenance } in JSON/JSONL exports.
```

The shape is `skarl.provenance.v1`; timestamps are Unix milliseconds and missing
facts are `null`. No new verification-report fields or model prompts are needed.

| Field | Witness and meaning |
| --- | --- |
| `consentRecordId` | Linked consent record, checked against submission, tenant and contributor |
| `licenseVersion`, `licenseScope`, `consentTimestamp` | Stored terms and acknowledgement time; `consentEvidence` is `stored_acknowledgement` or `missing`, not a claim of a legal signature |
| `contributorPseudonymousId` | SHA-256 over a versioned domain, tenant and internal identity token; never the token, name, wallet or email |
| `sourceSha256`, `sourceHashBasis` | Hash only when the linked original is server-verified and agrees with the submission; otherwise `null` / `unavailable`; a client expectation is insufficient |
| `eas` | Current report's confirmed attestation UID and EASScan/BaseScan links only when report and source hashes agree; otherwise `unavailable` |
| `liveness` | Derived spoken-word match using the existing challenge, transcript and segment timestamps; unavailable evidence is `not_checked`, never an invented pass |
| `revocation` | `not_requested`, `requested`, `revoked` or `consent_missing`, with recorded request/revocation times; absence of a request is not proof of irrevocability |
| `privacyReview`, `privacyEvidence` | `needs_review` only for a face/person/bystander mention in a stored visual description, with segment times and `stored_visual_description_heuristic` basis; otherwise `not_checked` |

The privacy heuristic can flag even a negated mention. It is deliberately a
review trigger, not a face detector, a bystander identity check, or proof that no
faces appear. Narration does not supply privacy clearance. No extra Gemini call
is made. Liveness is also an evidence heuristic, not proof of identity or rights.
The pseudonym is stable within a tenant and permits linkage; hashing is not
anonymization, particularly for guessable demo identities.

## Revocation Requests

`consent.requestRevocation({ demoIdentity, submissionId, reason })` is restricted
to the owning contributor. A nonempty, trimmed reason of at most 1,000 characters
creates optional fields on the existing consent record and one audit event.
Retries return the first request without replacing its reason or timestamp.
Buyer-facing provenance omits the reason because free text can contain personal
information. Existing records without the optional fields remain valid.

Controllers use `consent.revocationRequests({ demoIdentity, orderId? })` for a
tenant-scoped, newest-first inbox. The contributor earnings page exposes a
request form and the recorded status. `requested` is not a completed revocation,
confirmed deletion, automatic EAS revocation or recall of downloaded copies.
There is no public mutation to declare revocation completed: investigation and
downstream enforcement are still operator work.

First acceptance is refused while consent is requested/revoked. Existing
fulfillment replays and accrued contributor obligations remain intact. A request
must not quietly erase compensation already earned.

**Dataset integration:** `datasets.ts` attaches this provenance shape to every
licensed exported sample across JSON, JSONL, LeRobot and RLDS-style manifests.
It evaluates analysis witnesses against the delivery's accepted snapshot, while
consent and revocation remain current. Requested/revoked consent excludes the
sample from fresh manifests and blocks previously issued media grants at serving
time. Existing downloaded copies cannot be recalled by changing this field.
These are source implementations pending the deployment owner's deployment;
synthetic tests verify export and grant refusal, not live recall or deletion.

## Payment History and Contributor Receipts

Revocation never deletes or rewrites journals, payables, payment attempts or
chain observations. Those records witness what was earned, owed and paid, and
are needed for reconciliation and disputes. Any financial correction needs an
explicit linked accounting event; deleting history would hide obligations and
break the audit trail. This is a record-integrity rule, not a blanket exemption
from privacy obligations or a production retention policy.

The earnings page consumes `datasets.contributorEarnings`,
`submissions.getReport`, `coachData.forSubmission` and the opt-in
`coach.explainOutcome` action. The report query adds `submittedAt`,
`analysisCompletedAt` and a bounded current `decision` projection so evidence
times and a controller's reason remain distinguishable. Coach text is advisory.

**Timing handoff:** the dataset owner can add `acceptedAt` to each earnings row
and `confirmedAt` to its verified `payout` projection (the matched chain
observation's `observedAt`). Only a `paid` result with both valid timestamps
produces a time-to-payout measurement. It measures acceptance to observed
reconciliation, not the block timestamp. Missing timestamps show timing
unavailable; approval/broadcast never counts as paid. No completed payout or
payout-speed claim follows from local synthetic tests.

## Deployment

Deploy the optional consent fields/index, the new `consent` and `provenance`
functions, and the updated `finance` / `submissions` functions through the usual
Convex release. Then release the web earnings page and controller inbox. No
backfill or new environment variable is required. No Convex deployment is run
by this workstream. The helper can be adopted independently by the dataset owner.
