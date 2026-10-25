# Production Deployment

The public demo runs Next.js on Vercel and uses the shared Convex backend at
`https://keen-marmot-986.convex.cloud`. The production URL and dated checks are
recorded in [status](status.md). HTTPS enables the browser camera permission flow;
an HTTP 200 does not prove that recording, inference or a wallet payment succeeded.
Demo identity selectors remain public and impersonable: this is a testnet demo,
not production authentication. Use Base Sepolia test assets only.

## Vercel project

- Project: `skarl`, team `stephen-hungs-projects-d01c13ef`.
- Git repository: `stephenhungg/skarl`; production branch: `main`.
- Root directory: `apps/web`; include source files outside the root directory.
- Framework: Next.js; Node: `22.x` (repository development version 22.21.1).
- Install: `cd ../.. && corepack pnpm install --frozen-lockfile`.
- Build: `pnpm build` in `apps/web`.
- Deployment protection: preview deployments only. Production must be reachable
  without Vercel login for judges and x402 discovery probes.

The build/install commands are versioned in `apps/web/vercel.json`. Root directory,
Node version, Git connection and protection are Vercel project settings. The root
`.vercelignore` excludes local environment files, caches and private work artifacts
from CLI uploads. Never upload contributor recordings or wallet keys.

From the repository root, with the authorized Vercel account already logged in:

```sh
vercel link --yes --project skarl --scope stephen-hungs-projects-d01c13ef
vercel project inspect --non-interactive
pnpm check
vercel deploy --prod --yes
```

Normal releases are pushes to `main` through the Git integration. A CLI production
release is also available for environment-only changes. Do not deploy Convex from
an older worktree: the backend deployment owner deploys merged `origin/main`.

## Environment

| Production variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_CONVEX_URL` | Public browser/backend URL: `https://keen-marmot-986.convex.cloud` |
| `SKARL_TREASURY_ADDRESS` | Controller receiving address: `0x8408a922ea400af33d7c2080a9edd5d3495b695f` |
| `SKARL_PAYMENTS_SERVICE_SECRET` | Private service authentication; must match Convex |
| `BASE_SEPOLIA_RPC_URL` | Receipt verification; public default `https://sepolia.base.org` |
| `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET` | Server-side CDP facilitator authentication when both configured |
| `CDP_WALLET_SECRET` | CDP-managed wallet integration; buyer/Convex executor setup is separate |
| `CDP_CLIENT_API_KEY` | CDP SQL witness; its Convex action also needs this key in Convex |

The public URL is the only `NEXT_PUBLIC_*` value in this deployment setup. Gemini
credentials belong in Convex, where inference runs. Setting credentials does not
prove any CDP API call, policy enforcement, settlement or Bazaar listing worked.
Without CDP facilitator credentials the payment route defaults to
`https://x402.org/facilitator`; a partial key pair must refuse service.

Operators can import the existing private environment files without placing
secret values in command arguments or terminal output:

```sh
set -a
source ~/.config/skarl/payments.env
# Run this line once the human has provisioned the file:
source ~/.config/skarl/cdp.env
set +a
python3 - <<'PY'
import os
import subprocess
names = ["SKARL_PAYMENTS_SERVICE_SECRET", "CDP_API_KEY_ID",
         "CDP_API_KEY_SECRET", "CDP_WALLET_SECRET", "CDP_CLIENT_API_KEY"]
for name in names:
    value = os.environ.get(name)
    if not value:
        raise SystemExit("Missing required variable: " + name)
    result = subprocess.run(
        ["vercel", "env", "add", name, "production", "--yes", "--force"],
        input=value, text=True, capture_output=True,
    )
    if result.returncode:
        raise SystemExit("Environment update failed: " + name)
    print(name + " configured")
PY
vercel deploy --prod --yes
```

Run this only from the linked repository root after confirming the project.
Environment changes require a new deployment. Never use `--value` with a secret,
print environment values, or commit the ignored `.vercel` directory.

## CDP configuration probe

After importing credentials, this read-only probe checks the authenticated CDP
facilitator's supported schemes without submitting a payment:

```sh
node --input-type=module <<'JS'
import { homedir } from "node:os";
import { createCdpFacilitatorClient } from "@coinbase/cdp-sdk/x402";
process.loadEnvFile(`${homedir()}/.config/skarl/cdp.env`);
try {
  const result = await createCdpFacilitatorClient().getSupported();
  console.log(JSON.stringify({
    network: "eip155:84532",
    kinds: result.kinds.filter(kind => kind.network === "eip155:84532"),
  }));
} catch {
  console.error("CDP supported-schemes probe failed; no payment attempted.");
  process.exitCode = 1;
}
JS
```

A successful response proves API reachability/authentication for that call, not
settlement, wallet authorization or Bazaar indexing. The existing 10 USDC funding
transaction was recorded before this CDP configuration step.

## Verification

```sh
pnpm check
# Use the exact Production URL from docs/status.md:
curl --fail-with-body "$SKARL_APP_URL/api/health"
curl --fail-with-body -o /dev/null "$SKARL_APP_URL/contribute"
curl --fail-with-body "$SKARL_APP_URL/api/orders/skarl-red-cup-demo-v2/fund"
```

`pnpm check` includes TypeScript, package tests, convex-test, payment route tests,
local documentation links and the Next production build. **Do not run
`pnpm check:convex` in a checkout linked to the cloud.** Its anonymous-agent flag
does not override an existing `CONVEX_DEPLOYMENT` configuration: it can sync the
cloud backend. Use convex-test for isolated validation and let the designated
backend owner deploy merged `origin/main`.

`/api/health` currently returns HTTP 200 with a **static scaffold capability
payload**. It is a routing/liveness check, not an integration readiness probe.
The funding **GET is a status read**, not the x402 challenge: funded v2 returns
HTTP 200 with its stored amount and transaction hash. Funding **POST** returns
402 only for an eligible, unfunded order; an existing confirmed intent returns
200 without another charge, an unresolved intent returns 202, and missing payment
configuration returns 503. Do not repay v2 merely to obtain a 402 screenshot.

For the camera, open `/contribute` on the actual demonstration phone, grant camera
and microphone permission, record a bounded clip, upload it, then inspect the
stored verification result. This human/browser check is distinct from HTTPS
reachability. Original media goes directly to Convex storage, not a Next request.

For sponsor evidence, capture real request/response headers and transaction hashes
from the payment owner. The [Wallet MCP plugin](wallet-mcp-plugin/skarl.md) explains
capped funding and evidence purchase flows. Test fixtures, mock responses and
replayed traces must remain labeled. A public HTTPS URL alone does not establish
successful settlement, live inference, private media authorization or discovery.

## References

- [Vercel monorepos](https://vercel.com/docs/monorepos)
- [Vercel environment variables](https://vercel.com/docs/environment-variables)
- [CDP facilitator](https://docs.cdp.coinbase.com/x402/seller/facilitator)
- [Wallet MCP plugin specification](https://docs.cdp.coinbase.com/coinbase-for-agents/wallet-mcp/references/plugin-spec)
- [Browser camera requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
