# @skarl/ledger

Dependency-free, pure TypeScript accounting helpers. Amounts are integer micro-USDC (`bigint`, six decimals), never floating-point dollars. Input parsers accept unsigned decimal strings with at most six decimal places (trailing fractional zeros such as `7.50` are allowed) and reject values outside signed Int64 storage range. Formatting supports signed balances.

Run checks from the repository root:

```sh
node --test packages/ledger/src/index.test.ts
```

The principal-model helpers cover confirmed funding, accepted-and-delivered samples, confirmed contributor payouts, approved refund reservations, confirmed refunds, and append-only reversals. `postJournal` validates balanced postings and each kind's fixed account layout, detects repeated business events, rejects conflicting reuse of an event ID, rejects padded or unusual identifiers, keeps totals and balances within Int64, and prevents negative protected balances for an order or contributor. It also rejects a second active fulfillment for the same `(orderId, sampleId)`, requires a contributor on any payable movement, requires each payout to reference an active fulfillment and caps payouts at its accrued amount. Reversing a confirmed payout or refund requires chain failure evidence (a reverted transaction hash, or a different mined transaction that replaced it); reason text alone is refused. It still records an earned contributor obligation when its cost exceeds the sale price; any negative margin needs policy review, not concealed accounting. Its in-memory replay behavior is useful for deterministic demonstrations and unit tests.

**This is not a payment executor or concurrent database ledger.** It does not authenticate users, authorize a payout, confirm a Base transaction, reserve task quantity, or establish submission uniqueness. Persist the event claim, journals, payable, order transition, and audit event in the same Convex mutation. The replay check against duplicate fulfillment is not a concurrency control: enforce the submission/version business key with an indexed lookup inside the Convex mutation too. Chain import must deduplicate the identified transfer separately from HTTP responses.

`createFulfillmentJournal` assumes skarl sells the verified sample as principal and the accepted sample/license is available to the buyer. It recognizes gross sample revenue and the contributor acquisition expense. A broker/agent business would use a different net-fee revenue model. The modeled gross margin excludes inference, transaction fees, tax, and all other operating costs. See [accounting design](../../docs/accounting.md).

Use a reference per sample/payable and retain the actor, approval, rubric version, and chain evidence in the storage layer. Serialize micro-unit values as decimal integer strings at ordinary JSON boundaries; Convex supports Int64 `bigint` directly. Never post an onchain cash journal merely because a signature, client claim, or HTTP success was returned.
