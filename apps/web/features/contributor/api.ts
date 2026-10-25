import { makeFunctionReference } from "convex/server";
import type { SubmissionStatus } from "@skarl/contracts";

/**
 * Typed references to the shared demo deployment. `submissions:*` is deployed but not yet in the
 * committed `convex/_generated/api`, so these are declared by name. Swap to the generated `api`
 * once `convex/submissions.ts` lands on main.
 */

/** Demo selector from docs/backend.md. Impersonable on purpose; this is not authentication. */
export { DEMO_CONTRIBUTOR as DEMO_IDENTITY } from "../../lib/auth/identities";
import { DEMO_CONTRIBUTOR as DEMO_IDENTITY } from "../../lib/auth/identities";

export type Criterion = { criterionId: string; description: string; modality: "visual" | "audio" | "cross_modal" | "temporal" };
export type Rubric = { _id: string; version: number; taskPrompt: string; criteria: Criterion[]; contentHash: string; frozenAt?: number };

export type DemoContext = { organizationId: string; orderId: string; taskVersionId?: string; demoOnly: true; network: string } | null;

export type OrderSummary = {
  order: {
    _id: string; title: string; status: string; quantityRequested: string; acceptedCount: string;
    pricePerSampleAtomic: string; contributorRateAtomic: string; deadlineAt: number; network: string;
    taskSpec?: { object: string; distractors: string[]; target: string; steps: string[]; narration?: string[] };
  };
  rubric: Rubric | null;
  demoOnly: true;
  realFundingRequired: boolean;
};

export type Analysis = {
  _id: string; implementation: "inference" | "scaffold"; pipelineStatus: string;
  recommendation: "accept" | "request_correction" | "needs_review"; summary: string; sourceHash: string; completedAt: number;
};
export type Decision = { _id: string; decision: "accepted" | "rejected" | "request_correction"; reason: string; decidedAt: number };

export type Submission = {
  _id: string; _creationTime: number; status: SubmissionStatus; clientRequestId: string; updatedAt: number;
  expectedSourceHash?: string; sourceHash?: string; perceptualHash?: string; supersedesSubmissionId?: string;
  analysis: Analysis | null; decision: Decision | null; delivery: { _id: string; publishedAt: number } | null;
  // Fields a newer backend may add; read defensively and never assumed.
  duplicateOfSubmissionId?: string; matchingSubmissionId?: string; duplicate?: boolean;
};

export type Payable = { _id: string; submissionId: string; amountAtomic: string; status: string; createdAt: number };

export type CreateSubmissionArgs = {
  demoIdentity: string; orderId: string; storageId: string; clientRequestId: string; consentAcknowledged: boolean;
  livenessChallengeId?: string;
};
export type LivenessChallenge = { challengeId: string; words: string[]; expiresAt: number };
/** The create mutation's return is not documented yet; the caller normalizes every shape it might take. */
export type CreateSubmissionResult = string | { ok?: boolean; code?: string; submissionId?: string; replayed?: boolean; [key: string]: unknown };

export const refs = {
  demoContext: makeFunctionReference<"query", { demoIdentity: string }, DemoContext>("dashboard:demoContext"),
  orderSummary: makeFunctionReference<"query", { demoIdentity: string; orderId: string }, OrderSummary>("dashboard:orderSummary"),
  submissions: makeFunctionReference<"query", { demoIdentity: string; orderId: string }, Submission[]>("dashboard:submissions"),
  payables: makeFunctionReference<"query", { demoIdentity: string; orderId: string }, Payable[]>("dashboard:payables"),
  generateUploadUrl: makeFunctionReference<"mutation", { demoIdentity: string }, string>("submissions:generateUploadUrl"),
  issueChallenge: makeFunctionReference<"mutation", { demoIdentity: string }, LivenessChallenge>("liveness:issueChallenge"),
  createSubmission: makeFunctionReference<"mutation", CreateSubmissionArgs, CreateSubmissionResult>("submissions:create"),
};

export function isDuplicate(submission: Submission) {
  if (submission.duplicate || submission.duplicateOfSubmissionId || submission.matchingSubmissionId) return true;
  return /duplicate/i.test(submission.decision?.reason ?? "");
}

/** Exact micro-USDC string to a label that keeps every significant decimal (1.875 stays 1.875), at least two. */
export function formatUsdc(atomic: string) {
  if (!/^\d+$/.test(atomic)) return atomic;
  const padded = atomic.padStart(7, "0");
  const whole = padded.slice(0, -6).replace(/^0+(?=\d)/, "");
  const fraction = padded.slice(-6).replace(/0+$/, "").padEnd(2, "0");
  return `${whole}.${fraction}`;
}
