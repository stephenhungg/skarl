# Policy-bound finance agent wallet

The auto-pay executor uses `@coinbase/cdp-sdk` **1.60.0** and `viem`
**2.57.11**. Base Sepolia test USDC is the only payment asset. Set `PAYOUT_EXECUTOR=cdp_agent` for the buyer-signed auto-pay path. The legacy
`controller_wallet` mode retains browser signing for compatibility. `cdp_agent` lets a Convex Node action submit an already approved
intent through the CDP Server Wallet v2 account named `skarl-finance-agent`.
The agent cannot propose its own approval or supply new payment terms.

Implementation and mocked tests are not live payment evidence. At initial
implementation, no CDP policy response or agent payout transaction has been
captured. Keep the default until the deployment operator verifies this path.

## Approval, execution and recovery

1. Existing `finance.proposePayment` binds the payable, exact micro-USDC amount,
   recipient, source version and expiry. The internal `policy-engine` approves through the shared `finance.approve` logic only when the buyer’s signed rule passes. Failed checks go to buyer Review; the agent cannot approve even when the rule would pass.
2. The approval workflow validates the stored approval and creates its existing
   dispatch outbox row. With `cdp_agent` enabled, it schedules
   `agentWallet.execute({intentId})`; the argument contains no destination or
   amount.
3. The action checks the current verified contributor allowlist and configured
   CDP account, then calls existing `payments.claimPayout` as `finance-agent`.
   That atomic claim rechecks approval, expiry, tenant, source bindings and
   dispatch readiness. It creates the single existing payment attempt before
   calling CDP. A browser claim and an agent claim cannot both win.
4. The CDP call encodes only `USDC.transfer(boundRecipient, boundAmount)` with
   zero native value. Its idempotency key is the persisted claim ID. The action
   saves the returned hash using `payments.recordTransaction` before RPC waits.
5. Reconciliation verifies the successful Base Sepolia receipt, canonical block,
   confirmations, exact USDC transfer and sender. It calls the existing
   `payments.recordPayoutObservation`, which deduplicates by network, transaction
   hash and log index, posts the payout journal and marks the payable paid.

An attempt without a hash stays `requires_reconciliation`; it is never released
for another send. A timeout, exception or policy rejection is not proof that a
transfer failed. Use the CDP request/claim ID and account history to recover a
missing hash, then run the recovery action below. Reconciliation remains
available after disabling the executor or after approval expiry. Neither action
can renew or rewrite approval.

```sh
pnpm exec convex run agentWallet:execute '{"intentId":"APPROVED_INTENT_ID"}'
pnpm exec convex run agentWallet:reconcile '{"intentId":"CLAIMED_INTENT_ID"}'
pnpm exec convex run agentWallet:reconcile '{"intentId":"CLAIMED_INTENT_ID","txHash":"0xRECOVERED_HASH"}'
```

These are operator-only internal functions. `convex run` invokes deployed code;
it does not deploy the worktree. The orchestrator deploys the merged source.
Only `confirmed` with reconciled evidence is a successful payout. `submitted`
and `requires_reconciliation` remain pending.

## CDP policy setup

Integration prerequisites: the root package must declare
`@coinbase/cdp-sdk: "1.60.0"` and `viem: "2.57.11"`, with the lockfile updated.
Add `@coinbase/cdp-sdk` to `node.externalPackages` in `convex.json`: the SDK's
optional Solana imports otherwise fail Convex bundling even on this EVM-only
path. Required package scripts are `cdp:policy:apply` →
`node scripts/cdp-policy-apply.ts` and `demo:policy` →
`node scripts/cdp-policy-demo.ts`. These shared integration files require the
repository integrator's changes; the scoped executor change does not edit them.

Use a dedicated CDP project. The key used to administer the policy requires
**Non-custodial > Manage (modify policies)**. Store `CDP_API_KEY_ID`,
`CDP_API_KEY_SECRET` and `CDP_WALLET_SECRET` privately in
`~/.config/skarl/cdp.env`; the scripts load that file without printing it.
`CDP_CLIENT_API_KEY` is not needed by this executor. Runtime credentials belong
in Convex server environment variables, never browser `NEXT_PUBLIC_*` variables.
No wallet private key is exported or kept in the app or model context.

