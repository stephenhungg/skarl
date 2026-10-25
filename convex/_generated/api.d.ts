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
import type * as agentDiscovery from "../agentDiscovery.js";
import type * as agentWallet from "../agentWallet.js";
import type * as analytics from "../analytics.js";
import type * as annotationValidators from "../annotationValidators.js";
import type * as annotations from "../annotations.js";
import type * as approvalWorkflow from "../approvalWorkflow.js";
import type * as attestations from "../attestations.js";
import type * as attestationsNode from "../attestationsNode.js";
import type * as attestationsSchema from "../attestationsSchema.js";
import type * as auth from "../auth.js";
import type * as auth_memberships from "../auth/memberships.js";
import type * as bankWitness from "../bankWitness.js";
import type * as bankWitnessSchema from "../bankWitnessSchema.js";
import type * as chainWitness from "../chainWitness.js";
import type * as coach from "../coach.js";
import type * as coachData from "../coachData.js";
import type * as coachSchema from "../coachSchema.js";
import type * as consent from "../consent.js";
import type * as contributorKit from "../contributorKit.js";
import type * as contributorPlan from "../contributorPlan.js";
import type * as contributorWallet from "../contributorWallet.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as datasets from "../datasets.js";
import type * as evidenceSales from "../evidenceSales.js";
import type * as exceptions from "../exceptions.js";
import type * as finance from "../finance.js";
import type * as financeAgent from "../financeAgent.js";
import type * as financeAgentData from "../financeAgentData.js";
import type * as financeAnalyst from "../financeAnalyst.js";
import type * as financeAnalystData from "../financeAnalystData.js";
import type * as financeAnalystJobs from "../financeAnalystJobs.js";
import type * as financeAnalystRead from "../financeAnalystRead.js";
import type * as financeAnalystSchema from "../financeAnalystSchema.js";
import type * as financeToolRead from "../financeToolRead.js";
import type * as fixtures_demoOrders from "../fixtures/demoOrders.js";
import type * as fixtures_recordedEvidence from "../fixtures/recordedEvidence.js";
import type * as fixtures_seedWithTaskSpecs from "../fixtures/seedWithTaskSpecs.js";
import type * as fixtures_taskSpecs from "../fixtures/taskSpecs.js";
import type * as health from "../health.js";
import type * as healthData from "../healthData.js";
import type * as healthHttp from "../healthHttp.js";
import type * as healthJobs from "../healthJobs.js";
import type * as healthSchema from "../healthSchema.js";
import type * as http from "../http.js";
import type * as jiraFeed from "../jiraFeed.js";
import type * as lib_armRetarget from "../lib/armRetarget.js";
import type * as lib_authMemberships from "../lib/authMemberships.js";
import type * as lib_authPolicy from "../lib/authPolicy.js";
import type * as lib_canonical from "../lib/canonical.js";
import type * as lib_cdpSql from "../lib/cdpSql.js";
import type * as lib_cdpWallet from "../lib/cdpWallet.js";
import type * as lib_claude from "../lib/claude.js";
import type * as lib_config from "../lib/config.js";
import type * as lib_contributorCoach from "../lib/contributorCoach.js";
import type * as lib_copyDetection from "../lib/copyDetection.js";
import type * as lib_dashboardRead from "../lib/dashboardRead.js";
import type * as lib_demoAuth from "../lib/demoAuth.js";
import type * as lib_derivedAnnotations from "../lib/derivedAnnotations.js";
import type * as lib_diversity from "../lib/diversity.js";
import type * as lib_eas from "../lib/eas.js";
import type * as lib_easSender from "../lib/easSender.js";
import type * as lib_finance from "../lib/finance.js";
import type * as lib_financeAgentBudget from "../lib/financeAgentBudget.js";
import type * as lib_financeAgentIntent from "../lib/financeAgentIntent.js";
import type * as lib_financeAgentLoop from "../lib/financeAgentLoop.js";
import type * as lib_financeAgentPrompt from "../lib/financeAgentPrompt.js";
import type * as lib_financeAgentProvider from "../lib/financeAgentProvider.js";
import type * as lib_financeAnalyst from "../lib/financeAnalyst.js";
import type * as lib_financeEvidenceReferences from "../lib/financeEvidenceReferences.js";
import type * as lib_financeToolDispatch from "../lib/financeToolDispatch.js";
import type * as lib_financeToolRegistry from "../lib/financeToolRegistry.js";
import type * as lib_gemini from "../lib/gemini.js";
import type * as lib_health from "../lib/health.js";
import type * as lib_healthProbe from "../lib/healthProbe.js";
import type * as lib_jiraFeed from "../lib/jiraFeed.js";
import type * as lib_media from "../lib/media.js";
import type * as lib_nessie from "../lib/nessie.js";
import type * as lib_onboardingSteps from "../lib/onboardingSteps.js";
import type * as lib_policyReview from "../lib/policyReview.js";
import type * as lib_proofEvidence from "../lib/proofEvidence.js";
import type * as lib_provenance from "../lib/provenance.js";
import type * as lib_publicRateLimit from "../lib/publicRateLimit.js";
import type * as lib_recordingPlan from "../lib/recordingPlan.js";
import type * as lib_requestIdempotency from "../lib/requestIdempotency.js";
import type * as lib_sampleQuality from "../lib/sampleQuality.js";
import type * as lib_sensorTrace from "../lib/sensorTrace.js";
import type * as lib_serviceAuth from "../lib/serviceAuth.js";
import type * as lib_spokenLiveness from "../lib/spokenLiveness.js";
import type * as lib_taskSpec from "../lib/taskSpec.js";
import type * as lib_tax from "../lib/tax.js";
import type * as lib_trainingFormats from "../lib/trainingFormats.js";
import type * as lib_untrustedToolData from "../lib/untrustedToolData.js";
import type * as lib_verificationReport from "../lib/verificationReport.js";
import type * as lib_visualJury from "../lib/visualJury.js";
import type * as liveness from "../liveness.js";
import type * as mcp from "../mcp.js";
import type * as mcpPublic from "../mcpPublic.js";
import type * as media from "../media.js";
import type * as onboarding from "../onboarding.js";
import type * as onboardingData from "../onboardingData.js";
import type * as orders from "../orders.js";
import type * as payments from "../payments.js";
import type * as policy from "../policy.js";
import type * as proof from "../proof.js";
import type * as proofPublic from "../proofPublic.js";
import type * as provenance from "../provenance.js";
import type * as publicSecurity from "../publicSecurity.js";
import type * as publicSecuritySchema from "../publicSecuritySchema.js";
import type * as refunds from "../refunds.js";
import type * as review from "../review.js";
import type * as scenarios from "../scenarios.js";
import type * as scheduledData from "../scheduledData.js";
import type * as scheduledJobs from "../scheduledJobs.js";
import type * as seed from "../seed.js";
import type * as sensorTraceValidators from "../sensorTraceValidators.js";
import type * as sensorTraces from "../sensorTraces.js";
import type * as solanaLicense from "../solanaLicense.js";
import type * as solanaLicenseData from "../solanaLicenseData.js";
import type * as statements from "../statements.js";
import type * as submissions from "../submissions.js";
import type * as taskSpecExtraction from "../taskSpecExtraction.js";
import type * as taskSpecMigration from "../taskSpecMigration.js";
import type * as taskThumbnails from "../taskThumbnails.js";
import type * as taskThumbnailsData from "../taskThumbnailsData.js";
import type * as tax from "../tax.js";
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
  agentDiscovery: typeof agentDiscovery;
  agentWallet: typeof agentWallet;
  analytics: typeof analytics;
  annotationValidators: typeof annotationValidators;
  annotations: typeof annotations;
  approvalWorkflow: typeof approvalWorkflow;
  attestations: typeof attestations;
  attestationsNode: typeof attestationsNode;
  attestationsSchema: typeof attestationsSchema;
  auth: typeof auth;
  "auth/memberships": typeof auth_memberships;
  bankWitness: typeof bankWitness;
  bankWitnessSchema: typeof bankWitnessSchema;
  chainWitness: typeof chainWitness;
  coach: typeof coach;
  coachData: typeof coachData;
  coachSchema: typeof coachSchema;
  consent: typeof consent;
  contributorKit: typeof contributorKit;
  contributorPlan: typeof contributorPlan;
  contributorWallet: typeof contributorWallet;
  crons: typeof crons;
  dashboard: typeof dashboard;
  datasets: typeof datasets;
  evidenceSales: typeof evidenceSales;
  exceptions: typeof exceptions;
  finance: typeof finance;
  financeAgent: typeof financeAgent;
  financeAgentData: typeof financeAgentData;
  financeAnalyst: typeof financeAnalyst;
  financeAnalystData: typeof financeAnalystData;
  financeAnalystJobs: typeof financeAnalystJobs;
  financeAnalystRead: typeof financeAnalystRead;
  financeAnalystSchema: typeof financeAnalystSchema;
  financeToolRead: typeof financeToolRead;
  "fixtures/demoOrders": typeof fixtures_demoOrders;
  "fixtures/recordedEvidence": typeof fixtures_recordedEvidence;
  "fixtures/seedWithTaskSpecs": typeof fixtures_seedWithTaskSpecs;
  "fixtures/taskSpecs": typeof fixtures_taskSpecs;
  health: typeof health;
  healthData: typeof healthData;
  healthHttp: typeof healthHttp;
  healthJobs: typeof healthJobs;
  healthSchema: typeof healthSchema;
  http: typeof http;
  jiraFeed: typeof jiraFeed;
  "lib/armRetarget": typeof lib_armRetarget;
  "lib/authMemberships": typeof lib_authMemberships;
  "lib/authPolicy": typeof lib_authPolicy;
  "lib/canonical": typeof lib_canonical;
  "lib/cdpSql": typeof lib_cdpSql;
  "lib/cdpWallet": typeof lib_cdpWallet;
  "lib/claude": typeof lib_claude;
  "lib/config": typeof lib_config;
  "lib/contributorCoach": typeof lib_contributorCoach;
  "lib/copyDetection": typeof lib_copyDetection;
  "lib/dashboardRead": typeof lib_dashboardRead;
  "lib/demoAuth": typeof lib_demoAuth;
  "lib/derivedAnnotations": typeof lib_derivedAnnotations;
  "lib/diversity": typeof lib_diversity;
  "lib/eas": typeof lib_eas;
  "lib/easSender": typeof lib_easSender;
  "lib/finance": typeof lib_finance;
  "lib/financeAgentBudget": typeof lib_financeAgentBudget;
  "lib/financeAgentIntent": typeof lib_financeAgentIntent;
  "lib/financeAgentLoop": typeof lib_financeAgentLoop;
  "lib/financeAgentPrompt": typeof lib_financeAgentPrompt;
  "lib/financeAgentProvider": typeof lib_financeAgentProvider;
  "lib/financeAnalyst": typeof lib_financeAnalyst;
  "lib/financeEvidenceReferences": typeof lib_financeEvidenceReferences;
  "lib/financeToolDispatch": typeof lib_financeToolDispatch;
  "lib/financeToolRegistry": typeof lib_financeToolRegistry;
  "lib/gemini": typeof lib_gemini;
  "lib/health": typeof lib_health;
  "lib/healthProbe": typeof lib_healthProbe;
  "lib/jiraFeed": typeof lib_jiraFeed;
  "lib/media": typeof lib_media;
  "lib/nessie": typeof lib_nessie;
  "lib/onboardingSteps": typeof lib_onboardingSteps;
  "lib/policyReview": typeof lib_policyReview;
  "lib/proofEvidence": typeof lib_proofEvidence;
  "lib/provenance": typeof lib_provenance;
  "lib/publicRateLimit": typeof lib_publicRateLimit;
  "lib/recordingPlan": typeof lib_recordingPlan;
  "lib/requestIdempotency": typeof lib_requestIdempotency;
  "lib/sampleQuality": typeof lib_sampleQuality;
  "lib/sensorTrace": typeof lib_sensorTrace;
  "lib/serviceAuth": typeof lib_serviceAuth;
  "lib/spokenLiveness": typeof lib_spokenLiveness;
  "lib/taskSpec": typeof lib_taskSpec;
  "lib/tax": typeof lib_tax;
  "lib/trainingFormats": typeof lib_trainingFormats;
  "lib/untrustedToolData": typeof lib_untrustedToolData;
  "lib/verificationReport": typeof lib_verificationReport;
  "lib/visualJury": typeof lib_visualJury;
  liveness: typeof liveness;
  mcp: typeof mcp;
  mcpPublic: typeof mcpPublic;
  media: typeof media;
  onboarding: typeof onboarding;
  onboardingData: typeof onboardingData;
  orders: typeof orders;
  payments: typeof payments;
  policy: typeof policy;
  proof: typeof proof;
  proofPublic: typeof proofPublic;
  provenance: typeof provenance;
  publicSecurity: typeof publicSecurity;
  publicSecuritySchema: typeof publicSecuritySchema;
  refunds: typeof refunds;
  review: typeof review;
  scenarios: typeof scenarios;
  scheduledData: typeof scheduledData;
  scheduledJobs: typeof scheduledJobs;
  seed: typeof seed;
  sensorTraceValidators: typeof sensorTraceValidators;
  sensorTraces: typeof sensorTraces;
  solanaLicense: typeof solanaLicense;
  solanaLicenseData: typeof solanaLicenseData;
  statements: typeof statements;
  submissions: typeof submissions;
  taskSpecExtraction: typeof taskSpecExtraction;
  taskSpecMigration: typeof taskSpecMigration;
  taskThumbnails: typeof taskThumbnails;
  taskThumbnailsData: typeof taskThumbnailsData;
  tax: typeof tax;
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
