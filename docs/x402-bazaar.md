# Skarl paid evidence on x402 Bazaar

Updated October 25, 2026. Base Sepolia test funds only. The implementation and simulated tests are not evidence of a live sale or a Bazaar listing.

## Resource and access policy

`GET /api/samples/sample-<submissionId>/evidence` charges exactly **250000 micro-USDC (0.25 USDC)** to `SKARL_TREASURY_ADDRESS`, using the canonical Base Sepolia network and USDC contract in `packages/contracts/src/chain.ts`. A valid, available sample returns HTTP 402 to a probe with no login, identity header or payment. Invalid/unavailable samples return 404 without a payment challenge.

Only accepted, delivered submissions with an intact licensed manifest, verified original media, `demo-consent-v1` consent, and matching completed inference report are eligible. Rejected, unreviewed, verification-only, evaluation, scaffold, incomplete, missing or quarantined samples are excluded. Completion alone does not authorize sale. Consent here is the existing displayed demo contribution license; this is not a claim of production resale rights beyond those terms.

The successful JSON response contains `sampleId`, the stored `report`, `media: {url, expiresAt, mimeType}`, `settlement: {status: "confirmed", txHash, facilitator}`, and `accountingTreatment: "funding_like_inflow"`. Money is never a JSON float. The media URL is a five-minute HMAC grant bound to the sample and report/license manifest. Its endpoint rechecks eligibility and streams bytes without exposing or redirecting to the underlying Convex storage URL. It is a bearer grant: keep it private. Expiry prevents new gateway requests; it cannot revoke bytes already downloaded.

HTTP 202 means an attempt needs reconciliation and contains no report/media. A signature, facilitator success or timeout alone does not mark the journal confirmed. Paid delivery follows two-confirmation receipt observation with matching USDC `Transfer` and `AuthorizationUsed` logs.

## Deployment handoff

The payment owner implements the backend handlers in `packages/payments/src/evidence-store.ts` to stay inside the assigned ownership boundary. The backend owner must expose them through this tiny `convex/evidenceSales.ts` entrypoint and deploy merged `origin/main`:

```ts
export { sample, claim, sale, confirm } from "../packages/payments/src/evidence-store";
```

No schema changes are required. Until that entrypoint is deployed, the HTTP route fails closed. The handlers use the existing private payment-service secret; neither buyers nor browsers receive it. The deployment needs `NEXT_PUBLIC_CONVEX_URL`, `SKARL_PAYMENTS_SERVICE_SECRET`, `SKARL_TREASURY_ADDRESS`, `CDP_API_KEY_ID`, and `CDP_API_KEY_SECRET`. The CDP wallet secret belongs only in the buyer process.

The SDK pins are `@coinbase/cdp-sdk` 1.60.0 and `@x402/*` 2.28.0. Both paid routes use `createCdpFacilitatorClient` when both API credentials exist. No credentials selects the public x402.org facilitator; partial credentials refuse service, and a CDP error never falls back. `X-Skarl-Facilitator` identifies configuration; settlement response fields and structured logs identify the provider that actually reported settlement.

## Discover and buy

With Coinbase Wallet MCP connected, use `search_x402_services` to search for Skarl accepted sample evidence and inspect the returned resource URL and price. Follow the connected server's current tool schema for search arguments. If search finds nothing, this is not evidence of indexing: use the published sample URL to inspect the 402 directly. The funding route requires buyer identity and is not the listed resource.

