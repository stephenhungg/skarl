# @skarl/ledger

Dependency-free, pure TypeScript accounting helpers. Amounts are integer micro-USDC (`bigint`, six decimals), never floating-point dollars. Input parsers accept canonical unsigned decimal strings with at most six decimal places and reject values outside signed Int64 storage range. Formatting supports signed balances.

Run checks from the repository root:

```sh
node --test packages/ledger/src/index.test.ts
```

The principal-model helpers cover confirmed funding, accepted-and-delivered samples, confirmed contributor payouts, approved refund reservations, confirmed refunds, and append-only reversals. `postJournal` validates balanced postings, detects repeated business events, rejects conflicting reuse of an event ID, and prevents negative protected balances for an order or contributor. It still records an earned contributor obligation when its cost exceeds the sale price; any negative margin needs policy review, not concealed accounting. Its in-memory replay behavior is useful for deterministic demonstrations and unit tests.

**This is not a payment executor or concurrent database ledger.** It does not authenticate users, authorize a payout, confirm a Solana transaction, reserve task quantity, or establish submission uniqueness. Persist the event claim, journals, payable, order transition, and audit event in the same Convex mutation. Duplicate fulfillment under different event IDs must be stopped using a submission/version business key there. Chain import must deduplicate the identified transfer separately from HTTP responses.

`createFulfillmentJournal` assumes skarl sells the verified sample as principal and the accepted sample/license is available to the buyer. It recognizes gross sample revenue and the contributor acquisition expense. A broker/agent business would use a different net-fee revenue model. The modeled gross margin excludes inference, transaction fees, tax, and all other operating costs. See [accounting design](../../docs/accounting.md).

Use a reference per sample/payable and retain the actor, approval, rubric version, and chain evidence in the storage layer. Serialize micro-unit values as decimal integer strings at ordinary JSON boundaries; Convex supports Int64 `bigint` directly. Never post an onchain cash journal merely because a signature, client claim, or HTTP success was returned.
