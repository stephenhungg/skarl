import { makeFunctionReference } from 'convex/server';

// Explicit string references keep Metro independent of the backend workspace.
// These response projections mirror convex/dashboard.ts and submissions.ts.
export const identity = { demoIdentity: 'contributor' } as const;
type Identity = typeof identity;
export type Context = { orderId: string; network: string } | null;
export type Summary = {
  order: { _id: string; _creationTime: number; title: string; status: string; network: string; contributorRateAtomic: string;
    quantityRequested: string; acceptedCount: string; deadlineAt?: number };
  rubric: { version: number; contentHash: string; taskPrompt: string; criteria: { criterionId: string; description: string; modality: string }[] } | null;
};
export type LivenessChallenge = { challengeId: string; words: string[]; expiresAt: number };
export type Report = {
  status: string;
  report: {
    pipeline: { status: string; implementation: string };
    recommendation: string;
    criteria: { criterionId: string; status: string; reason: string;
      evidence: { startMs: number; endMs: number; claim: string; modality: string }[] }[];
  } | null;
};
export type SubmissionRow = {
  _id: string; _creationTime: number; orderId: string; status: string; updatedAt: number;
  contributorTokenIdentifier: string; verificationOnly?: boolean;
};
export type PayoutProjection = { status: 'pending' | 'paid' | 'not_payable'; amountAtomic: string | null; txHash: string | null; explorerUrl: string | null };
export type EarningRow = {
  submissionId: string; orderId: string; status: string; amountAtomic: string;
  payableStatus: 'accrued' | 'payout_in_progress' | 'paid' | 'reversed' | null; payout: PayoutProjection;
};
export const api = {
  context: makeFunctionReference<'query', Identity, Context>('dashboard:demoContext'),
  summary: makeFunctionReference<'query', Identity & { orderId: string }, Summary>('dashboard:orderSummary'),
  submissions: makeFunctionReference<'query', Identity & { orderId: string }, SubmissionRow[]>('dashboard:submissions'),
  earnings: makeFunctionReference<'query', Identity, EarningRow[]>('datasets:contributorEarnings'),
  report: makeFunctionReference<'query', Identity & { submissionId: string }, Report>('submissions:getReport'),
  challenge: makeFunctionReference<'mutation', Identity, LivenessChallenge>('liveness:issueChallenge'),
  uploadUrl: makeFunctionReference<'mutation', Identity, string>('submissions:generateUploadUrl'),
  create: makeFunctionReference<'mutation', Identity & { orderId: string; storageId: string;
    clientRequestId: string; consentAcknowledged: true; livenessChallengeId?: string }, { submissionId: string; replayed: boolean }>('submissions:create'),
  attach: makeFunctionReference<'action', Identity & { submissionId: string; storageId: string }, unknown>('sensorTraces:attachSensorTrace'),
};

export function usdc(atomic: string) {
  const digits = atomic.padStart(7, '0');
  return `${digits.slice(0, -6)}.${digits.slice(-6).replace(/0+$/, '') || '0'}`;
}

/** Fixed two decimals for balances, more only when the atomic amount needs them. */
export function money(atomic: string | bigint) {
  const value = typeof atomic === 'bigint' ? atomic : BigInt(atomic);
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(7, '0');
  let fraction = digits.slice(-6).replace(/0+$/, '');
  if (fraction.length < 2) fraction = fraction.padEnd(2, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -6)}.${fraction}`;
}