Invoke `initiate_x402_request` with the discovered HTTPS URL, `method: "GET"`, and `maxPayment: "0.250000"`. The human approves the request in Coinbase Wallet on Base Sepolia. Call `complete_x402_request` with its returned `requestId` once approved. Preserve the returned payment receipt and read the result; do not initiate a second payment after a timeout. Wallet MCP is an approval flow, not unattended wallet authority. The separate public Bazaar MCP server exposes `search_resources`; it is a different tool interface. [Coinbase MCP discovery guide](https://docs.cdp.coinbase.com/x402/buyer/mcp-payments)

For the CDP-managed buyer, privately load credentials and the approved treasury, then run:

```sh
set -a
. "$HOME/.config/skarl/cdp.env"
set +a
export SKARL_APP_URL='https://YOUR_PRODUCTION_HOST'
export SKARL_TREASURY_ADDRESS='YOUR_APPROVED_TREASURY'
pnpm agent:buy-evidence sample-YOUR_ACCEPTED_SUBMISSION_ID
# Separately, funding a stored collection order:
pnpm agent:fund --cdp YOUR_AWAITING_FUNDING_ORDER_ID
```

The buyer probes and validates the per-resource Bazaar declaration before paying. This direct discovery works before catalog indexing and does not assert the resource was found in the CDP catalog. It independently restricts treasury, network, token and amount and persists attempts/spend reservations under `~/.config/skarl/`. A successful evidence response is saved there with mode 600, rather than printing the report or media grant. The buyer validates the canonical report schema, report/sample binding, completed inference, confirmed transaction and expected same-origin media path/expiry.

## Validate and prove discovery

The route declares factual input/output metadata through `declareDiscoveryExtension` and registers `bazaarResourceServerExtension`. Its concrete GET route has no query inputs; each URL embeds a `sample-` prefix. The declaration's example is **illustrative only**: its empty report, zero transaction hash and example.invalid media URL are not real evidence. The real response contains a validated stored report and real settlement hash.

Run validation against an available accepted sample after the production deployment is published:

```sh
pnpm agent:validate-evidence sample-YOUR_ACCEPTED_SUBMISSION_ID
# Or directly:
curl -X POST https://api.cdp.coinbase.com/platform/v2/x402/validate \
  -H 'Content-Type: application/json' \
  -d '{"resource":"https://YOUR_PRODUCTION_HOST/api/samples/sample-YOUR_ACCEPTED_SUBMISSION_ID/evidence","method":"GET"}'
```

Without `SKARL_APP_URL`, the validation command polls `docs/status.md` for a `Production URL` line for up to 45 minutes. It makes no payment and requires no API key. Preserve the actual API response, especially `valid`, `preflight`, `bazaarExtension`, and `simulation.outcome`. The API's `simulation` is validator output, not a live chain transaction.

A successful paid CDP call triggers discovery. Capture and base64-decode `EXTENSION-RESPONSES`: `bazaar.status` is `success`, `processing`, or `rejected` (with `rejectedReason`). Missing metadata or `processing` is not a proven listing. Indexing can take up to 15 minutes. Testnet is supported; x402.org has a separate catalog. Validation does not guarantee content-policy acceptance. [CDP Bazaar documentation](https://docs.cdp.coinbase.com/x402/seller/get-discovered)

The implementation explicitly forwards `result.extensionResponses` because the pinned Next middleware otherwise omits that header. Discovery schemas and example presence are covered by actual middleware tests with simulated facilitator responses.

## Settlement, reconciliation and accounting limits

The durable business intent is an immutable `evidence_sale_claimed` audit record linked to a standalone `paymentAttempts` row. It binds sample/report/license, payer, treasury, nonce, amount and selected facilitator. The nonce index is shared with order funding: replay cannot settle twice or reuse funding authorization for an evidence sale. Claim errors explicitly abort settlement, since x402 logs and ignores thrown pre-settlement-hook errors.

The transaction hash is persisted before RPC polling. `evidenceSales:confirm` validates the observation and posts the existing balanced funding journal once, deduplicated by `(network, txHash, logIndex)` and business event. It never changes the original order status, accepted count or contributor payable. Confirmation records real cash even if the sample is quarantined after settlement; content access still fails closed.

**Accounting gap:** no standalone evidence-sale revenue kind exists. This inflow debits USDC cash and credits customer prepayments; no evidence revenue is recognized. The current order reconciliation excludes standalone sale attempts and flags the extra journal, and cancellation refuses the changed prepayment balance rather than refunding these proceeds to the original buyer. The backend owner must add tested sale accounting and reconciliation before treating evidence sales as finalized revenue or using that order's cancellation flow.

If the response is lost, do not pay again. The buyer's private attempt contains the signed authorization/nonce and any reported hash. An operator can use service-authenticated `evidenceSales:sale` to recover the saved terms, locate the original nonce transaction, verify it using the existing receipt observer, record it with `payments:recordTransaction`, and call `evidenceSales:confirm`. Public replay does not release evidence based on a nonce visible onchain. Automatic paid-content redelivery after a lost response and sale-specific refund execution are not implemented.

## Evidence recorded by this change

- Public x402.org `/supported` read: V2 exact, upto and batch-settlement on Base Sepolia; builder-code and gas-sponsoring extensions. This is a live capability response, not payment evidence.
- Route, privacy, durable claim, ledger, SDK spend-control and timeout tests use simulated external services and synthetic data.
- Live validator call to the published `https://skarl.vercel.app` deployment on October 25 returned HTTP 200 with `valid:false`, `statusCode:404`, `simulation.outcome:"rejected"`, and `rejectionReason:"endpoint failed preflight checks"`; the evidence route was not deployed yet. No successful validation is claimed.
- A live read of the default v2 order found one `needs_review`, verification-only submission with no delivery, so there is no eligible sample to sell on that order. The gate was not weakened to charge for it.
- CDP-paid transaction, successful deployed validation, `EXTENSION-RESPONSES` and catalog search evidence remain pending. The private CDP credential file was absent at this check.
