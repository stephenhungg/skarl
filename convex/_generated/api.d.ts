/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activity from "../activity.js";
import type * as agentChat from "../agentChat.js";
import type * as agentChatData from "../agentChatData.js";
import type * as agentWallet from "../agentWallet.js";
import type * as analytics from "../analytics.js";
import type * as approvalWorkflow from "../approvalWorkflow.js";
import type * as attestations from "../attestations.js";
import type * as attestationsNode from "../attestationsNode.js";
import type * as attestationsSchema from "../attestationsSchema.js";
import type * as bankWitness from "../bankWitness.js";
import type * as bankWitnessSchema from "../bankWitnessSchema.js";
import type * as chainWitness from "../chainWitness.js";
import type * as coach from "../coach.js";
import type * as coachData from "../coachData.js";
import type * as coachSchema from "../coachSchema.js";
import type * as contributorWallet from "../contributorWallet.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as datasets from "../datasets.js";
import type * as evidenceSales from "../evidenceSales.js";
import type * as exceptions from "../exceptions.js";
import type * as finance from "../finance.js";
import type * as financeAgent from "../financeAgent.js";
import type * as financeAgentData from "../financeAgentData.js";
import type * as health from "../health.js";
import type * as lib_cdpSql from "../lib/cdpSql.js";
import type * as lib_cdpWallet from "../lib/cdpWallet.js";
import type * as lib_claude from "../lib/claude.js";
import type * as lib_contributorCoach from "../lib/contributorCoach.js";
import type * as lib_copyDetection from "../lib/copyDetection.js";
import type * as lib_dashboardRead from "../lib/dashboardRead.js";
import type * as lib_demoAuth from "../lib/demoAuth.js";
import type * as lib_eas from "../lib/eas.js";
import type * as lib_easSender from "../lib/easSender.js";
import type * as lib_finance from "../lib/finance.js";
import type * as lib_financeAgentLoop from "../lib/financeAgentLoop.js";
import type * as lib_financeAgentProvider from "../lib/financeAgentProvider.js";
import type * as lib_gemini from "../lib/gemini.js";
import type * as lib_media from "../lib/media.js";
import type * as lib_nessie from "../lib/nessie.js";
import type * as lib_sensorTrace from "../lib/sensorTrace.js";
import type * as lib_verificationReport from "../lib/verificationReport.js";
import type * as lib_visualJury from "../lib/visualJury.js";
import type * as media from "../media.js";
import type * as liveness from "../liveness.js";
import type * as orders from "../orders.js";
import type * as payments from "../payments.js";
import type * as refunds from "../refunds.js";
import type * as review from "../review.js";
import type * as scenarios from "../scenarios.js";
import type * as scheduledData from "../scheduledData.js";
import type * as scheduledJobs from "../scheduledJobs.js";
import type * as seed from "../seed.js";
import type * as sensorTraceValidators from "../sensorTraceValidators.js";
import type * as sensorTraces from "../sensorTraces.js";
import type * as statements from "../statements.js";
import type * as submissions from "../submissions.js";
import type * as validators from "../validators.js";
import type * as verify from "../verify.js";
import type * as witnessReceipt from "../witnessReceipt.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activity: typeof activity;
  agentChat: typeof agentChat;
  agentChatData: typeof agentChatData;
  agentWallet: typeof agentWallet;
  analytics: typeof analytics;
  approvalWorkflow: typeof approvalWorkflow;
  attestations: typeof attestations;
  attestationsNode: typeof attestationsNode;
  attestationsSchema: typeof attestationsSchema;
  bankWitness: typeof bankWitness;
  bankWitnessSchema: typeof bankWitnessSchema;
  chainWitness: typeof chainWitness;
  coach: typeof coach;
  coachData: typeof coachData;
  coachSchema: typeof coachSchema;
  contributorWallet: typeof contributorWallet;
  crons: typeof crons;
  dashboard: typeof dashboard;
  datasets: typeof datasets;
  evidenceSales: typeof evidenceSales;
  exceptions: typeof exceptions;
  finance: typeof finance;
  financeAgent: typeof financeAgent;
  financeAgentData: typeof financeAgentData;
  health: typeof health;
  "lib/cdpSql": typeof lib_cdpSql;
  "lib/cdpWallet": typeof lib_cdpWallet;
  "lib/claude": typeof lib_claude;
  "lib/contributorCoach": typeof lib_contributorCoach;
  "lib/copyDetection": typeof lib_copyDetection;
  "lib/dashboardRead": typeof lib_dashboardRead;
  "lib/demoAuth": typeof lib_demoAuth;
  "lib/eas": typeof lib_eas;
  "lib/easSender": typeof lib_easSender;
  "lib/finance": typeof lib_finance;
  "lib/financeAgentLoop": typeof lib_financeAgentLoop;
  "lib/financeAgentProvider": typeof lib_financeAgentProvider;
  "lib/gemini": typeof lib_gemini;
  "lib/media": typeof lib_media;
  "lib/nessie": typeof lib_nessie;
  "lib/sensorTrace": typeof lib_sensorTrace;
  "lib/verificationReport": typeof lib_verificationReport;
  "lib/visualJury": typeof lib_visualJury;
  media: typeof media;
  liveness: typeof liveness;
  orders: typeof orders;
  payments: typeof payments;
  refunds: typeof refunds;
  review: typeof review;
  scenarios: typeof scenarios;
  scheduledData: typeof scheduledData;
  scheduledJobs: typeof scheduledJobs;
  seed: typeof seed;
  sensorTraceValidators: typeof sensorTraceValidators;
  sensorTraces: typeof sensorTraces;
  statements: typeof statements;
  submissions: typeof submissions;
  validators: typeof validators;
  verify: typeof verify;
  witnessReceipt: typeof witnessReceipt;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
};
