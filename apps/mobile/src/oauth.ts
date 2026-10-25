type SignIn = (provider: string, params: Record<string, string>) => Promise<{ redirect?: URL; signingIn: boolean }>;
type BrowserResult = { type: string; url?: string };

/** Convex Auth retains and validates its verifier when exchanging the callback code. */
export async function googleSignIn(
  signIn: SignIn,
  redirectTo: string,
  openSession: (url: string, redirectTo: string) => Promise<BrowserResult>,
) {
  const { redirect } = await signIn('google', { redirectTo });
  if (!redirect) throw new Error('Google sign-in did not return a redirect. Please try again.');
  const result = await openSession(redirect.toString(), redirectTo);
  if (result.type !== 'success') return false;
  const expected = new URL(redirectTo);
  const returned = new URL(result.url ?? '');
  if (returned.protocol !== expected.protocol || returned.host !== expected.host || returned.pathname !== expected.pathname
    || returned.username || returned.password || returned.hash) {
    throw new Error('Google sign-in returned an unexpected callback. Please try again.');
  }
  const code = returned.searchParams.get('code');
  if (!code) throw new Error('Google sign-in did not return a code. Please try again.');
  const { signingIn } = await signIn('google', { code });
  if (!signingIn) throw new Error('Google sign-in could not finish. Please try again.');
  return true;
}
