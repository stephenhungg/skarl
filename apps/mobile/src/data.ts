import { useMemo } from 'react';
import { useConvexConnectionState, useQueries, useQuery } from 'convex/react';
import { mobileConfig } from './config';
import { api, identity, type EarningRow, type Summary, type SubmissionRow } from './api';

export const CLOSED = ['closed', 'cancelled', 'cancelling', 'fulfilled', 'refunded'];
export const IN_REVIEW = ['uploading', 'queued', 'analysing', 'needs_review'];
const DAY = 24 * 60 * 60 * 1000;

export type LiveTask = {
  orderId: string; title: string; prompt: string; category: string; rateAtomic: string; status: string; closed: boolean;
  openSpots: string; quantity: string; isNew: boolean; criteria: NonNullable<Summary['rubric']>['criteria'];
  steps: string[];
  rubricVersion: number; rubricHash: string; network: string; taskSpec?: Summary['order']['taskSpec'];
};

/** Order titles name what is being collected; the category is that noun phrase, nothing more. */
function categoryOf(title: string) {
  const words = title.trim().split(/\s+/);
  const noun = words.at(-1) ?? 'Tasks';
  return noun.charAt(0).toUpperCase() + noun.slice(1);
}

function toTask(orderId: string, summary: Summary | undefined, network: string): LiveTask | null {
  if (!summary?.rubric) return null;
  const { order, rubric } = summary;
  const spec = rubric.taskSpecStatus === 'ready' ? rubric.taskSpec : undefined;
  const open = BigInt(order.quantityRequested) - BigInt(order.acceptedCount);
  return {
    orderId, title: order.title, prompt: rubric.taskPrompt.replace(/\s*[–-]\s*(?=\d)/g, ' to '),
    category: categoryOf(order.title), rateAtomic: order.contributorRateAtomic, status: order.status,
    closed: CLOSED.includes(order.status), openSpots: (open < 0n ? 0n : open).toString(), quantity: order.quantityRequested,
    isNew: Date.now() - order._creationTime < mobileConfig.newTaskWindowMs, criteria: rubric.criteria,
    rubricVersion: rubric.version, rubricHash: rubric.contentHash, network: order.network ?? network, taskSpec: spec,
    steps: [...(spec?.steps ?? rubric.criteria.map(criterion => criterion.description)), ...(spec?.narration ?? [])],
  };
}

/** One task: the order passed in, otherwise the default demo order. */
export function useLiveTask(orderId?: string) {
  const connection = useConvexConnectionState();
  const base = useQuery(api.context, identity);
  const context = useMemo(() => base && orderId ? { ...base, orderId } : base, [base, orderId]);
  const summary = useQuery(api.summary, context ? { ...identity, orderId: context.orderId } : 'skip');
  const task = useMemo(() => context ? toTask(context.orderId, summary, context.network) : null, [context?.orderId, context?.network, summary]);
  const loading = context === undefined || (context !== null && summary === undefined);
  return { task, loading, missing: context === null || (summary !== undefined && !summary?.rubric), summary, context,
    live: !!task && connection.isWebSocketConnected };
}

const OPEN_TASKS = { ids: { query: api.openTasks, args: identity } };

/** Every open task, newest first. Falls back to the default order if the backend has no task list yet. */
export function useOpenTasks() {
  const context = useQuery(api.context, identity);
  const listed = useQueries(OPEN_TASKS).ids as string[] | Error | undefined;
  const ids = useMemo(() => Array.isArray(listed) ? listed : context ? [context.orderId] : [], [listed, context?.orderId]);
  const queries = useMemo(() => Object.fromEntries(ids.map(orderId => [orderId, { query: api.summary, args: { ...identity, orderId } }])), [ids]);
  const summaries = useQueries(queries) as Record<string, Summary | Error | undefined>;
  const tasks = useMemo(() => ids.map(orderId => {
    const summary = summaries[orderId];
    return summary instanceof Error ? null : toTask(orderId, summary, context?.network ?? '');
  }).filter((task): task is LiveTask => !!task), [ids, summaries, context?.network]);
  const loading = context === undefined || (listed === undefined) || ids.some(orderId => summaries[orderId] === undefined);
  return { tasks, loading };
}

export type Earnings = { rows: EarningRow[] | undefined; error: Error | null };
const EARNINGS = { earnings: { query: api.earnings, args: identity } };
export function useEarnings(): Earnings {
  const result = useQueries(EARNINGS).earnings as EarningRow[] | Error | undefined;
  return result instanceof Error ? { rows: undefined, error: result } : { rows: result, error: null };
}

/** Joins contributor-owned rows across every order the contributor has touched, plus the live order. */
export function useContributorActivity() {
  const earnings = useEarnings();
  const { context } = useLiveTask();
  const orderIds = useMemo(() => [...new Set([...(earnings.rows ?? []).map(row => row.orderId), ...(context ? [context.orderId] : [])])],
    [earnings.rows, context]);
  const queries = useMemo(() => Object.fromEntries(orderIds.map(orderId =>
    [orderId, { query: api.submissions, args: { ...identity, orderId } }])), [orderIds]);
  const results = useQueries(queries) as Record<string, SubmissionRow[] | Error | undefined>;
  const submissions = useMemo(() => {
    const rows: SubmissionRow[] = [];
    for (const value of Object.values(results)) if (Array.isArray(value)) rows.push(...value);
    return rows.sort((a, b) => b._creationTime - a._creationTime);
  }, [results]);
  const loading = earnings.rows === undefined && !earnings.error || Object.values(results).some(value => value === undefined);
  const failed = Object.values(results).find(value => value instanceof Error) as Error | undefined;
  return { earnings, submissions, loading, error: earnings.error ?? failed ?? null };
}

export function totals(rows: EarningRow[] | undefined) {
  let pending = 0n, paid = 0n, earned = 0n;
  for (const row of rows ?? []) {
    if (!row.payableStatus || row.payableStatus === 'reversed') continue;
    const amount = BigInt(row.amountAtomic);
    earned += amount;
    if (row.payout.status === 'paid') paid += amount; else pending += amount;
  }
  return { pending, paid, earned };
}

export function contributorStats(rows: EarningRow[] | undefined, submissions: SubmissionRow[]) {
  const ids = new Set([...(rows ?? []).map(row => row.submissionId), ...submissions.map(row => row._id)]);
  const accepted = new Set([...(rows ?? []).filter(row => row.status === 'accepted').map(row => row.submissionId),
    ...submissions.filter(row => row.status === 'accepted').map(row => row._id)]);
  const days = new Set(submissions.map(row => new Date(row._creationTime).toDateString()));
  return { uploads: ids.size, earned: totals(rows).earned, completed: accepted.size, days: days.size };
}

export const statusLabel: Record<string, string> = {
  uploading: 'Uploading', queued: 'Queued', analysing: 'Analysing', needs_review: 'Needs review',
  needs_correction: 'Needs correction', accepted: 'Accepted', rejected: 'Held',
};
export const label = (status: string) => statusLabel[status] ?? status.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

export function when(ms: number) {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / 3_600_000)} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
