"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { CONTROLLER } from "./data";
import { formatTime } from "./format";
import { Loading, Section } from "./ui";

type RevocationRequest = { consentRecordId: string; submissionId: string; orderId: string;
  status: string; requestedAt: number | null; reason: string | null };
const requestsRef = makeFunctionReference<"query", { demoIdentity: string }, RevocationRequest[]>("consent:revocationRequests");

/** Requests require human follow-up. The queue never suggests that deleting an obligation is revocation. */
export function ConsentRevocations() {
  const requests = useQuery(requestsRef, { demoIdentity: CONTROLLER });
  return <Section title="Consent revocation requests" meta="All orders in this organization">
    <p className="mb-3 type-body-sm text-text-2">Review contributor requests and the affected sample before taking action. A request does not recall delivered copies. Posted financial journals remain immutable so owed and paid amounts stay auditable.</p>
    {requests === undefined ? <Loading rows={2} /> : requests.length === 0 ? <p className="rounded-panel border border-line-faint px-4 py-3 type-body-sm text-text-2">No revocation requests recorded.</p> : <ul className="divide-y divide-line-faint rounded-panel border border-line-faint">
      {requests.map(request => <li key={request.consentRecordId} className="space-y-2 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><Link href={`/dashboard/submissions/${request.submissionId}`} className="type-label underline underline-offset-4">Review sample {request.submissionId.slice(0, 10)}</Link>
          <span className="type-label-sm text-text-3">Requested {request.requestedAt === null ? "· time unavailable" : formatTime(request.requestedAt)}</span></div>
        <p className="whitespace-pre-wrap break-words type-body-sm text-text-2">{request.reason ?? "No reason recorded."}</p>
        <p className="type-label-sm font-mono text-text-3 break-all">Consent {request.consentRecordId} · order {request.orderId}</p>
      </li>)}
    </ul>}
  </Section>;
}
