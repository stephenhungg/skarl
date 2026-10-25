# Authentication

## Implementation and deployment status

Google OAuth is the only real sign-in provider on web and mobile. The unsigned,
labeled demo identity fallback remains available as before. The source uses
`@convex-dev/auth` `0.0.96` and `@auth/core` `0.41.1`; the Auth package supports the repository's Convex
`1.48.0` through its `^1.17.0` peer range. Local policy tests are not evidence
of a deployed sign-in, OAuth callback or transaction. An operator must configure
and deploy this change before live authentication is available.

The schema spreads `authTables` alongside the existing business tables.
`convex/auth.ts` registers Google, `convex/auth.config.ts` trusts the Convex
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

3. In Google Cloud Console → Google Auth Platform, select or create a project.
   Configure Branding (app name and support/contact email) and Audience. For an
   External app in testing, add the Google accounts that will test sign-in to
   the test-user list. Under Clients, create an OAuth client with application
   type **Web application**, including for the Expo app. Set:

   | Google Console field | Value |
   | --- | --- |
   | Authorized JavaScript origins | Your exact web origin, for example `https://YOUR-WEB-HOST` (no path); add `http://localhost:3000` for local web development |
   | Authorized redirect URIs | `https://keen-marmot-986.convex.site/api/auth/callback/google` |

   Google returns to Convex's `.site` callback, never a Next.js `/api/auth`
   route or the mobile scheme. Use a separate client/configuration when another
   Convex deployment has a different callback. Copy the client ID and secret,
   then set these values privately on the same Convex deployment:

   ```sh
   pnpm exec convex env set AUTH_GOOGLE_ID 'YOUR-GOOGLE-CLIENT-ID'
   pnpm exec convex env set AUTH_GOOGLE_SECRET 'YOUR-GOOGLE-CLIENT-SECRET'
   ```

4. Set the web origin and controller allowlist on that same Convex deployment:

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

5. Configure the web app's existing build environment (for example, ignored
   `apps/web/.env.local` locally or the hosting dashboard):

   ```dotenv
   NEXT_PUBLIC_CONVEX_URL=https://keen-marmot-986.convex.cloud
   ```

   Use the URL of the deployment you configured. `CONVEX_SITE_URL` is supplied by
   Convex in the backend; it is the `.convex.site` HTTP origin, not the web origin.
   Convex Auth's Next.js integration uses `NEXT_PUBLIC_CONVEX_URL`; no separate
   `NEXT_PUBLIC_CONVEX_SITE_URL` is required. Never expose auth secrets through a
   `NEXT_PUBLIC_*` variable.

6. Deploy Convex and rebuild/redeploy the web app through the project's normal
   operator workflow. Visit `/signin`, choose “Continue with Google”, and claim
   a permitted role from the header menu. Verify the live callback and role
   refusals before describing authentication as demonstrated.

## Mobile OAuth and redirects

Mobile uses `ConvexAuthProvider` with an `expo-secure-store` adapter for access
and refresh tokens and the OAuth verifier. AsyncStorage still holds the labeled
demo-session choice and upload drafts; it never stores auth tokens. The same
Convex client supplies authentication to queries, mutations and actions.

The sign-in button calls `signIn("google", { redirectTo })`, opens the returned
`redirect` in `expo-web-browser`'s `openAuthSessionAsync`, reads the returned
URL's `code`, then calls `signIn("google", { code })`. The provider retains and
checks the exchange verifier. Cancellation stays on sign-in; it does not enter
the demo. A separate demo button selects the unsigned contributor fallback.
After Google sign-in, mobile requires the signed-in account's contributor role;
role claims still go through `auth/memberships:claimRole` on the server.

`makeRedirectUri({ scheme: "skarl", path: "auth" })` uses the current runtime:
a standalone/development app can return to `skarl://auth`, while Expo Go returns
to its development URL, such as `exp://192.168.1.20:8081/--/auth`. Keep the phone
and Metro host reachable and preserve Expo Go's generated URL. The `skarl`
scheme in `app.json` does not install a new scheme into Expo Go. Google Console
still needs only the HTTPS Convex callback above; the mobile return URL is
Convex's post-auth destination, not Google's authorized redirect URI.

The backend redirect callback permits relative destinations under `SITE_URL`,
absolute URLs on that same origin, `skarl://` app URLs and `exp://` development
URLs. It rejects other origins and schemes. `SITE_URL` must match the web origin
that should receive browser sign-in. Mobile only needs the public
`EXPO_PUBLIC_CONVEX_URL=https://keen-marmot-986.convex.cloud`; Google client
secrets and auth keys belong only in Convex.

A real Google round trip, callback delivery in Expo Go, session restoration and
sign-out on a physical iPhone require credentials and a device smoke test. Local
policy tests, typechecks and exports do not establish that live flow.

## Membership and onboarding API

`auth/memberships:me` is a query with `{}` arguments. It returns the signed-in
`userId` and `email` (or `null`), the active membership's `roles`, `demoMode` and
`canClaimController`. Anonymous callers can read deployment
flags without gaining a membership.

`auth/memberships:claimRole({role})` is a mutation requiring a signed-in user.
It looks up or creates that user's membership in the seeded demo organization
(`demoKey: "skarl-demo-v1"`). Its `tokenIdentifier` is `auth:<userId>`; it never
reuses a seeded demo membership. The demo organization must already exist and
be active.

- A human may self-assign `buyer` or `contributor`.
- A `controller` claim requires an email in `SKARL_CONTROLLER_EMAILS` and a verified
  email ownership record (`users.emailVerificationTime`). The Google profile
  marks email verified only when `email_verified` is exactly `true`; a returned
  email string or allowlist match alone is insufficient.
- `finance-agent` is never self-assignable to a human. Contributor and controller
  roles cannot coexist on one membership. Existing independent-approval and
  self-approval refusals still apply.

There is no public role-administration or email-verification override endpoint.
Google provides email ownership verification for privileged onboarding. Changing
the controller allowlist controls future claims; use the membership's persisted role
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
[Google OAuth](https://labs.convex.dev/auth/config/oauth/google),
[React Native OAuth](https://labs.convex.dev/auth/config/oauth) and
[Next.js integration](https://labs.convex.dev/auth/setup) documentation. Convex
[actions documentation](https://docs.convex.dev/functions/actions#action-context)
confirms propagation of authentication to queries and mutations.
The [scheduled-functions auth contract](https://docs.convex.dev/scheduling/scheduled-functions#auth)
explains why scheduled jobs resolve stored scope separately.
