# Local Setup

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
# Or all four:
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

FFmpeg, model weights, Gemini access and optional ASR/copy-model dependencies are required only when real inference is implemented. Do not install large GPU packages merely to make a placeholder worker start. Production Python dependencies should be locked once the live adapter and target hardware are chosen; the core editable scaffold install is not a reproducible ML deployment.

## Cloud services — integration work

1. Use a team-controlled Convex account/development deployment. `pnpm convex:dev` will prompt for login/setup and generates `convex/_generated`; it is intentionally not required for local scaffold checks.
2. Configure Auth0 with the correct issuer/audience and Convex integration. Add actual membership authorization before exposing any private data.
3. Run the verifier as one Railway Python worker using separate service credentials, no treasury key. See [deployment](deployment.md).
4. Configure the Next.js server's Devnet RPC/facilitator/signer only when implementing payments. Query facilitator support and fund the treasury with **Devnet SOL** for rent/fees.

Copy root `.env.example` to the relevant service's ignored local environment file and fill only fields that service needs. It documents planned variables; values alone do not enable unimplemented integrations. `NEXT_PUBLIC_*` is browser-visible. Use server-only secret configuration for Gemini, HMAC credentials and signer material. The two HMAC secret values must encode independent random keys; see [security](security.md).

Do not create cloud resources or make paid inference/real-fund transactions as part of merely running this scaffold.
