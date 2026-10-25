# Build Status

This file describes the initial scaffold. Update it when a real integration becomes demonstrable.

| Area | Implemented now | Remaining |
| --- | --- | --- |
| Web | Server-rendered Next.js workspace page and `/api/health` | Buyer/contributor/operator product flows, capture/upload, auth and data wiring |
| Shared contracts | Devnet constants, status values, JSON Schema and TS report validation | Backend transition enforcement, full rubric-membership validation and live cross-service wiring |
| Convex | Schema, validators and truthful health query | Deployment, auth, all business mutations, service gateways, leases, privacy and persistence checks |
| Verifier | Python report models, validation CLI and unavailable-inference behavior | FFmpeg/ASR/Gemini/SSCD adapters, actual private media processing and worker gateway |
| Evaluation | Manifest/scoring scaffolding and documented split protocol | Consented labeled recordings and measured baseline/pipeline comparisons |
| Ledger | Exact arithmetic, balanced journal builders, pure replay/deduplication tests | Durable Convex persistence, period reports, role enforcement and reconciliation integration |
| Payments | Devnet configuration/policy helpers and adapter that refuses live execution | x402/SPL adapters, signer isolation, observed transfers and refund execution |
| Finance agent | Tool and policy design in docs | Real bounded tools, agent interface and scenario-driven evidence |
| Sponsors | Source-backed integration requirements and caveats | Demonstrable product integrations and eligibility confirmation |

Local tests prove only the behavior they execute. They do not prove external settlement, inference quality, hosted authorization or sponsor eligibility. CI configuration is included; its remote result is separate from a local test run.

## Initial local verification

On October 24, 2026: frozen pnpm install, TypeScript compilation, 16 TypeScript tests, local documentation links and the Next.js production build passed under Node 22.21.1. The production shell and `/api/health` were opened in a browser and showed the expected scaffold state. Python core validation passed 16 pytest tests and 7 evaluation unittest tests under Python 3.14.7; the canonical example also passed the CLI validator. These 39 tests do not run model inference or chain settlement. Python 3.11 is the target ML environment and the configured CI version; a local 3.11 ML deployment has not been exercised.
