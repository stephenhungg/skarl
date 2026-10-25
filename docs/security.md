# Security and Trust Boundaries

## Current status

The repository is a scaffold. No human authentication adapter, role-checking
domain mutation, HMAC gateway, private-media delivery endpoint, controller-wallet
integration, or live payment path is implemented. The public `health:status`
query exposes only scaffold metadata. The schema is not an authorization layer.

## Human identities and permissions

Auth0 is the starting provider because Convex documents its integration and it
matches an opportunistic sponsor track. Keep Clerk if it is already integrated;
do not mix identities from two providers without an explicit migration.

Verify tokens through Convex's configured identity provider. Resolve the issuer
and subject to an active organization membership on the server. Roles in a form,
URL, model response, or frontend selector never confer authority.

| Principal | Allowed future authority | Excluded authority |
| --- | --- | --- |
| Buyer | Create/fund own order, read licensed deliveries, request cancellation | Approve contributor settlement merely by being a buyer |
| Contributor | Read offered terms, upload own contribution, view own earnings | Accept own work, alter rates, access others' originals, approve/pay |
| Controller | Review evidence and authorize exact settlement proposals | Rewrite posted journals or approve a request made by the same principal |
| AI worker service | Claim/heartbeat assigned work, read job-scoped input, attach evidence and recommendations | Accept deliveries, post journals, create payables, sign or approve transfers |
| Payment gateway service | Record verified payment attempts/observations through narrow operations | Invent buyer authorization, change order terms, grant controller membership |

Enforce organization ownership on every query/mutation and every nested
reference. Possession of a Convex document ID is not permission to read it.
Record the authenticated actor, reason, source version, and evidence for each
decision. Keep authorization checks inside the mutation that changes the state.

An approval binds chain, mint, amount, recipient owner, source obligation, source
version, expiry, and proposal identity. Any material change requires a new
approval. The proposed independent signer is the controller's browser wallet;
the worker must never receive a treasury or controller private key.

## Proposed worker/payment gateway protocol

**This section is an integration contract to implement. There is no HMAC
verification code or worker HTTP route in this scaffold.**

Use HTTPS and a separate credential per service. Each service ID maps server-side
to one preconfigured secret and an exact operation allowlist. The claimed
`X-Skarl-Service` header selects that credential; the header alone does not prove
identity or grant its permissions.

Required request headers:

| Header | Encoding |
| --- | --- |
| `X-Skarl-Service` | Exact configured service ID, such as `verifier-01` |
| `X-Skarl-Timestamp` | Unix seconds, base-10 ASCII integer |
| `X-Skarl-Request-Id` | Lowercase UUID identifying one logical service request |
| `X-Skarl-Signature` | Lowercase hexadecimal HMAC-SHA256, exactly 64 characters |
| `Content-Type` | `application/json` for signed JSON operations |

The secret environment variable contains **base64 encoding of at least 32 random
bytes**. Decode it before use as the HMAC key; do not use the base64 text itself
as the key. No shared demo credential is included in the repository.

Construct this UTF-8 canonical string, joined by a single LF (`\n`), with **no
trailing newline**:

```text
v1
<serviceId>
<timestampSeconds>
<requestId>
<UPPERCASE_METHOD>
<exactPath>
<lowercaseSha256HexOfRawBody>
```

For example, `exactPath` may be `/internal/worker/claim`. Exclude scheme and host.
Reject query strings and non-allowlisted paths for the initial gateway. Do not
normalize, decode, reorder, or reserialize the body before hashing. Hash the
exact bytes sent; for an empty body hash zero bytes. The receiver must cap the
body before buffering it. Keep binary media out of signed JSON requests.

Compute:

```text
signature = lowercase_hex(
  HMAC_SHA256(base64_decode(service_secret), UTF8(canonical_string))
)
```

Verify with a constant-time cryptographic comparison, such as Web Crypto
`SubtleCrypto.verify`. Reject malformed encodings, unknown service IDs, bad
signatures, requests over the configured size cap, disallowed methods/paths,
and timestamps more than 300 seconds from the receiver's clock.

The default Convex runtime supports Web Crypto. A gateway HTTP action may call
`internalMutation`/`internalQuery` after validation. Internal functions cannot be
called directly by external clients; do not expose an unrestricted public
mutation as a shortcut.

### Idempotency and replay handling

