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
import type * as chainWitness from "../chainWitness.js";
import type * as dashboard from "../dashboard.js";
import type * as exceptions from "../exceptions.js";
import type * as finance from "../finance.js";
import type * as financeAgent from "../financeAgent.js";
import type * as financeAgentData from "../financeAgentData.js";
import type * as health from "../health.js";
import type * as lib_cdpSql from "../lib/cdpSql.js";
import type * as lib_cdpWallet from "../lib/cdpWallet.js";
import type * as lib_copyDetection from "../lib/copyDetection.js";
import type * as lib_dashboardRead from "../lib/dashboardRead.js";
import type * as lib_demoAuth from "../lib/demoAuth.js";
import type * as lib_finance from "../lib/finance.js";
import type * as lib_financeAgentLoop from "../lib/financeAgentLoop.js";
import type * as lib_gemini from "../lib/gemini.js";
import type * as lib_media from "../lib/media.js";
import type * as lib_verificationReport from "../lib/verificationReport.js";
import type * as media from "../media.js";
import type * as orders from "../orders.js";
import type * as payments from "../payments.js";
import type * as review from "../review.js";
import type * as seed from "../seed.js";
import type * as statements from "../statements.js";
import type * as submissions from "../submissions.js";
import type * as validators from "../validators.js";
import type * as verify from "../verify.js";

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
  chainWitness: typeof chainWitness;
  dashboard: typeof dashboard;
  exceptions: typeof exceptions;
  finance: typeof finance;
  financeAgent: typeof financeAgent;
  financeAgentData: typeof financeAgentData;
  health: typeof health;
  "lib/cdpSql": typeof lib_cdpSql;
  "lib/cdpWallet": typeof lib_cdpWallet;
  "lib/copyDetection": typeof lib_copyDetection;
  "lib/dashboardRead": typeof lib_dashboardRead;
  "lib/demoAuth": typeof lib_demoAuth;
  "lib/finance": typeof lib_finance;
  "lib/financeAgentLoop": typeof lib_financeAgentLoop;
  "lib/gemini": typeof lib_gemini;
  "lib/media": typeof lib_media;
  "lib/verificationReport": typeof lib_verificationReport;
  media: typeof media;
  orders: typeof orders;
  payments: typeof payments;
  review: typeof review;
  seed: typeof seed;
  statements: typeof statements;
  submissions: typeof submissions;
  validators: typeof validators;
  verify: typeof verify;
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
