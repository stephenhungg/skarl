# Authentication

## Implementation and deployment status

Convex Auth is an additive sign-in path: email/password is always registered;
GitHub is registered only when both `AUTH_GITHUB_ID` and
`AUTH_GITHUB_SECRET` exist. The source uses `@convex-dev/auth` `0.0.96` and
`@auth/core` `0.41.1`; the Auth package supports the repository's Convex
`1.48.0` through its `^1.17.0` peer range. Local policy tests are not evidence
of a deployed sign-in, OAuth callback or transaction. An operator must configure
and deploy this change before live authentication is available.

The schema spreads `authTables` alongside the existing business tables.
`convex/auth.ts` registers providers, `convex/auth.config.ts` trusts the Convex
HTTP origin, and the auth HTTP routes are appended without replacing `/jira/feed`,
`/mcp` or agent discovery routes. Next.js uses the server and client Convex Auth
providers and an auth proxy; the existing `demoIdentity` API arguments remain
unchanged.

## Operator setup

Run from the repository root. These are operator commands; the implementation
work does not set Convex environment variables or run Convex dev/deploy.

1. Install the pinned dependencies with `pnpm install --frozen-lockfile`.
2. Generate a key pair locally:

   ```sh
   node scripts/auth-keys.mjs
   ```

   The script generates an RS256 private key and its public JWKS in memory and
   prints two shell commands: `pnpm exec convex env set -- JWT_PRIVATE_KEY ...` and
   `pnpm exec convex env set -- JWKS ...`. The `--` keeps the PEM's leading dashes
   from being parsed as CLI options. It does not execute those commands or
   write a file. Run the printed commands yourself against the intended
   deployment. Do not commit, paste into chat, or save terminal output containing
   the private key. Keep an existing valid pair when preserving existing sessions;
   replacing the pair invalidates issued access tokens.

3. Set the web origin and controller allowlist on that same Convex deployment:

   ```sh
   pnpm exec convex env set SITE_URL 'https://YOUR-WEB-HOST'
   pnpm exec convex env set SKARL_CONTROLLER_EMAILS 'controller@example.com,second-controller@example.com'
   pnpm exec convex env set SKARL_DEMO_IDENTITIES 'on'
   ```

   For local development use `http://localhost:3000` for `SITE_URL`. Comma-separated
   allowlist entries are trimmed and compared case-insensitively. Demo identities
   are enabled by default; only the exact value `off` disables the fallback.
   Use the Convex CLI's deployment selection consistently for every command;
   when targeting production, add `--prod` before `--` (if present) in the
   `convex env set` commands. `node scripts/auth-keys.mjs --prod` prints key
   commands with the production flag in the correct position.

4. Configure the web app's existing build environment (for example, ignored
   `apps/web/.env.local` locally or the hosting dashboard):

   ```dotenv
   NEXT_PUBLIC_CONVEX_URL=https://keen-marmot-986.convex.cloud
   ```

   Use the URL of the deployment you configured. `CONVEX_SITE_URL` is supplied by
   Convex in the backend; it is the `.convex.site` HTTP origin, not the web origin.
   Convex Auth's Next.js integration uses `NEXT_PUBLIC_CONVEX_URL`; no separate
   `NEXT_PUBLIC_CONVEX_SITE_URL` is required. Never expose auth secrets through a
   `NEXT_PUBLIC_*` variable.

5. Deploy Convex and rebuild/redeploy the web app through the project's normal
   operator workflow. Visit `/signin`, create or sign into an account, and claim
   a permitted role from the header menu. Verify the live callback and role
   refusals before describing authentication as demonstrated.

## Optional GitHub OAuth

Create a GitHub OAuth App in GitHub Settings → Developer settings → OAuth Apps.
Use the deployed web origin as its homepage and set its Authorization callback URL
to the Convex HTTP origin plus `/api/auth/callback/github`. For the current shared
deployment, the exact callback is:

```text
https://keen-marmot-986.convex.site/api/auth/callback/github
```

Generate a client secret, then run these commands yourself with the real values:

```sh
pnpm exec convex env set AUTH_GITHUB_ID 'YOUR-GITHUB-CLIENT-ID'
pnpm exec convex env set AUTH_GITHUB_SECRET 'YOUR-GITHUB-CLIENT-SECRET'
```

Use separate OAuth Apps where development and production have different callback
origins. Both variables must be present for the provider and GitHub sign-in button
to be enabled. Keep `SITE_URL` aligned with the web origin that receives the
post-login redirect. The callback belongs on Convex's `.site` domain; it does not
belong on Next.js `/api/auth`.

## Membership and onboarding API

`auth/memberships:me` is a query with `{}` arguments. It returns the signed-in
`userId` and `email` (or `null`), the active membership's `roles`, `demoMode`,
`githubEnabled` and `canClaimController`. Anonymous callers can read deployment
flags without gaining a membership.

