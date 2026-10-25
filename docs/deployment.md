# Local Validation and Deployment Plan

## What exists now

The repository is a development scaffold. The Convex schema and a public scaffold
health query exist; live marketplace APIs, authentication, private file routes,
worker HTTP authentication, payment execution, and operational recovery are not
implemented. No Convex, Railway, Auth0, or GPU resource has been provisioned by
this scaffold.

The deployable target is Next.js + Convex + one Python worker. Only Solana Devnet
and the canonical Devnet USDC mint are in scope. Do not call a local dashboard
or successful TypeScript build a working payment demo.

## Local checks

Use Node 22.18 or a newer 22.x release and the pinned package manager from the
root `package.json` (`pnpm@10.19.0`). From the repository root:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm test
corepack pnpm check:docs
corepack pnpm build
```

Use `pnpm install` without `--frozen-lockfile` only when intentionally updating
dependencies and reviewing the lockfile. These checks validate local source and
document consistency; they do not validate a cloud account, camera permission,
model availability, facilitator, wallet, or onchain transaction.

Run the web scaffold with:

```sh
corepack pnpm dev
```

The worker's exact local commands and inference requirements belong in
`services/verifier/README.md`. A scaffold-mode worker/report must remain labeled
as such. Optional inference dependencies and model weights must be installed
and exercised before claiming live verification.

## Required accounts and configuration

| Component | Required setup |
| --- | --- |
| Convex | Development deployment; URL; file storage; eventual auth configuration and service secrets |
| Auth0 | Application/domain/client ID; callback/logout/web origins; verified identity integration |
| Railway | Project/credit; web and worker service configuration if using this host |
| AI provider | Working model access and quota; worker-only inference key where applicable |
| Solana Devnet | RPC access, buyer/controller wallets, Devnet USDC, native Devnet SOL for fees/account creation |
| x402 | Compatible Solana client/server/facilitator configuration and a verified short purchase flow |

Use the root environment example for canonical variable names when present.
Configure the public Convex URL in the web app, keep worker/payment credentials
server-side, and keep identity/credential material out of Git. No fake default
gateway secret should make a missing configuration appear functional.

## Convex setup after configuration

Run `corepack pnpm convex:dev` only when ready to connect to or create the
intended development deployment. It can authenticate, provision/sync deployment
state, and generate `_generated` files; it is not an offline typecheck. Do not
create hand-written generated files or run it solely to silence an import.

After configuration, the following is a useful narrow read-back:

```sh
corepack pnpm exec convex run health:status
```

Expected health is still `stage: "scaffold"` with financial mutations, worker
gateway, and live payments reported as unimplemented. It does not exercise
application data, authentication, or money movement.

Auth0 setup should follow the official Convex integration rather than assuming
that a generic Auth0 API access token has the right audience. The documented
identity-token path uses the Auth0 domain/client ID in `convex/auth.config.ts`
and `ConvexProviderWithAuth0` in a Next.js client provider. No auth config or
provider is implemented in this scaffold. Server-side Next routes needing user
identity require the corresponding server SDK/token integration as well.

After human identity works, implement trusted membership provisioning and
server-side role checks. Never grant controller permission from a user-selected
role field. Clerk is a supported fallback if already working; there is no reason
to run both providers for the MVP.

## Media path before judging

1. Deploy the web app on HTTPS and test the actual demonstration phone/browser.
   Plain HTTP on a laptop LAN IP is not equivalent to localhost for camera use.
2. Detect supported recording MIME/codec with `MediaRecorder.isTypeSupported()`.
   Persist the actual MIME type; do not assume every browser emits WebM.
3. Record audio/video in one stream and upload one completed bounded clip through
   a native Convex upload URL. Binary media should not pass through Next routes.
4. Implement upload finalization, source-hash verification, and job creation.
5. Implement private downloads with authorization on each request. Convex direct
   download URLs are bearer-accessible and do not automatically expire.
6. Prove FFmpeg can decode the resulting file and that evidence timestamps refer
   to the source video. Recorder chunk timing is not a reliable media clock.

Convex generated upload URLs expire after one hour; upload POST requests have a
two-minute timeout. Authenticated HTTP file responses have a 100 MiB cap. Our
initial 30-second/720p/roughly 20–25 MB application limit keeps the demo bounded.
If a custom HTTP upload route is later added, explicitly configure CORS and use
binary bodies; multipart bodies have additional limits.

## Hosting and process model

One Railway project may host both Next.js and a persistent Python pull worker;
Convex remains the only authoritative database/file backend. A working Vercel
web deployment is also suitable. Keep the Python process separate from request
handlers, install FFmpeg in its image, pin dependencies, and load model weights
before accepting work. Do not keep pending jobs in a Python list.

Use a persisted Convex job/lease lifecycle and narrow authenticated HTTP gateway.
The exact proposed HMAC contract is in [security.md](security.md); it is not
implemented. A worker restart must not lose work or grant stale completion
authority. Expose readiness from actual dependency/model initialization and
record a worker heartbeat in Convex.

Vercel's function payload cap is 4.5 MB, so direct uploads are important there.
Its June 2026 changelog supports durations up to 30 minutes for Pro/Enterprise,
with durations over 800 seconds described as beta/Fluid-dependent; do not rely
on stale blanket ceilings or treat a long timeout as a durable queue.

GPU hosting is optional. Measure the selected pipeline on a real clip first.
If Modal is introduced, persist call IDs/results in Convex and account for cold
starts and idle warm-container costs. No Modal/GPU account or deployment is
included here.

## Solana and sponsor gates

- Confirm the runtime network and mint against the canonical shared constants.
- Fund test wallets with Devnet USDC and native Devnet SOL. Solana token-account
  creation and transaction fees need SOL even when the commercial amount is USDC.
- Verify one x402 funding transaction independently before connecting it to order
  publication. The route handler must not declare funding before settlement.
- Verify one controller-signed payout and refund, including token-account owners,
  mint, amount, instruction identity, success, and commitment.
- Test a timeout/reload without charging or paying twice.
- Keep customer originals and identity records offchain.
- Confirm Coinbase's accepted Solana-compatible agent/MCP path with the sponsor.
  Coinbase Wallet MCP's documented x402 path is Base-only; do not change Skarl
  back to Base or claim eligibility from an SDK-only integration.

## Release evidence required

A future working demo should provide a first-party build, a working camera
capture, an actual inference report, a role-separated acceptance/approval flow,
verified Devnet funding/payout/refund signatures, balanced journals, and restart
recovery evidence. Document what remains simulated. Run the root checks and
domain regression tests after changes, then verify actual deployed behavior.

## Primary references

- [Convex project configuration](https://docs.convex.dev/config/convex.json)
- [Convex Auth0 integration](https://docs.convex.dev/auth/auth0)
- [Convex + Next.js authentication](https://docs.convex.dev/client/nextjs/app-router/)
- [Convex file uploads](https://docs.convex.dev/file-storage/upload-files)
- [Convex private file access](https://docs.convex.dev/file-storage/serve-files)
- [Convex HTTP action limits](https://docs.convex.dev/functions/http-actions)
- [Browser camera requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- [Recording codec support](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static)
- [Recording timestamp caveats](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/dataavailable_event)
- [Railway deployments](https://docs.railway.com/deployments)
- [Vercel function limits](https://vercel.com/docs/functions/limitations)
- [Vercel 30-minute functions announcement](https://vercel.com/changelog/vercel-functions-can-now-run-up-to-30-minutes)
- [Modal jobs](https://modal.com/docs/guide/job-queue)
- [Solana x402 integration](https://solana.com/docs/payments/agentic-payments/x402)
- [Coinbase Wallet MCP](https://docs.cdp.coinbase.com/ai-agents/coinbase-for-agents/wallet-mcp)
