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

## Buyer and policy authority

The user flow has two humans: buyer and contributor. The buyer sets an auto-pay rule on their order at creation/funding and can update or disable it. Its default is enabled, with `maxPerClipAtomic` equal to the per-clip price and `requireAllChecks: true`. Money is Convex Int64 internally and a decimal integer string at JSON boundaries. `setBy` and `setAt`, plus audit events, record the authorization. Old orders without a policy stay manual until their buyer sets one.

The internal `policy-engine` service membership (`service:skarl:policy-engine`) is distinct from the finance agent and every human. No public selector or model argument can choose it. Internal `policy.evaluateSubmission` checks completed accept evidence, duplicate status, liveness when required, prompt injection and consent/license before reusing acceptance. `policy.policyApproval` checks the buyer cap, distinct proposer, accepted-submission/payable binding, verified wallet and funded remaining capacity before reusing approval and its Workflow. The agent’s self-approval refusal still applies even when policy checks would pass. The CDP wallet cap independently guards execution.

A buyer may review and approve exceptions for their own order; no separate controller is required. `controller` roles, demo selectors and allowlisted onboarding remain for backward compatibility, hidden from product choices. They do not grant agents approval authority. Human order authority is organization-scoped: an active buyer in the organization owning the order can review its submissions, payouts and books. Original order creation and changes to its signed auto-pay rule remain bound to that order's individual buyer. Buyer and contributor roles cannot be combined through onboarding; stored mixed roles fail closed for human authority, and policy execution rechecks its active, non-contributor buyer signer.

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

4. Set the web origin on that same Convex deployment. The controller allowlist is optional, for legacy operator access only; buyers do not need it:

   ```sh
   pnpm exec convex env set SITE_URL 'https://YOUR-WEB-HOST'
   pnpm exec convex env set SKARL_DEMO_IDENTITIES 'on'
   ```

   For legacy controller onboarding only, optionally set `SKARL_CONTROLLER_EMAILS` to verified operator emails. For auto-pay execution set `PAYOUT_EXECUTOR=cdp_agent`; preserve the existing CDP account policy and cap.

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
- `finance-agent` and `policy-engine` are never self-assignable to a human. Contributor and buyer/controller
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
tool always refuses, even when a signed-in buyer started the run. The
approval Workflow and stored-intent executor resolve this internal service
without depending on anonymous demo mode; they still validate the independent
buyer-policy or buyer-review approval and exact stored payment bindings.
The scenario console's agent self-approval test uses the same service-only
refusal path, so starting it as a real buyer never approves the source intent.

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
for an unsigned demo session. Buyer Review uses the signed-in buyer’s own order access; passing a legacy controller selector cannot elevate it.

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
cannot approve; a proposer cannot approve its own intent. The internal policy is a separate deterministic principal, not a model-selected role. Model output, narration,
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

## Controller-to-buyer authorization inventory

This inventory compares the controller checks in baseline `f934789` with the buyer rules in this change. It includes callers of shared guards, so a function without its own role literal is still listed. `AbortController` variables are request-cancellation objects, not people or authorization checks, and are excluded.

**Owning buyer** below means an active human membership with `buyer` in the organization that owns the order, not only the individual `buyerTokenIdentifier` that created it. An active legacy `controller` membership in that organization remains compatible. Neither a contributor nor the finance-agent or policy-engine service can acquire human authority through an extra role or a demo selector. Every order/resource relationship still needs the existing tenant and binding checks. **Finance service** below means the existing separately resolved service principal; its reads/proposals never grant approval. Agent proposes; buyer-signed policy (or the buyer in review) approves; independent CDP cap.