`auth/memberships:claimRole({role})` is a mutation requiring a signed-in user.
It looks up or creates that user's membership in the seeded demo organization
(`demoKey: "skarl-demo-v1"`). Its `tokenIdentifier` is `auth:<userId>`; it never
reuses a seeded demo membership. The demo organization must already exist and
be active.

- A human may self-assign `buyer` or `contributor`.
- A `controller` claim requires an email in `SKARL_CONTROLLER_EMAILS` and a verified
  email ownership record (`users.emailVerificationTime`). A typed password-signup
  email alone is insufficient. GitHub sign-in supplies a verified email when the
  provider returns one. Alternatively an operator can independently verify the
  existing account owner's email and set that user's `emailVerificationTime` in
  the Convex dashboard. Do not mark an email verified merely because it is on the
  allowlist.
- `finance-agent` is never self-assignable to a human. Contributor and controller
  roles cannot coexist on one membership. Existing independent-approval and
  self-approval refusals still apply.

There is no public role-administration or email-verification override endpoint.
Password reset and an email verification delivery provider are outside this change;
use the operator process or GitHub for privileged onboarding. Changing the
controller allowlist controls future claims; use the membership's persisted role
and status to revoke access that was already granted.

## Coexistence with the demo

The shared principal resolver checks `ctx.auth.getUserIdentity()` first. A signed-in
call uses only its own auth membership. Passing `demoIdentity: "controller"` (or
any other selector) cannot change that principal, and a missing or inactive auth
membership never falls back to a demo identity. Convex propagates auth automatically
through awaited action `ctx.runQuery` and `ctx.runMutation` calls.
The Next.js payment, order, dataset and witness adapters forward browser auth
cookies to their per-request Convex client. A present auth session is never
silently downgraded to an anonymous demo selector when its token is unavailable.

The finance-agent dispatcher uses a separately resolved, persisted internal
service membership for proposals and refusal audits. A model-selected approval
tool always refuses, even when a signed-in controller started the run. The
approval Workflow and stored-intent executor resolve this internal service
without depending on anonymous demo mode; they still validate the independent
human approval and exact stored payment bindings.
The scenario console's agent self-approval test uses the same service-only
refusal path, so starting it as a real controller never approves the source intent.

Scheduled verification does not retain browser auth. Its internal claim, facts,
completion and watchdog operations resolve the active contributor membership
stored on the job's submission instead of selecting the demo contributor. This
supports real contributor accounts with demo mode on or off, while preserving
job generation, tenant, media and report bindings. These are internal worker
operations; public uploads and reads still require the caller's own role.

An unsigned call can continue to use the four labeled selectors `buyer`,
`contributor`, `controller` and `finance-agent` while `SKARL_DEMO_IDENTITIES` is
not `off`. Existing scripts, MCP requests, scenario console and iOS calls retain
their argument shapes. These anonymous selectors remain impersonable and must
be labeled as demo identities. `/dashboard` shows a visible “Demo identity” banner
for an unsigned demo session. Signed-in users without controller membership see
“controller access required”; they do not inherit the anonymous demo controller.

Set `SKARL_DEMO_IDENTITIES=off` when anonymous role selectors must be refused:

```sh
pnpm exec convex env set SKARL_DEMO_IDENTITIES 'off'
```

This intentionally disables unsigned role-gated demo scripts and integrations;
configure authenticated callers before turning it off. Public discovery and
provider sign-in are not role-gated demo calls.
Existing unsigned cron, bank-witness and Jira-feed calls that depend on public
demo role checks also require demo mode; this change does not migrate those
background integrations to authenticated service credentials. Keep demo mode on
for the live demo. Turning it off is not a claim of production hardening.

## Threat notes

Authentication does not authorize payments by itself. Membership roles,
organization boundaries, independent approvals, exact stored intent bindings and
chain reconciliation remain server checks. A contributor cannot approve; an agent
cannot approve; a proposer cannot approve its own intent. Model output, narration,
uploads and client-provided role hints cannot grant membership.

Demo mode remains a deliberate anonymous access path, including the seeded demo
controller; real sign-in does not secure anonymous demo data while that path is
on. Use only intended demo assets and testnet funds with demo mode enabled.
Auth keys, OAuth secrets, refresh tokens and original media stay private. No wallet
signing key is added to the web runtime or agent. Do not send credentials or session
tokens to MCP tools, model prompts, logs or public fixtures.
To revoke business access, revoke the persisted membership or remove its roles;
deleting a user alone does not immediately expire an already-issued access token.

Setup follows the official [manual setup](https://labs.convex.dev/auth/setup/manual),
[password provider](https://labs.convex.dev/auth/config/passwords),
[GitHub OAuth](https://labs.convex.dev/auth/config/oauth/github) and
[Next.js integration](https://labs.convex.dev/auth/setup) documentation. Convex
[actions documentation](https://docs.convex.dev/functions/actions#action-context)
confirms propagation of authentication to queries and mutations.
The [scheduled-functions auth contract](https://docs.convex.dev/scheduling/scheduled-functions#auth)
explains why scheduled jobs resolve stored scope separately.
