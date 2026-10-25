# Skarl Build Documentation

Research checked October 24, 2026. This directory is the team's implementation handoff. It distinguishes **implemented scaffold**, **agreed design** and **unverified sponsor eligibility**. Treat the product and architecture below as the target, not a claim that the code already implements it.

## Read in this order

1. [Product and user flows](product.md): the thesis, narrow demo and scope.
2. [Workstreams](workstreams.md): four owners, folder boundaries and integration sequence.
3. [Setup](setup.md): local commands, environments and checks.
4. [Architecture](architecture.md): services, data flow and trust boundaries.
5. [Shared contracts](contracts.md): state machines, report schema and endpoint design.
6. [Demo runbook](demo.md): the live moment, injected scenarios and honest fallbacks.

## Subsystem references

| Document | What it answers |
| --- | --- |
| [AI verification](ai-verification.md) | Which modalities, models and evidence checks do we build? |
| [Evaluation](evaluation.md) | How do we demonstrate that engineering improves correctness? |
| [Backend](backend.md) | How do Convex transactions, jobs, media and auth work? |
| [Solana payments](payments-solana.md) | How do funding, x402, payouts and uncertain transactions work? |
| [Finance agent](finance-agent.md) | How do typed tools, proposals, approvals and agent evaluations work? |
| [Accounting](accounting.md) | What gets posted, when, and how do we reconcile it? |
| [Security](security.md) | Where are identities, secrets, media and payment permissions enforced? |
| [Deployment](deployment.md) | How do web, Python worker and Convex connect? |
| [Sponsor tracks](sponsor-tracks.md) | What must be demonstrated for each prize? |
| [Decisions](decisions.md) | Which choices are settled, conditional or deliberately deferred? |
| [Sources](sources.md) | Which primary documents support the research? |
| [Build status](status.md) | What exists and what is still work to do? |

The canonical machine-readable verification schema is [verification-report.schema.json](../packages/contracts/schemas/verification-report.schema.json). The authoritative chain constants live in [solana.ts](../packages/contracts/src/solana.ts). Do not copy those into separate application configurations.