The operator must provision verified contributor payout addresses in Convex
before applying the policy. `lib/cdpWallet.allowlist` reads active contributors
in the finance agent's organization with an existing Base Sepolia wallet
verification record. An empty list refuses setup. The script does not invent
addresses or accept a command-line allowlist. This is a snapshot: rerun policy
setup after approved contributor changes. The executor also checks the current
Convex allowlist before claiming each payout.

Contributors can register their own wallet with `contributorWallet:challenge` and `contributorWallet:verify` using `demoIdentity:"contributor"` (or their signed-in contributor membership). They cannot register another contributor’s wallet. The legacy operator registration path also uses `contributorWallet:challenge`
mutation with `{demoIdentity:"controller",contributorTokenIdentifier:"demo:skarl:contributor",walletAddress}`.
Sign its returned `message` with that contributor's wallet using EIP-191
`signMessage`, then call `contributorWallet:verify` with the same identity fields,
returned `nonce`, and `signature`. The server-issued SIWE message binds the
`skarl.devshardat.work` domain by default, HTTPS URI, Base Sepolia chain, membership and organization.
Clients may pass optional `origin` on the challenge: only `https://skarl.devshardat.work`
and `https://skarl.vercel.app` are accepted, and the message binds that origin’s host and URI;
it expires after five minutes. Only the exact stored message is verified. A new
challenge supersedes the previous nonce, successful verification consumes it,
and exact success retries are idempotent. Existing verified addresses cannot be
changed through this initial-registration path. These functions retain the
project's impersonable demo controller selectors; they are not production auth.
Local tests use real disposable-key signatures but do not establish a live
registration or onchain transaction. The deployment operator must deploy these
functions and the optional membership challenge field before live use.
The mutation statically imports the pinned `@noble/curves` recovery primitive
and uses viem's EIP-191 hashing/address derivation: viem's `verifyMessage` utility
lazily imports the curve, which the [Convex default runtime does not support](https://docs.convex.dev/functions/bundling#dynamic-dependencies).

```sh
CDP_PAYOUT_CAP_ATOMIC=2000000 pnpm cdp:policy:apply
# Equivalent direct command:
CDP_PAYOUT_CAP_ATOMIC=2000000 node scripts/cdp-policy-apply.ts
```

The cap is a positive decimal integer in six-decimal micro-USDC: `2000000`
means exactly 2 USDC. The command prints the resulting public
`CDP_AGENT_ADDRESS` and `CDP_AGENT_POLICY_ID`; configure those in Convex. Keep
`PAYOUT_EXECUTOR=controller_wallet` while changing or validating policy, and
make sure no previously scheduled agent execution is in flight.

The account policy accepts `sendEvmTransaction` only when all of these hold:

- Network is `base-sepolia`.
- Transaction target is the canonical USDC contract and native value is zero.
- Calldata is ERC-20 `transfer`; parameter `to` is in the verified allowlist.
- Parameter `value` is positive and at most the cap.

The script tries the SDK's `evmData` `in` operator and tests it against the CDP
simulation endpoint. If that candidate fails, it creates one equality rule per
recipient and tests again. It refuses more than 90 recipients to remain below
CDP's 100-rule maximum. Wrong token, network, function, recipient, native value
and over-cap amount must all be rejected before the candidate is attached to
the finance account. The candidate is tested on `skarl-policy-probe` first.
Alternative EVM transaction, message, typed-data, raw-hash and user-operation
signing paths have reject-only rules.

CDP evaluates matching project rules before account rules. A project-level
accept can therefore bypass an account restriction. The script refuses all
project-level EVM accepts, including paused ones that could resume. It does
not alter project policies shared with other applications. Account policy
controls are independent of Convex approval checks, but an administrator who
can change policy remains trusted. Use separately restricted runtime API
credentials where available.

## Funding and gas

This version deliberately uses an EOA. `sendEvmTransaction` rules do not cover
Smart Account `sendUserOperation`; enabling a Smart Account requires a separate
policy and receipt verification exercise. Therefore this EOA needs Base
Sepolia ETH for gas. No gas subsidy is claimed here.

Prefer testnet faucet funds for verification. With the credentials loaded,
CDP SDK supports the following calls; record their returned hashes. Faucet
limits apply, and a grant may be smaller than the intended payout.

```ts
import { CdpClient } from "@coinbase/cdp-sdk";
const cdp = new CdpClient();
const account = await cdp.evm.getAccount({ name: "skarl-finance-agent" });
await cdp.evm.requestFaucet({ address: account.address, network: "base-sepolia", token: "eth" });
await cdp.evm.requestFaucet({ address: account.address, network: "base-sepolia", token: "usdc" });
```

Alternatively, an operator can approve a small testnet float from their own
Coinbase Wallet via Wallet MCP `send`, with `recipient` equal to the printed
agent address, `asset` equal to canonical `USDC_ADDRESS`, `decimals: 6`,
`chain: "base-sepolia"` and the operator-chosen exact decimal `amount`.
Show the MCP approval link and wait for the human's approval; do not move the
operator’s funds automatically. Record the float separately from payout
settlement evidence. The executor does not reconcile treasury-float funding.
Never fund `skarl-policy-probe`.

## Demonstration and evidence

```sh
CDP_PAYOUT_CAP_ATOMIC=2000000 pnpm demo:policy APPROVED_INTENT_ID
# Equivalent direct command:
CDP_PAYOUT_CAP_ATOMIC=2000000 node scripts/cdp-policy-demo.ts APPROVED_INTENT_ID
```

The script first repeats live CDP policy **simulations**, explicitly labeled
`simulated: true`. Simulation evaluates policy but signs and broadcasts
nothing. A simulated rejection returns HTTP 200 with `action: reject`, not a
`policy_violation` exception.

For independent enforcement evidence, the script attaches the same policy to
`skarl-policy-probe`, checks that this separate EOA has zero ETH and zero USDC,
then attempts over-cap and non-allowlisted transfers through the real CDP send
API. Only CDP `policy_violation` counts as a successful negative test; RPC,
authentication and insufficient-balance failures do not. It prints sanitized
CDP error details without serializing request headers or credentials. The
unfunded, unsponsored probe prevents an unexpectedly accepted request from
moving funds. These are live policy rejection checks on the probe, not rejected
payments from the finance account.

Finally, with an existing policy- or buyer-approved intent ID, it invokes the Convex
executor and reconciliation. It prints the actual returned status and hash.
It never sends a valid transfer directly from the CLI and never creates an
approval. Omitting the ID runs only negative checks and exits 2. Exit 0 requires
both CDP policy rejections and a confirmed approved payout; pending payout or
missing prerequisites are not a complete demonstration.

Retain the policy ID, recipient operator, cap, sanitized simulation responses,
both actual `policy_violation` errors, approved intent/claim IDs, payout hash,
transfer log index and balanced journal. Keep the executor default until the
deployment operator has reviewed this live evidence. No cloud deployment is
performed by these scripts.

## Verification and current limits

`node --test scripts/cdp-policy.test.ts` validates the policy objects against
the pinned SDK schema, exact bigint encoding, unexpected negative-case
acceptance, project-override refusal and deterministic idempotency keys. These
tests are synthetic and contact no CDP service. Convex executor tests cover the
approval and claim boundaries separately.

The policy is a per-transfer cap, not a cumulative budget. CDP policy does not
know whether a Convex approval exists; Convex must enforce that independently.
Do not use `netUSDChange` for this testnet limit: it is mainnet-only. The
existing impersonable demo identities remain a demo limitation, not production
authentication. A lost send response requires operator recovery; no automatic
replacement transfer is implemented.

Primary references, checked October 25, 2026:

- [Policy Engine evaluation and account policy setup](https://docs.cdp.coinbase.com/wallets/security-and-policies/policy-engine/overview)
- [EVM policy operations and testnet limits](https://docs.cdp.coinbase.com/wallets/security-and-policies/policy-engine/evm-policies)
- [Policy simulation responses and limitations](https://docs.cdp.coinbase.com/wallets/security-and-policies/policy-engine/simulate-policies)

Builder feedback: separate send-transaction and user-operation policy surfaces
make a gas-sponsored migration more than an account-type change. Simulation
traces are useful for checking the actual matching account policy. A built-in
approved-intent lookup and durable lookup by client request ID would simplify
recovery from a lost send response; this implementation keeps the claim locked
instead of guessing whether another send is safe.
