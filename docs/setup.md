# Local Setup

## Public demo

The production URL and observed checks are in [status](status.md); Vercel settings
and secret import commands are in [deployment](deployment.md). Agent users can
load the [Wallet MCP plugin](wallet-mcp-plugin/skarl.md). Production hosting does
not replace the demo identity selectors with real authentication.

## JavaScript

Use Node **22.18+ on the Node 22 line** (the repository pins 22.21.1) and pnpm 10.19.0. Node's built-in TypeScript stripping runs the package tests; avoid TypeScript syntax that requires runtime transformation.

```sh
nvm use
corepack prepare pnpm@10.19.0 --activate
pnpm install
pnpm dev
```

Open `http://localhost:3000`; inspect `http://localhost:3000/api/health`. The server should explicitly report scaffold capabilities with payments and inference disabled. No environment file is needed to boot it.

```sh
pnpm typecheck
pnpm test
pnpm check:docs
pnpm build
# Or the complete checks, including convex-test and payment route tests:
pnpm check
```

The lockfile pins JavaScript dependencies. CI uses frozen installs. The initial web app has no external fonts, analytics, wallet SDK or model client. `pnpm build` should not require API secrets.

## Python verifier

Use Python 3.11 for the reference environment. A local virtual environment avoids modifying system Python.

```sh
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -e './services/verifier[dev]'
python -m pytest services/verifier/tests
python -m unittest discover -s evals/tests
python -m skarl_verifier --help
```

See [the verifier README](../services/verifier/README.md) for exact report-validation/scaffold commands and optional ML extras. Core tests require no GPU, model download, network calls or private videos. They validate contracts and failure behavior, not inference quality.

The demo calls Gemini from a Node Convex action and uses external `ffmpeg-static` for media isolation/fingerprints, so no Python inference stack is needed tonight. Python model weights and ASR/copy-model extras belong to the deferred worker. Do not install large GPU packages merely to make a placeholder worker start. Production Python dependencies should be locked once the live adapter and target hardware are chosen; the core editable scaffold install is not a reproducible ML deployment.

## Shared Convex dev deployment

The Task 1 backend is deployed and seeded at:

```dotenv
CONVEX_URL=https://keen-marmot-986.convex.cloud
NEXT_PUBLIC_CONVEX_URL=https://keen-marmot-986.convex.cloud
```

Put these values in your own ignored `.env.local` (`apps/web/.env.local` for
Next.js). The URL is public configuration, not a secret. Use `CONVEX_URL` in
server clients and `NEXT_PUBLIC_CONVEX_URL` in the browser provider. No deploy key
is needed to call public APIs; deploying requires team/project access.

