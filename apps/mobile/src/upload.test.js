import { beforeEach, expect, mock, test } from 'bun:test';
import { getFunctionName } from 'convex/server';

const local = new Map();
mock.module('@react-native-async-storage/async-storage', () => ({ default: {
  setItem: async (key, value) => { local.set(key, value); },
  getItem: async key => local.get(key) ?? null,
  removeItem: async key => { local.delete(key); },
} }));
mock.module('expo-file-system', () => ({ File: class { exists = true; size = 100; } }));
const posts = [];
mock.module('expo/fetch', () => ({ fetch: async (url, options) => {
  posts.push({ url, options });
  return { ok: true, json: async () => ({ storageId: `storage-${posts.length}` }) };
} }));
const { submitDraft, loadDraft } = await import('./upload');
const initial = () => ({ uri: 'file:///private/take.mov', clientRequestId: 'stable-uuid', orderId: 'order-1',
  trace: { version: 1, samples: [], sensors: [] } });
let latest;
beforeEach(() => { local.clear(); posts.length = 0; latest = undefined; });
const update = draft => { latest = draft; };

test('lost create response resumes same request and stored video; no second submission', async () => {
  const creations = new Map(), requests = [];
  const client = {
    mutation: async (ref, args) => {
      if (getFunctionName(ref) === 'submissions:generateUploadUrl') return 'https://storage.example/upload';
      requests.push(args);
      if (!creations.has(args.clientRequestId)) {
        creations.set(args.clientRequestId, 'submission-1');
        throw new Error('Network disconnected after commit');
      }
      return { submissionId: creations.get(args.clientRequestId), replayed: true };
    }, action: async () => ({}),
  };
  await expect(submitDraft(client, initial(), update)).rejects.toThrow('Network disconnected');
  const restored = await loadDraft();
  expect(restored.createAttempted).toBe(true);
  expect(restored.submissionId).toBeUndefined();
  await submitDraft(client, restored, update);
  expect(creations.size).toBe(1);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[0]).not.toHaveProperty('verificationOnly');
  expect(requests[0].consentAcknowledged).toBe(true);
  expect(posts.length).toBe(2);
  expect(posts[0].options.headers['Content-Type']).toBe('video/quicktime');
  expect(latest.attached).toBe(true);
});

test('attachment timeout resumes only attachment after relaunch', async () => {
  let creates = 0, attaches = 0;
  const client = { mutation: async ref => {
    if (getFunctionName(ref) === 'submissions:generateUploadUrl') return 'https://storage.example/upload';
    creates++; return { submissionId: 'submission-2' };
  }, action: async () => { if (++attaches === 1) throw new Error('timeout'); return {}; } };
  await expect(submitDraft(client, initial(), update)).rejects.toThrow('timeout');
  const restored = await loadDraft();
  expect(restored.submissionId).toBe('submission-2');
  await submitDraft(client, restored, update);
  expect(creates).toBe(1); expect(attaches).toBe(2); expect(posts.length).toBe(2);
  expect((await loadDraft()).attached).toBe(true);
});

test('explicit creation refusal permits discard; ambiguous errors preserve the request', async () => {
  for (const [failure, attempted] of [['Uncaught Error: order_closed\n    at handler', false], ['Server timeout', true]]) {
    const client = { mutation: async ref => {
      if (getFunctionName(ref) === 'submissions:generateUploadUrl') return 'https://storage.example/upload';
      throw new Error(failure);
    } };
    await expect(submitDraft(client, initial(), update)).rejects.toThrow();
    expect(latest.createAttempted).toBe(attempted);
    expect((await loadDraft()).clientRequestId).toBe('stable-uuid');
  }
});

test('late evidence refusal retains known submission and permits a new take', async () => {
  const client = { mutation: async ref => getFunctionName(ref) === 'submissions:generateUploadUrl'
    ? 'https://storage.example/upload' : { submissionId: 'reviewed-1' },
    action: async () => { throw new Error('Uncaught Error: submission_evidence_closed\n    at handler'); } };
  await expect(submitDraft(client, initial(), update)).rejects.toThrow('submission_evidence_closed');
  expect(latest.submissionId).toBe('reviewed-1'); expect(latest.attachmentClosed).toBe(true); expect(latest.attached).not.toBe(true);
});