Persist `(serviceId, requestId)` with method, path, body digest, timestamp, and
the resulting operation reference. Perform that claim and the relevant state
transition atomically in the internal mutation.

- Same ID and same fingerprint: return/reconstruct the recorded operation
  result; do not repeat its side effect.
- Same ID and different method/path/body: reject the request.
- A newer timestamp/signature may be used for a retry of the same logical
  request. Its operation identity and fingerprint remain unchanged.
- Keep replay records at least through the allowed clock window; keep business
  idempotency records for the full operation lifetime. Expiring a service request
  must not make a completed payable/payment eligible again.
- A claim retry refers to the recorded job and lease generation. It cannot
  silently claim another job if that lease has expired.

Initial worker operations are limited to `claim`, `heartbeat`, `fetch-media`,
`evidence-upload`, and `complete`. Every non-claim operation binds the job ID,
lease owner/generation, source hash, task version, and pipeline version as
applicable. The payment service uses its own credential and namespace. Neither
service can claim another service's role by changing a header.

Future gateway tests must cover raw-body changes, reordered JSON keys, wrong
path/method, malformed signature, wrong secret, stale/future timestamps, replay
with identical/different bodies, service impersonation, stale job generations,
and cross-tenant references. A valid signature authenticates a caller; it does
not make the supplied financial or AI conclusion true.

## Media and model evidence

Original video, voice, transcripts, consent details, prompts, and reports stay
offchain. Keep originals private in application storage. Native Convex
`storage.getUrl()` URLs do **not** expire automatically and anyone holding one
can fetch the file. Authorize every private download through an HTTP action;
never treat knowledge of a storage ID as sufficient authorization.

Validate actual bytes using bounded decoding, not only browser MIME claims.
Check duration, dimensions, size, and audio presence. Preserve source hashes,
model/pipeline version, and timestamp mappings. A digest proves byte identity;
it does not prove authorship, human origin, licensing rights, or that an event
happened. A model's duplicate flag is evidence for review, not proof of fraud.

Consent records preserve a stated license version, scope, acknowledgment, and
receipt hash. They are not a claim that the software can automatically determine
all legal rights. Treat filenames, task text, transcriptions, and model output as
untrusted data. The verifier receives no financial tools or signing secrets.

## Payment verification

Only the canonical Solana Devnet network/mint is enabled in this scaffold's
types. Use labeled test assets. A transaction signature supplied by a browser or
facilitator response is a reference to inspect, not enough to mark an order
funded or a payable paid.

Reconcile the expected network, mint, precision, source/destination token-account
owners, amount, instruction path, execution success, and required commitment.
Store recent blockhash lifetime and distinguish unresolved from definitively
failed/expired attempts. Do not create a second transfer because a request timed
out. Native SOL fees and token-account creation require separate budgeting.

No onchain payment is atomic with an HTTP response or a Convex write. Persist
attempt identity first and recover the gaps using independently verified chain
observations. Keep journals and financial event keys immutable through public
APIs; use reviewed reversals for corrections.

## Secrets and logs

- The worker gets only its own gateway credential and required inference keys.
  It does not receive a Convex deploy/admin key, payment service secret, or
  treasury key.
- `NEXT_PUBLIC_*` values are public by design. Never put service secrets, Auth0
  client secrets, RPC URLs containing credentials, or signing material there.
- Keep environment files out of Git. Share deployed credentials through the
  relevant secret-management surface, not commits or chat prompts.
- Log job/operation IDs, stages, durations, sanitized errors, and verified
  transaction references. Avoid raw videos, transcripts, consent documents,
  authorization payloads, bearer URLs, and secret-bearing endpoints.
- Disable data export/public sign-up or sensitive operations until their actual
  authorization and privacy boundaries are implemented and tested.

## Primary references

- [Convex Auth0 integration](https://docs.convex.dev/auth/auth0)
- [Authentication inside functions](https://docs.convex.dev/auth/functions-auth)
- [Convex internal function guidance](https://docs.convex.dev/understanding/best-practices)
- [Convex HTTP actions](https://docs.convex.dev/functions/http-actions)
- [Convex runtime and Web Crypto](https://docs.convex.dev/functions/runtimes)
- [Convex private file delivery](https://docs.convex.dev/file-storage/serve-files)
- [Circle USDC mint addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)
- [Solana signature status](https://solana.com/docs/rpc/http/getsignaturestatuses)