`convex/_generated` is committed so a teammate can install and typecheck without
running codegen or creating another project. Import `api` from its generated API
module. Use `dashboard.demoContext({ demoIdentity: "controller" })` to discover
the seeded order/rubric IDs; see [the API contract](backend.md#task-1-client-contract).
The web provider, contributor recorder and dashboard use this shared deployment.

The demo selectors `buyer`, `contributor`, `controller`, `finance-agent` select
server-stored memberships. They are public and impersonable, **not production
authentication**. No Auth0 setup is needed. Use disposable synthetic data and
Base Sepolia test assets only. The finance-agent cannot approve a proposal.

Operators with project access can seed idempotently or deploy changed functions:

```sh
# Root ignored .env.local written by the CLI contains:
# CONVEX_DEPLOYMENT=dev:keen-marmot-986
pnpm seed
pnpm exec convex dev --once --typecheck enable
pnpm exec convex run health:status
pnpm test:convex
```

If configuring another authorized checkout for this existing project, use:

```sh
pnpm exec convex dev --once --configure existing --team stephenhung --project skarl --dev-deployment cloud
```

The CLI may select that developer's own cloud dev deployment. To use the shared
backend, retain the shared client URL above and coordinate backend writes;
operator deployment selection must explicitly point at `dev:keen-marmot-986`.
Do not commit root or app `.env.local`, and do not create a second project merely
to typecheck. **`pnpm check:convex` can sync the cloud when a checkout already has
`CONVEX_DEPLOYMENT` configured; its anonymous flag does not isolate it.** Use
`pnpm test:convex` for offline tests. During parallel work, only the deployment
owner deploys merged `origin/main` to the cloud.

The idempotent seed creates one org, the four memberships, and two **unfunded**
orders with the same frozen red-cup rubric. The default `skarl-red-cup-demo-v2`
requests four samples at 2.50 USDC each: a 10 USDC budget (`4n * 2_500_000n`
micro-USDC), with a 1.875 USDC contributor rate. The original
`skarl-red-cup-demo-v1` stays unchanged at 10 samples for 10 USDC each
(100 USDC budget, 7.5 contributor rate). Seed return fields `orderId` and
`taskVersionId` retain their v1 meaning; `defaultOrderId` and
`defaultTaskVersionId` identify v2. `dashboard.demoContext` prefers v2, falling
back to v1 until the deployment owner reruns the seed. Run `pnpm agent:fund`
(default v2) or `pnpm agent:fund skarl-red-cup-demo-v2` after the main-checkout
deployment owner deploys and seeds the update. Buyer funding needs USDC only,
not ETH; the exact/EIP-3009 facilitator pays gas. Set `SKARL_TREASURY_ADDRESS`
on the web server to the human controller's Coinbase Wallet receiving address;
missing or invalid configuration returns HTTP 503 and an actionable buyer error.
The seed does not seed submissions, verified wallet proofs, fake analysis, chain receipts or
cash. Acceptance stays blocked until the upload/analysis, wallet verification
and trusted funding integrations supply their real prerequisites. Convex tests
supply explicitly synthetic fixtures for these boundaries.

## Task 2 verification and local sample

The Convex deployment holds `GEMINI_API_KEY` as a server-side secret. It is never
read by the local sample script or browser. Configure model IDs on the deployment:

```sh
pnpm exec convex env set GEMINI_VIDEO_MODEL gemini-4-argon
pnpm exec convex env set GEMINI_AUDIO_MODEL gemini-3.5-transcribe
pnpm exec convex env set GEMINI_FINANCE_MODEL gemini-3.8-flash
pnpm verify:sample /absolute/path/to/clip.mp4
```

These are the current configurable code defaults. Earlier 3.8 measurements keep
their original model attribution. Each logical Gemini request has one shared
30-second deadline across at most three transient attempts, including backoff;
finance rounds also fit within a two-minute overall run budget. The sample script uploads the supplied clip, creates
an explicitly verification-only contribution, waits for its scheduled action and
prints the stored report/observations. It does not grant training rights or
request acceptance/payment. Do not commit media. See [AI verification](ai-verification.md)
for MIME, frame-hash and report APIs; the browser recorder/dashboard remain their
owners' integration work.

On clean installs pnpm permits the pinned `ffmpeg-static` install script. Convex
installs it as an external Node dependency; the action copies its binary into a
private temporary directory and restores executable permission before use.
Nothing under `node_modules` or temporary media belongs in Git. All new Convex
functions use committed generated API types.

Billing is now enabled. The latest Interactions probes returned HTTP 200 with
correct visual output for 3.8 Flash (about 2.1 seconds), 4 Argon (3.0 seconds)
and 3.6 Flash (1.4 seconds). The video default is now 4 Argon; finance and
read-only `askAgent` stay on 3.8 Flash for interactive latency.
Earlier free-tier stalls, Flash 503 responses and Argon zero-quota errors are
historical, not current blockers. These are provider probes, not a human-task
accuracy benchmark. No automatic model fallback is configured. New capacity,
schema or timeout failures still produce stored review-only reports; never
replace them with fabricated success.

## Remaining integrations

- The Railway/Python inference worker remains deferred; no GPU stack is needed.
- Implement licensed private-media downloads and actual contributor-wallet verification.
- The payment owner needs a server-only CDP key, controller Coinbase Wallet and
  Base Sepolia test USDC. Buyer funding requires no ETH; controller payout gas
  is a separate wallet concern. No server-side signing key is part of this design.
- Approval records enqueue a dispatch command; they do not execute or confirm a
  payment. Wallet execution and `(network, txHash, logIndex)` reconciliation remain
  payment-owner work.

Each service has its own environment example. `NEXT_PUBLIC_*` is browser-visible;
keep model/CDP/service secrets server-only. Ordinary local scaffold startup does
not require creating cloud resources, paid inference or real-fund transactions.
