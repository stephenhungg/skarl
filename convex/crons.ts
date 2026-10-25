import { cronJobs, makeFunctionReference } from "convex/server";

const crons = cronJobs();
crons.interval("observe pending settlements", { minutes: 2 }, makeFunctionReference<"action">("scheduledJobs:reconcile"), {});
crons.interval("finance changed accruals and exceptions", { minutes: 10 }, makeFunctionReference<"action">("scheduledJobs:finance"), {});
export default crons;