| Function or shared surface | Old role / check | New rule |
| --- | --- | --- |
| `lib/demoAuth.requireRole` | Required role literals; controller/contributor conflict; agent barred from controller-only checks | Resolve authenticated membership before demo hints; retain literal roles and legacy controller compatibility; never treat a role hint as authority |
| `lib/demoAuth.hasOrderAuthority` / `requireOrderAuthority` | Repeated controller bypasses and individual-buyer checks | One owning-organization human buyer rule; exclude contributors and both service identities; reject foreign organizations |
| `lib/demoAuth.requireDemoOrganizationAuthority` | Controller-only no-order privileges | Active buyer of seeded `skarl-demo-v1` organization, with legacy controller compatibility |
| `lib/authMemberships.signedInMembership` / `ensureAuthMembership` | Auth membership independent of demo identity | Preserve authenticated membership precedence; never reuse or fall back to a selected seeded identity |
| `lib/authMemberships.controllerEmailAllowed` | Verified-email controller allowlist | Keep only for legacy onboarding; normal buyer claims do not need it |
| `auth/memberships.claimRole` | Self-claim buyer/contributor; allowlisted verified-email controller; no finance-agent | Buyer and contributor remain mutually exclusive human choices; legacy controller claim remains allowlisted; services never self-assignable |
| `auth/memberships.me` | Roles plus `canClaimController` flag | Retain API compatibility flag; UI offers Buyer and Contributor only |
| `lib/finance.requireBuyerOrder` | Controller/finance-agent/policy-engine bypass; otherwise exact order buyer token | Owning buyer through shared authority; finance-agent and internal policy retain explicitly separate service scope |
| `lib/finance.isOrderApprover` | Controller or individual owning buyer; internal policy special case | Owning buyer or exact internal policy identity; active same-org principal, never finance-agent/contributor |
| `lib/dashboardRead.financeScope` | Buyer/controller/finance-agent; individual buyer order filtering | Owning buyer sees owning organization's orders; existing service scope retained; hide scenario orders in unscoped production projections |
| `dashboard.access` | Buyer/controller/finance-agent; contributor for non-finance reads; individual buyer filter | Shared organization authority for buyer financial reads; contributor visibility stays limited to contribution surfaces |
| `dashboard.orderSummary` | `dashboard.access` | Owning buyer reads order, funding terms and balances; existing task access for contributors remains |
| `dashboard.submissions` | Controller/finance-agent/buyer full view; contributor own rows | Owning buyer full order view; contributor own rows; tenant/reference checks remain |
| `dashboard.payables` | Controller/finance-agent/buyer full view; contributor own rows | Owning buyer full payout view; contributor own payables; exact stored approval/dispatch projection remains |
| `dashboard.journal` | Buyer/controller/finance-agent via finance access | Owning buyer reads order books; finance service reads separately |
| `dashboard.auditEvents` | Buyer/controller/finance-agent via finance access | Owning buyer reads order-linked audit records; finance service reads separately |
| `dashboard.demoContext` | All demo roles; individual buyer fallback | Discover an order in caller's organization; buyer never needs a controller selector |
| `activity.contributors` | Finance scope plus buyer-only token filtering | Owning buyer sees contributors for owning organization's visible orders |
| `activity.payoutHistory` | Shared finance scope | Owning buyer sees scoped payout history |
| `activity.feed` | Shared finance scope | Owning buyer sees scoped activity/audit feed |
| `analytics.overview` | Shared finance scope | Owning buyer sees organization/order financial overview |
| `analytics.timeSeries` | Shared finance scope | Owning buyer sees organization/order financial series |
| `statements.forOrder` | Buyer/controller/finance-agent; individual buyer token | Owning buyer reads order statements and trial balance; service reads retained |
| `orders.diversityCoverage` | Buyer/controller/finance-agent; controller/service bypass | Owning buyer reads order dataset coverage; service reads retained |
| `orders.listOrders` | Controller/finance-agent organization-wide; buyer only own token | Owning buyer reads owning organization's orders; no foreign organization access |
| `orders.cancelRemainder` | Individual buyer creates refund proposal requiring separate controller | Owning buyer requests cancellation; finance service proposes stored refund command; buyer can approve independently of service proposer |
| `orders.setAutoPay` | Individual owning buyer | Individual owning buyer changes their signed deterministic rule; audit set/change/disable; contributor/service cannot sign a human rule |
| `finance.acceptAndPublish` / `acceptAndPublishFor` | Buyer/controller or internal policy; reviewer controller/exact buyer | Owning buyer or internal deterministic policy accepts bound evidence; scaffold/incomplete/unavailable analysis never becomes machine acceptance |
| `finance.proposePayment` / `proposePaymentFor` | Finance-agent/controller | Finance-agent or owning buyer may propose; proposer is permanently distinct from approver |
| `finance.proposeAgentPaymentFor` / `proposeAccepted` | Internal finance service | Remain internal finance-service proposal operations; no human impersonation |
| `finance.approve` / `approveFor` | Buyer/controller; reject same requester and finance-agent | Owning buyer or internal buyer-signed policy approves stored intent; proposer and contributors cannot approve; exact amount/destination bindings remain |
| `finance.reject` | Buyer/controller | Owning buyer rejects stored payout proposal; no agent approval authority |
| `finance.refuseAgentApprovalFor` | Internal finance service refusal audit | Remains service-only refusal, including misprovisioned agent roles |
| `review.reviewSubmission` | Buyer/controller plus individual order ownership | Owning buyer accepts/rejects/reviews submission; evidence-bound decision and financial checks remain |
| `approvalWorkflow.awaitController` / `controllerApproved` | Legacy-named Workflow event | Keep persisted names for in-flight compatibility; event is a wake-up signal, not payment authority |
| `approvalWorkflow.queueApprovedDispatch` | Internal service validates independent controller/owning-buyer approval | Internal service revalidates stored owning-buyer or exact policy approval, distinct proposer, expiry, amount and payment bindings before dispatch |
| `payments.claimPayout` | Service secret plus buyer/controller/finance-agent (or internal executor) | Buyer browser-wallet compatibility uses owning order authority; internal executor uses service identity and stored approved intent only |
| `payments.payoutAttempt` | Service secret plus buyer/controller/finance-agent (or internal executor) | Same owning-buyer/service scope; inspect original attempt rather than retry after timeout |
| `payments.reconciliation` | Controller/finance-agent/buyer | Owning buyer reads order chain/ledger reconciliation; finance-service scope retained |
| `payments.recordPayoutObservation` | Trusted payment service | Remains service-authorized observation; reconcile by network, transaction hash and log index |
| `refunds.activeApproval` | Active controller, same organization, not proposer/agent/contributor | Stored approval must come from owning buyer/legacy controller distinct from command proposer; legacy buyer-proposed commands still cannot self-approve |
| `refunds.approve` | Controller; buyer/agent enter refusal audit | Owning buyer approves finance-service refund proposal; agent, contributor and same proposer remain refused |
| `refunds.claim` | Payment service secret plus human controller | Payment service secret plus owning buyer/legacy controller; exact approved command and one durable attempt required |
| `refunds.attempt` | Payment service secret plus human controller | Payment service secret plus owning buyer/legacy controller reads bound original attempt |
| `refunds.forOrder` | Controller or exact buyer token | Owning buyer reads refund request/approval/execution availability |
| `refunds.recordObservation` | Payment service secret | Remains trusted service reconciliation, never a client assertion that money moved |
| `exceptions.list` | Buyer/controller/finance-agent; individual buyer check | Owning buyer reads order exceptions; finance-service scope retained |
| `exceptions.acknowledge` / `setDisposition` | Buyer/controller; individual buyer check | Owning buyer acknowledges bound order exception with durable audit |
| `exceptions.resolve` / `setDisposition` | Buyer/controller; individual buyer check | Owning buyer records resolution; preserves detected evidence and tenant checks |
| `bankWitness.orderScope` | Buyer/controller/finance-agent; individual buyer token | Owning buyer reads bank witnesses; finance-service scope retained |
| `bankWitness.bankExceptions` | Shared bank order scope | Owning buyer reads order bank discrepancies; simulation labels remain truthful |
| `bankWitness.reconciliation4Way` | Shared bank order scope | Owning buyer compares order, ledger, chain and simulated bank evidence |
| `bankWitness.storeSnapshot` (scenario branch) | Internal controller-selected scenario scope | Internal finance service with exact simulated scenario order/account binding; no public snapshot authority |
| `bankWitness.seed` / `prepareAccounts` / `sweep` / `syncOrder` | Internal bank setup/sweep using finance-agent membership | Remain internal/service-only; no third human operator role introduced |
| `chainWitness.orderScope` | Buyer/controller/finance-agent; individual buyer token | Owning buyer reads/refreshes order chain witnesses; service scope retained |
| `chainWitness.webhookExceptions` | Shared chain order scope | Owning buyer reads order-scoped webhook discrepancies |
| `chainWitness.witnessInputs` | Shared chain order scope | Owning buyer reads bounded witness inputs |
| `chainWitness.refresh` / `reserveRefresh` / `storeSnapshot` | Public action plus scoped internal helpers | Owning buyer initiates scoped refresh; internal helpers preserve scope and durable reservation |
| `chainWitness.reconciliationWithWitness` | Shared chain order scope | Owning buyer reads order reconciliation with independent chain witness |
| `chainWitness.receiveWebhook` / `finishWebhook` | Trusted service secret | Remain trusted service-only receipt ingestion/completion |
| `datasets.forOrder` | Buyer/controller; exact buyer except controller | Owning buyer reads licensed delivery manifest; accepted consented samples only |
| `datasets.authorizeTrainingInputs` / `trainingInputs` | Same dataset order scope | Owning buyer authorizes training conversion inputs; action cannot widen original dataset scope |
| `datasets.sampleQuality` | Buyer/controller/contributor; exact buyer or own contributor | Owning buyer reads order sample quality; contributor reads own submission only |
| `datasets.originalMedia` | Trusted payment service secret plus dataset order scope | Trusted streaming proxy uses owning-buyer scope and exact delivered-media binding; non-expiring native storage URL never becomes an unguarded buyer response |
| `datasets.contributorEarnings` | Contributor only | Unchanged: contributor reads their own earnings, not buyer financial authority |
| `provenance.forSubmission` | Controller, exact buyer, or own contributor | Owning buyer reads order chain of title; contributor retains own-submission visibility |
| `witnessReceipt.forSubmission` | Controller, exact buyer, or own contributor | Owning buyer reads order witness receipt; contributor retains own-submission visibility; agent cannot gain receipt access through extra buyer/controller role |
| `annotations.accessible` | Controller/contributor writes; controller/buyer/contributor reads | Owning buyer or own contributor accesses annotations; model-derived annotations remain advisory |
| `annotations.generateUploadUrl` / `saveDerived` | Controller or own contributor via helper | Owning buyer or own contributor may attach validated derived evidence; no acceptance/payment authority |
| `annotations.forSubmission` | Controller, exact buyer, own contributor | Owning buyer reads order annotations; contributor reads own submission |
| `media.submissionEvidence` | Controller, exact buyer, own contributor | Owning buyer reads private order evidence; contributor reads own submission |
| `media.duplicatePair` | Controller, exact buyer, own contributor for both clips | Owning buyer reads scoped duplicate comparison; both submissions and all media references remain tenant checked |
| `submissions.getReport` | Buyer/controller/finance-agent/contributor plus visibility | Owning buyer reads order report; service reads separate; contributor reads own submission |
| `submissions.jobContributor` (worker `claim` / `facts` / `complete` / `expire`) | Stored contributor must not be controller/agent | Keep contributor-only stored worker principal; no buyer/controller authority through scheduled execution |
| `submissions.generateUploadUrl` / `create` / `evaluationRun` | Contributor only | Unchanged: original recordings/evaluation runs require contributor identity; buyer does not impersonate contributor |
| `financeAgent.run` / `financeAgentData.begin` | Buyer/controller/finance-agent; individual buyer order check | Owning buyer starts scoped service run; internal finance agent proposes under its own service identity |
| `financeAgentData.running` / `save` / `proposeBatch` / `requestApproval` / `refuseApproval` | Internal finance service; signed-in requester buyer/controller | Remain service-only; signed-in requester must own run; requestApproval records a request only; approval tool always refuses |
| `financeAgentData.runs` | Buyer/controller/finance-agent; exact buyer token | Owning buyer reads scoped runs; service scope retained |
| `agentChat.askAgent` / `agentChatData.begin` | Buyer/controller/finance-agent through begin/projections | Owning buyer starts order-scoped advisory chat; no proposal, approval or execution tools |
| `agentChatData.save` | Internal plus same requester buyer/controller/finance-agent | Preserve same-requester/tenant binding for saving results; owning-org read access does not let another user overwrite a chat |
| `agentChatData.history` | Buyer/controller/finance-agent | Owning buyer reads order chat history; service scope retained |
| `scheduledData.snapshots` | Buyer/controller/finance-agent plus individual buyer check | Owning buyer reads order scheduled reconciliation/finance snapshots |
| `scheduledJobs.reconcile` / `finance` and `scheduledData` reservations/completions | Internal scheduled service operations | Remain internal service operations; no public sweep or model-selected human authority |
| `policy.evaluateSubmission` / `policyApproval` | Internal `policy-engine`; contributor must not be controller/agent | Remain exact internal deterministic policy identity; owning-buyer human authority never comes from model output; independent CDP cap remains |
| `lib/cdpWallet.allowlist` | Internal finance service; verified contributor excluding controller | Remains service-only; contributor payout addresses require existing verified wallet proof and no privileged conflicting role |
| `seed.demo` | Internal bootstrap provisions controller, then requires it | Internal bootstrap attributes new demo records to seeded buyer; no public selector or controller prerequisite; retains legacy membership for old clients only |
| `seed.solanaDemo` | Internal controller-selected seeding | Internal demo-buyer attribution; optional funding-only rail, no payout target change |
| `scenarios.run` / `prepare` | Buyer/controller source-order scope | Demo-organization buyer starts explicitly simulated scenario; source order must belong to organization |
| `scenarios.scenarioPrincipal` / `inject` / `assess` / `finish` / `inputError` | Internal seeded controller operator | Internal seeded buyer lab principal after public authorization; bound audit run and lab order; no signing or external transfers |
| `scenarios.listRuns` | Buyer/controller, controller broader read | Demo-organization buyer reads scoped simulated runs; optional order still tenant/authority checked |
| `contributorWallet.challenge` / `verify` / `contributorFor` | Controller or contributor themself | Contributor themself or demo-organization buyer assisting; same one-use EIP-191/SIWE signature proof and target tenant required |
| `contributorWallet.mine` | Contributor only | Unchanged: contributor reads own registered wallet |
| `consent.requestRevocation` | Contributor themself | Contributor retains self-revocation; demo-organization buyer may request on bound same-org submission; request never claims to delete delivered copies |
| `consent.revocationRequests` | Controller-only inbox | Demo-organization buyer reads consent request inbox, optionally filtered to same-org order |
| `mcp.handle` authentication | Buyer/contributor/controller keys selected separate tool roles | Legacy controller key normalizes to buyer membership and allowlist; credential cannot choose arbitrary domain identity |
| MCP `skarl_reconciliation` / `skarl_exceptions` | Controller read-only tools | Buyer read-only tools; owning-org domain checks apply identically to legacy controller key alias |
| MCP remaining buyer/contributor tools | Separate role allowlists; no approve/accept/sign | Same strict allowlists, buyer additionally has financial reads; no MCP approval/acceptance/signing/execution authority |
| `agentDiscovery` metadata | Controller human/signing prose | Buyer-signed policy or buyer review; independent CDP cap; agents never approve or sign payouts |
| `scripts/demo-e2e.mjs:runDemo` | Controller accepts/approves/reads | Buyer accepts/approves/reads; finance-agent proposes and demonstrates refused self-approval; stops before signing |
| `scripts/scenario.mjs:runScenarios` | Buyer already used | Keep buyer; all eight scenarios remain explicitly simulated, no deployment or external transfer |
| `scripts/mcp-key.mjs` | Buyer/contributor/controller key identities | Buyer/contributor recommended; accept legacy controller input, interpreted by server as buyer alias |
| Web `DashboardAccess` | Signed-in buyer/controller admitted | Buyer dashboard; legacy controller membership still admitted invisibly for compatibility |
| Web `AccountMenu` / `HumanRole` | Buyer/contributor/controller type and claim handling | Display and claim Buyer/Contributor only; display legacy controller membership as Buyer; backend allowlist remains legacy-only |
| Web landing `Roles` | Already Buyer/Contributor humans, finance agent and deterministic rule as system nodes | Keep two human roles: Buyer and Contributor; services appear as system behavior rather than a third person |
| Web dashboard `data.ts` / scoped hooks | Legacy `CONTROLLER` symbol already selected `"buyer"` | Use `BUYER` name and selector for order, funding, review, payout and books queries |
| Web demo identity pickers / replay / activity labels | Controller demo identity available or named | Show Buyer/Contributor only; retained stored controller actor records label as buyer compatibility, never a third human flow |
| `validators.membershipRole`, schema roles, `DEMO_IDENTITIES` | Includes `controller` | Keep persisted/API literal for backward compatibility; hide from product choices |
| `human_controller`, `controllerApproved`, `awaitController`, `controllerApprovalRequired`, legacy refusal codes | Persisted evidence/event/response identifiers | Retain wire/storage names where required by existing clients and workflows; their authority is buyer/policy under the guards above, not a controller person |

The table deliberately distinguishes compatibility names from authorization. No new human role, signing key, database or deployment is introduced. Existing buyer-proposed refund commands still need a different owning buyer to approve; new cancellation requests use a finance-service proposal so the requesting buyer can review independently without a controller.

New refunds record a buyer `buyer_cancellation_requested` event and a separate finance-service `buyer_refund_proposed` event in the same transaction, with the exact command and reserved journal references. Execution rechecks both events for new service-proposed commands. This is deterministic stored proposal construction, not a claim that a model ran. The payment requester remains the finance service, so the buyer can approve without self-approving a proposal. The existing finance-service membership is scoped to the seeded demo organization; new refund proposal construction requires that service in the order's organization. No new tenant provisioning or deployment is performed by this change.
