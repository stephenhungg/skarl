import { makeFunctionReference } from 'convex/server';

// Explicit string references keep Metro independent of the backend workspace.
// These response projections mirror convex/dashboard.ts and submissions.ts.
export const identity = { demoIdentity: 'contributor' } as const;
type Identity = typeof identity;
export type Context = { orderId: string; network: string } | null;
export type Summary = {
  order: { title: string; status: string; contributorRateAtomic: string; quantityRequested: string; acceptedCount: string };
  rubric: { version: number; contentHash: string; taskPrompt: string; criteria: { criterionId: string; description: string; modality: string }[] } | null;
};
export type Report = {
  status: string;
  report: {
    pipeline: { status: string; implementation: string };
    recommendation: string;
    criteria: { criterionId: string; status: string; reason: string;
      evidence: { startMs: number; endMs: number; claim: string; modality: string }[] }[];
  } | null;
};
export const api = {
  context: makeFunctionReference<'query', Identity, Context>('dashboard:demoContext'),
  summary: makeFunctionReference<'query', Identity & { orderId: string }, Summary>('dashboard:orderSummary'),
  report: makeFunctionReference<'query', Identity & { submissionId: string }, Report>('submissions:getReport'),
  uploadUrl: makeFunctionReference<'mutation', Identity, string>('submissions:generateUploadUrl'),
  create: makeFunctionReference<'mutation', Identity & { orderId: string; storageId: string;
    clientRequestId: string; consentAcknowledged: true }, { submissionId: string; replayed: boolean }>('submissions:create'),
  attach: makeFunctionReference<'action', Identity & { submissionId: string; storageId: string }, unknown>('sensorTraces:attachSensorTrace'),
};

export function usdc(atomic: string) {
  const digits = atomic.padStart(7, '0');
  return `${digits.slice(0, -6)}.${digits.slice(-6).replace(/0+$/, '') || '0'}`;
}
