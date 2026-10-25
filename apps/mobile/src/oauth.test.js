import { expect, test } from 'bun:test';
import { googleSignIn } from './oauth';

for (const redirectTo of ['skarl://auth', 'exp://192.168.1.2:8081/--/auth']) {
  test(`Google exchanges the returned code using the same provider: ${redirectTo}`, async () => {
    const calls = [];
    const signIn = async (provider, params) => {
      calls.push({ provider, params });
      return params.code ? { signingIn: true } : { signingIn: false, redirect: new URL('https://backend.example/api/auth/signin/google') };
    };
    const result = await googleSignIn(signIn, redirectTo, async (url, destination) => {
      expect(url).toBe('https://backend.example/api/auth/signin/google');
      expect(destination).toBe(redirectTo);
      return { type: 'success', url: `${redirectTo}?code=one-time-code` };
    });
    expect(result).toBe(true);
    expect(calls).toEqual([{ provider: 'google', params: { redirectTo } }, { provider: 'google', params: { code: 'one-time-code' } }]);
  });
}

test('browser cancellation does not exchange a code or switch to demo', async () => {
  const calls = [];
  const signIn = async (...args) => { calls.push(args); return { redirect: new URL('https://backend.example'), signingIn: false }; };
  expect(await googleSignIn(signIn, 'skarl://auth', async () => ({ type: 'cancel' }))).toBe(false);
  expect(calls).toEqual([['google', { redirectTo: 'skarl://auth' }]]);
});

for (const url of ['https://evil.example/?code=stolen', 'other://auth?code=stolen', 'skarl://other?code=stolen', 'skarl://auth', 'skarl://auth?code=x#fragment']) {
  test(`refuses malformed/foreign callback before code exchange: ${url}`, async () => {
    let calls = 0;
    const signIn = async () => { calls++; return { redirect: new URL('https://backend.example'), signingIn: false }; };
    await expect(googleSignIn(signIn, 'skarl://auth', async () => ({ type: 'success', url }))).rejects.toThrow();
    expect(calls).toBe(1);
  });
}

test('a failed exchange is not reported as signed in', async () => {
  await expect(googleSignIn(async (_, params) => params.code ? { signingIn: false }
    : { redirect: new URL('https://backend.example'), signingIn: false }, 'skarl://auth',
  async () => ({ type: 'success', url: 'skarl://auth?code=x' }))).rejects.toThrow('could not finish');
});
