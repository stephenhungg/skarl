# Skarl Build Documentation

For judging, start with the [Coinbase submission](coinbase-submission.md),
[Devpost text](devpost.md), [two-minute demo script](demo-script.md), and
[exported architecture](architecture.svg). The dated [build status](status.md)
separates observed integrations from implemented or planned behavior.

Research checked October 24, 2026; updated October 25 after the audit and the move to Base Sepolia. This directory is the team's implementation handoff. It distinguishes **implemented scaffold**, **agreed design** and **unverified sponsor eligibility**. Treat the product and architecture below as the target, not a claim that the code already implements it.

## Read in this order

1. [Product and user flows](product.md): the thesis, narrow demo and scope.
2. [Workstreams](workstreams.md): the 8-hour plan, owners and folder boundaries.
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
| [Dashboard API handoff](dashboard-api.md) | Exact live query/mutation contracts, demo identities, refusals and browser payout signing |
| [Payments](payments.md) | How do x402 funding on Base Sepolia, Coinbase Wallet MCP, payouts and uncertain transactions work? |
| [Finance agent](finance-agent.md) | How do typed tools, proposals, approvals and agent evaluations work? |
| [Accounting](accounting.md) | What gets posted, when, and how do we reconcile it? |
| [Security](security.md) | Where are identities, secrets, media and payment permissions enforced? |
| [Deployment](deployment.md) | How do the web app, Convex and Gemini connect (Python worker deferred)? |
| [Sponsor tracks](sponsor-tracks.md) | What must be demonstrated for each prize? |
| [Decisions](decisions.md) | Which choices are settled, conditional or deliberately deferred? |
| [Sources](sources.md) | Which primary documents support the research? |
| [Build status](status.md) | What exists and what is still work to do? |

The canonical machine-readable verification schema is [verification-report.schema.json](../packages/contracts/schemas/verification-report.schema.json). The authoritative chain constants live in [chain.ts](../packages/contracts/src/chain.ts). Do not copy those into separate application configurations.
