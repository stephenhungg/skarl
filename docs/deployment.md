# Local Validation and Deployment Plan

## What exists now

The Task 1 demo finance backend is deployed at **https://keen-marmot-986.convex.cloud**
with seeded identities/order/rubric, role-checked financial mutations and live
queries. See [setup](setup.md) and the [callable API](backend.md#task-1-client-contract).
The web remains a scaffold. Production authentication, uploads/private file
routes, Gemini inference, funding confirmation, wallet execution and chain
reconciliation remain unimplemented. No Vercel, CDP or Gemini resource was
provisioned by Task 1.

The demo deployment target is **Next.js on Vercel (HTTPS) + Convex**, with Gemini
called from a Convex action. The Railway Python worker is deferred. Only Base
Sepolia and the canonical USDC address in `packages/contracts/src/chain.ts` are in
scope. Do not call a local dashboard
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
| Demo identities | Seed script for buyer/contributor/controller/agent memberships (no external identity provider) |
| Vercel | HTTPS web deployment (camera access needs a secure origin) |
| Gemini | API key in Convex environment variables; model ID configurable |
| CDP | API key (portal.cdp.coinbase.com) for the x402 facilitator, server-side only |
| Base Sepolia | Controller Coinbase Wallet, buyer wallet, test USDC and Sepolia ETH for gas |
| Coinbase Wallet MCP | Connected to the agent client (`https://wallet-mcp.coinbase.com`), approved in Coinbase Wallet |
| Railway | Deferred (Python worker) |

Use the root environment example for canonical variable names when present.
Configure the public Convex URL in the web app, keep worker/payment credentials
server-side, and keep identity/credential material out of Git. No fake default
gateway secret should make a missing configuration appear functional.

## Convex setup after configuration

Run `corepack pnpm convex:dev` only when ready to connect to or create the
intended development deployment. It can authenticate, provision/sync deployment
state, and regenerate the committed `_generated` files; it is not an offline typecheck.
Teammates can typecheck using the committed files without provisioning a deployment.

After configuration, the following is a useful narrow read-back:

```sh
corepack pnpm exec convex run health:status
```

Expected backend health is `stage: "demo_backend"` with financial mutations implemented,
`demoIdentityOnly: true`, and inference/worker gateway/live payments false. It does not exercise
application data, authentication, or money movement.

Identity for the demo is seeded demo users with server-side role checks (see
[security](security.md)); Auth0 is not used. Never grant controller permission
from a user-selected role field.

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
6. Prove Gemini accepts the recorded file and that evidence timestamps refer
   to the source video. Recorder chunk timing is not a reliable media clock.

Convex generated upload URLs expire after one hour; upload POST requests have a
two-minute timeout. Authenticated HTTP file responses have a 100 MiB cap. Our
initial 30-second/720p/25 MB application limit keeps the demo bounded.
If a custom HTTP upload route is later added, explicitly configure CORS and use
binary bodies; multipart bodies have additional limits.

## Hosting and process model

**Deferred:** a Railway-hosted persistent Python pull worker. For the demo, Vercel
hosts Next.js and Convex actions call Gemini; Convex remains the only
authoritative database/file backend. If the worker is revived: Keep the Python process separate from request
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

## Payment and sponsor gates

- Confirm the runtime chain ID and token address against `packages/contracts/src/chain.ts`.
- Fund test wallets with Base Sepolia USDC and Sepolia ETH for gas.
- Verify one x402 funding transaction independently before connecting it to order
  publication. The route handler must not declare funding before settlement.
- Verify one controller-approved payout by `(txHash, logIndex)`: token, `from`,
  `to`, `value` and receipt status.
- Test a timeout/reload without charging or paying twice.
- Keep customer originals and identity records offchain.
- Confirm every member's Coinbase prize eligibility ([checklist](sponsor-tracks.md#team-eligibility-checklist)).

## Release evidence required

A future working demo should provide a first-party build, a working camera
capture, an actual inference report, a role-separated acceptance/approval flow,
verified Base Sepolia funding and payout transactions, balanced journals, and restart
recovery evidence. Document what remains simulated. Run the root checks and
domain regression tests after changes, then verify actual deployed behavior.

## Primary references

- [Convex project configuration](https://docs.convex.dev/config/convex.json)
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
- [CDP x402 facilitator](https://docs.cdp.coinbase.com/x402/seller/facilitator)
- [Coinbase Wallet MCP](https://docs.cdp.coinbase.com/ai-agents/coinbase-for-agents/wallet-mcp)
