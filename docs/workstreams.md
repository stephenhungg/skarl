# Workstreams and Ownership

Assignments requested by Stephen: Matthew owns the web dashboard, Silas owns UI, Stephen owns the backend, and qtzx06 owns onchain. Backend includes multimodal verification, financial business logic and accounting so those responsibilities remain covered. Each person builds against shared contracts and pairs at the boundaries below.

## MatthewKim323 — Web dashboard

**Own:** `apps/web/app/dashboard/**` and `apps/web/features/dashboard/**`. These are planned dashboard folders; no dashboard route is implemented yet. Suggested branch: `matthew/web-dashboard`.

1. Build buyer and operator dashboard pages: task/order creation, funding progress, submission queue, review details and delivered manifests.
2. Build finance views for outstanding payables, refunds, balances, payment attempts and reconciliation exceptions. Render backend projections; do not calculate authoritative balances in the browser.
3. Wire dashboard queries/actions to Stephen's Convex contracts and qtzx06's payment status. Show unavailable, loading, empty, pending and error states explicitly.
4. Build timestamp-linked evidence review using the verifier report. Never show unconfirmed payouts as paid or make acceptance decisions solely in client code.

**Done when:** the dashboard can follow an order from funding through submission review, delivery and settlement status; live updates and failure states are visible; displayed financial amounts are formatted from exact micro-units.

**Dependencies:** Stephen supplies authenticated queries, mutations, evidence and financial projections; Silas supplies shared components and visual patterns; qtzx06 supplies wallet/payment integration contracts. Request changes to shared components from Silas instead of maintaining a second UI kit.

## silaswu4 — UI and contributor experience

**Own:** `apps/web/components/**`, `apps/web/features/contributor/**`, contributor routes under `apps/web/app/contribute/**`, and the root web `layout.tsx`, `page.tsx` and `globals.css`. These feature folders/routes are implementation targets. Suggested branch: `silas/ui`.

1. Establish the shared visual system, responsive app shell, navigation, inputs, buttons, dialogs, status badges and accessible loading/error patterns.
2. Build the contributor task/consent screens, camera and microphone preview, recording controls, private-upload experience and timestamped correction feedback.
3. Handle browser permission denial, unsupported recording codecs, upload progress and retry states. Keep original-media access behind Stephen's authorized backend.
4. Supply reusable evidence, amount and payment-status components for Matthew's dashboard. Coordinate wallet UI with qtzx06's adapter; do not put signing secrets in UI code.

**Done when:** the contributor flow is usable on the demo device, recording and upload states are clear, the layout works on mobile and desktop, and the dashboard can reuse the same components without duplicated styles.

**Dependencies:** Stephen supplies auth/session, consent, upload and submission endpoints; Matthew provides dashboard component needs; qtzx06 provides wallet connection/signing interfaces. Matthew owns dashboard page composition and data wiring; Silas owns shared presentation and contributor page composition.

## Stephen — Backend, AI and finance logic

**Own:** `convex/**`, `convex.json`, `services/verifier/**`, `evals/**`, `fixtures/**`, `packages/contracts/**`, `packages/ledger/**`, non-payment API routes, root tooling and backend/AI/accounting/integration docs. Suggested branch: `stephen/backend`.

1. Configure Convex and Auth0, trusted organization memberships and role checks; implement task/order, consent, private media and submission APIs.
2. Implement fenced analysis jobs and the purpose-limited worker gateway. Build the multimodal pipeline: silent visual evidence, independent speech transcription, temporal copy checks and schema-validated reports.
3. Implement atomic review, delivery, budget allocation, payable creation, journal persistence and payment-command/outbox records. Acceptance racing cancellation must never spend the same budget twice.
4. Build the [bounded finance-agent tools](finance-agent.md), policy and independent approval workflow, deterministic financial projections and prior/current-period reports.
5. Supply typed frontend contracts and integration fixtures to Matthew/Silas. Evaluate model evidence and financial invariants with consented recordings and synthetic finance scenarios; report actual results.

