import { mobileConfig } from './config';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';
import { fetch } from 'expo/fetch';
import type { ConvexReactClient } from 'convex/react';
import { api, identity } from './api';
import type { Trace } from './sensors';

// Only explicit server refusals prove no creation occurred. Transport errors remain unresolved.
function refused(error: unknown, codes: string[]) {
  return error instanceof Error && error.message.split('\n').some(line =>
    codes.includes(line.replace(/^Uncaught Error: /, '').trim()));
}

const DRAFT_KEY = 'skarl.contribution.v1';
export type Draft = {
  uri: string; clientRequestId: string; orderId: string; trace: Trace;
  videoStorageId?: string; sensorStorageId?: string; submissionId?: string;
  livenessChallengeId?: string; livenessExpiresAt?: number;
  createAttempted?: boolean; attached?: boolean; attachmentClosed?: boolean;
};
export const saveDraft = (draft: Draft) => AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
export async function loadDraft(): Promise<Draft | null> {
  const json = await AsyncStorage.getItem(DRAFT_KEY);
  return json ? JSON.parse(json) as Draft : null;
}
export const clearDraft = () => AsyncStorage.removeItem(DRAFT_KEY);

async function post(client: ConvexReactClient, body: File | string, contentType: string) {
  const url = await client.mutation(api.uploadUrl, identity);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), mobileConfig.uploadTimeoutMs);
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': contentType }, body, signal: controller.signal });
    if (!response.ok) throw new Error(`Storage upload failed (${response.status}). Retry when connected.`);
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object' || !('storageId' in value) || typeof value.storageId !== 'string') {
      throw new Error('Storage did not return an upload ID.');
    }
    return value.storageId;
  } finally { clearTimeout(timer); }
}

/** Persist every completed stage; creation retries always use the same business ID and video. */
export async function submitDraft(client: ConvexReactClient, initial: Draft,
  update: (draft: Draft, label: string) => void) {
  let draft = { ...initial };
  const persist = async (patch: Partial<Draft>, label: string) => {
    draft = { ...draft, ...patch };
    update(draft, label);
    await saveDraft(draft);
  };
  if (!draft.videoStorageId) {
    update(draft, 'Uploading private video…');
    const file = new File(draft.uri);
    if (!file.exists || file.size <= 0 || file.size > mobileConfig.uploadMaxVideoBytes) {
      throw new Error(`Video is missing or exceeds ${mobileConfig.uploadMaxVideoBytes / 1024 / 1024} MB. Record a new take.`);
    }
    const mime = /\.mov(?:\?|$)/i.test(draft.uri) ? 'video/quicktime' : 'video/mp4';
    await persist({ videoStorageId: await post(client, file, mime) }, 'Video stored');
  }
  if (!draft.sensorStorageId) {
    update(draft, 'Uploading sensor trace…');
    const json = JSON.stringify(draft.trace);
    if (new TextEncoder().encode(json).length > mobileConfig.uploadMaxTraceBytes) throw new Error(`Sensor trace exceeds ${mobileConfig.uploadMaxTraceBytes / 1024 / 1024} MB.`);
    await persist({ sensorStorageId: await post(client, json, 'application/json') }, 'Sensor trace stored');
  }
  if (!draft.submissionId) {
    // Persist before the request: a timeout never authorizes creating a fresh contribution.
    await persist({ createAttempted: true }, 'Creating consented contribution…');
    try {
      const result = await client.mutation(api.create, { ...identity, orderId: draft.orderId,
        storageId: draft.videoStorageId!, clientRequestId: draft.clientRequestId, consentAcknowledged: true,
        ...(draft.livenessChallengeId ? { livenessChallengeId: draft.livenessChallengeId } : {}) });
      await persist({ submissionId: result.submissionId }, 'Contribution queued; attaching sensors…');
    } catch (error) {
      if (refused(error, ['order_closed', 'consent_required', 'rubric_required', 'frozen_rubric_required', 'upload_size_invalid', 'unsupported_upload_type',
        'liveness_challenge_expired', 'liveness_challenge_used', 'liveness_challenge_foreign', 'liveness_challenge_not_found'])) {
        await persist({ createAttempted: false }, 'Contribution refused; discard this take and record a new one with fresh words.');
      }
      throw error;
    }
  }
  if (!draft.attached && !draft.attachmentClosed) {
    try {
      await client.action(api.attach, { ...identity, submissionId: draft.submissionId!, storageId: draft.sensorStorageId! });
      await persist({ attached: true }, 'Video and sensor trace submitted');
    } catch (error) {
      if (refused(error, ['submission_evidence_closed'])) {
        await persist({ attachmentClosed: true }, 'A reviewer already decided this submission. New sensor evidence cannot be attached.');
      }
      throw error;
    }
  }
  return draft;
}
