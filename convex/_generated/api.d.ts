/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as dashboard from "../dashboard.js";
import type * as finance from "../finance.js";
import type * as health from "../health.js";
import type * as lib_copyDetection from "../lib/copyDetection.js";
import type * as lib_demoAuth from "../lib/demoAuth.js";
import type * as lib_finance from "../lib/finance.js";
import type * as lib_gemini from "../lib/gemini.js";
import type * as lib_media from "../lib/media.js";
import type * as lib_verificationReport from "../lib/verificationReport.js";
import type * as payments from "../payments.js";
import type * as seed from "../seed.js";
import type * as submissions from "../submissions.js";
import type * as validators from "../validators.js";
import type * as verify from "../verify.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  dashboard: typeof dashboard;
  finance: typeof finance;
  health: typeof health;
  "lib/copyDetection": typeof lib_copyDetection;
  "lib/demoAuth": typeof lib_demoAuth;
  "lib/finance": typeof lib_finance;
  "lib/gemini": typeof lib_gemini;
  "lib/media": typeof lib_media;
  "lib/verificationReport": typeof lib_verificationReport;
  payments: typeof payments;
  seed: typeof seed;
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

export declare const components: {};
