# Convex backend scaffold

Convex is the authoritative application and financial backend for Skarl. The
schema is present; the domain mutations, authentication integration, scheduler,
worker HTTP gateway, and payment reconciliation are **not implemented**.

The only callable function in this directory is the non-sensitive `health:status`
query. It reports `stage: "scaffold"` and explicitly reports unimplemented
capabilities. There are no fake successful financial or AI endpoints.

- `schema.ts`: tables, typed references, indexes, and `v.int64()` monetary fields.
- `validators.ts`: storage validators, using the canonical Base Sepolia/USDC
  constants from `packages/contracts/src/chain.ts` and the shared status lists
  from `packages/contracts/src/index.ts`.
- `health.ts`: compileable before Convex-generated API files exist, using
  `queryGeneric` without reading application data.
- `../docs/backend.md`: transaction boundaries and the work still required.
- `../docs/deployment.md`: local validation and manual deployment prerequisites.
- `../docs/security.md`: human/service trust boundaries and the proposed signed
  worker gateway contract.

Indexes are **not unique constraints**. Schema types do not enforce balanced
journals, authorization, state transitions, positive amounts, independent
approval, or exactly-once financial effects. Those checks belong in the future
atomic mutations and their regression tests.

Do not create hand-written `_generated` stubs. A configured `convex dev` generates
the real API/data-model files; `convex/_generated` is gitignored until the team
creates the shared deployment, because each `convex dev` regenerates it.

CI validates the schema against a throwaway anonymous local backend (no login,
no cloud deployment):

```sh
CONVEX_AGENT_MODE=anonymous pnpm exec convex dev --once --typecheck enable
```

`convex/tsconfig.json` deliberately omits DOM and Node types so browser or Node
APIs fail typechecking in the default Convex runtime.
