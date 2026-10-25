import { cronJobs, makeFunctionReference } from "convex/server";

const crons = cronJobs();
crons.interval("expire idle public rate buckets", { minutes: 10 }, makeFunctionReference<"mutation">("publicSecurity:sweep"), {});
crons.interval("observe pending settlements", { minutes: 2 }, makeFunctionReference<"action">("healthJobs:reconcile"), {});
crons.interval("finance changed accruals and exceptions", { minutes: 10 }, makeFunctionReference<"action">("healthJobs:finance"), {});
crons.interval("attest stored verification reports", { minutes: 2 }, makeFunctionReference<"action">("healthJobs:attest"), {});
crons.interval("observe simulated bank witness", { minutes: 2 }, makeFunctionReference<"action">("healthJobs:bank"), {});
crons.interval("read-only integration health probes", { minutes: 2 }, makeFunctionReference<"action">("health:refresh"), {});
crons.interval("advisory finance analyst catch-up", { minutes: 1 }, makeFunctionReference<"action">("financeAnalystJobs:sweep"), {});
crons.interval("advisory organization close", { minutes: 1 }, makeFunctionReference<"action">("financeAnalystJobs:close"), {});
export default crons;
