# Hackathon log

- **Project:** Skarl
- **Event:** Cal Hacks 13.0
- **What it does:** Buyers post and fund robot-demonstration tasks, contributors record narrated clips on their phones, and Skarl verifies each clip before an approved USDC payout.
- **Live app:** https://skarl.devshardat.work
- **Repo:** https://github.com/stephenhungg/skarl
- **Frontend:** Vercel
- **Convex deployment:** https://keen-marmot-986.convex.cloud
- **Components:** @convex-dev/workflow
- **Convex features:** schema, indexes, queries, mutations, actions, HTTP actions, crons, scheduled functions, file storage, realtime useQuery, paginated queries
- **Auth:** Convex Auth
- **AI models:** gemini-4-argon, gemini-3.8-flash, gemini-3.5-transcribe, claude-sonnet-5-5
- **Started:** 2026-10-25T04:15:12Z
- **Last updated:** 2026-10-25T16:18:20Z

## How we use Convex

- Clip upload and verification: contributors upload video to Convex file storage, and a scheduled action runs the Gemini evidence pipeline (`convex/submissions.ts`, `convex/verify.ts`).
- Payout approval: payout dispatch waits on a durable `@convex-dev/workflow` approval step, so the finance agent can't approve its own payout (`convex/approvalWorkflow.ts`, `convex/convex.config.ts`).
- Mobile task list: the Expo app subscribes with `useQueries`, so newly posted tasks and clip status appear without a refresh (`apps/mobile/src/data.ts`, `convex/dashboard.ts`).
- Buyer dashboard: overview, review queue, payables and reconciliation use `useQuery` and update live (`apps/web/features/dashboard/overview.tsx`, `review.tsx`, `payables.tsx`).
- Background jobs: crons reconcile settlements, attest reports and generate task thumbnails (`convex/crons.ts`).
- Agent access: HTTP actions serve MCP tools, discovery files and a proof endpoint (`convex/http.ts`, `convex/mcp.ts`).

## Log

All times UTC on 2026-10-25.

- 04:15 `9ad40e9` Scaffold workstreams, contracts and schema (`convex/schema.ts`)
- 07:44 `720629b` Seeded finance backend (`convex/finance.ts`)
- 07:55 `56e019b` x402 order funding on Base Sepolia (`apps/web/app/api/orders/[id]/fund/route.ts`)
- 08:12 `2735583` Web recorder with live Convex upload (`apps/web/features/contributor/`)
- 08:26 `942f795` Scheduled multimodal verification pipeline (`convex/lib/verificationReport.ts`)
- 08:46 `6314cc0` Payout gated on durable approval (`convex/approvalWorkflow.ts`)
- 09:05 `56ddde0` Frozen buyer orders with pagination (`convex/orders.ts`)
- 09:54 `f1966e0` SIWE contributor wallet verification (`convex/contributorWallet.ts`)
- 10:15 `b101609` Buyer dashboard with live overview (`apps/web/features/dashboard/`)
- 10:34 `03b40f1` Expo capture app with IMU uploads (`apps/mobile/App.tsx`)
- 11:15 `c836065` Per-take spoken liveness (`convex/lib/spokenLiveness.ts`)
- 12:06 `1fc169d` MCP tools over Convex HTTP (`convex/mcp.ts`)
- 12:26 `66b759d` Convex Auth sign-in (`convex/auth.ts`)
- 12:50 `4d8c3d7` Google OAuth on web and mobile (`convex/lib/authPolicy.ts`)
- 12:55 `f934789` On-device payout wallet (`apps/mobile/src/wallet.ts`)
- 12:58 `89ece72` Buyer-signed auto-pay policies (`convex/policy.ts`)
- 13:09 `a9fda74` Open task list on mobile (`convex/dashboard.ts`)
- 13:30 `84e5e86` Evidence bound to frozen rubrics (`convex/lib/verificationReport.ts`)
- 14:15 `7259529` Solana Token-2022 license per delivery (`packages/payments/src/solana-license.ts`)
- 14:28 `7e6f3a1` LeRobot v2.1 dataset export (`apps/web/features/datasets/lerobot-v2.ts`)
- 14:54 `2a6afbe` Cron for task thumbnails (`convex/crons.ts`)
- 15:27 `7c0ff0b` Post and fund a task in one flow (`apps/web/features/dashboard/post-task.tsx`)
