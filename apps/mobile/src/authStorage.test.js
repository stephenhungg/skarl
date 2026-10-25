import { expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
const values = new Map();
const calls = [];
mock.module('expo-secure-store', () => ({
  getItemAsync: async key => { calls.push(['get', key]); return values.get(key) ?? null; },
  setItemAsync: async (key, value) => { calls.push(['set', key, value]); values.set(key, value); },
  deleteItemAsync: async key => { calls.push(['delete', key]); values.delete(key); },
}));
const { authStorage } = await import('./authStorage');

test('Convex token storage reads/writes/deletes through SecureStore', async () => {
  await authStorage.setItem('refresh_token', 'private-token');
  expect(await authStorage.getItem('refresh_token')).toBe('private-token');
  await authStorage.removeItem('refresh_token');
  expect(await authStorage.getItem('refresh_token')).toBeNull();
  expect(calls).toEqual([['set', 'refresh_token', 'private-token'], ['get', 'refresh_token'], ['delete', 'refresh_token'], ['get', 'refresh_token']]);
});

test('the shared Convex client is auth-enabled and receives the SecureStore adapter', () => {
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  expect(app).toContain('<ConvexAuthProvider client={client} storage={authStorage}>');
  const storage = readFileSync(new URL('./authStorage.ts', import.meta.url), 'utf8');
  expect(storage).not.toContain("from '@react-native-async-storage/async-storage'");
});
