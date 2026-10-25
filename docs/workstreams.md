# Workstreams and Ownership

Proposed assignments for the four-person team. Each person can build independently against shared contracts, then pair at the listed boundaries. These assignments are a handoff plan, not a claim that anyone has accepted it.

## Stephen — Web and integration

**Own:** `apps/web`, `packages/contracts`, root tooling and integration docs. Suggested branch: `stephen/web-integration`.

1. Build the buyer's fixed task, order funding status and delivered-manifest view.
2. Build authenticated contributor consent, camera/microphone preview, recording, private upload and timestamped feedback.
3. Build operator evidence, payable and reconciliation views using Convex live queries. Never show unconfirmed payouts as paid.
4. Integrate typed backend/worker reports without making financial decisions in the browser.

**Done when:** the chosen clip goes from upload to report to decision in the UI; a user without membership cannot see private media; blocked/unavailable states are visible. Browser permission failure and unsupported codec have useful recovery. Financial amounts are formatted from micro-units.

**Dependencies:** Silas's auth/query/upload functions, Matthew's canonical report, qtzx06's funding result and account projections. Until ready, show unavailable states; fixture mode must be explicitly labeled.

## MatthewKim323 — Multimodal verifier

**Own:** `services/verifier`, `evals`, `fixtures`, `docs/ai-verification.md`, `docs/evaluation.md`. Suggested branch: `matthew/multimodal-verifier`.

1. Capture a small consented fixed-task dataset with distinct recording sessions and labeled event times.
2. Decode/hash media; preserve source time mapping; extract silent visual evidence with Gemini, independent faster-whisper word times and SSCD frame/copy alignment.
3. Produce schema-valid reports with grounded criteria and copy status. Retry bounded transient model errors and fail to review when unavailable.
4. Integrate signed worker requests, claim/renew leases and reject stale completion locally before submission.
5. Run a raw audiovisual-model baseline versus the independent-trace pipeline. Report counts and failures; use no fabricated accuracy.

**Done when:** a correct clip is supported, missing action is localized, narration mismatch is flagged, transformed re-upload is detected, and a fresh valid retake is not rejected merely for similarity. A worker/model failure cannot recommend acceptance.

**Dependencies:** canonical schema from Stephen; fenced job gateway and private asset access from Silas. No treasury access or journal writes.

## silaswu4 — Convex, auth, jobs and media

**Own:** `convex`, `convex.json`, `docs/backend.md`, `docs/deployment.md`, `docs/security.md`. Suggested branch: `silas/convex-backend`.

1. Configure a team-owned Convex dev deployment and Auth0 JWT integration; add organization memberships and role checks to every boundary.
2. Implement task/order and scoped private media flows, submission finalization and indexed idempotent event writes.
3. Implement leased AI jobs and a purpose-limited HMAC worker gateway with replay/fencing checks.
4. Implement review/delivery transactions plus outbox commands and immutable audit/journal persistence.
5. Provide live queries for progress, evidence, payables and account projections.

**Done when:** two concurrent acceptances cannot exceed quota, acceptance racing cancellation cannot spend refunded budget, duplicate worker completion does not duplicate fulfillment, an expired worker cannot overwrite a newer report and cross-organization access is rejected.

**Dependencies:** report schema and domain decisions from Stephen; exact journal builders and intent contract from qtzx06. Do not invoke blockchain or models inside a database mutation.

## qtzx06 — Solana/x402 and finance

**Own:** `packages/payments`, `packages/ledger`, `docs/payments-solana.md`, `docs/accounting.md`, `docs/sponsor-tracks.md`. Payment Node routes touch Stephen's folder; coordinate a narrow handoff or shared integration PR. Suggested branch: `qtzx/solana-finance`.

1. Implement Devnet x402 V2 `exact` funding with validated server quotes, runtime facilitator support check and post-settlement reconciliation.
2. Implement approved contributor payouts/refunds using SPL checked transfers, correct ATAs, durable attempts and signature/blockhash lifetime tracking.
3. Connect pure journal helpers to Convex atomic events and financial projections.
4. Implement [allowlisted finance-agent tools](finance-agent.md) for explanation, proposal and policy checks; approvals/signing remain in deterministic control paths.
5. Build a synthetic finance scenario set and a prior-period/current-period report. Confirm the Coinbase MCP eligibility question at the sponsor booth without switching off Solana.

**Done when:** confirmed funding, one delivery, contributor payout and unused-balance refund reconcile; duplicate events, unknown transfer results, insufficient quota, wrong mint/recipient, excessive amount and self-approved exceptions are handled safely.

**Dependencies:** Silas's durable intent/outbox/gateway; Stephen's paid endpoint and UI. Never share signer credentials with the verifier or browser. The current adapter explicitly cannot submit transactions.

## Integration order

1. **Contract freeze:** agree fixed task, report v1, money representation and event identities. Current code supplies a starting contract; rubric membership validation remains backend work.
2. **Local vertical slice:** consented fixture → verifier report → authorized review → delivery event → pure journal projection. Label fixture paths clearly.
3. **Live persistence:** wire auth, private upload, fenced worker gateway and real report publication. Verify real concurrent/race cases before adding finance execution.
4. **Devnet finance:** implement funding, payout and refund one by one; reconcile each before adding retries or an agent UI.
5. **Judge rehearsal:** one good clip plus one deceptive narration or copied clip, then an injected finance exception. Complete the evidence checklist in [demo](demo.md).

Given the remaining hackathon window, favor one complete loop. If the verifier lacks grounded evidence, freeze finance UI expansion. If settlement is not proven, label a deterministic simulation rather than display a fake signature. Optional sponsor embellishments come only after the core path.

## Shared change protocol

Pull `main`, work in the assigned folder and make small reviewable PRs. Schema changes require a matching JSON Schema, Python-model update, examples and both-language tests. Tell the affected owner before changing contract semantics. Do not commit `.env` files, wallet keys, raw contributor media, generated Convex code or large model weights. Pin downloaded model identity/checksum in deployment configuration when introduced.