**Done when:** authenticated clients can complete the order/submission/review/delivery loop; stale worker completions, cross-organization access, duplicate financial events and overspending are rejected; evidence and balanced journals are traceable. The verifier cannot approve payments, and the finance agent cannot approve its own proposals.

**Dependencies:** Matthew and Silas consume the backend interfaces and surface real errors; qtzx06 executes approved onchain intents and returns independently checked settlement facts. Stephen owns accounting and financial policy; qtzx06 owns chain execution and observation. Network inference and RPC calls stay outside database mutations.

## qtzx06 — Onchain and Solana/x402

**Own:** `packages/payments/**`, `apps/web/lib/solana/**`, payment routes such as `apps/web/app/api/orders/[id]/fund/**`, and `docs/payments-solana.md`. Coordinate any additional payout/refund API path with Stephen before adding it. Suggested branch: `qtzx/solana-onchain`.

1. Implement Solana Devnet wallet integration and x402 V2 `exact` funding with server-owned quotes, facilitator support checks and post-settlement confirmation.
2. Implement approved contributor payouts/refunds using checked SPL transfers, correct associated token accounts, native SOL fee/rent handling and isolated signing boundaries.
3. Persist transaction attempts through Stephen's backend before submission; retain signatures, blockhash lifetime and confirmation/finality observations. Reconcile an uncertain attempt before replacing it.
4. Verify expected network, mint, token-account owners, recipient, amount and transfer identity, then report observed facts to the backend. Do not post ledger entries or grant approval authority from the chain adapter.
5. Provide Matthew/Silas with typed wallet actions, payment status and explorer links. Verify the Coinbase MCP eligibility question without switching Skarl off Solana.

**Done when:** funding, one contributor payout and the unused-balance refund are observed on Solana Devnet; replay, lost responses, wrong mint/recipient, expired transaction validity and missing token accounts have explicit handling. No unapproved transfer can execute.

**Dependencies:** Stephen supplies durable intents, approval/policy checks, service gateway and accounting; Matthew/Silas provide the dashboard and wallet presentation. Wallet connection/signing mechanics belong here; shared wallet presentation belongs to Silas. Never expose signer credentials to the verifier or browser UI. The current payment adapter remains explicitly unimplemented.

## Folder boundaries and handoffs

- Matthew owns dashboard routes, dashboard-specific components and dashboard data wiring. Silas owns reusable components, the global shell and contributor UI. Both can work inside `apps/web` without editing the same feature folders.
- Stephen owns server business rules, AI processing, shared schemas, finance-agent behavior and ledger persistence. UI code consumes these APIs; it does not duplicate their authority.
- qtzx06 owns wallet adapters and payment route internals. Coordinate changes to the shared shell with Silas, payment screens with Matthew and intent/approval contracts with Stephen.
- Coordinate root dependencies and configuration with Stephen. Shared-schema changes require matching JSON Schema, Python models, examples and cross-language checks.

## Integration order

1. **Contract freeze:** agree fixed task, report v1, money representation and event identities. Current code supplies a starting contract; rubric membership validation remains backend work.
2. **Local vertical slice:** consented fixture → verifier report → authorized review → delivery event → pure journal projection. Label fixture paths clearly.
3. **Live persistence:** wire auth, private upload, fenced worker gateway and real report publication. Verify real concurrent/race cases before adding finance execution.
4. **Devnet finance:** implement funding, payout and refund one by one; reconcile each before adding retries or an agent UI.
5. **Judge rehearsal:** one good clip plus one deceptive narration or copied clip, then an injected finance exception. Complete the evidence checklist in [demo](demo.md).

Given the remaining hackathon window, favor one complete loop. If the verifier lacks grounded evidence, freeze finance UI expansion. If settlement is not proven, label a deterministic simulation rather than display a fake signature. Optional sponsor embellishments come only after the core path.

## Shared change protocol

Pull `main`, work in the assigned folder and make small reviewable PRs. Schema changes require a matching JSON Schema, Python-model update, examples and both-language tests. Tell the affected owner before changing contract semantics. Do not commit `.env` files, wallet keys, raw contributor media, generated Convex code or large model weights. Pin downloaded model identity/checksum in deployment configuration when introduced.
