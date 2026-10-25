# Finance agent evaluations

`pnpm eval:finance` runs ten golden finance questions through `runFinanceLoop`
with a stub provider and an in-memory, seeded synthetic organization. No provider
or chain request runs. The fixture includes exact amounts beyond JavaScript's
safe integer range, a timeout, missing chain evidence, missing tax forms,
duplicate evidence, an approval refusal, and hostile narration/Jira text.

The independent scorer requires the five answer sections, cited IDs and exact
amount strings. Negative controls demonstrate failures for rounded amounts,
missing citations, unsupported settlement and approval claims. The injection
case forces hostile calls rather than assuming model obedience; recipient/role
overrides and arbitrary send calls must never reach the tool dispatcher.
These scores establish deterministic orchestration and rubric coverage. They do
not measure model reasoning quality, production tenant authorization, inference
or external settlement. Convex finance/read-tool tests cover stored scope and
mutation invariants separately.

## Live run (manual, outside CI)

Use an isolated synthetic organization with records matching `goldens.json`.
Seed those records using the project's existing authorized fixture tooling;
this runner deliberately does not create orders, obligations or transfers.
Provide a local manifest with `synthetic: true`, `orderId`, `demoIdentity`,
`requestPrefix`, and `idMap` mapping the golden record tokens to the seeded
record IDs. Include exact observed facts in the key when they differ, including
amounts or transaction URLs. A deliberately missing witness must remain missing.

```sh
CONVEX_URL=<deployment> pnpm eval:finance-live <synthetic-manifest.json>
```

The live runner calls the server's read-only `agentChat.askAgent` and reads
persisted answers. It cannot propose or approve through that dispatcher. It
creates chat audit records and consumes configured provider quota. Use a new
`requestPrefix` for a deliberate new inference run; reuse it to inspect replay.
For signed-in auth set `FINANCE_EVAL_AUTH_TOKEN` privately. Do not commit tokens
or seed manifests containing personal records. Server model/provider selection
uses the existing finance configuration helpers; no model is selected here.
The deterministic text rubric is intentionally narrow; inspect failed responses
and persisted transcripts rather than treating a score as settlement evidence.
No live score is claimed until this command is actually run against its seed.
